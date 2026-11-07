// Free daily picks, profiles, readers' reports and the leaderboard: no wallet and no money.
//
// A visitor's browser already holds an ed25519 key, made for the free $1 bet (site/lib/core/lane.ts).
// It signs each pick, nickname and report; this code checks the signature against the public key and
// keeps the signed record, so anyone can check every pick (GET /api/picks?claim=<id> serves them with
// their messages and signatures). Picks are off-chain and free, and they win nothing: no purchase, no
// prize, no payout. A pick is scored when its line settles on-chain.
//
//   picks.jsonl     { t: "pick", key, claim_id, side, issued_at, at, price_yes_ppm, page, message, signature }
//   profiles.jsonl  { t: "profile", key, nickname, issued_at, at, message, signature }
//   reports.jsonl   { t: "report", id, key, claim_id, says, url, quote, note, issued_at, at, message, signature, evidence }
//                   then { t: "report_status", id, status, at, reason, ... } as the check and the challenge go
//
// The house AI traders sit on the same board: each one's first buy on a line is its pick, at the price
// before that buy, so "you against the AIs" counts the same thing for both.

import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { baseDecode } from "near-api-js";
import { endOfDay } from "../../services/ai/src/scout.js";
import { chronological, timeOf } from "./views.mjs";

export const PICKS = "picks.jsonl";
export const PROFILES = "profiles.jsonl";
export const REPORTS = "reports.jsonl";
export const MAX_SKEW_MS = 10 * 60_000;
export const RULES = "Picks are free and win nothing: no purchase, no prize, no payout, no sweepstakes. They only count toward accuracy on this board. A verified catch the jury upholds adds to your caught count and your points.";
const DAY = 86_400_000;
const sha256hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export class Refusal extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const refusalBody = (e) => ({ error: { code: e.code, message: e.message, ...e.extra } });

// ---------- what a browser signs ----------

/** The exact bytes a browser signs for a pick. */
export const pickMessage = ({ network, claim_id, side, issued_at }) => `pricedin|pick|v1|${network}|${claim_id}|${side}|${issued_at}`;
/** ... for a nickname. */
export const profileMessage = ({ network, nickname, issued_at }) => `pricedin|profile|v1|${network}|${nickname}|${issued_at}`;
/** ... for a report: its url, quote and note go in by their sha256, so the message stays one line. */
export const reportDigest = ({ url, quote, note }) => sha256hex(JSON.stringify([url, quote, note]));
export const reportMessage = ({ network, claim_id, says, url, quote, note, issued_at }) => `pricedin|report|v1|${network}|${claim_id}|${says}|${reportDigest({ url, quote, note })}|${issued_at}`;

/** A public key as the lane names it ("ed25519:<base58 of 32 bytes>"), or a refusal. */
export function parseKey(s) {
  const t = String(s ?? "").trim();
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) throw new Refusal(400, "invalid_public_key", "public_key must be your browser's key: ed25519:<base58>.");
  let bytes;
  try { bytes = baseDecode(t.slice(8)); } catch { throw new Refusal(400, "invalid_public_key", "public_key is not valid base58."); }
  if (bytes.length !== 32) throw new Refusal(400, "invalid_public_key", "public_key must be 32 bytes.");
  return { key: t, bytes: new Uint8Array(bytes) };
}

/** A signature as 128 hex characters or 88 base64 characters. */
function signatureBytes(s) {
  const t = String(s ?? "").trim();
  if (/^[0-9a-fA-F]{128}$/.test(t)) return new Uint8Array(Buffer.from(t, "hex"));
  if (/^[A-Za-z0-9+/]{86}==$/.test(t)) return new Uint8Array(Buffer.from(t, "base64"));
  throw new Refusal(400, "invalid_signature", "signature must be the ed25519 signature of the message: 128 hex characters (or base64).");
}

/** Check an ed25519 signature over the message's UTF-8 bytes. */
export function verifySigned(keyBytes, message, signature) {
  return nacl.sign.detached.verify(new Uint8Array(Buffer.from(message, "utf8")), signatureBytes(signature), keyBytes);
}

