// The quote on every Yes/No button is the contract's fill, to the micro: checked against the vectors
// generated from crates/lmsr (web/test/vectors/lmsr.json), against a real logged trade, and on the
// live claim views (a snapshot of mainnet's /claims, with the 1% taker fee).
import { describe, expect, test } from "vitest";
import vectors from "../../../web/test/vectors/lmsr.json";
import claimsSnap from "./fixtures/claims.json";
import { feeBpsOf, fillBuy, marketFromClaim, priceYes } from "@/lib/core/lmsr";
import { backUsd, payoutWords, quoteClaim, quoteSide } from "@/lib/quote";
import type { ClaimView } from "@/lib/model";
import { preBetClaim, REPLAY } from "@/lib/replay/record";

const MICRO = 1_000_000n;

describe("quoteClaim equals the contract's fill on the crate's vectors", () => {
  test("every buy step: shares and paid to the micro, fee included", () => {
    let checked = 0, withFee = 0, capped = 0;
    for (const m of (vectors as any).markets) {
      for (const st of m.steps) {
        if (st.op !== "buy" || st.overflow) continue;
        const b = st.before;
        const view = {
          b_micro: String(BigInt(b.b) / MICRO), d0: b.d0, q_yes_micro: String(BigInt(b.q_yes) / MICRO), q_no_micro: String(BigInt(b.q_no) / MICRO),
          fee_bps: st.fee_bps, price_yes_ppm: Number(BigInt(st.price_yes) / MICRO),
        };
        const side = quoteSide(view, st.side, Number(st.amount_micro) / 1e6);
        if (!side) { expect(BigInt(st.shares_micro)).toBe(0n); capped++; continue; } // at the price cap: nothing to buy, no button

        expect(side.sharesMicro).toBe(String(st.shares_micro));
        expect(Math.round(side.paid * 1e6)).toBe(Number(st.paid_micro));
        expect(side.exact).toBe(true);
        checked++;
        if (st.fee_bps > 0 && Number(st.fee_micro) > 0) withFee++;
      }
    }
    expect(checked + capped).toBe(190); // every buy step in the vectors
    expect(checked).toBeGreaterThan(130);
    expect(withFee).toBeGreaterThan(20);
  });
});

describe("the replay's claim is the chain's", () => {
  test("claim 18 before the free $1: 23.18% chance it's true", () => {
    expect(preBetClaim().price_yes_ppm).toBe(231763);
  });
  test("a $1 No on it buys 1.203049 shares: exactly the logged trade (tx FGFhi1W9…)", () => {
    const q = quoteClaim(preBetClaim(), 1)!;
    expect(q.no.sharesMicro).toBe(String(REPLAY.sharesMicro));
    expect(Math.round(q.no.priceAfter * 1e6)).toBe(REPLAY.priceAfterPpm);
  });
});

describe("live mainnet claim views (v3, 1% fee)", () => {
  const claims = claimsSnap.claims as ClaimView[];
  test("every open claim quotes exactly, both sides, with the view's fee", () => {
    let n = 0;
    for (const c of claims.filter((x) => x.status === "Open")) {
      const q = quoteClaim(c, 1)!;
      expect(q).not.toBeNull();
      const m = marketFromClaim(c)!;
      expect(Number(priceYes(m) / MICRO)).toBe(c.price_yes_ppm);
      for (const side of ["yes", "no"] as const) {
        const f = fillBuy(m, side, 1_000_000n, feeBpsOf(c));
        expect(q[side].sharesMicro).toBe(String(f.sharesMicro));
        expect(q[side].fee).toBeCloseTo(Number(f.feeMicro) / 1e6, 9);
        expect(f.paidMicro).toBeLessThanOrEqual(1_000_000n);
      }
      n++;
    }
    expect(n).toBeGreaterThan(30);
  });
  test("the payout is said in plain money: what you get if right, the stake lost if wrong", () => {
    const q = { back: 1.5799, sharesMicro: "1579900", paid: 1, fee: 0.01, priceAfter: 0.6, exact: true };
    expect(payoutWords(q)).toEqual({ get: "$1.57", right: "Right: you get $1.57", wrong: "Wrong: you lose $1" });
  });
  test("backUsd rounds down, never promising more than the chain pays", () => {
    expect(backUsd({ back: 1.8199, sharesMicro: "1819900", paid: 1, fee: 0.01, priceAfter: 0.5, exact: true })).toBe("$1.81");
    expect(backUsd({ back: 1.2, sharesMicro: "1200000", paid: 1, fee: 0.01, priceAfter: 0.5, exact: true })).toBe("$1.20");
  });
});
