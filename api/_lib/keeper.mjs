// The ruling loop's keeper and its Checker.
//
//   keeper   every challenge whose dispute window has ended is finalized, and every challenge
//            whose jury deadline passed with no two matching verdicts is expired (both are
//            permissionless on the market; a narrowly scoped key signs them)
//   correct  when a line our measurement caught out of date settles FALSE, its corrected wording
//            (the latest signed rewrite's sentence for it, in the "correct" band) opens as a new
//            market with open_claim, at the same liquidity b, linked to the old line in the store
//   Checker  a plain account with a $1 bond balance sits daily: at the first cron run at or after
//            CHECKER_SITTING_HOUR_UTC it challenges (claimed_outcome false) the caught line with
//            the most bets, CHECKER_PER_DAY a day, one at a time, with the corpus record and its
//            sha256 as evidence. A line with fewer than CHECKER_MIN_BETS bets waits, so a ruling
//            pays someone. The jury (POST /api/after-challenge) rules on it within minutes; the
//            keeper finalizes it. The signer's daily caps stay above this as a safety net: the
//            keeper asks where they stand first, and reaching one is a quiet state, not a failure.
//
// Every money move goes through the signer process (roles "keeper" and "checker"); this module
// holds no key. The pure functions below are what the tests exercise.

import { createHash } from "node:crypto";
import errors from "../../corpus/ERRORS.json" with { type: "json" };
import { corpusEvidence, normText } from "../../services/ai/src/evidence.js";

export const CRON_EVERY_MS = 10 * 60_000;
const SLOT_MS = 30_000; // how long into a cron run the Checker has acted
const LIVE = ["jury", "window", "escalated"];
const CAPPED_OPEN = "today's cap on opened lines is reached: the keeper opens it after midnight UTC";
const NS = 1_000_000n;
const nsToMs = (ns) => (ns === null || ns === undefined ? null : Number(BigInt(String(ns)) / NS));
const day = (t) => new Date(t).toISOString().slice(0, 10);
const sittingAt = (t, hour, days = 0) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, hour); };
const hhmm = (hour) => `${String(hour).padStart(2, "0")}:00 UTC`;

/** When the cron run at or after t has done its work: it fires on the ten-minute marks. */
export function nextTick(t, every = CRON_EVERY_MS, latencyMs = 45_000) {
  return Math.ceil(t / every) * every + latencyMs;
}

// ---------- the keeper's plan ----------

/**
 * What the keeper should send now, from the chain's views.
 * @param {{ challenges: { id: number, ch: object, claim: object, windowEndNs?: string|null }[], nowMs: number, marginMs?: number }} a
 * @returns {{ method: "finalize"|"expire_challenge", challenge_id: number, claim_id: number, why: string }[]}
 */
export function planKeeper({ challenges, nowMs, marginMs = 5000 }) {
  const out = [];
  for (const { id, ch, claim, windowEndNs } of challenges) {
    if (!ch || ch.resolved || !claim || claim.challenge_id !== id) continue;
    if (claim.status !== "Challenged") continue; // Open, Settled, or Escalated (the council's)
    if (claim.provisional === true || claim.provisional === false) {
      const end = nsToMs(windowEndNs ?? ch.window_ends_ns);
      if (end !== null && nowMs >= end + marginMs) out.push({ method: "finalize", challenge_id: id, claim_id: ch.claim_id, why: `the dispute window ended ${new Date(end).toISOString()}` });
    } else {
      const deadline = nsToMs(ch.jury_deadline_ns);
      if (deadline !== null && nowMs > deadline + marginMs) out.push({ method: "expire_challenge", challenge_id: id, claim_id: ch.claim_id, why: `the jury deadline passed ${new Date(deadline).toISOString()} with no quorum` });
    }
  }
  return out;
}

// ---------- the sitting ----------

export const SITTING = { perDay: 1, hourUtc: 15, minBets: 1 };

/** The sitting's schedule from CHECKER_PER_DAY, CHECKER_SITTING_HOUR_UTC and CHECKER_MIN_BETS; anything out of range keeps the default. */
export function sittingConfig(env = process.env) {
  const whole = (v, min, max, d) => (v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : d);
  return {
    perDay: whole(env.CHECKER_PER_DAY, 1, 1000, SITTING.perDay),
    hourUtc: whole(env.CHECKER_SITTING_HOUR_UTC, 0, 23, SITTING.hourUtc),
    minBets: whole(env.CHECKER_MIN_BETS, 0, 1_000_000, SITTING.minBets),
  };
}

