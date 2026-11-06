// The reads the proof pages need beyond getSite(): the activity log, every agent's reasons,
// portfolios, attestation proofs, the truth API's own answers, and the few things only the chain
// can say honestly (the market's `stats`, its code hash, its keys, a model's registered key, and a
// verdict transaction's own arguments). Every read returns a Res (never throws) with a short timeout
// and a cache window, so a slow source gives an honest error state instead of a blank page.
import "server-only";
import { cache } from "react";
import { API_ORIGIN, type Res } from "./api";
import { MARKET_ID } from "../nav";
import type { Rationale } from "../core/api";

async function get<T>(path: string, revalidate = 15, timeoutMs = 8000): Promise<Res<T>> {
  try {
    const r = await fetch(`${API_ORIGIN}${path}`, { headers: { accept: "application/json" }, next: { revalidate }, signal: AbortSignal.timeout(timeoutMs) });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, error: body?.error?.message ?? `The API answered ${r.status}.`, status: r.status };
    if (body === null) return { ok: false, error: "The API sent something we couldn't read.", status: r.status };
    return { ok: true, value: body as T };
  } catch (e) {
    const timeout = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    return { ok: false, error: timeout ? "Priced In took too long to answer." : "We couldn't reach Priced In.", status: 0 };
  }
}

/** Mainnet RPCs, tried in order. */
export const RPC_URLS = ["https://rpc.fastnear.com", "https://free.rpc.fastnear.com", "https://near.drpc.org"];

async function rpc<T>(method: string, params: unknown, revalidate = 60): Promise<Res<T>> {
  let last = "No NEAR RPC answered.";
  for (const url of RPC_URLS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), next: { revalidate }, signal: AbortSignal.timeout(6000) });
      const j = await r.json().catch(() => null);
      if (j?.result !== undefined && !j.result?.error) return { ok: true, value: j.result as T };
      last = j?.error?.cause?.name ?? j?.result?.error ?? j?.error?.message ?? `RPC answered ${r.status}`;
    } catch (e) { last = (e as Error).message; }
  }
  return { ok: false, error: last, status: 0 };
}

/** A view call on the market (or another contract), decoded from JSON. */
export async function view<T>(method: string, args: object = {}, account = MARKET_ID, revalidate = 30): Promise<Res<T>> {
  const r = await rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") }, revalidate);
  if (!r.ok) return r;
  try { return { ok: true, value: JSON.parse(Buffer.from(r.value.result).toString("utf8")) as T }; } catch { return { ok: false, error: "The view's answer was not JSON.", status: 0 }; }
}

export interface MarketStats {
  claims: number; challenges: number; treasury_micro: string; reserved_micro: string; lane_budget_micro: string; lane_credit_micro: string;
  paused: boolean; held_micro: string; balances_micro: string; collected_micro: string; payouts_micro: string; bonds_micro: string;
  bounties_micro: string; rewrites_anchored: number; fee_bps: number; fees_micro: string;
}

export interface ActivityItem {
  kind: string; at: number; claim_id: number; claim?: string; who?: string; model?: string; action?: string; text?: string;
  rationale?: string | null; reason?: string | null; credence?: number; source_url?: string | null; trigger?: string; tx?: string | null;
  side?: string; amount_usd?: number; price_before?: number; price_after?: number;
}

export interface AgentFull {
  account_id: string; name: string; label: string; house: boolean; model: string; persona: string; awake: boolean;
  limits: { max_bet_usd: number; daily_loss_limit_usd: number; kelly_fraction: number };
  last_action: { at: string; kind: string; claim_id: number; text?: string; reason?: string; tx_hash?: string | null; credence: number } | null;
}

export interface AgentsDoc {
  agents: AgentFull[];
  swarm: string | null;
  state: { status: string; reason: string | null; stats?: Record<string, number>; inference?: Record<string, { calls: number; cost_usd: number; prompt_tokens: number; completion_tokens: number }> };
  asOf: string;
}

export interface Portfolio {
  trader: string; balance_usd: number | null;
  totals: { value_usd: number; spent_usd: number; received_usd: number; pnl_usd: number; redeemable_usd: number; positions: number };
  positions: { claim_id: number; text: string; side: string; shares: number; avg_price: number; spent_usd: number; received_usd: number; value_usd: number; pnl_usd: number; status: string; outcome: boolean | null; state: string; trades: number }[];
}

