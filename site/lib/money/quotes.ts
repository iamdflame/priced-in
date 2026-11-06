// Wallet trades, quoted by the contract's own fills (fillBuy, fillSell, the fee included) on the exact
// market a v3 claim view describes. The number on the confirm button is the chain's, to the micro; the
// slippage floor (min shares on a buy, min proceeds on a sale) is what the chain enforces if the price
// moves before the transaction lands. A view without the exact market can't be traded here.
import { applyBuy, applySell, atCap, feeBpsOf, fillBuy, fillSell, marketFromClaim, MICRO, priceYes, SCALE, type ClaimMarket, type Side } from "../core/lmsr";

export const SLIPPAGE_CHOICES = [50, 100, 200, 500] as const; // basis points
export const DEFAULT_SLIPPAGE_BPS = 200;

export interface BuyQuote {
  side: Side;
  amountMicro: bigint;
  sharesMicro: bigint;
  costMicro: bigint;
  feeMicro: bigint;
  /** what leaves the balance: cost and fee */
  paidMicro: bigint;
  /** the chain refuses the buy below this */
  minSharesMicro: bigint;
  feeBps: number;
  priceBefore: number;
  priceAfter: number;
  /** paid per share, 0..1 */
  avgPrice: number;
}

export interface SellQuote {
  side: Side;
  sharesMicro: bigint;
  proceedsMicro: bigint;
  feeMicro: bigint;
  /** what reaches the balance, after the fee */
  receivedMicro: bigint;
  /** the chain refuses the sale below this */
  minProceedsMicro: bigint;
  feeBps: number;
  priceBefore: number;
  priceAfter: number;
}

export type QuoteFail = { error: "not_exact" | "too_small" | "capped" | "no_shares" | "too_many_shares" };

const toNum = (x: bigint) => Number(x) / Number(SCALE);

/** The floor: amount less the slippage, rounded down; never below 1 micro for a real fill. */
export function floorBy(x: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(5000, Math.round(slippageBps))));
  const f = (x * (10_000n - bps)) / 10_000n;
  return x > 0n && f < 1n ? 1n : f;
}

export function quoteWalletBuy(view: ClaimMarket, side: Side, amountMicro: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): BuyQuote | QuoteFail {
  const m = marketFromClaim(view);
  if (!m) return { error: "not_exact" };
  if (atCap(m, side)) return { error: "capped" };
  const feeBps = feeBpsOf(view);
  const f = fillBuy(m, side, amountMicro, feeBps);
  if (f.sharesMicro <= 0n) return { error: "too_small" };
  const after = applyBuy(m, side, f.sharesMicro * MICRO);
  return {
    side, amountMicro, sharesMicro: f.sharesMicro, costMicro: f.costMicro, feeMicro: f.feeMicro, paidMicro: f.paidMicro,
    minSharesMicro: floorBy(f.sharesMicro, slippageBps), feeBps: Number(feeBps),
    priceBefore: toNum(priceYes(m)), priceAfter: toNum(priceYes(after)), avgPrice: Number(f.paidMicro) / Number(f.sharesMicro),
  };
}

export function quoteWalletSell(view: ClaimMarket, side: Side, sharesMicro: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): SellQuote | QuoteFail {
  const m = marketFromClaim(view);
  if (!m) return { error: "not_exact" };
  if (sharesMicro <= 0n) return { error: "no_shares" };
  const outstanding = (side === "yes" ? m.qYes : m.qNo) / MICRO;
  if (sharesMicro > outstanding) return { error: "too_many_shares" };
  const feeBps = feeBpsOf(view);
  const f = fillSell(m, side, sharesMicro, feeBps);
  const after = applySell(m, side, sharesMicro * MICRO);
  return {
    side, sharesMicro, proceedsMicro: f.proceedsMicro, feeMicro: f.feeMicro, receivedMicro: f.receivedMicro,
    minProceedsMicro: f.receivedMicro > 0n ? floorBy(f.receivedMicro, slippageBps) : 0n, feeBps: Number(feeBps),
    priceBefore: toNum(priceYes(m)), priceAfter: toNum(priceYes(after)),
  };
}

export const isFail = (q: unknown): q is QuoteFail => !!q && typeof q === "object" && "error" in (q as object);

export const QUOTE_WORDS: Record<QuoteFail["error"], string> = {
  not_exact: "This market can’t be quoted exactly right now, so it can’t be traded here. Try again in a moment.",
  too_small: "That amount is too small to buy a share. Try a little more.",
  capped: "The price is at its limit on this side, so there’s nothing left to buy.",
  no_shares: "You don’t hold any shares on this side.",
  too_many_shares: "That’s more shares than the market has outstanding.",
};