/** A signer refusal that only means today's cap is reached: the keeper waits, nothing failed. */
export const isCapRefusal = (error) => /already (opened|posted) today/.test(String(error));

// ---------- the Checker ----------

/** The corpus record behind a caught line, and its sha256 (over the record's JSON as committed). */
export function corpusRecord(corpusId) {
  const item = (errors.items || []).find((x) => x.id === corpusId) || null;
  return item ? { item, sha256: createHash("sha256").update(JSON.stringify(item), "utf8").digest("hex") } : null;
}

/** The evidence the Checker posts: the corpus record in plain words, its source, and its hash. At most 4,000 bytes. */
export function checkerEvidence(ev) {
  const rec = corpusRecord(ev.corpus_id);
  const lines = [
    `Priced In's Checker. Corpus record ${ev.corpus_id}: our measurement found this line ${ev.verdict === "wrong" ? "wrong" : "out of date"} (checked ${ev.checked_on || "recently"}).`,
    ev.value_on_page ? `The line says: ${ev.value_on_page}.` : null,
    `${ev.source_name || "The source"} gives today: ${ev.value_today}.`,
    `Source: ${ev.source_url}`,
    ev.receipt_match ? `Receipt excerpt: "${ev.receipt_match.slice(0, 600)}"` : null,
    rec ? `Record sha256: ${rec.sha256} (corpus/ERRORS.json, github.com/iamdflame/priced-in)` : null,
  ].filter(Boolean);
  let s = lines.join("\n");
  while (Buffer.byteLength(s, "utf8") > 4000) s = s.slice(0, -64);
  return s;
}

/** Bets on a line. Bets sold back out don't count: with no position left, a ruling pays nobody. */
export function betsOn(c) {
  const held = c.q_yes_micro === undefined && c.q_no_micro === undefined ? null : Number(c.q_yes_micro || 0) + Number(c.q_no_micro || 0);
  return held === 0 ? 0 : c.trades || 0;
}

/**
 * The lines the Checker may challenge: open on the chain, caught by our measurement, and not
 * already ruled on. Lines it challenged before that expired with no quorum wait a day.
 * @param {{ claims: object[], history: { claim_id: number, status: string, at: number }[], nowMs: number, evidenceOf?: (text: string) => object|null }} a
 */
export function checkerCandidates({ claims, history = [], nowMs, evidenceOf = corpusEvidence, retryAfterMs = 24 * 3600_000 }) {
  const out = [];
  for (const c of claims) {
    if (c.status !== "Open") continue;
    const ev = evidenceOf(c.text);
    if (!ev) continue;
    const past = history.filter((h) => h.claim_id === c.id);
    if (past.some((h) => h.status === "settled" || h.status === "jury" || h.status === "window" || h.status === "escalated")) continue;
    const lastExpired = Math.max(0, ...past.filter((h) => h.status === "expired" || h.status === "void").map((h) => h.at || 0));
    if (lastExpired && nowMs - lastExpired < retryAfterMs) continue;
    out.push({ claim: c, evidence: ev, tries: past.length, bets: betsOn(c) });
  }
  // the most bets first (more people get to collect); on a tie, a line never tried
  return out.sort((a, b) => b.bets - a.bets || a.tries - b.tries || a.claim.id - b.claim.id);
}

/** What the Checker has before it now: the queue, the lines with enough bets, and today's count. */
export function checkerQueue({ claims, rulings, account, nowMs, sitting = SITTING, evidenceOf = corpusEvidence }) {
  const mine = account ? rulings.filter((r) => r.challenger === account) : [];
  const history = mine.map((r) => ({ claim_id: r.claim_id, status: r.status, at: r.settled_at || r.expired_at || r.opened_at }));
  const candidates = checkerCandidates({ claims, history, nowMs, evidenceOf });
  const ready = candidates.filter((x) => x.bets >= sitting.minBets);
  return { candidates, ready, rulingsToday: mine.filter((r) => r.opened_at && day(r.opened_at) === day(nowMs)).length };
}

/**
 * Should the Checker challenge now? Why not, in the operator's words, if not. Every "no" here is
 * expected and quiet: it comes back as a note, never as a failure.
 */
