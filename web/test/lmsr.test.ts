import { describe, expect, test } from "vitest";
import vectors from "./vectors/lmsr.json";
import {
  SCALE, MICRO, mul, div, exp, expm1, ln, softplus, sigmoid, openMarket, priceYes, priceNo, cost, costOpen,
  quoteBuyRaw, quoteSellRaw, maxLoss, contractBuy, contractSell, costToMoveMicro, quoteBuy, quoteSell, costToMove,
  marketFromPrice, marketFromReceipt, marketFromClaim, feeBpsOf, impliedBMicro, priceNumber, LmsrOverflow,
  feeOn, fillBuy, fillSell, atCap, applyBuy, type ClaimMarket, type Market, type Side,
} from "../src/core/lmsr";

const B = (s: string) => BigInt(s);
const mk = (j: { b: string; d0: string; q_yes: string; q_no: string }): Market => ({ b: B(j.b), d0: B(j.d0), qYes: B(j.q_yes), qNo: B(j.q_no) });
const f = (x: bigint) => Number(x) / 1e12;

describe("lmsr: equal to crates/lmsr on the generated vectors", () => {
  test("exp, expm1, softplus and sigmoid: every row bit-exact", () => {
    for (const [x, e, em1, sp, sg] of vectors.exp_expm1_softplus_sigmoid) {
      expect(exp(B(x))).toBe(B(e));
      expect(expm1(B(x))).toBe(B(em1));
      expect(softplus(B(x))).toBe(B(sp));
      expect(sigmoid(B(x))).toBe(B(sg));
    }
    expect(vectors.exp_expm1_softplus_sigmoid.length).toBeGreaterThan(150);
  });

  test("ln, mul and div: every row bit-exact, truncating toward zero like Rust", () => {
    for (const [y, l] of vectors.ln) expect(ln(B(y))).toBe(B(l));
    for (const [a, b, m, d] of vectors.mul_div) {
      expect(mul(B(a), B(b))).toBe(B(m));
      expect(div(B(a), B(b))).toBe(B(d));
    }
  });

  test("markets: open, price, cost, max loss, every quote and fill, cost to move", () => {
    let trades = 0, overflows = 0, worstFloat = 0, huge = 0, feeBuys = 0, feeSells = 0;
    for (const v of vectors.markets) {
      const open = openMarket(B(v.b), B(v.p0));
      expect(open).toEqual(mk(v.open));
      expect(costOpen(open)).toBe(B(v.cost_open));
      expect(maxLoss(open, "yes")).toBe(B(v.max_loss_yes));
      expect(maxLoss(open, "no")).toBe(B(v.max_loss_no));
      expect(priceNo(open)).toBe(B(v.price_no));
      let m = open;
      for (const st of v.steps as any[]) {
        expect(m).toEqual(mk(st.before));
        expect(priceYes(m)).toBe(B(st.price_yes));
        expect(cost(m)).toBe(B(st.cost));
        expect(costToMoveMicro(m, true)).toBe(B(st.cost_up_10_micro));
        expect(costToMoveMicro(m, false)).toBe(B(st.cost_down_10_micro));
        const side = st.side as Side;
        if (st.op === "buy") {
          if (st.overflow) {
            overflows++;
            expect(() => quoteBuyRaw(m, side, B(st.spend))).toThrow(LmsrOverflow);
            expect(quoteBuy(m, side, Number(st.amount_micro) / 1e6).overflow).toBe(true);
            continue;
          }
          if (B(st.spend) >= 33n * m.b) huge++;
          const [sh, ch] = quoteBuyRaw(m, side, B(st.spend));
          expect(sh).toBe(B(st.shares));
          expect(ch).toBe(B(st.charged));
          const r = contractBuy(m, side, B(st.amount_micro), st.fee_bps);
          expect(r.sharesMicro).toBe(B(st.shares_micro));
          expect(r.chargedMicro).toBe(B(st.charged_micro));
          expect(r.feeMicro).toBe(B(st.fee_micro));
          expect(r.paidMicro).toBe(B(st.paid_micro));
          expect(r.paidMicro).toBeLessThanOrEqual(B(st.amount_micro));
          if (st.fee_bps > 0 && r.feeMicro > 0n) feeBuys++;
          const q = quoteBuy(m, side, Number(st.amount_micro) / 1e6, st.fee_bps);
          expect(q.sharesMicro).toBe(B(st.shares_micro));
          expect(q.paidMicro).toBe(B(st.paid_micro));
          worstFloat = Math.max(worstFloat, Math.abs(q.priceAfter - f(B(st.price_yes_after))));
          m = r.after;
        } else {
          const p = quoteSellRaw(m, side, B(st.shares));
          expect(p).toBe(B(st.proceeds));
          const r = contractSell(m, side, B(st.shares) / MICRO, st.fee_bps);
          expect(r.proceedsMicro).toBe(B(st.proceeds_micro));
          expect(r.feeMicro).toBe(B(st.fee_micro));
          expect(r.receivedMicro).toBe(B(st.received_micro));
          if (st.fee_bps > 0 && r.feeMicro > 0n) feeSells++;
          m = r.after;
        }
        expect(priceYes(m)).toBe(B(st.price_yes_after));
        trades++;
      }
      expect(m).toEqual(mk(v.final));
    }
    expect(trades).toBeGreaterThan(150);
    // the crate checks the price cap before its closed form, so no order overflows any more,
    // and the vectors hold orders far above 33 b, where the old order did
    expect(overflows).toBe(0);
    expect(huge).toBeGreaterThan(20);
    expect(worstFloat).toBeLessThan(1e-9);
    // the walks trade at fees from 0 to the 300 bps cap, on both buys and sales
    expect(feeBuys).toBeGreaterThan(50);
    expect(feeSells).toBeGreaterThan(10);
  });

  test("fee_on: every row, rounded up", () => {
    for (const [amount, bps, fee] of vectors.fee_on as [string, number, string][]) expect(feeOn(B(amount), BigInt(bps))).toBe(B(fee));
    expect(vectors.fee_on.length).toBeGreaterThan(50);
  });

  test("fills the walks rarely reach: stepped back from a rounded cost, at the cap, too small", () => {
    const rows = vectors.fills as Record<"stepped_back" | "at_cap" | "too_small", any[]>;
    for (const r of [...rows.stepped_back, ...rows.at_cap, ...rows.too_small]) {
      const m = mk(r.market);
      expect(fillBuy(m, r.side, B(r.amount_micro), r.fee_bps)).toEqual({ sharesMicro: B(r.shares_micro), costMicro: B(r.cost_micro), feeMicro: B(r.fee_micro), paidMicro: B(r.paid_micro) });
      expect(atCap(m, r.side)).toBe(r.at_cap);
    }
    // these rows are the point: the floored shares cost a micro over budget, so the crate gave one back
    expect(rows.stepped_back.length).toBeGreaterThanOrEqual(20);
    for (const r of rows.stepped_back) expect(B(r.raw_shares_micro)).toBeGreaterThan(B(r.shares_micro));
    expect(rows.at_cap.every((r) => r.shares_micro === "0" && r.paid_micro === "0")).toBe(true);
    expect(rows.too_small.every((r) => r.shares_micro === "0" && r.paid_micro === "0")).toBe(true);
  });

  test("the architect's number: b = $3 at 50%, $1 on YES", () => {
    const m = openMarket(3n * SCALE, SCALE / 2n);
    const [sh, ch] = quoteBuyRaw(m, "yes", SCALE);
    expect(sh).toBe(B(vectors.architect.shares));
    expect(ch).toBe(B(vectors.architect.charged));
    expect(Math.abs(priceNumber({ ...m, qYes: sh }) - 0.6417)).toBeLessThan(0.001);
  });
});

