// The operating signals the cron writes into snapshots/health.json for GET /health, so that the
// founder hears of a problem (scripts/watchdog.mjs fails on any /health check whose ok is false, and
// GitHub emails the owner) before a judge sees it. Each is computed here, in the cron, never on the
// request path; each is a checks.<name> entry with an `ok` flag, never an entry in /health's
// `failures` (that list turns /health into a 503, which a judge's own check reads as the site down).
//
//   ai         today's model calls and refusals, from spend.jsonl; ok false above 20 refusals that are
//              also more than a tenth of the day's calls
//   jury_keys  for each jury model, the signing key NEAR AI Cloud's attestation proves now against the
//              key registered on the market (get_model); ok false on any mismatch. Checked once a day,
//              and again from an hour before the Checker's sitting on sitting days (docs/RUNBOOK-jury-keys.md)
//   news       when the last news line opened, and the reserve room left for the next one
//   checker    the Checker's balance in the market against the challenge bond
//   lane       the free bets' credits and the lane account's NEAR for gas
//
// Every function below takes its reads as arguments, so the tests run it with fakes. A figure that
// could not be read is null and the entry says so; it never guesses.

import { creditsOf, spareNear } from "../../services/api/src/lane.mjs";
import { headroomMicro } from "../../services/ai/src/gate.js";
import { firstSitting } from "./keeper.mjs";

export const JURY_KEYS_DOC = "snapshots/jury-keys.json";
export const RUNBOOK = "docs/RUNBOOK-jury-keys.md";
export const MAX_REFUSALS = 20;
export const MAX_REFUSAL_SHARE = 0.1;
const HOUR = 3600_000;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t) => Date.parse(isoDay(t));
const iso = (t) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);
const usd = (micro) => (micro === null || micro === undefined ? null : Number(micro) / 1e6);
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00 UTC`;

// ---------- ai ----------

/**
 * The `ai` entry from today's call counts (spend.mjs countCalls). Not ok when more than 20 calls came back
 * without an answer and they are also more than a tenth of the day's calls. The count alone grows with the
 * number of open claims: on 13 November, 48 claims made 819 calls, and the 29 that failed (3.5%) tripped a
 * rule written when a day had a few dozen calls.
 */
export function aiEntry(counts, { maxRefusals = MAX_REFUSALS, maxShare = MAX_REFUSAL_SHARE } = {}) {
  if (!counts) return null;
  const share = counts.calls > 0 ? counts.refusals / counts.calls : 0;
  const ok = counts.refusals <= maxRefusals || share <= maxShare;
  return {
    day: counts.day, calls: counts.calls, refusals: counts.refusals, refusal_share: Number(share.toFixed(4)), cap_refused: counts.cap_refused, by_status: counts.by_status, max_refusals: maxRefusals, max_share: maxShare, ok,
    note: ok ? null : `NEAR AI refused or failed ${counts.refusals} of ${counts.calls} model calls today (UTC): more than ${maxRefusals}, and more than ${Math.round(maxShare * 100)}% of them. The agents, the writer or the jury may be going quiet. by_status says which answers came back.`,
  };
}

// ---------- jury_keys ----------

/**
 * The check window a moment falls in: the day's own ("2026-11-12"), or on a sitting day, from an hour
 * before the sitting on ("2026-11-12T14"). A sitting day is any day from CHECKER_FROM's first sitting on
 * (every day when it is unset): news lines also go to the jury as they come due, every day.
 */
export function juryKeysWindow(nowMs, sitting) {
  const d = isoDay(nowMs);
  const first = firstSitting(sitting);
  const sittingDay = !first || nowMs >= dayStart(first);
  const preAt = dayStart(nowMs) + (sitting.hourUtc - 1) * HOUR;
  if (sittingDay && nowMs >= preAt) return { key: `${d}T${String(Math.max(0, sitting.hourUtc - 1)).padStart(2, "0")}`, why: `before the ${hh(sitting.hourUtc)} sitting` };
  return { key: d, why: "the daily check" };
}

/** The window to check now, or null when this window's check is done (or tried maxAttempts times). */
export function juryKeysDue(last, nowMs, sitting, { maxAttempts = 3 } = {}) {
  const w = juryKeysWindow(nowMs, sitting);
  if (last?.window === w.key && (last.complete || (last.attempts || 0) >= maxAttempts)) return null;
  return w;
}

const lower = (s) => String(s || "").toLowerCase();

/**
 * One model's row: the attested key against the registered one.
 *   match           the key the market verifies with is a key the attestation proves now
 *   mismatch        it is not: the model's verdicts would be refused by the contract
 *   not_registered  the market has no key for this model
 *   unverified      the attestation came back but did not verify (Intel quote, GPU, nonce or binding)
 *   unread          the attestation or get_model did not answer
 * @param {string} model
 * @param {{ v?: object, e?: Error }} a the Attestor's preflight record, or its error
 * @param {{ v?: object|null, e?: Error }} r get_model's answer, or its error
 */
export function keyRow(model, a, r) {
  const registered = r.e ? null : r.v?.signing_address_hex ? lower(r.v.signing_address_hex) : null;
  const signers = a.e || !a.v?.ok ? [] : (a.v.verifiedSigners || []).map((s) => lower(s.signing_address));
  const row = {
    model,
    registered_signing_address: registered,
    attested_signing_address: signers.length === 1 ? signers[0] : signers.length ? signers : null,
    attested_at: a.v?.fetchedAt ? iso(a.v.fetchedAt) : null,
    nonce: a.v?.nonce ?? null,
  };
  if (!r.e && !registered) return { ...row, status: "not_registered", detail: "The market has no signing key for this model, so it refuses every verdict the model signs." };
  if (a.e) return { ...row, status: "unread", detail: `NEAR AI Cloud's attestation report did not answer: ${String(a.e.message || a.e).slice(0, 160)}` };
  if (!a.v?.ok) return { ...row, status: "unverified", detail: `The attestation did not verify: ${(a.v?.failures || ["no report"]).slice(0, 2).join("; ").slice(0, 240)}` };
  if (r.e) return { ...row, status: "unread", detail: `get_model did not answer: ${String(r.e.message || r.e).slice(0, 160)}` };
  if (signers.includes(registered)) return { ...row, status: "match", detail: null };
  return { ...row, status: "mismatch", detail: `The market verifies this model's signatures with ${registered.slice(0, 16)}…, but its attested TEE now signs with ${signers[0].slice(0, 16)}…: the contract would refuse its verdicts. Re-register it: ${RUNBOOK}.` };
}