export function checkerDecision({ nowMs, sitting = SITTING, live = null, queue, ready, rulingsToday, capped = false, balance, bond, left = Infinity }) {
  const no = (note) => ({ go: false, note });
  if (live) return no(`a ruling is running (challenge ${live.challenge_id}): one at a time`);
  if (!queue) return no("no caught line is open");
  if (!ready) return no(`${queue} caught ${queue === 1 ? "line waits" : "lines wait"} for bets (${sitting.minBets} needed)`);
  if (rulingsToday >= sitting.perDay) return no(`today's sitting is done: ${rulingsToday} of ${sitting.perDay}`);
  if (capped) return no("the signer's daily challenge cap is reached: the next sitting is tomorrow");
  if (nowMs < sittingAt(nowMs, sitting.hourUtc)) return no(`the sitting is at ${hhmm(sitting.hourUtc)}`);
  if (balance === null || balance === undefined || bond === null || bond === undefined) return no("could not read the bond balance");
  if (BigInt(balance) < BigInt(bond)) return no(`the Checker holds $${(Number(balance) / 1e6).toFixed(2)} and the bond is $${(Number(bond) / 1e6).toFixed(2)}: it waits for funding`);
  if (left < 8000) return no("out of time this run");
  return { go: true, note: null };
}

/** The clock's view of the Checker: the last run's record of it, and the queue as it stands. */
export function checkerFacts(chk, q, nowMs) {
  return { enabled: Boolean(chk?.enabled), queue: q.candidates.length, waiting_for_bets: q.candidates.length - q.ready.length, rulings_today: q.rulingsToday, funded: chk?.funded ?? null, refused: chk?.refused ?? null, capped: chk?.capped_on === day(nowMs) };
}

// ---------- corrections ----------

/**
 * The corrected wording for a claim: the latest signed rewrite's sentence for it in the
 * "correct" band (a sourced correction), or null.
 * @param {Iterable<object>} rewrites every rewrite record (any order)
 */
export function correctedWording(rewrites, claimId, claimText) {
  let best = null;
  for (const r of rewrites) {
    if (r?.status !== "signed") continue;
    const s = (r.sentences || []).find((x) => x.claim_id === claimId);
    if (!s || s.band !== "correct" || !s.text || normText(s.text) === normText(claimText)) continue;
    if (Buffer.byteLength(s.text, "utf8") > 600) continue; // the market's text limit
    const t = r.createdAt || r.updatedAt || 0;
    if (!best || t > best.at || (t === best.at && r.version > best.version)) best = { text: s.text, rewrite_id: r.id, version: r.version, at: t, page: r.page, paragraph: r.paragraph };
  }
  return best;
}

/** The liquidity b a claim opened with, from its open event; else inferred from its cost-to-move. */
export function bOf(claim, events) {
  const open = events.find((e) => e.event === "open" && e.data?.claim_id === claim.id);
  if (open?.data?.b_micro) return { b_micro: String(open.data.b_micro), p0_ppm: open.data.p0_ppm, from: "open event" };
  const p = claim.price_yes_ppm / 1e6;
  const up = Number(claim.cost_up_10_micro || 0) / 1e6;
  if (up > 0 && p + 0.1 < 0.999) {
    const b = up / Math.log((1 - p) / (1 - p - 0.1));
    return { b_micro: String(Math.round(b * 1e5) * 10), p0_ppm: null, from: "cost to move" };
  }
  return null;
}

// ---------- the clock: what is being ruled now, and when the next ruling really starts ----------

/** What a live ruling waits for next, and when. Never a time already past, and never one that slides. */
function liveClock(r, nowMs, juryMs, windowMs) {
  if (r.status === "escalated") return { at: null, note: "This ruling went to the council after three disputes" };
  if (r.status === "window") return { at: r.window_ends_at ? nextTick(Math.max(nowMs, r.window_ends_at)) : null, note: "Anyone can object with twice the bond until the window closes, then the keeper settles it" };
  const expected = (r.opened_at || nowMs) + juryMs;
  // a late jury has one known limit left: its deadline, when the keeper expires the challenge
  const at = nowMs <= expected ? nextTick(expected + windowMs) : r.jury_deadline_at ? nextTick(Math.max(nowMs, r.jury_deadline_at)) : null;
  return { at, note: "Three AI judges are ruling on this fact now" };
}

