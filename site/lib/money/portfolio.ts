// The portfolio's view model, from /api/portfolio and this browser's ledger. Pure, so each rule here is
// tested: which positions go where, what a free bet scores, how the two histories join, and how a fresh
// trade shows before the indexer reaches it. The chain's own views stay the source of what is held.
import type { TxKind, TxRecord } from "./ledger";

export type PositionState = "open" | "ruling" | "won" | "lost" | "collected" | "closed";

export interface PositionRow {
  claim_id: number;
  side: "yes" | "no";
  shares: number;
  spent_usd: number;
  received_usd: number;
  value_usd: number | null;
  pnl_usd: number | null;
  state: PositionState;
  redeemable: boolean;
  redeem_usd: number;
}

export interface HistoryRow {
  kind: "deposit" | "withdraw" | "refund" | "buy" | "sell" | "collect" | "bridge_in" | "bridge_out";
  claim_id: number | null;
  side: string | null;
  amount_usd: number;
  tx: string | null;
  at: number;
}

export interface Portfolio {
  balance_usd: number | null;
  totals: { value_usd: number; spent_usd: number; received_usd: number; pnl_usd: number; redeemable_usd: number; positions: number };
  positions: PositionRow[];
  /** absent on an API deployed before it was added */
  history?: HistoryRow[];
}

export async function fetchPortfolio(trader: string): Promise<Portfolio> {
  const r = await fetch(`/api/portfolio?trader=${encodeURIComponent(trader)}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`The portfolio answered ${r.status}.`);
  return r.json();
}

export interface Grouped { collect: PositionRow[]; open: PositionRow[]; past: PositionRow[] }

/** What can be collected, what is still running, and what is over. */
export function groupPositions(rows: PositionRow[]): Grouped {
  return {
    collect: rows.filter((r) => r.redeemable),
    open: rows.filter((r) => r.state === "open" || r.state === "ruling"),
    past: rows.filter((r) => !r.redeemable && r.state !== "open" && r.state !== "ruling"),
  };
}

/** A free bet's score: what its decided bets won, in dollars of winnings that can never be withdrawn. */
export function scoreOf(rows: PositionRow[]): number {
  return rows.filter((r) => r.state === "won" || r.state === "collected").reduce((n, r) => n + (r.value_usd ?? 0) + r.received_usd, 0);
}

const LEDGER_KINDS: Partial<Record<TxKind, HistoryRow["kind"]>> = { deposit: "deposit", withdraw: "withdraw", buy: "buy", sell: "sell", collect: "collect", bridge_in: "bridge_in", bridge_out: "bridge_out" };

/** Server history and this browser's, one row per transaction; the server's row wins, as the chain's record. */
export function mergeHistory(server: HistoryRow[], local: TxRecord[]): HistoryRow[] {
  const seen = new Set(server.map((r) => `${r.tx}:${r.kind}`));
  const mine: HistoryRow[] = [];
  for (const t of local) {
    const kind = LEDGER_KINDS[t.kind];
    if (!kind || t.amountMicro === null || (t.hash && seen.has(`${t.hash}:${kind}`))) continue;
    mine.push({ kind, claim_id: t.claimId ?? null, side: t.side ?? null, amount_usd: Number(t.amountMicro) / 1e6, tx: t.hash, at: t.at });
  }
  return [...server, ...mine].sort((a, b) => b.at - a.at);
}

/** Claims this browser traded that the indexer's answer doesn't list yet. */
export function unindexedClaims(rows: PositionRow[], local: TxRecord[]): number[] {
  const known = new Set(rows.map((r) => r.claim_id));
  return [...new Set(local.filter((t) => t.kind === "buy" && t.claimId !== undefined && !known.has(t.claimId)).map((t) => t.claimId!))];
}

/** A position read straight from the chain, for a claim the indexer hasn't reached: priced at today's chance. */
export function chainRow(claimId: number, side: "yes" | "no", sharesMicro: bigint, priceYes: number | null, local: TxRecord[]): PositionRow {
  const shares = Number(sharesMicro) / 1e6;
  const spent = local.filter((t) => t.kind === "buy" && t.claimId === claimId && t.side === side).reduce((n, t) => n + Number(t.amountMicro ?? 0) / 1e6, 0);
  const value = priceYes === null ? null : shares * (side === "yes" ? priceYes : 1 - priceYes);
  return { claim_id: claimId, side, shares, spent_usd: spent, received_usd: 0, value_usd: value, pnl_usd: value === null ? null : value - spent, state: "open", redeemable: false, redeem_usd: 0 };
}