export interface Proof {
  model: string; bundle: string; bundle_sha256: string; fetched_at: string; nonce: string; signing_address: string; signing_algo: string; verified: boolean;
  failures: string[];
  tdx: { verified: boolean; tcb_status: string; advisory_ids: string[]; verifier: string; error: string | null };
  binding: Record<string, boolean>;
  registered: { network: string; market: string; get_model: { signing_address_hex: string; block_height: number; rpc: string }; match: boolean; read_at: string; error: string | null };
  gpu?: { verified?: boolean; overall?: boolean; arch?: string; gpus?: number; [k: string]: unknown } | null;
}

/** The truth API's terms: GET /v1. `payments` is null while x402 is off. */
export interface TruthTerms { name: string; network: string; contract: string; credence: { path: string; free_per_ip_per_day: number; payments: unknown | null }; quote: string; mcp: string }

export interface CredenceClaim {
  claim_id: number; text: string; page: string; credence: number; summary: string; trades: number; volume_usd: number; open_interest_usd: number;
  match?: { kind: string; score: number };
  resolution: { state: string; status: string; outcome: string | null };
}

export interface Credence { query?: string; matched: number; answer: string; claims: CredenceClaim[]; free?: { limit: number; remaining: number } }

export interface TruthQuote { text: string; quote: { claim_id: number; side: string; amount_usd: number; shares: number; avg_price: number; payout_if_right_usd: number; price_yes_before: number; price_yes_after: number; /** absent from an API that predates the fee fix: its payout then ignores the fee */ fee_bps?: number } }

export const proof = {
  activity: (limit = 200) => get<{ activity: ActivityItem[]; asOf: number }>(`/api/activity?limit=${limit}`, 15),
  rationales: (q = "") => get<{ rationales: (Rationale & { policy?: { reason?: string; edge?: number }; source_checked?: { status: number } })[] }>(`/api/rationales${q}`, 30),
  agents: () => get<AgentsDoc>("/api/agents", 60),
  portfolio: (trader: string) => get<Portfolio>(`/api/portfolio?trader=${encodeURIComponent(trader)}`, 60),
  attestations: () => get<{ proofs: Proof[]; files: string[]; check?: string }>("/api/attestations", 600),
  truthTerms: () => get<TruthTerms>("/api/v1", 300),
  // metered at 20 a day for this server's address, so a sample is read a few times a day at most
  credence: (query: string) => get<Credence>(`/api/v1/credence?${query}`, 21600),
  quote: (claim: number, side: "yes" | "no", usd: number) => get<TruthQuote>(`/api/v1/quote?claim=${claim}&side=${side}&amount_usd=${usd}`, 60),
  stats: () => view<MarketStats>("stats", {}, MARKET_ID, 30),
  account: (account: string) => rpc<{ code_hash: string; amount: string; storage_usage: number; block_height: number }>("query", { request_type: "view_account", finality: "final", account_id: account }, 300),
  keys: (account: string) => rpc<{ keys: { public_key: string; access_key: { nonce: number; permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } } } }[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: account }, 300),
};

export interface VerdictTx { model: string; challengeId: number; responseB64: string; signatureHex: string; text: string | null; signer: string }

/** A verdict's own transaction: the model's signed response, word for word, and its signature. */
export const verdictTx = cache(async (tx: string, sender = "isitpriced.near"): Promise<Res<VerdictTx>> => {
  const r = await rpc<any>("tx", { tx_hash: tx, sender_account_id: sender, wait_until: "NONE" }, 86400);
  if (!r.ok) return r;
  try {
    const fc = r.value.transaction.actions.find((a: any) => a.FunctionCall)?.FunctionCall;
    const args = JSON.parse(Buffer.from(fc.args, "base64").toString("utf8"));
    const resp = JSON.parse(Buffer.from(args.response, "base64").toString("utf8"));
    const text = String(resp?.choices?.[0]?.message?.content ?? "").trim() || null;
    return { ok: true, value: { model: args.model, challengeId: args.challenge_id, responseB64: args.response, signatureHex: args.signature_hex, text, signer: r.value.transaction.signer_id } };
  } catch {
    return { ok: false, error: "That transaction isn't a verdict we can read.", status: 0 };
  }
});

/** "VERDICT: FALSE\nThe claim's…" to the reasoning line alone. */
export const judgeWords = (t: string | null) => (t ? t.replace(/^VERDICT:\s*(TRUE|FALSE|UNSURE|[A-Z]+)\s*/i, "").trim() : null);