/** issued_at: the browser's clock in ms, within ten minutes of ours (a replay later is refused). */
function issuedAt(v, nowMs) {
  const t = Number(v);
  if (!Number.isSafeInteger(t)) throw new Refusal(400, "invalid_issued_at", "issued_at must be the time you signed, in ms since 1970.");
  if (Math.abs(nowMs - t) > MAX_SKEW_MS) throw new Refusal(400, "stale_signature", "This was signed more than ten minutes away from now. Check your clock and sign again.");
  return t;
}

function signed(b, { nowMs, message }) {
  const { key, bytes } = parseKey(b?.public_key);
  const issued_at = issuedAt(b?.issued_at, nowMs);
  const msg = message(issued_at);
  if (!verifySigned(bytes, msg, b?.signature)) throw new Refusal(401, "bad_signature", "The signature does not match this message and key.", { message: msg });
  return { key, issued_at, message: msg, signature: String(b.signature).trim() };
}

// ---------- picks ----------

/** A pick request, checked: its fields, its signature, its time. Throws a Refusal. */
export function parsePick(b, { network, nowMs = Date.now() }) {
  const claim_id = Number(b?.claim_id);
  if (!Number.isSafeInteger(claim_id) || claim_id < 0) throw new Refusal(400, "invalid_claim_id", "claim_id must be a line's id.");
  const side = String(b?.side ?? "").toLowerCase();
  if (side !== "yes" && side !== "no") throw new Refusal(400, "invalid_side", 'side must be "yes" or "no".');
  const s = signed(b, { nowMs, message: (issued_at) => pickMessage({ network, claim_id, side, issued_at }) });
  return { claim_id, side, ...s };
}

/** May this line take a pick now? A refusal says why in plain words. */
export function pickableOrWhy(claim, news, nowMs) {
  if (!claim) throw new Refusal(404, "no_such_claim", "There is no line with that id.");
  if (claim.status === "Settled") throw new Refusal(409, "line_closed", "This line is settled: it takes no more picks.");
  if (claim.status !== "Open") throw new Refusal(409, "line_closed", "Three AI judges are ruling on this line, so it takes no picks until they finish.");
  if (news?.settles?.by && nowMs >= endOfDay(news.settles.by)) throw new Refusal(409, "line_closed", "This line's date has passed: it takes no more picks while it settles.");
}

