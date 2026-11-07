// The free $1's score: what can be bet again is the identity's own balance, rounded down to the micro so a
// bet never asks for more than it holds; what it is worth adds its open and won bets.
import { describe, expect, it } from "vitest";
import { canBetScore, scoreMicro, scoreOfPortfolio } from "@/lib/client/score";
import type { Portfolio } from "@/lib/money/portfolio";

const row = (o: Partial<Portfolio["positions"][number]>) => ({ claim_id: 18, side: "no" as const, shares: 0, spent_usd: 1, received_usd: 0, value_usd: 0, pnl_usd: 0, state: "open" as const, redeemable: false, redeem_usd: 0, ...o });
const pf = (balance: number | null, positions: Portfolio["positions"]): Portfolio => ({ balance_usd: balance, totals: { value_usd: 0, spent_usd: 0, received_usd: 0, pnl_usd: 0, redeemable_usd: 0, positions: positions.length }, positions });

describe("the score", () => {
  it("is the balance to bet, and the balance plus every bet's worth as it stands", () => {
    const s = scoreOfPortfolio("lane:ed25519:x", pf(1.203049, [row({ shares: 0.5, value_usd: 0.31 }), row({ claim_id: 6, state: "won", redeemable: true, redeem_usd: 1.19, value_usd: 1.19 })]));
    expect(s.balanceUsd).toBe(1.203049);
    expect(s.worthUsd).toBeCloseTo(2.703049, 6);
    expect(s.redeemable).toEqual([{ claim_id: 6, usd: 1.19 }]);
    expect(scoreMicro(s)).toBe(1_203_049n);
  });

  it("can't be bet below a cent, and a missing balance is none", () => {
    expect(canBetScore(scoreOfPortfolio("t", pf(0.004, [])))).toBe(false);
    expect(canBetScore(scoreOfPortfolio("t", pf(null, [])))).toBe(false);
    expect(canBetScore(scoreOfPortfolio("t", pf(0.01, [])))).toBe(true);
    expect(canBetScore(null)).toBe(false);
  });

  it("never rounds a bet above the balance", () => {
    for (const b of [0.1, 0.29, 1.15, 2.3, 7.000001]) expect(Number(scoreMicro(scoreOfPortfolio("t", pf(b, [])))) / 1e6).toBeLessThanOrEqual(b);
  });
});
