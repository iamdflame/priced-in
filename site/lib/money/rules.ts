// Every go or no-go for real money, in one place. Each check returns null when the action may go ahead,
// or the sentence that says why not; the screens show that sentence and never decide for themselves.
// The chain enforces balances, shares and settlement anyway; these checks say so before the tap. The
// per-action caps exist only here: the contract has no per-person limit.
import { canAddMoney, canTakeOut, type Access } from "./geo";
import { fmtMicro } from "./units";

export type Refusal = string | null;
export type ClaimStatus = "Open" | "Challenged" | "Escalated" | "Settled";

/** The micro-stakes research preview's caps, per action, in dollars. /terms prints these. */
export const LIMITS = { maxBetUsd: 100, maxDepositUsd: 500 } as const;

const micro = (usd: number) => BigInt(usd) * 1_000_000n;
export const MAX_BET_MICRO = micro(LIMITS.maxBetUsd);
export const MAX_DEPOSIT_MICRO = micro(LIMITS.maxDepositUsd);

const REGION_IN = "Deposits and new bets aren’t available from your region.";
const REGION_OUT = "Real money isn’t available from your region.";

/** New bets only on an open market. A sale also runs during a ruling, as the contract allows: a holder can always leave. */
export const canBuy = (status: ClaimStatus) => status === "Open";
export const canSell = (status: ClaimStatus) => status !== "Settled";

export function checkDeposit(amount: bigint | null, walletUsdc: bigint | null, access: Access): Refusal {
  if (!canAddMoney(access)) return REGION_IN;
  if (amount === null) return "Enter an amount above zero.";
  if (amount > MAX_DEPOSIT_MICRO) return `The research preview takes up to $${LIMITS.maxDepositUsd} per deposit.`;
  if (walletUsdc !== null && amount > walletUsdc) return `Your wallet holds ${fmtMicro(walletUsdc)} USDC on NEAR.`;
  return null;
}

/** For a deposit from another chain, where the wallet's balance isn't what pays. */
export function checkBridgeIn(usdEstimate: number | null, access: Access): Refusal {
  if (!canAddMoney(access)) return REGION_IN;
  if (usdEstimate !== null && usdEstimate > LIMITS.maxDepositUsd) return `The research preview takes up to $${LIMITS.maxDepositUsd} per deposit.`;
  return null;
}

export function checkBet(amount: bigint | null, balance: bigint | null, status: ClaimStatus, access: Access): Refusal {
  if (!canAddMoney(access)) return REGION_IN;
  if (!canBuy(status)) return "This market isn’t open for new bets right now.";
  if (amount === null) return "Enter an amount above zero.";
  if (amount > MAX_BET_MICRO) return `The research preview takes up to $${LIMITS.maxBetUsd} per bet.`;
  if (balance !== null && amount > balance) return `Your balance is ${fmtMicro(balance)}. Deposit more, or bet less.`;
  return null;
}

export function checkSell(shares: bigint | null, held: bigint, status: ClaimStatus, access: Access): Refusal {
  if (!canTakeOut(access)) return REGION_OUT;
  if (!canSell(status)) return "This market has been decided, so it can’t be sold any more.";
  if (held <= 0n) return "You don’t hold any shares on this side.";
  if (shares === null) return "Enter how many shares to sell.";
  if (shares > held) return "You don’t hold that many shares.";
  return null;
}

export function checkCollect(status: ClaimStatus, access: Access): Refusal {
  if (!canTakeOut(access)) return REGION_OUT;
  if (status !== "Settled") return "This market isn’t decided yet, so there’s nothing to collect.";
  return null;
}

/** A challenge with the person's own bond: an open line, the evidence's two parts, and the bond in the balance. */
export function checkChallenge(bond: bigint, balance: bigint | null, status: ClaimStatus, access: Access, receipt: { url: string; quote: string }): Refusal {
  if (!canAddMoney(access)) return REGION_IN;
  if (status !== "Open") return status === "Settled" ? "This line is settled: it can’t be challenged now." : "A challenge is already running on this line.";
  if (!/^https:\/\/\S{4,}$/.test(receipt.url.trim())) return "Add a public https:// link to the page that shows it.";
  if (receipt.quote.trim().split(/\s+/).length < 3) return "Copy the exact words from that page: three words or more.";
  if (balance !== null && bond > balance) return `The bond is ${fmtMicro(bond)} and your balance is ${fmtMicro(balance)}. Deposit first.`;
  return null;
}

export function checkWithdraw(amount: bigint | null, available: bigint | null, access: Access): Refusal {
  if (!canTakeOut(access)) return REGION_OUT;
  if (amount === null) return "Enter an amount above zero.";
  if (available !== null && amount > available) return `You have ${fmtMicro(available)} to withdraw.`;
  return null;
}
