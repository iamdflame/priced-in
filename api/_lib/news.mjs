// News lines on the hosted runtime: today's claims, opened, traded and settled within a week.
//
//   news/lines.json   one document: { lines: { <claim_id>: metadata }, last_slot, runs: [...] }. The
//                     chain holds the claim (its text, page news-YYYY-MM-DD, price, status); this holds
//                     what the screens need besides: the question, topic, why it matters, the headline
//                     and link it came from, the settling source and date, the first estimate, and
//                     what the settler did
//   scout.jsonl       a journal: every candidate the scout proposed, with the check that stopped it or
//                     the line it opened, so the record shows what was refused and why
//
// Everything here is off unless NEWS_ENABLED=1: no scouting, no opening, no settling, no route.
//
// The scout's round (GET /api/news, at NEWS_SCOUT_HOURS_UTC): the feeds, the scout model, the gate
// (services/ai/src/gate.js), then each line that passed opens through the signer with the keeper's
// open_claim key, under the news lines' own daily cap, at the scout's first estimate.
// The settler's round (the same function, every hour): a line whose date has passed, or an early look
// every NEWS_EARLY_LOOK_H, gets receipts (services/ai/src/settle.js); the receipt check our jury runner
// applies runs on them first; only then does the Checker challenge, under the news lines' own cap, and
// the jury is called at once. The keeper finalizes it like any ruling.

import { createHash } from "node:crypto";
import { isoDay, dateWords, endOfDay, DEFAULT_FEEDS, parseFeeds } from "../../services/ai/src/scout.js";
import { runGate, reserveFromState, spareNearOf } from "../../services/ai/src/gate.js";
import { settleTiming, checkPassed } from "../../services/ai/src/settle.js";
import { REPORT_WAITING, reportVerdict, reportsOf, trustedSource } from "./picks.mjs";

export const LINES = "news/lines.json";
export const SCOUT_JOURNAL = "scout.jsonl";
export const NEWS_PAGE = /^news-\d{4}-\d{2}-\d{2}$/;
export const isNewsPage = (page) => NEWS_PAGE.test(String(page ?? ""));
const H = 3600_000;
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const usd = (micro) => Number(micro || 0) / 1e6;

// ---------- configuration ----------

const whole = (v, min, max, d) => (v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : d);
const hours = (s, d) => {
  const list = String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(Number);
  return list.length && list.every((h) => Number.isInteger(h) && h >= 0 && h <= 23) ? [...new Set(list)].sort((a, b) => a - b) : d;
};

/** Every news setting, from env. NEWS_ENABLED=1 turns it on; anything out of range keeps the default. */
export function newsConfig(env = process.env) {
  const extra = parseFeeds(env.NEWS_FEEDS);
  return {
    enabled: env.NEWS_ENABLED === "1",
    perDay: whole(env.NEWS_PER_DAY, 0, 24, 4),
    // the most lines one topic opens in a UTC day, so the day's claims are never one story told four times
    topicCap: whole(env.NEWS_TOPIC_CAP, 1, 24, 2),
    bMicro: whole(env.NEWS_B_MICRO, 100_000, 5_000_000, 1_450_000),
    chainKind: ["data", "document", "judgment"].includes(env.NEWS_CHAIN_KIND) ? env.NEWS_CHAIN_KIND : "document",
    scoutHoursUtc: hours(env.NEWS_SCOUT_HOURS_UTC, [6, 18]),
    floorMicro: whole(env.NEWS_TREASURY_FLOOR_MICRO, 0, 1_000_000_000, 1_500_000),
    minSpareNear: Number.isFinite(Number(env.NEWS_MARKET_MIN_NEAR)) && Number(env.NEWS_MARKET_MIN_NEAR) > 0 ? Number(env.NEWS_MARKET_MIN_NEAR) : 0.3,
    webVerify: env.NEWS_WEB_VERIFY !== "0",
    // off: on the recorded runs it strands 9 of 22 lines (deployments/settle-bar-test.json), and the contract can't void a line
    settleBar: env.NEWS_SETTLE_BAR === "1",
    requireDefinite: env.NEWS_REQUIRE_DEFINITE === "1",
    graceH: whole(env.NEWS_SETTLE_GRACE_H, 0, 72, 6),
    earlyEveryH: whole(env.NEWS_EARLY_LOOK_H, 1, 168, 24),
    dueEveryH: whole(env.NEWS_DUE_LOOK_H, 1, 168, 12),
    settlePerRun: whole(env.NEWS_SETTLE_PER_RUN, 1, 10, 3),
    // news stops here, as a share of the daily model cap, so the jury, the writer and the agents always have the rest
    spendShare: whole(env.NEWS_SPEND_SHARE, 1, 100, 50) / 100,
    feeds: [...DEFAULT_FEEDS, ...extra.feeds],
    errors: extra.errors,
    scoutModel: env.NEWS_SCOUT_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    reviewModel: env.NEWS_REVIEW_MODEL || "Qwen/Qwen3.8-27B",
    verifyModel: env.NEWS_VERIFY_MODEL || "z-ai/glm-5.3-flash",
  };
}

