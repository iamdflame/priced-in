// The Sentinel: nobody wins by lying to the AI jury.
//
// The jury reads a claim and the challenger's evidence, and a made-up receipt fooled the real
// models 9 times in 10 (deployments/jury-test.json). Our own jury runner no longer carries one
// (services/ai/src/receipts.js gates it), but anyone can run the jury with their own NEAR AI key,
// so a refusal is not enough. The Sentinel watches every live challenge, every minute:
//
//   - when a provisional outcome sides with a challenger whose receipts failed the check
//     (quote_not_found, unfetchable, record_mismatch, or unsupported with no model disagreeing), it
//     disputes, once per round, inside the window, with evidence in plain words: what it fetched,
//     when, the HTTP status, the page's sha256, and the quote it could not find
//   - it never disputes a verified receipt, our own Checker's included
//   - a bare accusation (no_receipt) is recorded, not disputed: the jury already refuses those
//     (0 FALSE in 10)
//
// A dispute posts twice the current bond and flips the provisional outcome. If the challenger
// disputes back (twice again), the Sentinel disputes once more, and that third dispute sends the
// claim to the council: $2, then $8, on the market's $1 challenge bond. Its key can call only
// `dispute`, from its own account; the signer holds the daily caps and checks the round and the
// side on the chain again right before it signs (services/ai/src/signer.js).

import { FAILED } from "./receipts.js";

export const SENTINEL = Object.freeze({
  marginMs: 15_000, // a dispute is not started with less of the window left: it might land after it closes
  freshMs: 120_000, // a failed check older than this is run again before the Sentinel acts on it
});

