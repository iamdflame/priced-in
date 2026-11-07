// The free $1's score: what this browser's free bet has become. Its winnings stay in the market under the
// browser's own lane identity (lane:<key>), never leave it (the lane key can't withdraw: services/api's
// lane methods are buy, sell, open_and_buy and redeem), and can be bet again on any fact. No new money moves:
// it is the visitor's own balance. Read from /api/portfolio, the numbers /portfolio shows; never on a page
// view without a key, so reading never makes one.
import { fetchPortfolio, type Portfolio } from "../money/portfolio";
import { existingKey } from "./picks";

export interface Score {
  trader: string;
  /** what can be bet again now: won bets collected, or sold, into the identity's balance */
  balanceUsd: number;
  /** the free $1 as it stands: the balance and what its open and won bets are worth */
  worthUsd: number;
  /** won bets not collected yet: each can be added to the score */
  redeemable: { claim_id: number; usd: number }[];
  portfolio: Portfolio;
}

export const scoreOfPortfolio = (trader: string, p: Portfolio): Score => ({
  trader,
  balanceUsd: Math.max(0, p.balance_usd ?? 0),
  worthUsd: Math.max(0, p.balance_usd ?? 0) + p.positions.reduce((n, r) => n + (r.value_usd ?? 0), 0),
  redeemable: p.positions.filter((r) => r.redeemable).map((r) => ({ claim_id: r.claim_id, usd: r.redeem_usd })),
  portfolio: p,
});

/** This browser's score, or null when it has no key yet or the read failed. */
export async function myScore(): Promise<Score | null> {
  const k = existingKey();
  if (!k) return null;
  const trader = `lane:${k.publicKey}`;
  try { return scoreOfPortfolio(trader, await fetchPortfolio(trader)); } catch { return null; }
}

/** Enough to bet: a cent at least. */
export const canBetScore = (s: Score | null) => !!s && s.balanceUsd >= 0.01;

/** The score in micro-USDC, rounded down so a bet never asks for more than the balance holds. */
export const scoreMicro = (s: Score) => BigInt(Math.floor(s.balanceUsd * 1e6 + 1e-6));
