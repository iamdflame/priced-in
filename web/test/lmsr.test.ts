import { describe, expect, test } from "vitest";
import vectors from "./vectors/lmsr.json";
import {
  SCALE, MICRO, mul, div, exp, expm1, ln, softplus, sigmoid, openMarket, priceYes, priceNo, cost, costOpen,
  quoteBuyRaw, quoteSellRaw, maxLoss, contractBuy, contractSell, costToMoveMicro, quoteBuy, quoteSell, costToMove,
  marketFromPrice, marketFromReceipt, impliedBMicro, priceNumber, LmsrOverflow, type Market, type Side,
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
    let trades = 0, overflows = 0, worstFloat = 0;
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
          const [sh, ch] = quoteBuyRaw(m, side, B(st.spend));
          expect(sh).toBe(B(st.shares));
          expect(ch).toBe(B(st.charged));
          const r = contractBuy(m, side, B(st.amount_micro));
          expect(r.sharesMicro).toBe(B(st.shares_micro));
          expect(r.chargedMicro).toBe(B(st.charged_micro));
          const q = quoteBuy(m, side, Number(st.amount_micro) / 1e6);
          expect(q.sharesMicro).toBe(B(st.shares_micro));
          worstFloat = Math.max(worstFloat, Math.abs(q.priceAfter - f(B(st.price_yes_after))));
          m = r.after;
        } else {
          const p = quoteSellRaw(m, side, B(st.shares));
          expect(p).toBe(B(st.proceeds));
          const r = contractSell(m, side, B(st.shares) / MICRO);
          expect(r.proceedsMicro).toBe(B(st.proceeds_micro));
          m = r.after;
        }
        expect(priceYes(m)).toBe(B(st.price_yes_after));
        trades++;
      }
      expect(m).toEqual(mk(v.final));
    }
    expect(trades).toBeGreaterThan(150);
    expect(overflows).toBeGreaterThan(0);
    expect(worstFloat).toBeLessThan(1e-9);
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

  test("a spend over about 33 times the liquidity overflows, as it does in the contract", () => {
    const m = marketFromReceipt(500_000, 100_000);
    expect(quoteBuy(m, "yes", 5).overflow).toBe(true);
    expect(quoteBuy(m, "yes", 1).overflow).toBe(false);
    expect(quoteBuy(m, "yes", 0).shares).toBe(0);
  });
});