const usd = (micro) => `$${(Number(micro) / 1e6).toFixed(2)}`;
const nsToMs = (ns) => (ns === null || ns === undefined ? null : Number(BigInt(String(ns)) / 1_000_000n));
const OUTCOME = (b) => (b === true ? "TRUE" : b === false ? "FALSE" : null);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}...` : String(s));

/**
 * What holding the line costs, on a given challenge bond (micro-USDC). Each dispute posts twice the
 * last bond, and the third goes to the council: the Sentinel posts rounds 1 and 3, the attacker
 * round 2. Those bonds are held until the council rules; the wrong side's pay the right side.
 */
export function fundingOf(challengeBondMicro) {
  const b = BigInt(String(challengeBondMicro));
  return { first_dispute_micro: String(2n * b), attacker_back_micro: String(4n * b), third_dispute_micro: String(8n * b), full_escalation_micro: String(10n * b) };
}

/** A signer refusal that means a cap or the money ran out: the Sentinel says so and stands by. */
export const isDisputeHold = (error) => /already sent today|dispute limit|bond cap|holds \$|still in flight/.test(String(error));

/**
 * What the Sentinel should do about one live challenge. Pure.
 * @param {{ id: number, ch: object, claim: object, check: object|null, windowEndMs?: number|null, nowMs: number,
 *   accounts?: { sentinel?: string|null, checker?: string|null }, disputed?: number[], marginMs?: number }} a
 * @returns {{ act: "dispute"|"check"|"none", status: "watching"|"disputed"|"no_dispute"|"blocked", note: string, round?: number, bond_micro?: string }}
 */
export function sentinelDecision({ id, ch, claim, check, windowEndMs = null, nowMs, accounts = {}, disputed = [], marginMs = SENTINEL.marginMs }) {
  const before = disputed.length > 0;
  const none = (status, note) => ({ act: "none", status, note });
  if (!ch || ch.resolved || !claim || claim.challenge_id !== id) return none(before ? "disputed" : "no_dispute", "This challenge is no longer live.");
  if (claim.status === "Escalated") return none(before ? "disputed" : "watching", "Three disputes sent this to the council, which rules now.");
  if (claim.status !== "Challenged") return none(before ? "disputed" : "no_dispute", "This challenge is no longer live.");
  if (accounts.sentinel && ch.challenger === accounts.sentinel) return none("no_dispute", "The Sentinel never disputes its own account.");
  if (!check) return { act: "check", status: "watching", note: "The receipts are being checked." };
  if (check.result === "verified" && check.support?.verdict === "unanswered") return none("watching", "The quote is at its source. Whether that source supports the challenge is still unanswered, so it is asked again.");
  if (check.result === "verified") {
    const ours = accounts.checker && ch.challenger === accounts.checker;
    return none("no_dispute", ours && check.via !== "source" ? "Our Checker's receipt verified against the committed corpus record: the Sentinel never disputes it." : "The receipts verified at their source: the Sentinel never disputes a verified receipt.");
  }
  if (check.result === "no_receipt") return none("no_dispute", "A bare accusation, with no source, no quote and no record: the jury refuses those (0 FALSE in 10 measured), so the Sentinel records it and does not dispute.");
  if (!FAILED.includes(check.result)) return none("watching", `The receipt check said ${check.result}.`);
  if (check.result === "unsupported" && !check.support?.unanimous) return none("no_dispute", "Two attested models found the source does not support the challenge and another disagreed: enough to keep our jury off it, not enough to put money against it.");
  const failed = `The receipts failed (${check.result.replace(/_/g, " ")})`;
  if (claim.provisional === null || claim.provisional === undefined) return none(before ? "disputed" : "watching", `${failed}. The jury has not ruled for anyone yet: if two judges side with the challenger, the Sentinel disputes.`);
  if (claim.provisional !== ch.claimed_outcome) return none(before ? "disputed" : "watching", before
    ? `${failed}, and after the Sentinel's dispute the outcome stands against the challenger (${OUTCOME(claim.provisional)}). If they dispute back, it disputes again.`
    : `${failed}, but the outcome already stands against the challenger (${OUTCOME(claim.provisional)}): nothing to dispute.`);
  const round = Number(ch.disputes || 0) + 1;
  const bond = String(BigInt(String(ch.bond_micro || "0")) * 2n);
  if (windowEndMs !== null && nowMs > windowEndMs - marginMs) return none("blocked", `${failed}, but the window closes at ${new Date(windowEndMs).toISOString()}: too late to land a dispute.`);
  return { act: "dispute", status: before ? "disputed" : "watching", note: `${failed}, and the provisional outcome sides with the challenger: the Sentinel disputes (round ${round}, a ${usd(bond)} bond).`, round, bond_micro: bond };
}

/** One source in plain words: where, when, what came back, and its hash. */
function sourceLine(s) {
  const when = s.fetched_at ? s.fetched_at.replace(/\.\d+Z$/, "Z") : "an unknown time";
  if (s.via === "corpus") return `Our corpus fetched ${s.url} at ${when}${s.status ? `: HTTP ${s.status}` : ""}${s.sha256 ? `, sha256 ${s.sha256}` : ""}.`;
  if (s.error && !s.status) return `We tried ${s.url} at ${when}: ${s.error}.`;
  return `We fetched ${s.url} at ${when}: HTTP ${s.status}${s.bytes ? `, ${s.bytes.toLocaleString("en-US")} bytes` : ""}${s.sha256 ? `, sha256 ${s.sha256}` : ""}${s.error && s.status ? ` (${s.error})` : ""}.`;
}

/**
 * The Sentinel's dispute evidence, in plain words and at most 4,000 bytes: what it fetched, when,
 * the HTTP status, the page's sha256, and the quote it could not find.
 */