/**
 * The clock promises only what can happen. Every answer has the same fields.
 *   next_ruling_at    the real next sitting (a live ruling: when it settles), or null when none is coming
 *   next_ruling_note  one plain sentence for a visitor
 * @param {{ rulings: object[], nowMs: number, sitting?: { perDay: number, hourUtc: number, minBets: number },
 *   checker?: { enabled: boolean, queue?: number, waiting_for_bets?: number, rulings_today?: number, funded?: boolean|null, capped?: boolean, refused?: string|null }|null,
 *   juryMs?: number, windowMs?: number }} a
 */
export function rulingClock({ rulings, nowMs, sitting = SITTING, checker = null, juryMs = 3 * 60_000, windowMs = 10 * 60_000 }) {
  const c = checker || {};
  const queue = c.queue ?? 0, waiting = c.waiting_for_bets ?? 0, today = c.rulings_today ?? 0;
  const facts = { sitting_hour_utc: sitting.hourUtc, rulings_today: today, per_day: sitting.perDay, queue, waiting_for_bets: waiting };
  const say = (at, note, ruling_now = null) => ({ ruling_now, next_challenge_at: ruling_now ? null : at, next_ruling_at: at, next_ruling_note: note, ...facts });

  const live = rulings.filter((r) => LIVE.includes(r.status));
  if (live.length) {
    const r = live[0];
    const { at, note } = liveClock(r, nowMs, juryMs, windowMs);
    return say(at, note, { challenge_id: r.challenge_id, claim_id: r.claim_id, claim: r.claim, stage: r.status, provisional: r.provisional, verdicts: r.verdicts.map((v) => ({ model: v.model, verdict: v.verdict })), opened_at: r.opened_at, jury_deadline_at: r.jury_deadline_at, window_ends_at: r.window_ends_at, finalize_due_at: at, live: live.length });
  }
  if (!c.enabled) return say(null, "The jury isn't sitting right now");
  if (!queue) return say(null, "No doubted fact is waiting for the jury");
  if (waiting >= queue) return say(null, "No doubted fact has a bet yet, so the next sitting waits for one");
  if (c.funded === false) return say(null, "The next sitting waits for the Checker's bond to be funded");
  if (c.refused) return say(null, "Today's sitting is delayed while the keeper tries again");
  if (today >= sitting.perDay || c.capped) return say(sittingAt(nowMs, sitting.hourUtc, 1), `Today's ${sitting.perDay > 1 ? "rulings are" : "ruling is"} done. The next sitting is tomorrow at ${hhmm(sitting.hourUtc)}`);
  const at = sittingAt(nowMs, sitting.hourUtc);
  if (nowMs < at) return say(at, `The jury sits daily at ${hhmm(sitting.hourUtc)}`);
  return say(nextTick(nowMs - SLOT_MS, CRON_EVERY_MS, SLOT_MS), "The jury sits within the next 10 minutes");
}

// ---------- one round ----------

/**
 * One round of the loop. Everything it touches comes in `d`, so the tests run it with fakes.
 * @param {{ signer: object, view: (method: string, args?: object) => Promise<any>, claims: () => Promise<object[]>, events: () => object[],
 *   rewrites: () => Iterable<object>, links: () => object[], addLink: (l: object) => Promise<void>, wantCorrection: (claimId: number) => Promise<void>,
 *   record: (txHash: string, sender: string) => Promise<void>, trigger?: (c: { txHash: string, signerId: string, challenge_id: number }) => Promise<object>,
 *   rulings: (claims: object[]) => Promise<object[]>, plannerP0?: (text: string) => Promise<number|null>, sitting?: { perDay: number, hourUtc: number, minBets: number }, checkerOn?: boolean,
 *   left?: () => number, now?: () => number, log?: (m: string) => void }} d
 */