/** The scout's slot for this hour ("2026-11-07T06"), or null outside the scout hours. */
export function scoutSlot(nowMs, scoutHours) {
  const h = new Date(nowMs).getUTCHours();
  return scoutHours.includes(h) ? `${isoDay(nowMs)}T${String(h).padStart(2, "0")}` : null;
}

/** The next scout run after now, in ms. */
export function nextScoutAt(nowMs, scoutHours) {
  for (let d = 0; d < 2; d++) {
    for (const h of scoutHours) {
      const t = Date.parse(`${isoDay(nowMs + d * 24 * H)}T${String(h).padStart(2, "0")}:05:00Z`);
      if (t > nowMs) return t;
    }
  }
  return null;
}

// ---------- the store ----------

const blank = () => ({ lines: {}, last_slot: null, runs: [], updated_at: null });

/** The lines document and its update, over the store (state is the Blob store or the local one). */
export function linesStore(state) {
  return {
    read: async () => ({ ...blank(), ...((await state.getDoc(LINES))?.value || {}) }),
    update: (fn) => state.updateDoc(LINES, (cur) => {
      const next = fn({ ...blank(), ...(cur || {}) });
      if (next === undefined) return undefined;
      next.runs = (next.runs || []).slice(-30);
      next.updated_at = new Date().toISOString();
      return next;
    }),
  };
}

let cached = { at: 0, value: null, pending: null };
/** The lines document for read routes: at most a few seconds old, one store read shared by concurrent requests. */
export async function cachedLines(state, { maxAgeMs = 5000 } = {}) {
  if (cached.value && Date.now() - cached.at < maxAgeMs) return cached.value;
  cached.pending ||= linesStore(state).read().then((v) => { cached = { at: Date.now(), value: v, pending: null }; return v; }, (e) => { cached.pending = null; throw e; });
  return cached.pending;
}
export const forgetCachedLines = () => { cached = { at: 0, value: null, pending: null }; };

// ---------- the chain's money ----------

/**
 * Treasury, reserved, the lane budget and the reserve cap. `stats` gives three; the cap lives only in the
 * market's STATE, read raw. Null when either read fails: the gate then opens nothing.
 * @param {{ call: (method: string, params: object, o?: object) => Promise<any>, viewFunction: Function }} rpc
 */
export async function readCapacity(rpc, marketId) {
  try {
    const [stats, raw, acct] = await Promise.all([
      rpc.viewFunction(marketId, "stats", {}),
      rpc.call("query", { request_type: "view_state", finality: "final", account_id: marketId, prefix_base64: Buffer.from("STATE").toString("base64") }, { timeoutMs: 8000 }),
      rpc.call("query", { request_type: "view_account", finality: "final", account_id: marketId }, { timeoutMs: 8000 }).catch(() => null),
    ]);
    const v = (raw?.values || []).find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
    if (!v) return null;
    const st = reserveFromState(Buffer.from(v.value, "base64"));
    return { treasuryMicro: String(stats.treasury_micro), reservedMicro: String(stats.reserved_micro), capMicro: st.capMicro, laneBudgetMicro: String(stats.lane_budget_micro), spareNear: acct ? spareNearOf(acct) : null };
  } catch { return null; }
}

// ---------- the scout's round ----------

/** What the store keeps about a line that opened. */
export function lineMeta(d, { claimId, tx, nowMs, page, chainKind, models }) {
  const c = d.candidate;
  return {
    claim_id: claimId, kind: "news", page, chain_kind: chainKind,
    question: c.question, claim: c.claim, topic: c.topic, why: c.why,
    source: c.source, settles: c.settles,
    first_estimate: c.estimate, p0_ppm: d.open.p0_ppm, b_micro: d.open.b_micro, reserve_micro: d.open.reserve_micro,
    opened_at: nowMs, open_tx: tx, candidate_id: c.id, models,
    coverage: (d.checks.unconfirmed?.sources || []).map((s) => s.url).filter(Boolean).slice(0, 4),
    checks: Object.fromEntries(Object.entries(d.checks).map(([k, v]) => [k, { ok: v.ok, by: v.by ?? null }])),
    settle: null,
  };
}