/** Every key's first pick on every line, oldest first (a later pick on the same line never counts). */
export function firstPicks(records) {
  const seen = new Set();
  const out = [];
  for (const r of [...records].filter((x) => x?.t === "pick").sort((a, b) => a.at - b.at)) {
    const k = `${r.key}|${r.claim_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// ---------- nicknames ----------

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s", "!": "i" };
const squash = (s) => String(s).toLowerCase().replace(/[013457@$!8]/g, (c) => LEET[c] || c).replace(/[^a-z\p{L}]/gu, "");
// whole-word in the name, or anywhere in its letters for the unambiguous ones
const ANYWHERE = ["fuck", "cunt", "nigg", "faggot", "retard", "whore", "kike", "rapist", "pedo", "nazi", "hitler", "shit", "bitch", "pussy", "cock", "porn"];
const WORDS = ["fag", "rape", "sex", "dick", "spic", "chink", "slut", "twat", "wank", "kill", "die", "ass", "anal", "cum", "hoe", "jew", "isis"];
const RESERVED = ["pricedin", "isitpriced", "admin", "administrator", "moderator", "mod", "official", "support", "staff", "team", "checker", "sentinel", "keeper", "jury", "judge", "archivist", "skeptic", "quant", "near", "nearai", "system", "anthropic", "claude", "owner", "treasury"];

/** A nickname, cleaned and checked: 3 to 20 characters of letters, digits, spaces, dots, dashes and underscores, with at least one letter, and no word we refuse. */
export function cleanNickname(raw) {
  const s = String(raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 20) throw new Refusal(400, "invalid_nickname", "A nickname is 3 to 20 characters.");
  if (!/^[\p{L}\p{N} ._-]+$/u.test(s)) throw new Refusal(400, "invalid_nickname", "A nickname uses letters, digits, spaces, dots, dashes and underscores only.");
  if (!/\p{L}/u.test(s)) throw new Refusal(400, "invalid_nickname", "A nickname needs at least one letter.");
  const flat = squash(s);
  const words = s.toLowerCase().split(/[^\p{L}\p{N}]+/u).map(squash).filter(Boolean);
  if (ANYWHERE.some((w) => flat.includes(w)) || WORDS.some((w) => words.includes(w))) throw new Refusal(400, "nickname_refused", "That nickname isn't allowed. Pick another.");
  if (RESERVED.some((w) => flat.includes(w))) throw new Refusal(400, "nickname_reserved", "That nickname could be mistaken for Priced In or one of its AIs. Pick another.");
  return s;
}

export function parseProfile(b, { network, nowMs = Date.now() }) {
  const nickname = cleanNickname(b?.nickname);
  const s = signed(b, { nowMs, message: (issued_at) => profileMessage({ network, nickname, issued_at }) });
  return { nickname, ...s };
}

const nameKey = (n) => squash(n) || n.toLowerCase();

/** Each key's nickname: its latest, unless another key took that name first (then it has none). */
export function nicknames(records) {
  const owner = new Map(); // name key -> the first key that took it
  const latest = new Map(); // key -> nickname
  for (const r of [...records].filter((x) => x?.t === "profile").sort((a, b) => a.at - b.at)) {
    const k = nameKey(r.nickname);
    if (!owner.has(k)) owner.set(k, r.key);
    latest.set(r.key, r.nickname);
  }
  const out = new Map();
  for (const [key, nick] of latest) if (owner.get(nameKey(nick)) === key) out.set(key, nick);
  return out;
}
export const nicknameTaken = (records, nickname, key) => {
  const k = nameKey(nickname);
  const first = [...records].filter((x) => x?.t === "profile").sort((a, b) => a.at - b.at).find((r) => nameKey(r.nickname) === k);
  return Boolean(first && first.key !== key);
};

/** A visitor's name on the board: their nickname, or "Visitor" and the start of their key. */
export const displayName = (key, nicks) => nicks.get(key) || `Visitor ${String(key).slice(8, 14)}`;

// ---------- reports ----------

const URL_OK = /^https:\/\/[^\s"'<>]{4,490}$/;

/** A report request, checked. The evidence the Checker would post is built here, from the reader's words. */
export function parseReport(b, { network, nowMs = Date.now() }) {
  const claim_id = Number(b?.claim_id);
  if (!Number.isSafeInteger(claim_id) || claim_id < 0) throw new Refusal(400, "invalid_claim_id", "claim_id must be a line's id.");
  const says = String(b?.says ?? "false").toLowerCase();
  if (says !== "false" && says !== "true") throw new Refusal(400, "invalid_says", 'says is "false" (the line is wrong, the default) or "true".');
  const url = String(b?.url ?? "").trim();
  if (!URL_OK.test(url)) throw new Refusal(400, "invalid_url", "url must be a public https:// link to the page with the words.");
  const quote = String(b?.quote ?? "").replace(/\s+/g, " ").trim();
  if (quote.length < 16 || quote.length > 600 || quote.split(" ").length < 3) throw new Refusal(400, "invalid_quote", "quote must be the exact words from that page: 3 or more words, 16 to 600 characters.");
  const note = String(b?.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > 600) throw new Refusal(400, "invalid_note", "note is at most 600 characters.");
  const s = signed(b, { nowMs, message: (issued_at) => reportMessage({ network, claim_id, says, url, quote, note, issued_at }) });
  return { claim_id, says, url, quote, note, ...s, id: sha256hex(`${s.key}|${claim_id}|${s.issued_at}`).slice(0, 16) };
}

/** The evidence a verified report goes on-chain with: the reader's note (links and quote marks taken out, so only their receipt is checked), the page and its words. */
export function reportEvidence(r) {
  const note = r.note.replace(/https?:\/\/\S+/g, "[link removed]").replace(/["“”„«»]/g, "'").replace(/^\s*>/gm, "");
  const lines = [
    `A reader's report, checked by Priced In's Checker before this challenge: the line is ${r.says === "true" ? "TRUE" : "FALSE"}.`,
    note ? `The reader's note: ${note}` : null,
    `Source: ${r.url}`,
    `Receipt excerpt: "${r.quote.replace(/"/g, "'")}"`,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 3900);
}

const PLAIN = {
  received: "Received. We are checking that the words are on that page.",
  retry: "Received. The check could not finish yet; it runs again soon.",
  refused: "Refused.",
  verified: "The words are on that page and it supports your report. The Checker challenges the line next.",
  challenged: "The Checker challenged the line with your receipt. Three AI judges rule next.",
  ruling: "Three AI judges are ruling on it.",
  upheld: "Upheld: the jury ruled your way. It counts as a catch.",
  rejected: "Not upheld: the line settled the other way.",
  expired: "The ruling ran out of time without a decision. Nothing counts either way.",
  closed: "The line stopped taking challenges before we could act on it.",
};