export function disputeEvidence({ id, round, check, claimed }) {
  const lines = [`Priced In's Sentinel disputes challenge ${id} (round ${round}): the challenger's receipts do not check out, so the ${OUTCOME(claimed) ?? "claimed"} outcome has no support.`];
  if (check.result === "unsupported" && !check.support?.answers?.length) {
    lines.push(check.reason); // refused in code: no model read anything, and the record must not say one did
  } else if (check.result === "unsupported") {
    for (const s of (check.sources || []).filter((x) => x.via === "source").slice(0, 3)) lines.push(sourceLine(s));
    lines.push(`The quoted words are there, but they do not state what the challenge relies on. Attested models read that source and said so: ${(check.support?.answers || []).filter((a) => a.verified && a.answer === "NO").map((a) => `${a.model} (response sha256 ${a.response_hash})`).join("; ")}.`);
  } else if (check.result === "record_mismatch") {
    lines.push(check.reason);
    if (check.record?.id) lines.push(`The challenge cites corpus record ${check.record.id}${check.record.sha256_claimed ? ` with sha256 ${check.record.sha256_claimed}` : ""}. Anyone can compare: corpus/ERRORS.json at github.com/iamdflame/priced-in${check.record.sha256_committed ? ` gives that record sha256 ${check.record.sha256_committed}` : " has no such record"}.`);
  } else {
    for (const s of (check.sources || []).filter((x) => x.via === "source").slice(0, 6)) lines.push(sourceLine(s));
    const missing = (check.quotes || []).filter((q) => !q.found);
    if (missing.length) for (const q of missing.slice(0, 3)) lines.push(`The quoted words "${clip(q.text, 300)}" are not in ${check.result === "unfetchable" ? "any source we could read" : "it"} (compared ignoring case, spacing, quote marks, dashes and number formatting).`);
    else if (check.result === "quote_not_found") lines.push("The evidence quotes nothing from it, so nothing in it can be checked.");
    if (check.result === "unfetchable") lines.push("A receipt nobody can read is not a receipt.");
  }
  lines.push(`Checked ${String(check.checked_at || "").replace(/\.\d+Z$/, "Z")}. A real receipt is a public source and the exact words from it; with one, this challenge can be brought again.`);
  let s = lines.join("\n");
  while (Buffer.byteLength(s, "utf8") > 4000) s = `${s.slice(0, -80)}...`;
  return s;
}

/** Every claim on the market, a page of 100 at a time (one call for today's catalog). */
async function allClaims(view) {
  const out = [];
  for (let from = 0; ; from += 100) {
    const page = await view("get_claims", { from, limit: 100 });
    out.push(...page);
    if (page.length < 100) return out;
  }
}

/**
 * One look at every live challenge. Everything it touches comes in `d`, so the tests run it with fakes.
 * @param {{ view: (method: string, args?: object) => Promise<any>, stats?: object, ledger: { read: () => Promise<{ checks: object, sentinel: object }>,
 *   putCheck: (id: number, c: object) => Promise<void>, putSentinel: (id: number, e: object) => Promise<void> },
 *   check: (a: { claim: string, evidence: string, claimed: boolean|null }) => Promise<object>,
 *   dispute?: ((intent: string, d: { challenge_id: number, round: number, evidence: string }) => Promise<object>)|null,
 *   accounts?: { sentinel?: string|null, checker?: string|null }, now?: () => number, left?: () => number, log?: (m: string) => void }} d
 */