const settle = (p, ms) => {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer in ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([p, t]).then((v) => ({ v }), (e) => ({ e })).finally(() => clearTimeout(timer));
};

/**
 * Check every jury model once. A mismatch or a missing key fails at once; an unread or unverified
 * attestation is tried again by the next cron runs, and fails once maxAttempts in the window all ended so.
 * @param {{ models: string[], attest: (model: string) => Promise<object>, registered: (model: string) => Promise<object|null>,
 *   nowMs: number, window: string, prev?: object|null, maxAttempts?: number, timeoutMs?: number }} d
 */
export async function juryKeysCheck(d) {
  const maxAttempts = d.maxAttempts ?? 3;
  const attempts = d.prev?.window === d.window ? (d.prev.attempts || 0) + 1 : 1;
  const rows = await Promise.all(d.models.map(async (model) => {
    const [a, r] = await Promise.all([settle(Promise.resolve().then(() => d.attest(model)), d.timeoutMs ?? 60_000), settle(Promise.resolve().then(() => d.registered(model)), d.timeoutMs ?? 60_000)]);
    return keyRow(model, a, r);
  }));
  const bad = rows.filter((x) => x.status === "mismatch" || x.status === "not_registered");
  const unsure = rows.filter((x) => x.status === "unread" || x.status === "unverified");
  const complete = unsure.length === 0;
  const ok = bad.length === 0 && (complete || attempts < maxAttempts);
  const note = bad.length ? `${bad.map((x) => x.model).join(", ")}: ${bad.length === 1 ? "its key does" : "their keys do"} not match the market's. The jury cannot rule until ${bad.length === 1 ? "it is" : "they are"} re-registered (${RUNBOOK}).`
    : !complete ? `${unsure.map((x) => x.model).join(", ")} could not be checked (attempt ${attempts} of ${maxAttempts}${ok ? "; the next cron run tries again" : ""}). ${unsure[0].detail}`
      : `All ${rows.length} jury keys match the market's.`;
  return { at: iso(d.nowMs), window: d.window, attempts, complete, ok, models: rows, note, runbook: RUNBOOK };
}