/**
 * One scout round. Everything it touches comes in `d`, so the tests run it with fakes.
 * @param {{ cfg: object, now?: () => number, force?: boolean, store: ReturnType<typeof linesStore>, journal: (rec: object) => void,
 *   readFeeds: () => Promise<{ headlines: object[], feeds: object[] }>, propose: (headlines: object[], nowMs: number) => Promise<{ candidates: object[] }>,
 *   review: Function, verify: Function|null, claims: () => Promise<object[]>, capacity: () => Promise<object|null>,
 *   open: (pass: object[], ctx: object) => Promise<{ opened: object[], errors: string[] }>, log?: Function }} d
 */
export async function scoutRound(d) {
  const cfg = d.cfg;
  if (!cfg.enabled) return { off: true };
  const nowMs = (d.now || Date.now)();
  const slot = d.force ? `${isoDay(nowMs)}T${String(new Date(nowMs).getUTCHours()).padStart(2, "0")}-forced` : scoutSlot(nowMs, cfg.scoutHoursUtc);
  if (!slot) return { skipped: true, why: `the scout runs at ${cfg.scoutHoursUtc.map((h) => `${String(h).padStart(2, "0")}:00`).join(" and ")} UTC` };
  // the slot is taken first, with compare-and-swap: a second run in the same hour does nothing
  const took = await d.store.update((cur) => (cur.last_slot === slot ? undefined : { ...cur, last_slot: slot }));
  if (!took.changed) return { skipped: true, why: `the ${slot} slot already ran` };
  const doc = took.value;
  const out = { slot, at: new Date(nowMs).toISOString(), headlines: 0, candidates: 0, passed: 0, opened: [], refused: {}, errors: [] };
  const { headlines, feeds } = await d.readFeeds();
  out.headlines = headlines.length;
  out.feeds_failed = feeds.filter((f) => !f.ok).map((f) => `${f.feed}: ${f.error}`);
  if (!headlines.length) { out.errors.push("no feed answered"); return finishRun(d, out); }
  let proposal;
  try { proposal = await d.propose(headlines, nowMs); } catch (e) { out.errors.push(`the scout model: ${String(e.message).slice(0, 160)}`); return finishRun(d, out); }
  const claims = await d.claims();
  const lines = doc.lines || {};
  const open = claims.filter((c) => c.status !== "Settled").map((c) => ({ claim_id: c.id, text: c.text, question: lines[c.id]?.question ?? null, source_url: lines[c.id]?.source?.url ?? null }));
  const today = Object.values(lines).filter((l) => isoDay(l.opened_at) === isoDay(nowMs));
  const openedToday = today.length;
  const topicsToday = today.reduce((m, l) => ({ ...m, [l.topic]: (m[l.topic] || 0) + 1 }), {});
  const gate = await runGate({
    candidates: proposal.candidates, nowMs, review: d.review, verify: cfg.webVerify ? d.verify : null, open,
    capacity: await d.capacity(), openedToday, topicsToday, topicCap: cfg.topicCap, perDay: cfg.perDay, bMicro: cfg.bMicro, floorMicro: cfg.floorMicro, minSpareNear: cfg.minSpareNear, requireDefinite: cfg.requireDefinite,
  });
  out.candidates = gate.counts.candidates;
  out.passed = gate.pass.length;
  out.refused = Object.fromEntries(Object.entries(gate.counts).filter(([k, v]) => k.startsWith("refused_") && v).map(([k, v]) => [k.slice(8), v]));
  out.headroom_usd = gate.headroom_micro === null ? null : usd(gate.headroom_micro);
  const page = `news-${isoDay(nowMs)}`;
  let opened = { opened: [], errors: [] };
  if (gate.pass.length) {
    try { opened = await d.open(gate.pass, { slot, page, nowMs, chainKind: cfg.chainKind }); } catch (e) { opened.errors.push(String(e.message).slice(0, 200)); }
  }
  out.errors.push(...opened.errors);
  const byCandidate = new Map(opened.opened.map((o) => [o.candidate_id, o]));
  if (opened.opened.length) {
    await d.store.update((cur) => {
      const next = { ...cur, lines: { ...cur.lines } };
      for (const o of opened.opened) {
        const dd = gate.pass.find((x) => x.id === o.candidate_id);
        next.lines[o.claim_id] = lineMeta(dd, { claimId: o.claim_id, tx: o.tx, nowMs, page, chainKind: cfg.chainKind, models: { scout: cfg.scoutModel, review: cfg.reviewModel, verify: cfg.webVerify ? cfg.verifyModel : null } });
      }
      return next;
    });
  }
  for (const dd of gate.decisions) {
    const o = byCandidate.get(dd.id) || null;
    const failedOpen = dd.status === "passed" && !o ? opened.failed?.find((f) => f.candidate_id === dd.id) ?? { error: "not opened" } : null;
    d.journal({
      t: "candidate", run: slot, at: nowMs, id: dd.id, claim: dd.candidate.claim, question: dd.candidate.question, topic: dd.candidate.topic, why: dd.candidate.why,
      source: dd.candidate.source, settles: dd.candidate.settles, estimate: dd.candidate.estimate,
      result: o ? "opened" : dd.status === "passed" ? "not_opened" : "refused", refused_at: dd.failed, reason: failedOpen ? `It passed every check, and the open failed: ${failedOpen.error}` : dd.reason,
      checks: dd.checks, review: dd.review ?? null, web: dd.web ? { status: dd.web.status, note: dd.web.note, sources: dd.web.sources } : null,
      claim_id: o?.claim_id ?? null, open_tx: o?.tx ?? null,
    });
  }
  out.opened = opened.opened.map((o) => ({ claim_id: o.claim_id, tx: o.tx, question: gate.pass.find((x) => x.id === o.candidate_id)?.candidate.question }));
  return finishRun(d, out);
}

