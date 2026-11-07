// Free picks, nicknames and readers' reports, signed by the key this browser already keeps for the free
// $1 (lib/core/lane.ts stores it as "ed25519:<base58 of seed and public key>"). Signing needs only
// @noble's ed25519, so a pick never loads near-api-js, and making a key costs nothing: the lane's gas is
// spent only when the free $1 asks for it (POST /lane/key), never here.
//
// The messages are the API's, byte for byte (docs/API.md, "Signing"; api/_lib/picks.mjs):
//   pricedin|pick|v1|<network>|<claim_id>|<yes|no>|<issued_at>
//   pricedin|profile|v1|<network>|<nickname>|<issued_at>
//   pricedin|report|v1|<network>|<claim_id>|<false|true>|<sha256 hex of JSON [url, quote, note]>|<issued_at>
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Board, ChallengeInfo, MyRecord, Period, Report, Side } from "../news";

export const NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK || "mainnet";
/** The lane's own slot: one key per browser for the free $1, the picks and the board. */
export const KEY_NAME = `pricedin.lane.${NETWORK}.v1`;
/** This browser's picks, so a card shows yours at once, and when results were last shown. */
export const PICKS_NAME = "pricedin.picks.v1";

// ---------- base58 (the Bitcoin alphabet, as near-api-js uses) ----------

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] * 256; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = "";
  for (const byte of bytes) { if (byte !== 0) break; out += "1"; }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

export function b58decode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("not base58");
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== "1") break; bytes.push(0); }
  return new Uint8Array(bytes.reverse());
}

// ---------- the key ----------

export interface BrowserKey { publicKey: string; sign(message: string): string }

/** Where the key lives: localStorage when the browser allows it, else memory for this visit (as the lane does). */
let memory: string | null = null;
function storage(): Storage | null {
  try { const s = globalThis.localStorage; s?.getItem(KEY_NAME); return s ?? null; } catch { return null; }
}
const readSecret = (): string | null => { const s = storage(); return s ? s.getItem(KEY_NAME) : memory; };
function writeSecret(v: string) {
  const s = storage();
  if (s) { try { s.setItem(KEY_NAME, v); return; } catch { /* full: keep it for this visit */ } }
  memory = v;
}

function keyFrom(secret: string): BrowserKey | null {
  try {
    const raw = b58decode(secret.replace(/^ed25519:/, ""));
    if (raw.length !== 64 && raw.length !== 32) return null;
    const seed = raw.slice(0, 32);
    const pub = ed25519.getPublicKey(seed);
    return {
      publicKey: `ed25519:${b58encode(pub)}`,
      sign: (message: string) => bytesToHex(ed25519.sign(new TextEncoder().encode(message), seed)),
    };
  } catch { return null; }
}

/** The key, if this browser has one. Reading a page must never make one. */
export function existingKey(): BrowserKey | null {
  const s = readSecret();
  return s ? keyFrom(s) : null;
}

/** The key, made now if this browser has none: only on a person's own tap. */
export function browserKey(): BrowserKey {
  const had = existingKey();
  if (had) return had;
  const seed = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(seed);
  const extended = new Uint8Array(64);
  extended.set(seed, 0);
  extended.set(pub, 32);
  writeSecret(`ed25519:${b58encode(extended)}`);
  return keyFrom(readSecret()!)!;
}

// ---------- messages ----------

export const pickMessage = (claimId: number, side: Side, issuedAt: number) => `pricedin|pick|v1|${NETWORK}|${claimId}|${side}|${issuedAt}`;
/** A nickname as the API checks it: NFKC, each run of spaces made one, trimmed. */
export const cleanNick = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
export const profileMessage = (nickname: string, issuedAt: number) => `pricedin|profile|v1|${NETWORK}|${nickname}|${issuedAt}`;
/** The report's words as the API reads them: url trimmed, quote and note with each run of whitespace made one. */
export const cleanReport = (r: { url: string; quote: string; note: string }) => ({ url: r.url.trim(), quote: r.quote.replace(/\s+/g, " ").trim(), note: r.note.replace(/\s+/g, " ").trim() });
export const reportDigest = (r: { url: string; quote: string; note: string }) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([r.url, r.quote, r.note]))));
export const reportMessage = (claimId: number, says: "false" | "true", digest: string, issuedAt: number) => `pricedin|report|v1|${NETWORK}|${claimId}|${says}|${digest}|${issuedAt}`;

// ---------- the calls ----------

export type Refused = { ok: false; code: string; message: string; status: number; pick?: { claim_id: number; side: Side; at: number } };

async function call<T>(path: string, init?: RequestInit): Promise<({ ok: true } & T) | Refused> {
  try {
    const r = await fetch(path, { ...init, headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) } });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, code: body?.error?.code ?? "error", message: body?.error?.message ?? "That didn’t work just now. Try again in a moment.", status: r.status, pick: body?.error?.pick };
    return { ok: true, ...(body as T) };
  } catch {
    return { ok: false, code: "offline", message: "We couldn’t reach Priced In. Check your connection and try again.", status: 0 };
  }
}