/** The entry /health shows from the last stored check: a check older than 26 hours is itself a failure. */
export function juryKeysEntry(doc, nowMs, { maxAgeH = 26 } = {}) {
  if (!doc?.at) return { checked: false, note: "Not checked yet: the cron checks the jury keys once a day, and an hour before each sitting." };
  const { running_until: _r, ...entry } = doc;
  const ageH = (nowMs - Date.parse(doc.at)) / HOUR;
  if (ageH > maxAgeH) return { ...entry, ok: false, note: `The jury-key check last ran ${Math.round(ageH)} hours ago (it runs at least daily). ${doc.note || ""}`.trim() };
  return entry;
}

/**
 * The cron's jury-key round: when a window is due, claim it in the store (so two overlapping runs don't
 * both attest), check every model, store the result. Returns the entry for /health either way.
 * @param {{ state: object, models: string[], attest: Function, registered: Function, sitting: object, now?: () => number, log?: Function, maxAttempts?: number, timeoutMs?: number }} d
 */
export async function juryKeysRound(d) {
  const nowMs = (d.now || Date.now)();
  let prev = null, window = null;
  const claim = await d.state.updateDoc(JURY_KEYS_DOC, (cur) => {
    prev = cur ?? null;
    const w = juryKeysDue(cur, nowMs, d.sitting, { maxAttempts: d.maxAttempts ?? 3 });
    if (!w || (cur?.running_until || 0) > nowMs) return undefined;
    window = w.key;
    return { ...(cur || {}), running_until: nowMs + 150_000 };
  });
  if (!claim.changed) return juryKeysEntry(prev, nowMs);
  let entry;
  try {
    entry = await juryKeysCheck({ models: d.models, attest: d.attest, registered: d.registered, nowMs, window, prev, maxAttempts: d.maxAttempts, timeoutMs: d.timeoutMs });
  } catch (e) {
    entry = { at: iso(nowMs), window, attempts: (prev?.window === window ? prev.attempts || 0 : 0) + 1, complete: false, ok: true, models: prev?.models ?? [], note: `The check itself failed: ${String(e.message).slice(0, 160)}`, runbook: RUNBOOK };
  }
  await d.state.updateDoc(JURY_KEYS_DOC, () => entry).catch((e) => d.log?.(`jury keys: record: ${e.message}`));
  if (!entry.ok) d.log?.(`jury keys: ${entry.note}`);
  return juryKeysEntry(entry, nowMs);
}

// ---------- news ----------

/**
 * The `news` entry: when the last line opened, and whether the treasury can carry the next one.
 * Fails when no line opened for maxAgeH hours (the scout runs twice a day), or when the reserve room is
 * smaller than what the last line reserved.
 * @param {{ enabled: boolean, lines: object, roomMicro: number|null, capRead?: boolean, nowMs: number, maxAgeH?: number }} a
 */
export function newsEntry({ enabled, lines, roomMicro, capRead = true, nowMs, maxAgeH = 26 }) {
  if (!enabled) return { enabled: false, ok: true, note: "Today's claims are off (NEWS_ENABLED is not 1)." };
  const opened = Object.values(lines || {}).filter((l) => Number.isFinite(l?.opened_at)).sort((a, b) => b.opened_at - a.opened_at);
  const last = opened[0] ?? null;
  const ageH = last ? (nowMs - last.opened_at) / HOUR : null;
  const needMicro = last?.reserve_micro !== undefined && last?.reserve_micro !== null ? Number(last.reserve_micro) : null;
  const stale = !last || ageH > maxAgeH;
  const short = roomMicro !== null && roomMicro !== undefined && needMicro !== null && roomMicro < needMicro;
  const ok = !stale && !short;
  const notes = [];
  if (stale) notes.push(last ? `No news line opened in ${Math.round(ageH)} hours (the scout runs twice a day).` : "No news line has opened yet.");
  if (short) notes.push(`The treasury can carry $${usd(roomMicro).toFixed(2)} more of reserves, less than the $${usd(needMicro).toFixed(2)} the last line reserved: the next line won't open until money is added (scripts/mainnet/news-funding.mjs).`);
  if (roomMicro === null || roomMicro === undefined) notes.push("The reserve room could not be read.");
  else if (!capRead) notes.push("The reserve cap could not be read (the market's state is past what most public RPCs list), so the room shown is the treasury's; the contract enforces the cap.");
  return {
    enabled: true,
    last_opened_at: iso(last?.opened_at), last_claim_id: last?.claim_id ?? null, hours_since: ageH === null ? null : Math.round(ageH * 10) / 10,
    opened_today: opened.filter((l) => isoDay(l.opened_at) === isoDay(nowMs)).length,
    reserve_room_usd: roomMicro === null || roomMicro === undefined ? null : usd(roomMicro), reserve_cap_read: capRead, last_line_reserve_usd: usd(needMicro),
    ok, note: notes.join(" ") || null,
  };
}