export async function sentinelRound(d) {
  const now = d.now || Date.now;
  const log = d.log || (() => {});
  const left = d.left || (() => Infinity);
  const out = { at: new Date(now()).toISOString(), idle: false, live: [], disputed: [], blocked: [], errors: [] };
  const stats = d.stats ?? (await d.view("stats", {}));
  // one view call when nothing is live: every live challenge holds at least the challenger's bond
  if (BigInt(String(stats?.bonds_micro ?? "0")) === 0n) return { ...out, idle: true, note: "No bond is held, so no challenge is live." };
  const claims = (await allClaims(d.view)).filter((c) => (c.status === "Challenged" || c.status === "Escalated") && Number.isInteger(c.challenge_id));
  const ledger = await d.ledger.read().catch((e) => { out.errors.push(`ledger: ${e.message}`); return { checks: {}, sentinel: {} }; });
  for (const claim of claims) {
    const id = claim.challenge_id;
    if (left() < 12_000) { out.errors.push("out of time before every live challenge was looked at"); break; }
    try {
      const ch = await d.view("get_challenge", { challenge_id: id });
      const past = ledger.sentinel?.[id] || {};
      const disputed = (past.disputes || []).map((x) => x.round);
      const ends = claim.provisional === null || claim.provisional === undefined ? null : await d.view("dispute_ends_ns", { challenge_id: id }).catch(() => null);
      const windowEndMs = nsToMs(ends);
      let check = ledger.checks?.[id] ?? null;
      const run = async () => {
        const c = await d.check({ claim: claim.text, evidence: ch.evidence, claimed: ch.claimed_outcome });
        await d.ledger.putCheck(id, c).catch((e) => out.errors.push(`ledger: check ${id}: ${e.message}`));
        return c;
      };
      const decide = () => sentinelDecision({ id, ch, claim, check, windowEndMs, nowMs: now(), accounts: d.accounts, disputed });
      let dec = decide();
      if (dec.act === "check") { check = await run(); dec = decide(); }
      // a failure is checked again just before acting on it: a source that was down may be back,
      // and the dispute's evidence says what is true now. So is a question the models left unanswered
      const stale = () => now() - Date.parse(check.checked_at) > SENTINEL.freshMs;
      if ((dec.act === "dispute" || check?.support?.verdict === "unanswered") && stale()) { check = await run(); dec = decide(); }
      const entry = { status: dec.status, note: dec.note, last_look_at: new Date(now()).toISOString(), disputes: past.disputes || [], attempts: past.attempts || [] };
      if (dec.act === "dispute") {
        const evidence = disputeEvidence({ id, round: dec.round, check, claimed: ch.claimed_outcome });
        const intent = `sentinel:dispute:${id}:r${dec.round}:${Math.floor(now() / 60_000)}`;
        const r = d.dispute ? await d.dispute(intent, { challenge_id: id, round: dec.round, evidence }) : { ok: false, error: "no Sentinel key in the keystore" };
        if (r.ok) {
          const x = { round: dec.round, bond_usd: Number(dec.bond_micro) / 1e6, tx: r.txHash ?? null, at: new Date(now()).toISOString(), result: check.result };
          Object.assign(entry, { status: "disputed", note: `The receipts failed (${check.result.replace(/_/g, " ")}): the Sentinel disputed in round ${dec.round} with a ${usd(dec.bond_micro)} bond.`, disputes: [...entry.disputes, x] });
          out.disputed.push({ challenge_id: id, ...x });
        } else {
          const why = String(r.error || "the dispute was refused").slice(0, 200);
          Object.assign(entry, { status: "blocked", note: `The receipts failed and the Sentinel would dispute, but ${isDisputeHold(why) ? "it is held" : "the dispute did not go through"}: ${why}`, attempts: [...entry.attempts, { round: dec.round, at: new Date(now()).toISOString(), error: why }].slice(-5) });
          out.blocked.push({ challenge_id: id, round: dec.round, error: why });
          if (!isDisputeHold(why) && !/round|does not side|not live|can't be disputed/.test(why)) out.errors.push(`dispute ${id}: ${why}`);
        }
      }
      // the record changes only when something changed: no store write on a quiet minute
      const same = past.status === entry.status && past.note === entry.note && (past.disputes || []).length === entry.disputes.length && (past.attempts || []).length === entry.attempts.length;
      if (!same) await d.ledger.putSentinel(id, entry).catch((e) => out.errors.push(`ledger: sentinel ${id}: ${e.message}`));
      out.live.push({ challenge_id: id, claim_id: claim.id, stage: claim.status === "Escalated" ? "escalated" : claim.provisional === null || claim.provisional === undefined ? "jury" : "window", receipt: check?.result ?? null, status: entry.status, note: entry.note });
      log(`sentinel: challenge ${id}: ${entry.status}: ${entry.note}`);
    } catch (e) {
      out.errors.push(`challenge ${id}: ${e.message}`);
    }
  }
  return out;
}
