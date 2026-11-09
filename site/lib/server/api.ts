// Server-side reads of the live API, for server components. Each call resolves to a Result (never
// throws), with a short timeout and a small cache window, so a slow API gives an honest error state
// instead of a blank page. The browser never calls API_ORIGIN directly: it goes through next.config's
// rewrites on this site's own origin.
import "server-only";
import { resolveRulingNow } from "../rulings";
import type { MarketEvent, Rationale, Rewrite } from "../core/api";
import type { ClaimView } from "../model";

export const API_ORIGIN = (process.env.API_ORIGIN || "https://isitpriced.com").replace(/\/+$/, "");

export type Res<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

export async function get<T>(path: string, revalidate = 10, timeoutMs = 8000): Promise<Res<T>> {
  try {
    const r = await fetch(`${API_ORIGIN}/api${path}`, { headers: { accept: "application/json" }, next: { revalidate }, signal: AbortSignal.timeout(timeoutMs) });
    const body = await r.json().catch(() => null);
    // a server failure's own words are for the logs, never for visitors (8 Nov: a broken config put account names
    // and RPC URLs on the home page); a 4xx is written for people (no such fact, too many requests) and shows as sent
    if (r.status >= 500) { console.error(`API ${path} answered ${r.status}: ${body?.error?.message ?? ""}`); return { ok: false, error: "The market didn’t answer just now.", status: r.status }; }
    if (!r.ok) return { ok: false, error: body?.error?.message ?? `The API answered ${r.status}.`, status: r.status };
    if (body === null) return { ok: false, error: "The API sent something we couldn't read.", status: r.status };
    return { ok: true, value: body as T };
  } catch (e) {
    const timeout = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    return { ok: false, error: timeout ? "Priced In took too long to answer." : "We couldn't reach Priced In.", status: 0 };
  }
}

export interface Verdict {
  model: string;
  verdict: string;
  at: number;
  tx: string;
  signature: string;
  request_hash?: string;
  response_hash?: string;
  runner?: { signing_address?: string; signature_kind?: string; attestation?: { ok: boolean; bundle?: string } };
}

/** won: the bond came back with a share of the losing side's; lost: it paid the winners; forfeit: no bond was on the winning side, so all went to the treasury; returned: given back (void or expired). */
export type BondResult = "won" | "lost" | "forfeit" | "returned" | null;

/** An objection: a bond of twice the last one that flipped the proposed outcome and, before the third, restarted the window. */
export interface Dispute {
  who: string;
  trader: string;
  bond_usd: number;
  /** 1, 2 or 3; the third sends it to the council */
  round: number;
  /** the outcome it proposed: the ruling after it */
  proposed: "TRUE" | "FALSE" | string | null;
  at: number | null;
  tx: string | null;
  /** when the window it opened was due to close; null for the third, which opens none */
  window_ends_at?: number | null;
  evidence?: string | null;
  result?: BondResult;
  paid_usd?: number | null;
}

export interface Ruling {
  challenge_id: number;
  claim_id: number;
  claim: string;
  page: string;
  challenger: string;
  challenger_name: string;
  claimed: "TRUE" | "FALSE" | string;
  bond_usd: number;
  opened_at: number;
  open_tx: string;
  jury_deadline_at: number;
  evidence: string;
  verdicts: Verdict[];
  provisional: string | null;
  provisional_at: number | null;
  window_ends_at: number | null;
  disputes: Dispute[];
  escalated: boolean;
  /** what an objection posts now (twice the current bond); null when none can be filed */
  dispute_bond_usd?: number | null;
  /** what became of the challenger's bond: null while it runs */
  challenger_result?: BondResult;
  challenger_paid_usd?: number | null;
  status: "jury" | "window" | "settled" | "expired" | string;
  outcome: string | null;
  settled_at: number | null;
  settle_tx: string | null;
  payout_usd: number | null;
  bonds?: { who: string; trader: string; paid_usd: number; tx: string }[];
  correction: { claim_id: number; text: string; open_tx: string; rewrite_id?: string; at: number } | null;
  /** what the evidence's receipts were, checked where they live (docs/API.md); null before anything checked them */
  receipt_check?: ReceiptCheck | null;
  /** the Sentinel's watch on this ruling, null before it looked */
  sentinel?: SentinelWatch | null;
}