/** A free pick, signed. A second pick on the same side answers duplicate; the other side is refused with the first. */
export async function sendPick(claimId: number, side: Side) {
  const k = browserKey();
  const issued_at = Date.now();
  const r = await call<{ pick: { claim_id: number; side: Side; at: number; price_yes_ppm: number }; duplicate?: boolean }>("/api/picks", {
    method: "POST",
    body: JSON.stringify({ public_key: k.publicKey, claim_id: claimId, side, issued_at, signature: k.sign(pickMessage(claimId, side, issued_at)) }),
  });
  if (r.ok) remember(claimId, r.pick.side, r.pick.at);
  else if (r.code === "already_picked" && r.pick) remember(claimId, r.pick.side, r.pick.at);
  return r;
}

/** This browser's picks and numbers. Null when it has no key: nothing is made to ask. */
export async function myRecord() {
  const k = existingKey();
  if (!k) return null;
  return call<MyRecord>(`/api/picks?key=${encodeURIComponent(k.publicKey)}`);
}

export async function saveNickname(raw: string) {
  const k = browserKey();
  const nickname = cleanNick(raw);
  const issued_at = Date.now();
  return call<{ key: string; nickname: string }>("/api/profile", {
    method: "POST",
    body: JSON.stringify({ public_key: k.publicKey, nickname, issued_at, signature: k.sign(profileMessage(nickname, issued_at)) }),
  });
}

export async function sendReport(claimId: number, says: "false" | "true", words: { url: string; quote: string; note: string }) {
  const k = browserKey();
  const r = cleanReport(words);
  const issued_at = Date.now();
  return call<{ report: Report; next: string }>("/api/reports", {
    method: "POST",
    body: JSON.stringify({ public_key: k.publicKey, claim_id: claimId, says, ...r, issued_at, signature: k.sign(reportMessage(claimId, says, reportDigest(r), issued_at)) }),
  });
}

export const reportById = (id: string) => call<{ reports: Report[]; count: number }>(`/api/reports?id=${encodeURIComponent(id)}`);
export async function myReports() {
  const k = existingKey();
  return k ? call<{ reports: Report[]; count: number }>(`/api/reports?key=${encodeURIComponent(k.publicKey)}`) : null;
}
export const boardFor = (period: Period) => call<Board>(`/api/leaderboard?period=${period}`);
export const challengeInfo = (claimId: number) => call<ChallengeInfo>(`/api/challenge?claim=${claimId}`);

// ---------- what this browser picked, kept here so a card can say so at once ----------

export interface LocalPicks { picks: Record<string, { side: Side; at: number }>; seen: number }

const EMPTY: LocalPicks = { picks: {}, seen: 0 };
let cached: { raw: string | null; value: LocalPicks } | null = null;
const listeners = new Set<() => void>();

export function localPicks(): LocalPicks {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PICKS_NAME); } catch { /* storage blocked */ }
  if (cached && cached.raw === raw) return cached.value;
  let value = EMPTY;
  try { if (raw) { const j = JSON.parse(raw); value = { picks: j.picks ?? {}, seen: Number(j.seen) || 0 }; } } catch { value = EMPTY; }
  cached = { raw, value };
  return value;
}

function store(v: LocalPicks) {
  try { localStorage.setItem(PICKS_NAME, JSON.stringify(v)); } catch { cached = { raw: null, value: v }; }
  document.documentElement.dataset.picker = "1";
  for (const f of listeners) f();
}

export function remember(claimId: number, side: Side, at: number) {
  const cur = localPicks();
  if (cur.picks[claimId]?.side === side) return;
  store({ ...cur, picks: { ...cur.picks, [claimId]: { side, at } } });
}

/** Results up to now have been shown: the next visit's "since your last visit" starts here. */
export function markSeen(at: number) {
  const cur = localPicks();
  if (at > cur.seen) store({ ...cur, seen: at });
}

export function subscribePicks(f: () => void) {
  listeners.add(f);
  const onStorage = (e: StorageEvent) => { if (e.key === PICKS_NAME) f(); };
  addEventListener("storage", onStorage);
  return () => { listeners.delete(f); removeEventListener("storage", onStorage); };
}

/** Before paint (app/layout.tsx): a browser that has picked gets its results first. */
export const PICKER_SCRIPT = `if(localStorage.getItem('${PICKS_NAME}'))document.documentElement.dataset.picker='1';`;

// ---------- the switch the server sets: picks exist only while the API has news on ----------

let on = false;
export const setPicksOn = (v: boolean) => { on = v; };
export const picksOn = () => on;