/** The reserve room from readCapacity (api/_lib/news.mjs), with the news treasury floor kept back. Null when unread. */
export const roomOf = (capacity, floorMicro = 0) => (capacity ? headroomMicro({ ...capacity, floorMicro }) : null);

// ---------- checker ----------

/** The `checker` entry: its balance in the market against the challenge bond. */
export function checkerEntry({ account, balanceMicro, bondMicro }) {
  if (!account) return { configured: false, note: "No Checker key in the keystore: the daily sitting can't post a challenge." };
  if (balanceMicro === null || balanceMicro === undefined || bondMicro === null || bondMicro === undefined) return { account, balance_usd: usd(balanceMicro ?? null), bond_usd: usd(bondMicro ?? null), note: "The balance or the bond could not be read." };
  const b = BigInt(String(balanceMicro)), bond = BigInt(String(bondMicro));
  const ok = b >= bond;
  return { account, balance_usd: usd(b), bond_usd: usd(bond), bonds_covered: bond > 0n ? Number(b / bond) : null, ok, note: ok ? null : `The Checker holds $${usd(b).toFixed(2)}, less than one $${usd(bond).toFixed(2)} bond: the next sitting can't challenge. Fund it with scripts/mainnet/checker.mjs.` };
}

// ---------- lane ----------

/** The `lane` entry: the free credits the market can pay, and the lane account's spare NEAR for gas. */
export function laneEntry({ account, stats, acct, minNear }) {
  if (!account) return { note: "No lane account: free bets are off." };
  const credits = stats ? creditsOf(stats) : null;
  const near = acct ? spareNear(acct) : null;
  const noCredits = credits === 0;
  const lowGas = near !== null && Number(minNear) > 0 && near < Number(minNear);
  const notes = [];
  if (noCredits) notes.push("No free credit is left on the market: add some with scripts/mainnet/news-funding.mjs --lane-budget max.");
  if (lowGas) notes.push(`The lane account has ${near.toFixed(3)} NEAR spare, under the ${minNear} NEAR minimum: new free bets are refused until it is topped up.`);
  if (credits === null || near === null) notes.push("Part of this could not be read.");
  return { account, credits, near_spare: near, near_min: Number(minNear) || 0, ok: !noCredits && !lowGas, note: notes.join(" ") || null };
}

// ---------- the chain reads, together ----------

/**
 * The news, checker and lane entries from the chain and the store. Never throws: a read that fails
 * leaves its figure null.
 * @param {{ view: (method: string, args?: object) => Promise<any>, account: (id: string) => Promise<object>, capacity: () => Promise<object|null>,
 *   lines: () => Promise<object>, news: { enabled: boolean, floorMicro: number }, checkerId: string|null, laneId: string|null, laneMinNear: number, nowMs: number }} d
 */
export async function chainSignals(d) {
  const quiet = (p) => Promise.resolve().then(p).catch(() => null);
  const [stats, res, checkerBal, laneAcct, capacity, lines] = await Promise.all([
    quiet(() => d.view("stats")),
    quiet(() => d.view("get_resolution")),
    d.checkerId ? quiet(() => d.view("get_balance", { trader: d.checkerId })) : null,
    d.laneId ? quiet(() => d.account(d.laneId)) : null,
    d.news.enabled ? quiet(() => d.capacity()) : null,
    d.news.enabled ? quiet(() => d.lines()) : null,
  ]);
  return {
    news: newsEntry({ enabled: d.news.enabled, lines: lines?.lines ?? {}, roomMicro: roomOf(capacity, d.news.floorMicro), capRead: capacity?.capRead !== false, nowMs: d.nowMs }),
    checker: checkerEntry({ account: d.checkerId, balanceMicro: checkerBal, bondMicro: res?.challenge_bond_micro ?? null }),
    lane: laneEntry({ account: d.laneId, stats, acct: laneAcct, minNear: d.laneMinNear }),
  };
}

/** /health's checks entry for one of these: the cron's figures over what the request read itself, with the cron's time. */
export function mergeSignal(base, sig, at) {
  if (!sig) return base ?? null;
  return { ...(base || {}), ...sig, as_of: at ?? null };
}
