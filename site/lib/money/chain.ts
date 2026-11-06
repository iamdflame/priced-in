// Read-only chain views for a wallet: the market balance, positions, the exact claim view for quotes,
// the wallet's own USDC and whether an account can receive USDC. Straight from NEAR RPC (raced with
// failover by the proven core's NearRpc), so the money screens never depend on the indexer being current.
import { NearRpc, type TxOutcome } from "../core/rpc";
import type { MoneyConfig } from "./config";

export interface Position { yes_micro: string; no_micro: string }

export interface ClaimView {
  id: number;
  text: string;
  price_yes_ppm: number;
  status: "Open" | "Challenged" | "Escalated" | "Settled";
  outcome: boolean | null;
  payout_left_micro: string;
  b_micro?: string;
  d0?: string;
  q_yes_micro?: string;
  q_no_micro?: string;
  fee_bps?: number;
}

export class Chain {
  readonly rpc: NearRpc;
  constructor(readonly c: MoneyConfig, rpc?: NearRpc) {
    this.rpc = rpc ?? new NearRpc(c.rpcUrls, { timeoutMs: 6000 });
  }
  view<T>(contract: string, method: string, args: object) { return this.rpc.view<T>(contract, method, args, "optimistic"); }

  async balance(account: string): Promise<bigint> { return BigInt(await this.view<string>(this.c.market, "get_balance", { trader: account })); }
  position(claimId: number, account: string) { return this.view<Position>(this.c.market, "get_position", { claim_id: claimId, trader: account }); }
  claim(claimId: number) { return this.view<ClaimView | null>(this.c.market, "get_claim", { claim_id: claimId }); }
  async usdcBalance(account: string): Promise<bigint> { return BigInt(await this.view<string>(this.c.usdc, "ft_balance_of", { account_id: account })); }
  async canReceiveUsdc(account: string): Promise<boolean> { return (await this.view<unknown>(this.c.usdc, "storage_balance_of", { account_id: account })) !== null; }
  async paused(): Promise<boolean> { return Boolean((await this.view<{ paused: boolean }>(this.c.market, "stats", {})).paused); }
}

/** A transaction's result in plain terms: did it work, its hash, the value it returned, and why not. */
export interface TxResult { ok: boolean; hash: string | null; value: any; error: string | null }

const decode = (b64: string) => {
  try { return JSON.parse(atob(b64)); } catch { return null; }
};

/** Why a NEAR outcome failed, in words a person reads (the contract's own panic messages are plain). */
export function failureOf(o: TxOutcome | null | undefined): string | null {
  if (!o) return "No result came back from the wallet.";
  const failed = (s: any) => s && typeof s === "object" && "Failure" in s;
  const fail = failed(o.status) ? (o.status as any).Failure : (o.receipts_outcome || []).map((r) => r.outcome?.status).find(failed)?.Failure;
  if (!fail) return null;
  const text = JSON.stringify(fail);
  const m = text.match(/Smart contract panicked: ([^"\\]+)/) || text.match(/"ExecutionError":"([^"]+)"/);
  return plainPanic(m ? m[1] : "The transaction failed on NEAR.");
}

export function plainPanic(msg: string): string {
  const s = msg.toLowerCase();
  if (s.includes("slippage")) return "The price moved before your transaction landed, past your slippage limit, so nothing was traded. Look at the new price and try again.";
  if (s.includes("not enough balance")) return "Your Priced In balance is too low for that. Deposit first, or try a smaller amount.";
  if (s.includes("paused")) return "The market is paused right now, so nothing can move. Your money is safe; try again later.";
  if (s.includes("settled")) return "This market has been decided, so it can’t be traded any more.";
  if (s.includes("nothing to redeem")) return "There’s nothing to collect here: these shares didn’t win, or they were collected already.";
  if (s.includes("not settled")) return "This market isn’t decided yet, so there’s nothing to collect.";
  if (s.includes("not enough shares")) return "You don’t hold that many shares.";
  if (s.includes("price is at its cap")) return "The price is at its limit on this side, so there’s nothing left to buy.";
  if (s.includes("amount too small")) return "That amount is too small to buy a share.";
  if (s.includes("the account doesn't have enough balance") || s.includes("notenoughbalance")) return "Your wallet doesn’t hold enough for that.";
  return msg.endsWith(".") ? msg : `${msg}.`;
}

export function resultOf(o: TxOutcome | null | undefined): TxResult {
  const hash = o?.transaction?.hash ?? o?.transaction_outcome?.id ?? null;
  const error = failureOf(o);
  const sv = o && typeof o.status === "object" && "SuccessValue" in o.status ? (o.status as any).SuccessValue : null;
  return { ok: !error, hash, value: sv ? decode(sv) : null, error };
}

/** The pricedin events a transaction emitted (trade, deposit, withdraw, redeem): what really happened. */
export function eventsOf(o: TxOutcome | null | undefined, market: string): { event: string; data: any }[] {
  const out: { event: string; data: any }[] = [];
  for (const r of o?.receipts_outcome || []) {
    if (r.outcome?.executor_id !== market) continue;
    for (const log of r.outcome.logs || []) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const j = JSON.parse(log.slice(11));
        if (j?.standard !== "pricedin") continue;
        for (const d of Array.isArray(j.data) ? j.data : [j.data]) out.push({ event: j.event, data: d });
      } catch { /* not ours */ }
    }
  }
  return out;
}
