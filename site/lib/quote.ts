// The one-line bet: "Bet $1 → get $1.81 back if you're right". Exact: the market contract's own fill
// (fillBuy, fee included) on the market a v3 claim view describes (marketFromClaim), so the number on
// the button is the number of shares the chain will credit, to the micro. Each share pays $1.
import { feeBpsOf, marketFromClaim, marketFromPrice, quoteBuy, type ClaimMarket } from "./core/lmsr";

export interface Quote {
  /** what $amount buys, in shares: also the dollars back if right */
  back: number;
  sharesMicro: string;
  /** what leaves the balance, the fee included */
  paid: number;
  fee: number;
  /** the price your bet leaves, 0..1 */
  priceAfter: number;
  /** quoted on the exact market (v3 view) or rebuilt from the price */
  exact: boolean;
}

export interface Quotes { yes: Quote; no: Quote; amountUsd: number }

export interface ClaimLike extends ClaimMarket {
  price_yes_ppm: number;
  cost_up_10_micro?: string;
}

const DEFAULT_B_MICRO = 1_450_000; // the deployed liquidity, used only for a view without b_micro

/** Both sides of a $amount bet on a claim view. Null when the market can't be quoted. */
export function quoteClaim(c: ClaimLike, amountUsd = 1): Quotes | null {
  const exact = marketFromClaim(c);
  const m = exact ?? marketFromPrice(c.price_yes_ppm, c.b_micro ?? DEFAULT_B_MICRO);
  const fee = feeBpsOf(c);
  const one = (side: "yes" | "no"): Quote | null => {
    const q = quoteBuy(m, side, amountUsd, fee);
    if (q.overflow || q.capped || q.sharesMicro <= 0n) return null;
    return { back: q.shares, sharesMicro: q.sharesMicro.toString(), paid: q.paid, fee: q.fee, priceAfter: q.priceAfter, exact: !!exact };
  };
  const yes = one("yes"), no = one("no");
  return yes && no ? { yes, no, amountUsd } : null;
}

/** "$1.81": dollars back, rounded down to the cent so we never promise more than the chain pays. */
export const backUsd = (q: Quote) => `$${(Math.floor(q.back * 100) / 100).toFixed(2)}`;