/** What a receipt check's result means for a reader, in one sentence. */
export function refusalWords(check) {
  if (!check) return "The check could not run.";
  if (check.result === "quote_not_found") return "We couldn't find those exact words at that page. Copy them from the page as they appear there.";
  if (check.result === "unfetchable") return "We couldn't read that page (it may block robots, need a login, or be down). Try a page anyone can open.";
  if (check.result === "no_receipt") return "There was nothing to check: give a link and the exact words.";
  if (check.result === "unsupported") return "The words are on that page, but our three AI checkers found the page doesn't show the line is wrong.";
  if (check.result === "record_mismatch") return "That record doesn't match this line.";
  return check.reason || "The check did not pass.";
}

/**
 * Every report with where it stands now: the journal's latest status, then the chain's word on a
 * challenge it led to (upheld, rejected, expired).
 */
export function reportsOf(records, { claims = [], events = [] } = {}) {
  const byId = new Map();
  for (const r of [...records].sort((a, b) => a.at - b.at)) {
    if (r?.t === "report") byId.set(r.id, { ...r, status: "received", reason: PLAIN.received, history: [] });
    else if (r?.t === "report_status" && byId.has(r.id)) {
      const x = byId.get(r.id);
      x.history.push({ status: r.status, at: r.at });
      Object.assign(x, { status: r.status, reason: r.reason ?? PLAIN[r.status] ?? null, ...(r.challenge_id !== undefined ? { challenge_id: r.challenge_id, challenge_tx: r.tx ?? null } : {}), ...(r.check ? { check: r.check } : {}), attempts: r.attempts ?? x.attempts ?? 0 });
    }
  }
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const expired = new Set(events.filter((e) => e.event === "challenge_expired" || e.event === "void").map((e) => e.data?.challenge_id));
  const settledAt = new Map(events.filter((e) => e.event === "settle").map((e) => [e.data?.challenge_id, timeOf(e)]));
  for (const x of byId.values()) {
    if (x.status !== "challenged" || !Number.isInteger(x.challenge_id)) continue;
    const c = claimById.get(x.claim_id);
    if (expired.has(x.challenge_id)) Object.assign(x, { status: "expired", reason: PLAIN.expired });
    else if (c?.status === "Settled" && c.challenge_id === x.challenge_id) {
      const won = c.outcome === (x.says === "true");
      Object.assign(x, { status: won ? "upheld" : "rejected", reason: won ? PLAIN.upheld : PLAIN.rejected, decided_at: settledAt.get(x.challenge_id) ?? null });
    } else if (c && c.challenge_id === x.challenge_id) Object.assign(x, { status: "ruling", reason: PLAIN.ruling });
  }
  return byId;
}

/** A report as the API shows it: no signature bytes needed to read it, but they are there to check. */
export const reportView = (x) => ({
  id: x.id, key: x.key, claim_id: x.claim_id, says: x.says, url: x.url, quote: x.quote, note: x.note, at: x.at,
  status: x.status, reason: x.reason, challenge_id: x.challenge_id ?? null, challenge_tx: x.challenge_tx ?? null, decided_at: x.decided_at ?? null,
  check: x.check ? { result: x.check.result, support: x.check.support ?? null } : null,
  message: x.message, signature: x.signature,
});

// ---------- the board ----------

