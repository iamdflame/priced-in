// A wallet quote is the chain's fill, to the micro: checked against every step of the vectors generated
// from crates/lmsr, the same code the contract runs, with and without the taker fee.
import { describe, expect, test } from "vitest";
import vectors from "../../../web/test/vectors/lmsr.json";
import { feeOn } from "../core/lmsr";
import { DEFAULT_SLIPPAGE_BPS, floorBy, isFail, quoteWalletBuy, quoteWalletSell } from "./quotes";

const MICRO = 1_000_000n;
type Before = { b: string; d0: string; q_yes: string; q_no: string };
const view = (b: Before, feeBps: number) => ({
  b_micro: String(BigInt(b.b) / MICRO), d0: b.d0, q_yes_micro: String(BigInt(b.q_yes) / MICRO), q_no_micro: String(BigInt(b.q_no) / MICRO), fee_bps: feeBps,
});
const steps = (op: string) => (vectors as any).markets.flatMap((m: any) => m.steps).filter((s: any) => s.op === op && !s.overflow);

describe("quote equals fill", () => {
  test("every buy in the vectors: shares, paid and fee, to the micro", () => {
    let filled = 0, withFee = 0;
    for (const st of steps("buy")) {
      const q = quoteWalletBuy(view(st.before, st.fee_bps), st.side, BigInt(st.amount_micro));
      if (isFail(q)) { expect(BigInt(st.shares_micro)).toBe(0n); continue; }
      expect(q.sharesMicro).toBe(BigInt(st.shares_micro));
      expect(q.paidMicro).toBe(BigInt(st.paid_micro));
      expect(q.feeMicro).toBe(BigInt(st.fee_micro));
      filled++;
      if (q.feeMicro > 0n) withFee++;
    }
    expect(filled).toBeGreaterThan(130);
    expect(withFee).toBeGreaterThan(20);
  });

  test("every sale in the vectors: proceeds, fee and what is received, to the micro", () => {
    let filled = 0, withFee = 0;
    for (const st of steps("sell")) {
      const q = quoteWalletSell(view(st.before, st.fee_bps), st.side, BigInt(st.shares) / MICRO);
      if (isFail(q)) throw new Error(`a vector's sale wasn't quoted: ${q.error}`);
      expect(q.proceedsMicro).toBe(BigInt(st.proceeds_micro));
      expect(q.feeMicro).toBe(BigInt(st.fee_micro));
      expect(q.receivedMicro).toBe(BigInt(st.received_micro));
      filled++;
      if (q.feeMicro > 0n) withFee++;
    }
    expect(filled).toBe(42);
    expect(withFee).toBeGreaterThan(5);
  });
});

describe("fee math", () => {
  const market = { b_micro: "1450000", d0: "0", q_yes_micro: "0", q_no_micro: "0", fee_bps: 100 };

  test("the crate's fee_on vectors", () => {
    const rows = (vectors as any).fee_on as [amountMicro: string, feeBps: number, feeMicro: string][];
    expect(rows).toHaveLength(70);
    for (const [amount, bps, fee] of rows) expect(feeOn(BigInt(amount), BigInt(bps))).toBe(BigInt(fee));
  });
  test("a buy's fee rides on top of its cost and the total stays inside the amount", () => {
    const q = quoteWalletBuy(market, "yes", 1_000_000n);
    if (isFail(q)) throw new Error(q.error);
    expect(q.paidMicro).toBe(q.costMicro + q.feeMicro);
    expect(q.feeMicro).toBe(feeOn(q.costMicro, 100n));
    expect(q.paidMicro).toBeLessThanOrEqual(1_000_000n);
  });
  test("a sale's fee comes out of its proceeds", () => {
    const held = { ...market, q_yes_micro: "2000000" };
    const q = quoteWalletSell(held, "yes", 1_000_000n);
    if (isFail(q)) throw new Error(q.error);
    expect(q.receivedMicro).toBe(q.proceedsMicro - q.feeMicro);
    expect(q.feeMicro).toBe(feeOn(q.proceedsMicro, 100n));
  });
});

describe("the slippage floor", () => {
  test("rounds down, and never reaches zero on a real fill", () => {
    expect(floorBy(1_000_000n, 200)).toBe(980_000n);
    expect(floorBy(999n, 100)).toBe(989n);
    expect(floorBy(1n, 500)).toBe(1n);
    expect(floorBy(0n, 100)).toBe(0n);
  });
  test("a quote's floor is what the chain is told to enforce", () => {
    const q = quoteWalletBuy({ b_micro: "1450000", d0: "0", q_yes_micro: "0", q_no_micro: "0", fee_bps: 100 }, "no", 5_000_000n);
    if (isFail(q)) throw new Error(q.error);
    expect(q.minSharesMicro).toBe(floorBy(q.sharesMicro, DEFAULT_SLIPPAGE_BPS));
    expect(q.minSharesMicro).toBeLessThan(q.sharesMicro);
  });
});

describe("what can't be quoted says so", () => {
  test("a view without the exact market is refused, never estimated", () => {
    expect(quoteWalletBuy({ fee_bps: 100 }, "yes", 1_000_000n)).toEqual({ error: "not_exact" });
    expect(quoteWalletSell({ fee_bps: 100 }, "yes", 1_000_000n)).toEqual({ error: "not_exact" });
  });
  test("a sale of nothing, or of more than exists", () => {
    const m = { b_micro: "1450000", d0: "0", q_yes_micro: "1000000", q_no_micro: "0", fee_bps: 100 };
    expect(quoteWalletSell(m, "yes", 0n)).toEqual({ error: "no_shares" });
    expect(quoteWalletSell(m, "yes", 1_000_001n)).toEqual({ error: "too_many_shares" });
  });
});
