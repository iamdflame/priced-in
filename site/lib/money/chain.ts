// The chain, for a wallet: read-only views (straight from NEAR RPC with failover, so the money screens
// never wait on the indexer), and the one reading of what a transaction outcome means.
import { eventsInOutcome, NearRpc, type TxOutcome } from "../core/rpc";
import { moneyConfig, type MoneyConfig } from "./config";
import type { ClaimStatus } from "./rules";

export interface Position { yes_micro: string; no_micro: string }

export interface ClaimView {
  id: number;
  text: string;
  price_yes_ppm: number;
  status: ClaimStatus;
  outcome: boolean | null;
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
  private view<T>(contract: string, method: string, args: object) { return this.rpc.view<T>(contract, method, args, "optimistic"); }

  async balance(account: string): Promise<bigint> { return BigInt(await this.view<string>(this.c.market, "get_balance", { trader: account })); }
  position(claimId: number, account: string) { return this.view<Position>(this.c.market, "get_position", { claim_id: claimId, trader: account }); }
  claim(claimId: number) { return this.view<ClaimView | null>(this.c.market, "get_claim", { claim_id: claimId }); }
  async usdcBalance(account: string): Promise<bigint> { return BigInt(await this.view<string>(this.c.usdc, "ft_balance_of", { account_id: account })); }
  async canReceiveUsdc(account: string): Promise<boolean> { return (await this.view<unknown>(this.c.usdc, "storage_balance_of", { account_id: account })) !== null; }
}

let shared: Chain | null = null;
export const moneyChain = () => (shared ??= new Chain(moneyConfig()));

// ---------- what a transaction outcome means ----------

/**
 * ok: it landed, with every receipt clean. Not ok with `unknown`: nobody can say, so the screen must
 * send the person to their balance and never suggest trying again blind, which could pay twice.
 */
export interface TxResult { ok: boolean; hash: string | null; value: unknown; error: string | null; unknown: boolean }

export const UNKNOWN_TX = "Your wallet didn’t say whether this went through. Check your balance before you try again.";
const REFUNDED = "The USDC couldn’t reach your wallet, so it went back to your Priced In balance. Nothing was lost.";

export const unknownResult = (hash: string | null = null): TxResult => ({ ok: false, hash, value: null, error: UNKNOWN_TX, unknown: true });

/** A contract's panic, in words a person reads. */
export function plainPanic(msg: string): string {
  const s = msg.toLowerCase();
  if (s.includes("slippage")) return "The price moved before your transaction landed, past your limit, so nothing was traded. Check the new price and try again.";
  if (s.includes("not enough balance")) return "Your Priced In balance is too low for that. Deposit first, or try a smaller amount.";
  if (s.includes("paused")) return "The market is paused right now, so nothing can move. Your money is safe; try again later.";
  if (s.includes("not settled")) return "This market isn’t decided yet, so there’s nothing to collect.";
  if (s.includes("is settled")) return "This market has been decided, so it can’t be traded any more.";
  if (s.includes("nothing to redeem")) return "There’s nothing to collect here: these shares didn’t win, or they were collected already.";
  if (s.includes("payout pot exhausted")) return "This market’s payout pot can’t cover that right now. Nothing moved; contact us with the transaction.";
  if (s.includes("not enough shares")) return "You don’t hold that many shares.";
  if (s.includes("price is at its cap")) return "The price is at its limit on this side, so there’s nothing left to buy.";
  if (s.includes("amount too small")) return "That amount is too small to buy a share.";
  if (s.includes("notenoughbalance")) return "Your wallet doesn’t hold enough NEAR for that.";
  return msg.endsWith(".") ? msg : `${msg}.`;
}

const failureIn = (status: unknown) => (status && typeof status === "object" && "Failure" in status ? (status as { Failure: unknown }).Failure : null);

/**
 * Every receipt counts, not only the transaction's last status. A deposit the market refuses still ends
 * in a SuccessValue of "0" from the token, and a withdrawal whose transfer fails ends in a clean callback.
 */
function failureOf(o: TxOutcome): unknown {
  return failureIn(o.status) ?? (o.receipts_outcome ?? []).map((r) => failureIn(r.outcome?.status)).find(Boolean) ?? null;
}

function decodeValue(b64: string): unknown {
  try { return JSON.parse(atob(b64)); } catch { return null; }
}

export function resultOf(o: TxOutcome | null | undefined, market: string): TxResult {
  if (!o) return unknownResult();
  const hash = o.transaction?.hash ?? o.transaction_outcome?.id ?? null;
  if (eventsInOutcome(o, market).some((e) => e.event === "withdraw_refunded")) return { ok: false, hash, value: null, error: REFUNDED, unknown: false };
  const failure = failureOf(o);
  if (failure) {
    const text = JSON.stringify(failure);
    const panic = text.match(/Smart contract panicked: ([^"\\]+)/) ?? text.match(/"ExecutionError":"([^"]+)"/);
    return { ok: false, hash, value: null, error: plainPanic(panic ? panic[1] : "The transaction failed on NEAR"), unknown: false };
  }
  const status = o.status;
  if (typeof status !== "object" || status === null || !("SuccessValue" in status)) return unknownResult(hash);
  return { ok: true, hash, value: status.SuccessValue ? decodeValue(status.SuccessValue) : null, error: null, unknown: false };
}