describe("lmsr: the numbers the views use", () => {
  test("a $1 doubt on a $3-liquidity market at 50% moves it to 35.8265% (the testnet e2e figure)", () => {
    const m = marketFromReceipt(500_000, 3_000_000);
    const q = quoteBuy(m, "no", 1);
    expect(q.priceBefore).toBeCloseTo(0.5, 9);
    expect(priceYes(q.after) / MICRO).toBe(358265n); // the contract reports ppm truncated
    expect(q.cost).toBeLessThanOrEqual(1);
    expect(q.shares).toBeGreaterThan(1);
    expect(q.overflow).toBe(false);
  });

  test("costToMove(10) equals the contract's view; other distances use the closed form", () => {
    const m = marketFromReceipt(500_000, 3_000_000);
    const after = contractBuy(m, "no", 1_000_000n).after;
    const m2 = after;
    const c = costToMove(m2);
    expect(c.upUsd).toBe(Number(costToMoveMicro(m2, true)) / 1e6);
    expect(c.upUsd).toBeCloseTo(0.508196, 5);
    expect(c.downUsd).toBeCloseTo(0.981857, 5);
    const five = costToMove(m2, 5);
    expect(five.upUsd).toBeGreaterThan(0);
    expect(five.upUsd).toBeLessThan(c.upUsd);
  });

  test("a market rebuilt from a claim view's price quotes like the original", () => {
    const real = openMarket(1_000_000n * MICRO, 620_000n * MICRO);
    const after = contractBuy(real, "no", 400_000n).after;
    const ppm = Number(priceYes(after) / MICRO);
    const rebuilt = marketFromPrice(ppm, 1_000_000);
    const a = quoteBuy(after, "no", 1), b = quoteBuy(rebuilt, "no", 1);
    expect(Math.abs(a.priceAfter - b.priceAfter)).toBeLessThan(2e-6);
    expect(Number(a.sharesMicro - b.sharesMicro)).toBeLessThan(20);
  });

  test("liquidity implied by the view's cost-to-move figures", () => {
    for (const bMicro of [100_000, 1_000_000, 3_000_000, 25_000_000]) {
      const m = openMarket(BigInt(bMicro) * MICRO, 450_000n * MICRO);
      const p = priceNumber(m);
      const est = impliedBMicro(p, Number(costToMoveMicro(m, true)), Number(costToMoveMicro(m, false)))!;
      expect(Math.abs(est - bMicro) / bMicro).toBeLessThan(2e-5);
    }
    expect(impliedBMicro(0.5, 0, 0)).toBeNull();
  });

  test("sells: proceeds of a position bought earlier, even on a rebuilt market", () => {
    const m = marketFromReceipt(500_000, 1_000_000);
    const buy = contractBuy(m, "no", 1_000_000n);
    const direct = contractSell(buy.after, "no", buy.sharesMicro);
    expect(Number(direct.proceedsMicro)).toBeLessThanOrEqual(Number(buy.chargedMicro));
    expect(Number(buy.chargedMicro - direct.proceedsMicro)).toBeLessThanOrEqual(2);
    const rebuilt = marketFromPrice(Number(priceYes(buy.after) / MICRO), 1_000_000);
    const q = quoteSell(rebuilt, "no", buy.sharesMicro);
    expect(Math.abs(Number(q.proceedsMicro - direct.proceedsMicro))).toBeLessThan(5);
    expect(q.priceAfter).toBeCloseTo(0.5, 5);
  });

  test("a spend far above the liquidity buys to the price cap and is charged only that", () => {
    const m = marketFromReceipt(500_000, 100_000);
    const q = quoteBuy(m, "yes", 5); // 50 b: this overflowed before the crate checked the cap first
    expect(q.overflow).toBe(false);
    expect(q.chargedMicro).toBe(851_720n); // b ln(0.5 / 0.0001), as crates/lmsr's test says
    expect(q.priceAfter).toBeGreaterThan(0.9998);
    const huge = quoteBuy(m, "yes", 1e9);
    expect(huge.overflow).toBe(false);
    expect(huge.chargedMicro).toBe(q.chargedMicro);
    expect(quoteBuy(q.after, "yes", 5).capped).toBe(true);
    expect(quoteBuy(m, "yes", 1).overflow).toBe(false);
    expect(quoteBuy(m, "yes", 0).shares).toBe(0);
  });

  test("the fee: on top of a buy's cost, out of a sale's proceeds, inside the amount", () => {
    const m = marketFromReceipt(500_000, 3_000_000);
    const q = quoteBuy(m, "yes", 1, 100);
    expect(q.chargedMicro).toBeLessThanOrEqual(990_099n); // floor($1 / 1.01): the pot's budget
    expect(q.feeMicro).toBe(feeOn(q.chargedMicro, 100n));
    expect(q.paidMicro).toBe(q.chargedMicro + q.feeMicro);
    expect(q.paidMicro).toBeLessThanOrEqual(1_000_000n);
    expect(q.paid).toBe(Number(q.paidMicro) / 1e6);
    expect(q.avgPrice).toBeCloseTo(q.paid / q.shares, 12);
    // the same order with no fee buys more shares for the same dollar
    const free = quoteBuy(m, "yes", 1);
    expect(free.sharesMicro).toBeGreaterThan(q.sharesMicro);
    expect([free.feeMicro, free.paidMicro]).toEqual([0n, free.chargedMicro]);
    const s = quoteSell(q.after, "yes", q.sharesMicro, 100);
    expect(s.feeMicro).toBe(feeOn(s.proceedsMicro, 100n));
    expect(s.receivedMicro).toBe(s.proceedsMicro - s.feeMicro);
    // a round trip pays both fees, and the pot keeps its rounding
    expect(s.receivedMicro + q.feeMicro + s.feeMicro).toBeLessThanOrEqual(q.paidMicro);
    // the fee on a capped buy is on what it cost, not on the order
    const capped = quoteBuy(marketFromReceipt(500_000, 100_000), "yes", 5, 100);
    expect([capped.chargedMicro, capped.feeMicro, capped.paidMicro]).toEqual([851_720n, 8_518n, 860_238n]);
  });

  test("a claim view carries the exact market; a view from before v3 doesn't, and charges no fee", () => {
    const opened = marketFromReceipt(620_000, 1_450_000);
    const traded = contractBuy(opened, "no", 400_000n, 100).after;
    const view = { b_micro: "1450000", d0: String(opened.d0), q_yes_micro: "0", q_no_micro: String(traded.qNo / MICRO), fee_bps: 100 };
    expect(marketFromClaim(view)).toEqual(traded);
    expect(feeBpsOf(view)).toBe(100n);
    // so its quote is the fill itself, where a market rebuilt from the price is only close
    const m = marketFromClaim(view)!;
    const exact = fillBuy(m, "yes", 1_000_000n, feeBpsOf(view));
    expect(exact).toEqual(fillBuy(traded, "yes", 1_000_000n, 100));
    expect(fillSell(m, "no", 1000n, 100)).toEqual(fillSell(traded, "no", 1000n, 100));
    const rebuilt = marketFromPrice(Number(priceYes(traded) / MICRO), 1_450_000);
    expect(applyBuy(m, "yes", 0n)).not.toEqual(rebuilt);
    const old: ClaimMarket = JSON.parse('{"price_yes_ppm":620000,"cost_up_10_micro":"1","cost_down_10_micro":"1"}');
    expect(marketFromClaim(old)).toBeNull();
    expect(feeBpsOf(old)).toBe(0n);
  });
});