/** The house AI traders: account -> name, from the agents' own answers, else the three house accounts of this market's owner. */
export function aiTraders({ names = new Map(), marketId = "", env = process.env }) {
  const out = new Map();
  for (const part of String(env.LEADERBOARD_AI || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [acct, name] = part.split("=");
    if (acct && name) out.set(acct.trim(), name.trim());
  }
  if (out.size) return out;
  const root = String(marketId).replace(/^market\./, "");
  for (const [k, v] of [["archivist", "Archivist"], ["skeptic", "Skeptic"], ["quant", "Quant"]]) out.set(`h-${k}.${root}`, names.get(`h-${k}.${root}`) || v);
  return out;
}

/** Each AI trader's picks: its first buy on each line, at the price just before that buy. */
export function aiPicks(events, ai) {
  const price = new Map(); // claim -> price_yes_ppm before the next trade
  const seen = new Set();
  const out = [];
  for (const e of chronological(events)) {
    const d = e.data || {};
    if (!Number.isInteger(d.claim_id)) continue;
    if (e.event === "open") { price.set(d.claim_id, Math.min(800_000, Math.max(200_000, Number(d.p0_ppm)))); continue; }
    if (e.event !== "trade") continue;
    const before = price.get(d.claim_id) ?? 500_000;
    if (Number.isFinite(d.price_yes_ppm)) price.set(d.claim_id, d.price_yes_ppm);
    if (!ai.has(d.trader) || String(d.side).startsWith("sell_")) continue;
    const k = `${d.trader}|${d.claim_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ t: "pick", key: d.trader, claim_id: d.claim_id, side: d.side, at: timeOf(e), price_yes_ppm: before, tx: e.txHash ?? null, ai: true });
  }
  return out;
}

/** Points for a right pick: more for calling what the market thought unlikely. A wrong pick scores none. */
export const pointsFor = (side, priceYesPpm) => Math.max(1, Math.round(100 * (1 - (side === "yes" ? priceYesPpm : 1_000_000 - priceYesPpm) / 1e6)));

const PERIODS = { week: 7 * DAY, month: 30 * DAY, all: Infinity };

/**
 * The leaderboard: people and the house AI traders side by side, ranked by accuracy once they have
 * `minSettled` settled picks in the period (then by how many, then by points).
 * @param {{ picks: object[], claims: object[], events: object[], reports?: Map<string, object>, ai: Map<string, string>, nicks: Map<string, string>, period?: string, nowMs?: number, minSettled?: number }} a
 */
export function leaderboard({ picks, claims, events, reports = new Map(), ai, nicks, period = "week", nowMs = Date.now(), minSettled = 5 }) {
  const span = PERIODS[period] ?? PERIODS.week;
  const from = span === Infinity ? 0 : nowMs - span;
  const byId = new Map(claims.map((c) => [c.id, c]));
  const settledAt = new Map();
  for (const e of events) if (e.event === "settle" && Number.isInteger(e.data?.claim_id)) settledAt.set(e.data.claim_id, timeOf(e));
  const all = [...picks, ...aiPicks(events, ai)];
  const who = new Map();
  const entry = (key, isAi) => {
    if (!who.has(key)) who.set(key, { kind: isAi ? "ai" : "person", id: key, name: isAi ? ai.get(key) : displayName(key, nicks), scored: [], picks_total: 0, picks_today: 0, open_picks: 0, caught: 0, catch_points: 0 });
    return who.get(key);
  };
  for (const k of ai.keys()) entry(k, true);
  const today = isoDay(nowMs);
  for (const p of all) {
    const e = entry(p.key, Boolean(p.ai));
    e.picks_total++;
    if (isoDay(p.at) === today) e.picks_today++;
    const c = byId.get(p.claim_id);
    if (c?.status !== "Settled" || (c.outcome !== true && c.outcome !== false)) { if (c && c.status !== "Settled") e.open_picks++; continue; }
    const at = settledAt.get(p.claim_id) ?? 0;
    if (at < from && span !== Infinity) continue;
    const right = (p.side === "yes") === c.outcome;
    e.scored.push({ at, picked_at: p.at, right, points: right ? pointsFor(p.side, p.price_yes_ppm) : 0 });
  }
  for (const r of reports.values()) {
    if (r.status !== "upheld" || ((r.decided_at ?? 0) < from && span !== Infinity)) continue;
    const e = entry(r.key, false);
    e.caught++;
    e.catch_points += 100;
  }
  const rows = [...who.values()].map((e) => {
    const s = e.scored.sort((a, b) => a.at - b.at || a.picked_at - b.picked_at);
    let cur = 0, best = 0;
    for (const x of s) { cur = x.right ? cur + 1 : 0; best = Math.max(best, cur); }
    const right = s.filter((x) => x.right).length;
    return {
      kind: e.kind, id: e.id, name: e.name,
      accuracy: s.length ? Math.round((right / s.length) * 1000) / 1000 : null,
      settled: s.length, right, points: s.reduce((n, x) => n + x.points, 0) + e.catch_points,
      streak: { current: cur, best }, picks_today: e.picks_today, picks_total: e.picks_total, open_picks: e.open_picks, caught: e.caught,
      ranked: s.length >= minSettled,
    };
  });
  const order = (a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.settled - a.settled || b.points - a.points || String(a.id).localeCompare(String(b.id));
  const board = rows.filter((r) => r.ranked).sort(order).map((r, i) => ({ rank: i + 1, ...r }));
  const waiting = rows.filter((r) => !r.ranked && r.kind === "person" && (r.picks_total > 0 || r.caught > 0)).sort((a, b) => b.settled - a.settled || b.points - a.points).slice(0, 50).map((r) => ({ ...r, needs: minSettled - r.settled }));
  const aiRows = rows.filter((r) => r.kind === "ai").map((r) => ({ ...r, rank: board.find((b) => b.id === r.id)?.rank ?? null }));
  const bestAi = board.find((r) => r.kind === "ai") || null;
  const people = board.filter((r) => r.kind === "person");
  return {
    period: PERIODS[period] ? period : "week", window: { from: span === Infinity ? null : from, to: nowMs }, min_settled: minSettled,
    board, waiting, ai: aiRows,
    you_vs_ai: { best_ai: bestAi ? { id: bestAi.id, name: bestAi.name, accuracy: bestAi.accuracy, settled: bestAi.settled, rank: bestAi.rank } : null, people_ranked: people.length, people_ahead_of_best_ai: bestAi ? people.filter((p) => p.rank < bestAi.rank).length : people.length },
    totals: { people: rows.filter((r) => r.kind === "person").length, picks: all.filter((p) => !p.ai).length, ai_picks: all.filter((p) => p.ai).length, settled_picks: rows.reduce((n, r) => n + r.settled, 0), catches_upheld: rows.reduce((n, r) => n + r.caught, 0) },
    rules: RULES,
  };
}

/** One visitor's picks, each with where its line stands, and their all-time numbers. */
export function picksOf(key, { picks, claims, events, nicks, reports = new Map(), news = new Map(), nowMs = Date.now(), minSettled = 5 }) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const mine = picks.filter((p) => p.key === key).sort((a, b) => b.at - a.at);
  const settledAt = new Map(events.filter((e) => e.event === "settle").map((e) => [e.data?.claim_id, timeOf(e)]));
  const board = leaderboard({ picks: mine, claims, events: events.filter((e) => e.event === "settle"), reports: new Map([...reports].filter(([, r]) => r.key === key)), ai: new Map(), nicks, period: "all", nowMs, minSettled });
  const me = board.board[0] || board.waiting[0] || { accuracy: null, settled: 0, right: 0, points: 0, streak: { current: 0, best: 0 }, picks_today: 0, picks_total: 0, open_picks: 0, caught: 0, ranked: false };
  return {
    key, nickname: nicks.get(key) ?? null, name: displayName(key, nicks),
    stats: { accuracy: me.accuracy, settled: me.settled, right: me.right, points: me.points, streak: me.streak, picks_today: me.picks_today, picks_total: me.picks_total, open_picks: me.open_picks, caught: me.caught, ranked: me.ranked, min_settled: minSettled },
    picks: mine.slice(0, 200).map((p) => {
      const c = byId.get(p.claim_id);
      const state = !c ? "unknown" : c.status === "Settled" ? ((p.side === "yes") === c.outcome ? "right" : "wrong") : c.status === "Open" ? "open" : "ruling";
      return { claim_id: p.claim_id, side: p.side, at: p.at, price_yes_ppm: p.price_yes_ppm, question: news.get(p.claim_id)?.question ?? null, claim: c?.text ?? null, state, points: state === "right" ? pointsFor(p.side, p.price_yes_ppm) : 0, settled_at: settledAt.get(p.claim_id) ?? null, message: p.message, signature: p.signature };
    }),
    rules: RULES,
  };
}

/** The picks on one line: how many each way, and every signed pick to check. */
export function picksOnLine(claimId, picks, nicks) {
  const mine = picks.filter((p) => p.claim_id === claimId);
  return {
    claim_id: claimId, yes: mine.filter((p) => p.side === "yes").length, no: mine.filter((p) => p.side === "no").length, total: mine.length,
    picks: mine.sort((a, b) => b.at - a.at).slice(0, 200).map((p) => ({ key: p.key, name: displayName(p.key, nicks), side: p.side, at: p.at, price_yes_ppm: p.price_yes_ppm, message: p.message, signature: p.signature })),
    verify: "Each signature is ed25519 by `key` over the UTF-8 bytes of `message`.",
  };
}

/** Yes and No counts per line, for /api/today. */
export function pickCounts(picks) {
  const m = new Map();
  for (const p of picks) {
    const x = m.get(p.claim_id) || { yes: 0, no: 0, total: 0 };
    x[p.side]++;
    x.total++;
    m.set(p.claim_id, x);
  }
  return m;
}

// ---------- the money path ----------

/** What a wallet needs to challenge a line itself with its own bond, and what happens after. */
export function challengeCall(claim, { marketId, network, bondMicro, news = null }) {
  const open = claim.status === "Open";
  return {
    claim_id: claim.id, claim: claim.text, status: claim.status, open,
    why_not: open ? null : claim.status === "Settled" ? "This line is settled." : "A challenge is already running on this line.",
    call: { contract: marketId, method: "challenge", args: { claim_id: claim.id, claimed_outcome: false, evidence: "<your receipt: see evidence>" }, deposit: "0", gas_tgas: 30 },
    bond: { micro: String(bondMicro ?? "1000000"), usd: Number(bondMicro ?? 1_000_000) / 1e6, from: `Your balance in the market. Deposit ${network === "mainnet" ? "USDC" : "test USDC"} first: ft_transfer_call to ${marketId} with msg "". The free $1 can't be a bond: lane keys can't challenge.` },
    evidence: {
      max_bytes: 4000,
      format: 'Say what is wrong, then one or more receipts: "Source: <a public https:// page>" on one line and "Receipt excerpt: "<the exact words from that page>"" on the next.',
      checked: "Our jury runner fetches every source and finds every quoted passage before any model reads it, then three attested models check that the page supports your challenge. If it doesn't, our runner calls no model and the Sentinel disputes any ruling that sides with you.",
    },
    claimed_outcome: "false if the line is wrong; true if it is right and you want it settled TRUE.",
    after: "POST /api/after-challenge {txHash, signerId}: three AI judges rule within minutes. Two matching verdicts open a dispute window; then the keeper settles it.",
    outcomes: { right: "Your bond comes back, the line's bounty is yours if it has one, and anyone who bet your way is paid.", wrong: "Your bond goes to whoever was right (the treasury, if nobody disputed)." },
    bounty: { usd: Number(claim.bounty_micro || 0) / 1e6, pays: "the first challenger whose claimed outcome wins", fund: { contract: marketId, method: "fund_question", args: { claim_id: claim.id, amount_micro: "<at least 10000>" }, note: "From a funded NEAR account's market balance; lane keys can't fund. Returned after it expires unclaimed." } },
    ...(news ? { settles: news.settles } : {}),
  };
}

// ---------- rate limits ----------

/** Per key and per network (address), per UTC day, through the store. Releases what it took on refusal. */
export async function takeLimits(state, limits) {
  const taken = [];
  for (const [scope, key, limit, message] of limits) {
    const a = await state.take(scope, key, limit).catch(() => ({ ok: true }));
    if (!a.ok) {
      for (const [s, k] of taken) await state.release(s, k).catch(() => {});
      throw new Refusal(429, "rate_limited", message, { retryAfterS: a.retryAfterS });
    }
    taken.push([scope, key]);
  }
  return async () => { for (const [s, k] of taken) await state.release(s, k).catch(() => {}); };
}

export const limitsConfig = (env = process.env) => {
  const n = (k, d) => (Number.isInteger(Number(env[k])) && Number(env[k]) > 0 ? Number(env[k]) : d);
  return {
    picksPerKey: n("PICKS_PER_KEY_PER_DAY", 60), picksPerIp: n("PICKS_PER_IP_PER_DAY", 400),
    profilesPerKey: n("PROFILES_PER_KEY_PER_DAY", 5), profilesPerIp: n("PROFILES_PER_IP_PER_DAY", 60),
    reportsPerKey: n("REPORTS_PER_KEY_PER_DAY", 3), reportsPerIp: n("REPORTS_PER_IP_PER_DAY", 10),
    minSettled: n("LEADERBOARD_MIN_SETTLED", 5),
  };
};