export type ReceiptResult = "verified" | "quote_not_found" | "unfetchable" | "record_mismatch" | "no_receipt" | "unsupported";

export interface ReceiptCheck {
  result: ReceiptResult | string;
  reason: string;
  checked_at: string;
  via: "corpus" | "source" | null;
  record: { id: string; found: boolean; hash_matches: boolean; sentence_matches: boolean } | null;
  quotes: { text: string; found: boolean; url: string | null }[];
  sources: { url: string; via: string; status: number | null; sha256: string | null; bytes: number | null; fetched_at: string | null; error: string | null }[];
  support: { verdict: string; unanimous: boolean; answers?: { model: string; answer: string; verified: boolean }[] } | null;
}

export interface SentinelWatch {
  status: "watching" | "disputed" | "no_dispute" | "blocked" | string;
  note: string;
  last_look_at: string | null;
  disputes: { round: number; bond_usd: number; tx: string; at: string }[];
}

export interface Rulings {
  ruling_now: Ruling | null;
  next_challenge_at: number | null;
  next_ruling_at: number | null;
  next_ruling_note?: string;
  /** when the AI judges take each queued fact, soonest first (absent from an older API) */
  schedule?: Scheduled[];
  /** the hour (UTC) the Checker's daily turn starts, and how many doubted facts a day */
  sitting_hour_utc?: number;
  per_day?: number;
  checker?: { account: string; balance_usd: number; lines_left: number; note?: string };
  rulings: Ruling[];
  asOf: number;
}

/** One fact queued for the AI judges: a doubted Wikipedia line at its sitting, or a news line when it comes due. */
export interface Scheduled { claim_id: number; at: number; kind: "wikipedia" | "news" | string }

/** /rulings as it arrives: `ruling_now` is a summary until resolveRulingNow swaps in the full record. */
export type RulingsWire = Omit<Rulings, "ruling_now"> & { ruling_now: { challenge_id: number } | null };

export interface Agent { account_id: string; name: string; persona: string; model: string; house: boolean }

export interface Health {
  ok: boolean;
  network: string;
  marketId: string | null;
  checks?: { lane?: { configured: boolean; open: boolean; creditsLeft: number; paused: boolean }; spend?: { open: boolean } };
}

export const api = {
  claims: async () => {
    const r = await get<{ claims: ClaimView[]; asOf: number }>("/claims", 10);
    return r.ok ? { ok: true as const, value: r.value.claims } : r;
  },
  claim: async (id: number) => {
    const r = await get<{ claim: ClaimView }>(`/claims/${id}`, 5);
    return r.ok ? { ok: true as const, value: r.value.claim } : r;
  },
  historyAll: async () => {
    const r = await get<{ claims: Record<string, [number, number][]> }>("/history?all=1", 30);
    return r.ok ? { ok: true as const, value: r.value.claims } : r;
  },
  history: async (id: number) => {
    const r = await get<{ points: [number, number][] }>(`/history?claim=${id}`, 10);
    return r.ok ? { ok: true as const, value: r.value.points } : r;
  },
  rulings: async () => {
    const r = await get<RulingsWire>("/rulings", 15);
    return r.ok ? { ok: true as const, value: resolveRulingNow(r.value) } : r;
  },
  events: async () => {
    const r = await get<{ events: MarketEvent[]; lastSeq: number }>("/events/recent?since=0", 10);
    return r.ok ? { ok: true as const, value: r.value.events } : r;
  },
  agents: async () => {
    const r = await get<{ agents: Agent[] }>("/agents", 300);
    return r.ok ? { ok: true as const, value: r.value.agents } : r;
  },
  rationales: async (claim: number) => {
    const r = await get<{ rationales: Rationale[] }>(`/rationales?claim=${claim}`, 15);
    return r.ok ? { ok: true as const, value: r.value.rationales } : r;
  },
  rewrites: async (page: string) => {
    const r = await get<{ rewrites: Rewrite[] }>(`/rewrites?page=${encodeURIComponent(page)}`, 30);
    return r.ok ? { ok: true as const, value: r.value.rewrites } : r;
  },
  health: () => get<Health>("/health", 15),
};

/** Agent personas by account ("h-quant.isitpriced.near" to "Quant"). */
export const agentNames = (agents: Agent[]): Record<string, string> => Object.fromEntries(agents.map((a) => [a.account_id, a.persona || a.name]));