async function finishRun(d, out) {
  await d.store.update((cur) => ({ ...cur, runs: [...(cur.runs || []), { kind: "scout", ...out, opened: out.opened.length }] })).catch(() => {});
  return out;
}

/**
 * Open the lines that passed, one at a time, through the signer's news cap. A refusal that is only
 * today's cap stops quietly. The intent carries the slot and the candidate, so a retry never opens twice.
 * @param {{ signer: object, record: (txHash: string, sender: string) => Promise<void>, capacity: () => Promise<object|null> }} s
 */
export async function openPassed(pass, { slot, page, chainKind }, s) {
  const opened = [], errors = [], failed = [];
  const caps = await Promise.resolve(s.signer?.caps?.()).catch(() => null);
  let left = caps?.ok && caps.news_opens ? caps.news_opens.cap - caps.news_opens.used : pass.length;
  const keeper = s.signer?.operator?.keeper;
  if (!keeper?.ok) return { opened, errors: [`no keeper key (${keeper?.error || "none in the keystore"})`], failed: pass.map((d) => ({ candidate_id: d.id, error: "no keeper key" })) };
  for (const d of pass) {
    if (left <= 0) { failed.push({ candidate_id: d.id, error: "the signer's daily cap on news lines is reached" }); continue; }
    const r = await s.signer.openNews(`news-open:${slot}:${d.id}`, { text: d.candidate.claim, page, kind: chainKind, p0_ppm: d.open.p0_ppm, b_micro: d.open.b_micro });
    if (!r.ok) {
      const quiet = /already opened today/.test(String(r.error));
      if (quiet) left = 0;
      else errors.push(`open ${d.id}: ${String(r.error).slice(0, 160)}`);
      failed.push({ candidate_id: d.id, error: String(r.error).slice(0, 200) });
      if (/subsidy cap|treasury can't cover/.test(String(r.error))) break;
      continue;
    }
    left--;
    opened.push({ candidate_id: d.id, claim_id: Number(r.value), tx: r.txHash });
    await s.record(r.txHash, keeper.accountId).catch(() => {});
  }
  return { opened, errors, failed };
}

// ---------- the settler's round ----------

/** What the settler did on a line, in words a visitor reads: the site shows `note` as it is. The technical reason goes in `detail`. */
const NOTE = {
  waiting: () => "Waiting for its date: the source may still confirm it before then.",
  unknown: (h) => `Its date has passed and no source has settled it yet. We look again every ${h} hours.`,
  refused: (h) => `A source turned up, but it didn’t hold up when we checked it, so our Checker hasn’t challenged. We look again every ${h} hours.`,
  challenged: (id, o) => `Our Checker found a source saying it’s ${o === "TRUE" ? "true" : "false"} and put up its bond (challenge ${id}). Three AI judges rule next.`,
  unposted: () => "Its source checked out, and our Checker couldn’t post its challenge yet. It tries again on the next look.",
};
const refusedDetail = (c) => `Its receipts did not pass the check (${c.result}${c.support?.verdict ? `, support ${c.support.verdict}` : ""}), so the Checker did not challenge.`;

/**
 * One settler round. Lines that are open on the chain and due (or due an early look) get receipts;
 * those whose receipts pass the check are challenged for the outcome they show.
 * @param {{ cfg: object, now?: () => number, store: ReturnType<typeof linesStore>, claims: () => Promise<object[]>,
 *   find: (meta: object, nowMs: number) => Promise<object>, check: (a: object) => Promise<object>,
 *   challenge: (plans: object[]) => Promise<{ posted: object[], errors: string[] }>, left?: () => number, budget?: () => boolean }} d
 */
export async function settleRound(d) {
  const cfg = d.cfg;
  if (!cfg.enabled) return { off: true };
  const nowMs = (d.now || Date.now)();
  const left = d.left || (() => Infinity);
  const doc = await d.store.read();
  const byId = new Map((await d.claims()).map((c) => [c.id, c]));
  const out = { at: new Date(nowMs).toISOString(), looked: [], challenged: [], errors: [] };
  const due = [];
  for (const meta of Object.values(doc.lines || {})) {
    const c = byId.get(meta.claim_id);
    if (!c || c.status !== "Open") continue; // a live challenge or a settled line: the jury and the keeper have it
    const t = settleTiming({ by: meta.settles.by, nowMs, lastLookAt: meta.settle?.last_look_at || 0, graceH: cfg.graceH, earlyEveryH: cfg.earlyEveryH, dueEveryH: cfg.dueEveryH });
    if (t.look) due.push({ meta, claim: c, timing: t });
  }
  due.sort((a, b) => Number(b.timing.due) - Number(a.timing.due) || a.timing.due_at - b.timing.due_at);
  const plans = [];
  const notes = {};
  for (const x of due.slice(0, cfg.settlePerRun)) {
    if (left() < 90_000) { out.errors.push("out of time before every due line was looked at"); break; }
    if (d.budget && !d.budget()) { out.note = "the news share of today's model budget is spent: the rest wait for the next run"; break; }
    const f = await d.find(x.meta, nowMs);
    const look = { claim_id: x.meta.claim_id, due: x.timing.due, outcome: f.outcome, basis: f.basis, receipts: f.receipts?.length ?? 0, reason: f.reason };
    const every = x.timing.due ? cfg.dueEveryH : cfg.earlyEveryH;
    let note, detail = null;
    if (f.outcome === "UNKNOWN" || !f.evidence) { note = x.timing.due ? NOTE.unknown(every) : NOTE.waiting(); detail = f.reason || null; }
    else {
      const check = await d.check({ claim: x.claim.text, evidence: f.evidence, claimed: f.outcome === "TRUE" });
      look.receipt_check = { result: check.result, support: check.support?.verdict ?? null };
      const ok = checkPassed(check);
      if (ok) plans.push({ claim_id: x.meta.claim_id, claimed_outcome: f.outcome === "TRUE", evidence: f.evidence, outcome: f.outcome, intent: `news-settle:${x.meta.claim_id}:${f.outcome}:${x.meta.settle?.looks || 0}` });
      note = ok ? null : NOTE.refused(every);
      detail = ok ? null : refusedDetail(check);
    }
    notes[x.meta.claim_id] = { last_look_at: nowMs, outcome: f.outcome, basis: f.basis, note, detail, evidence_sha256: f.evidence ? sha(f.evidence) : null };
    out.looked.push(look);
  }
  let posted = { posted: [], errors: [] };
  if (plans.length) {
    try { posted = await d.challenge(plans); } catch (e) { posted.errors.push(String(e.message).slice(0, 200)); }
  }
  out.errors.push(...posted.errors);
  for (const p of posted.posted) {
    notes[p.claim_id] = { ...notes[p.claim_id], challenge_id: p.challenge_id, challenge_tx: p.tx, challenged_at: nowMs, note: NOTE.challenged(p.challenge_id, p.outcome), detail: null };
    out.challenged.push(p);
  }
  for (const pl of plans) if (!posted.posted.some((p) => p.claim_id === pl.claim_id)) notes[pl.claim_id] = { ...notes[pl.claim_id], note: NOTE.unposted(), detail: `Its receipts passed; the challenge was not posted: ${posted.errors.find((e) => e.startsWith(`challenge ${pl.claim_id}:`)) || posted.errors[0] || "see the run's errors"}` };
  if (Object.keys(notes).length) {
    await d.store.update((cur) => {
      const next = { ...cur, lines: { ...cur.lines } };
      for (const [id, n] of Object.entries(notes)) if (next.lines[id]) next.lines[id] = { ...next.lines[id], settle: { ...(next.lines[id].settle || {}), looks: (next.lines[id].settle?.looks || 0) + 1, ...n } };
      next.runs = [...(next.runs || []), { kind: "settle", at: out.at, looked: out.looked.length, challenged: out.challenged.length, errors: out.errors.length }];
      return next;
    });
  }
  return out;
}

/**
 * Post the Checker's challenges for news lines whose receipts passed: its bond from its own balance,
 * the news cap in the signer, then the jury at once.
 * @param {{ signer: object, view: Function, record: Function, trigger: Function|null }} s
 */
export async function postNewsChallenges(plans, s, { kind = "news", keepBonds = 1 } = {}) {
  const posted = [], errors = [];
  const checker = s.signer?.operator?.checker;
  if (!checker?.ok) return { posted, errors: [`no Checker key (${checker?.error || "none in the keystore"})`] };
  const [balance, res] = await Promise.all([s.view("get_balance", { trader: checker.accountId }).catch(() => null), s.view("get_resolution", {}).catch(() => null)]);
  let free = balance === null ? null : BigInt(String(balance));
  const bond = res?.challenge_bond_micro ? BigInt(String(res.challenge_bond_micro)) : null;
  // a report never spends the bond the daily sitting needs
  const keep = kind === "report" && bond !== null ? bond * BigInt(keepBonds) : 0n;
  for (const p of plans) {
    if (free === null || bond === null) { errors.push(`challenge ${p.claim_id}: could not read the Checker's balance or the bond`); break; }
    if (keep && free < bond + keep) { errors.push(`challenge ${p.claim_id}: the Checker holds $${(Number(free) / 1e6).toFixed(2)} and keeps $${(Number(keep) / 1e6).toFixed(2)} for its daily sitting: this report waits for funding`); break; }
    if (free < bond) { errors.push(`challenge ${p.claim_id}: the Checker holds $${(Number(free) / 1e6).toFixed(2)} and the bond is $${(Number(bond) / 1e6).toFixed(2)}: it waits for funding`); break; }
    const r = await (kind === "report" ? s.signer.challengeReport(p.intent, p) : s.signer.challengeNews(p.intent, p));
    if (!r.ok) { errors.push(`challenge ${p.claim_id}: ${String(r.error).slice(0, 160)}`); if (/already posted today/.test(String(r.error))) break; continue; }
    free -= bond;
    const challengeId = Number(r.value);
    posted.push({ claim_id: p.claim_id, challenge_id: challengeId, tx: r.txHash, outcome: p.outcome ?? (p.claimed_outcome ? "TRUE" : "FALSE"), report_id: p.report_id ?? null });
    await s.record(r.txHash, checker.accountId).catch(() => {});
    if (s.trigger) await s.trigger({ txHash: r.txHash, signerId: checker.accountId, challenge_id: challengeId }).catch(() => {});
  }
  return { posted, errors };
}

// ---------- readers' reports ----------

/**
 * One round of readers' reports: the check on those waiting, then the Checker's challenge on those
 * that pass. One round at a time, or a burst of reports (each one starts a round) would ask the
 * models the same question once per round, each round blind to what the others have spent.
 * @param {{ now?: () => number, lock?: () => Promise<{ release: () => Promise<void> }|null>, records: () => object[], events: () => object[],
 *   claims: () => Promise<object[]>, lines: () => Promise<object>, append: (rec: object) => void, flush?: () => Promise<void>,
 *   check: (a: object) => Promise<object>, challenge: (plans: object[]) => Promise<{ posted: object[], errors: string[] }>,
 *   takeCheck?: () => Promise<boolean>, left?: () => number, budget?: () => boolean, trustedHosts?: string[] }} d
 */
export async function reportsRound(d) {
  const now = d.now || Date.now;
  const left = d.left || (() => Infinity);
  const lock = d.lock ? await d.lock() : { release: async () => {} };
  if (!lock) return { busy: true, note: "Another round is checking the reports." };
  try {
    const nowMs = now();
    const claims = mergeNews(await d.claims(), await d.lines());
    const waiting = [...reportsOf(d.records(), { claims, events: d.events(), nowMs }).values()].filter((r) => REPORT_WAITING.includes(r.status)).sort((a, b) => a.at - b.at).slice(0, 3);
    const out = { waiting: waiting.length, checked: [], challenged: [], errors: [] };
    const status = (r, s, extra = {}) => d.append({ t: "report_status", id: r.id, status: s, at: now(), ...extra });
    const plans = [];
    for (const r of waiting) {
      if (left() < 100_000 || (d.budget && !d.budget())) break;
      const c = claims.find((x) => x.id === r.claim_id);
      if (!c || c.status !== "Open") { status(r, "closed", { reason: "The line stopped taking challenges before we could act on it." }); continue; }
      if (r.status !== "verified") {
        if (d.takeCheck && !(await d.takeCheck())) { out.capped = true; break; }
        const check = await d.check({ claim: c.text, evidence: r.evidence, claimed: r.says === "true" });
        const summary = { result: check.result, reason: check.reason, support: check.support?.verdict ?? null };
        out.checked.push({ id: r.id, ...summary });
        const v = reportVerdict(check, { trusted: (u) => trustedSource(u, { news: c.news ?? null, extra: d.trustedHosts }).ok });
        if (v.pass) status(r, "verified", { check: summary });
        else if (v.retry && (r.attempts || 0) < 2) { status(r, "retry", { check: summary, attempts: (r.attempts || 0) + 1 }); continue; }
        else { status(r, "refused", { check: summary, reason: v.reason }); continue; }
      }
      plans.push({ claim_id: c.id, claimed_outcome: r.says === "true", evidence: r.evidence, intent: `report:${r.id}`, report_id: r.id, outcome: r.says === "true" ? "TRUE" : "FALSE" });
    }
    await d.flush?.();
    if (plans.length) {
      const posted = await d.challenge(plans);
      for (const x of posted.posted) { status({ id: x.report_id }, "challenged", { challenge_id: x.challenge_id, tx: x.tx }); out.challenged.push(x); }
      out.errors.push(...(posted.errors || []));
      await d.flush?.();
    }
    return out;
  } finally { await lock.release(); }
}

// ---------- read models ----------

/** A news line's metadata as the claim views carry it (`news` on /api/claims and in the truth API). */
export function newsField(meta) {
  if (!meta) return null;
  return {
    kind: "news", question: meta.question, topic: meta.topic, why: meta.why,
    source: meta.source ? { headline: meta.source.headline, url: meta.source.url, outlet: meta.source.outlet ?? null, published_at: meta.source.published_at ?? null } : null,
    settles: { by: meta.settles.by, by_words: meta.settles.by_words ?? dateWords(meta.settles.by), due_at: endOfDay(meta.settles.by), source: meta.settles.source, source_url: meta.settles.source_url ?? null, event: meta.settles.event ?? null, rule: meta.claim },
    first_estimate: meta.first_estimate, opened_at: meta.opened_at, open_tx: meta.open_tx ?? null, coverage: meta.coverage || [],
  };
}

/** Claims with their news metadata merged in (news lines only; every other claim is unchanged). */
export function mergeNews(claims, doc) {
  const lines = doc?.lines || {};
  return claims.map((c) => (lines[c.id] ? { ...c, news: newsField(lines[c.id]) } : c));
}

const STATUS = (c) => (c.status === "Settled" ? "decided" : c.status === "Open" ? "open" : "ruling");

/** One line as /api/today serves it. */
export function todayLine(meta, c, { section, picks = null, settleTime = null, nowMs = Date.now() }) {
  const n = newsField(meta);
  return {
    claim_id: meta.claim_id, section, kind: "news",
    question: n.question, claim: c?.text ?? meta.claim, topic: n.topic, why: n.why,
    source: n.source, settles: n.settles, first_estimate: n.first_estimate,
    price_yes: c ? c.price_yes_ppm / 1e6 : null, price_yes_ppm: c?.price_yes_ppm ?? null,
    trades: c?.trades ?? 0, volume_usd: c ? usd(c.volume_micro) : 0, open_interest_usd: c ? usd(c.open_interest_micro) : 0,
    liquidity_b_usd: usd(meta.b_micro), cost_to_move: c ? { up_10_points_usd: usd(c.cost_up_10_micro), down_10_points_usd: usd(c.cost_down_10_micro) } : null,
    status: c ? STATUS(c) : "unknown", chain_status: c?.status ?? null,
    overdue: c?.status === "Open" && nowMs >= n.settles.due_at,
    outcome: c?.outcome === true ? "true" : c?.outcome === false ? "false" : null,
    decided_at: c?.status === "Settled" ? settleTime : null,
    ruling: c && c.status !== "Open" && c.challenge_id !== null && c.challenge_id !== undefined ? { challenge_id: c.challenge_id, provisional: c.provisional === true ? "true" : c.provisional === false ? "false" : null } : null,
    settler: meta.settle ? { last_look_at: meta.settle.last_look_at ?? null, note: meta.settle.note ?? null, detail: meta.settle.detail ?? null, challenge_id: meta.settle.challenge_id ?? null } : null,
    picks: picks || { yes: 0, no: 0, total: 0 },
    bounty_usd: c ? usd(c.bounty_micro) : 0,
    opened_at: n.opened_at, open_tx: n.open_tx,
    url: `/c/${meta.claim_id}`,
  };
}

/**
 * GET /api/today: today's lines first (opened in the last 24 hours and still open), then the open
 * ones settling soonest, then the ones just decided (the last 7 days), newest first.
 * @param {{ claims: object[], doc: object, events?: object[], pickCounts?: Map<number, object>, nowMs?: number, cfg?: object }} a
 */
export function todayOf({ claims, doc, events = [], pickCounts = new Map(), nowMs = Date.now(), cfg = null }) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const settledAt = new Map();
  for (const e of events) if (e.event === "settle" && Number.isInteger(e.data?.claim_id)) settledAt.set(e.data.claim_id, e.blockTimestampMs || e.seenAtMs || null);
  const today = [], settling = [], decided = [];
  for (const meta of Object.values(doc?.lines || {})) {
    const c = byId.get(meta.claim_id);
    if (!c) continue;
    const view = (section) => todayLine(meta, c, { section, picks: pickCounts.get(meta.claim_id), settleTime: settledAt.get(meta.claim_id) ?? null, nowMs });
    if (c.status === "Settled") {
      const at = settledAt.get(meta.claim_id) ?? null;
      if (at === null || nowMs - at <= 7 * 24 * H) decided.push(view("decided"));
    } else if (nowMs - meta.opened_at <= 24 * H) today.push(view("today"));
    else settling.push(view("settling"));
  }
  today.sort((a, b) => b.opened_at - a.opened_at);
  settling.sort((a, b) => a.settles.due_at - b.settles.due_at || a.claim_id - b.claim_id);
  decided.sort((a, b) => (b.decided_at || 0) - (a.decided_at || 0));
  const lines = [...today, ...settling, ...decided];
  return {
    as_of: nowMs, date: isoDay(nowMs),
    counts: { today: today.length, settling: settling.length, decided: decided.length },
    next_scout_at: cfg ? nextScoutAt(nowMs, cfg.scoutHoursUtc) : null,
    lines,
    rules: {
      lines: "Each line is a claim from today's news that nobody had confirmed when it opened. It settles TRUE if the named source confirms it by the date in the claim, and FALSE if that date passes without it or the source denies it. Three AI judges rule on the receipts, on-chain.",
      picks: "Picks are free and win nothing: no purchase, no prize, no payout. They count toward your accuracy on the leaderboard only.",
    },
  };
}

/** GET /v1/today: today's lines and their odds, compact, for a publisher to embed. */
export function v1TodayOf(today, { network, marketId, siteUrl = "https://isitpriced.com" }) {
  return {
    name: "Priced In: today's claims", network, contract: marketId, as_of: new Date(today.as_of).toISOString(),
    lines: today.lines.map((l) => ({
      claim_id: l.claim_id, question: l.question, claim: l.claim, topic: l.topic,
      odds: l.price_yes === null ? null : { yes: l.price_yes, no: Math.round((1 - l.price_yes) * 1e6) / 1e6 },
      status: l.status, outcome: l.outcome, settles_by: l.settles.by, settling_source: l.settles.source,
      headline: l.source?.headline ?? null, headline_url: l.source?.url ?? null,
      url: `${siteUrl}/c/${l.claim_id}`, embed: { iframe: `${siteUrl}/embed/${l.claim_id}`, script: `<script src="${siteUrl}/embed.js" data-fact="${l.claim_id}" async></script>` },
    })),
    count: today.lines.length,
    terms: "Free, no key. Cached for a minute. The odds are the market's price on NEAR; /v1/credence?claim=<id> gives the full answer with its provenance.",
  };
}