export async function keeperRound(d) {
  const now = d.now || Date.now;
  const log = d.log || (() => {});
  const left = d.left || (() => Infinity);
  const sitting = d.sitting || SITTING;
  const out = { at: new Date(now()).toISOString(), finalized: [], expired: [], opened: [], waiting: [], challenged: null, checker: null, errors: [] };
  const keeperKey = d.signer?.operator?.keeper;
  const checkerKey = d.signer?.operator?.checker;
  out.keeper_key = keeperKey?.ok ? { account: keeperKey.accountId, ok: true } : { ok: false, reason: keeperKey?.error || "no keeper key in the keystore" };

  // where the signer's safety caps stand: what they would refuse isn't tried
  const caps = await Promise.resolve(d.signer?.caps?.()).catch(() => null);
  let opensLeft = caps?.ok ? caps.opens.cap - caps.opens.used : Infinity;

  let claims = await d.claims();

  // 1. finalize what is due, expire what ran out of time
  if (keeperKey?.ok) {
    const open = claims.filter((c) => c.challenge_id !== null && c.challenge_id !== undefined && c.status === "Challenged");
    const list = [];
    for (const c of open) {
      const ch = await d.view("get_challenge", { challenge_id: c.challenge_id }).catch(() => null);
      const windowEndNs = c.provisional === true || c.provisional === false ? await d.view("dispute_ends_ns", { challenge_id: c.challenge_id }).catch(() => null) : null;
      list.push({ id: c.challenge_id, ch, claim: c, windowEndNs });
    }
    for (const a of planKeeper({ challenges: list, nowMs: now() })) {
      if (left() < 8000) { out.errors.push("out of time before every due step ran"); break; }
      const r = await d.signer.keep(`keep:${a.method}:${a.challenge_id}:${Math.floor(now() / 60_000)}`, a.method, a.challenge_id);
      if (r.ok) {
        (a.method === "finalize" ? out.finalized : out.expired).push({ challenge_id: a.challenge_id, claim_id: a.claim_id, tx: r.txHash, outcome: a.method === "finalize" ? r.value : null });
        await d.record(r.txHash, keeperKey.accountId).catch((e) => log(`keeper: events of ${r.txHash}: ${e.message}`));
      } else out.errors.push(`${a.method} ${a.challenge_id}: ${String(r.error).slice(0, 200)}`);
    }
    if (out.finalized.length || out.expired.length) claims = await d.claims();
  }

  // 2. a caught line ruled FALSE: its corrected wording opens as a new market, linked to the old one
  const linked = new Set(d.links().map((l) => l.old_claim_id));
  const events = d.events();
  for (const c of claims.filter((x) => x.status === "Settled" && x.outcome === false && !linked.has(x.id))) {
    const ev = corpusEvidence(c.text);
    if (!ev) continue; // no sourced correction exists for this line: nothing to open
    const w = correctedWording(d.rewrites(), c.id, c.text);
    if (!w) {
      await d.wantCorrection(c.id).catch(() => {});
      out.waiting.push({ claim_id: c.id, why: "no signed correction yet: the writer was asked for one" });
      continue;
    }
    const base = { old_claim_id: c.id, challenge_id: c.challenge_id ?? null, page: c.page, text: w.text, rewrite_id: w.rewrite_id, corpus_id: ev.corpus_id, source_url: ev.source_url, at: now() };
    // a crash between the open and the link must not open it twice: the chain says if it is there
    const already = claims.find((x) => x.id !== c.id && x.page === c.page && normText(x.text) === normText(w.text));
    if (already) {
      await d.addLink({ ...base, new_claim_id: already.id, open_tx: null });
      out.opened.push({ old_claim_id: c.id, new_claim_id: already.id, tx: null, note: "already open on the chain: linked" });
      continue;
    }
    if (!keeperKey?.ok) { out.waiting.push({ claim_id: c.id, why: "no keeper key" }); continue; }
    if (opensLeft <= 0) { out.waiting.push({ claim_id: c.id, why: CAPPED_OPEN }); continue; }
    const b = bOf(c, events);
    if (!b) { out.errors.push(`open for claim ${c.id}: its liquidity could not be read`); continue; }
    let planner = null;
    try { planner = d.plannerP0 ? await d.plannerP0(w.text) : null; } catch (e) { log(`keeper: planner: ${e.message}`); }
    // the planner's estimate, as every other line opened; then the old line's own opening price,
    // whose reserve the settlement just freed; then 50%, the smallest reserve the market takes
    const prices = [...new Set([planner, b.p0_ppm, 500_000].filter((x) => Number.isInteger(x)))];
    let done = null;
    const why = [];
    for (const p0 of prices) {
      if (left() < 8000) { why.push("out of time"); break; }
      const r = await d.signer.openClaim(`open:${c.id}:${p0}:${Math.floor(now() / 3_600_000)}`, { text: w.text, page: c.page, kind: c.kind, p0_ppm: p0, b_micro: b.b_micro });
      if (r.ok) { done = { r, p0 }; break; }
      if (isCapRefusal(r.error)) { opensLeft = 0; break; }
      why.push(String(r.error).slice(0, 160));
      if (!/subsidy cap|treasury can't cover/i.test(String(r.error))) break;
    }
    if (!done && opensLeft <= 0) { out.waiting.push({ claim_id: c.id, why: CAPPED_OPEN }); continue; }
    if (!done) { out.errors.push(`open for claim ${c.id}: ${why.join("; ")}`); continue; }
    opensLeft--;
    const id = Number(done.r.value);
    await d.addLink({ ...base, new_claim_id: id, open_tx: done.r.txHash, p0_ppm: done.p0, b_micro: b.b_micro });
    await d.record(done.r.txHash, keeperKey.accountId).catch((e) => log(`keeper: events of ${done.r.txHash}: ${e.message}`));
    out.opened.push({ old_claim_id: c.id, new_claim_id: id, tx: done.r.txHash, p0_ppm: done.p0, b_micro: b.b_micro, rewrite_id: w.rewrite_id });
    claims = await d.claims();
  }

  // 3. the Checker: the sitting, one caught line at a time
  const rulings = await d.rulings(claims);
  const account = checkerKey?.ok ? checkerKey.accountId : null;
  const q = checkerQueue({ claims, rulings, account, nowMs: now(), sitting });
  const liveRuling = rulings.find((r) => LIVE.includes(r.status)) || null;
  const chk = {
    enabled: Boolean(account) && d.checkerOn !== false, account, candidates: q.candidates.length,
    lines: q.candidates.slice(0, 12).map((x) => ({ claim_id: x.claim.id, corpus_id: x.evidence.corpus_id, bets: x.bets })),
    reason: account ? null : `no Checker key (${checkerKey?.error || "none in the keystore"})`, balance_micro: null, bond_micro: null, funded: null, refused: null,
    capped_on: caps?.ok && caps.challenges.used >= caps.challenges.cap ? caps.day : null, note: null,
  };
  out.checker = chk;
  if (chk.enabled) {
    const [balance, res] = await Promise.all([d.view("get_balance", { trader: account }).catch(() => null), d.view("get_resolution").catch(() => null)]);
    chk.balance_micro = balance === null ? null : String(balance);
    chk.bond_micro = res?.challenge_bond_micro ?? null;
    chk.funded = balance === null || chk.bond_micro === null ? null : BigInt(balance) >= BigInt(chk.bond_micro);
    const go = checkerDecision({ nowMs: now(), sitting, live: liveRuling, queue: q.candidates.length, ready: q.ready.length, rulingsToday: q.rulingsToday, capped: chk.capped_on === day(now()), balance, bond: chk.bond_micro, left: left() });
    chk.note = go.note;
    if (go.go) {
      const pick = q.ready[0];
      // a refused challenge is tried again next hour, never twice in one: once it lands the line is no longer Open
      const r = await d.signer.challenge(`checker:${pick.claim.id}:${pick.tries}:${day(now())}:${new Date(now()).getUTCHours()}`, { claim_id: pick.claim.id, claimed_outcome: false, evidence: checkerEvidence(pick.evidence) });
      if (r.ok) {
        const challenge_id = Number(r.value);
        out.challenged = { claim_id: pick.claim.id, corpus_id: pick.evidence.corpus_id, challenge_id, tx: r.txHash };
        await d.record(r.txHash, account).catch((e) => log(`checker: events of ${r.txHash}: ${e.message}`));
        if (d.trigger) out.challenged.jury = await d.trigger({ txHash: r.txHash, signerId: account, challenge_id }).catch((e) => ({ ok: false, error: e.message }));
      } else if (isCapRefusal(r.error)) {
        chk.capped_on = day(now());
        chk.note = "the signer's daily challenge cap is reached: the next sitting is tomorrow";
      } else {
        chk.refused = String(r.error).slice(0, 200);
        out.errors.push(`challenge of claim ${pick.claim.id}: ${chk.refused}`);
      }
    }
  }
  const claimsAfter = out.challenged ? await d.claims() : claims;
  const after = out.challenged ? await d.rulings(claimsAfter) : rulings;
  const qAfter = out.challenged ? checkerQueue({ claims: claimsAfter, rulings: after, account, nowMs: now(), sitting }) : q;
  out.clock = rulingClock({ rulings: after, nowMs: now(), sitting, checker: checkerFacts(chk, qAfter, now()) });
  return out;
}
