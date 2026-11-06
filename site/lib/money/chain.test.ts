// What a transaction outcome means. The cases that matter are the ones where the last status looks
// fine and the money didn't move, and the ones where nobody can tell.
import { describe, expect, test } from "vitest";
import type { TxOutcome } from "../core/rpc";
import { plainPanic, resultOf, UNKNOWN_TX } from "./chain";

const MARKET = "market.isitpriced.near";
const USDC = "usdc.near";
const b64 = (v: unknown) => btoa(JSON.stringify(v));
const event = (name: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: "pricedin", version: "3.0.0", event: name, data })}`;
const receipt = (executor_id: string, status: unknown, logs: string[] = []) => ({ id: "r", outcome: { executor_id, logs, status } });
const tx = (status: TxOutcome["status"], receipts: ReturnType<typeof receipt>[] = []): TxOutcome =>
  ({ status, transaction: { hash: "HASH" }, transaction_outcome: { id: "HASH" }, receipts_outcome: receipts });
const panic = (m: string) => ({ Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${m}` } } } } });

describe("a transaction that landed", () => {
  test("gives its hash and its value", () => {
    const r = resultOf(tx({ SuccessValue: b64({ shares_micro: "1810000" }) }, [receipt(MARKET, { SuccessValue: "" })]), MARKET);
    expect(r).toEqual({ ok: true, hash: "HASH", value: { shares_micro: "1810000" }, error: null, unknown: false });
  });
  test("an empty SuccessValue is still success", () => {
    expect(resultOf(tx({ SuccessValue: "" }), MARKET).ok).toBe(true);
  });
});

describe("a clean last status isn't enough", () => {
  test("a deposit the market refuses: the token ends in SuccessValue \"0\", the market's receipt failed", () => {
    const r = resultOf(tx({ SuccessValue: b64("0") }, [receipt(USDC, { SuccessValue: "" }), receipt(MARKET, panic("paused")), receipt(USDC, { SuccessValue: b64("0") })]), MARKET);
    expect(r.ok).toBe(false);
    expect(r.unknown).toBe(false);
    expect(r.error).toMatch(/paused/);
  });
  test("a withdrawal whose transfer failed ends in a clean callback, and says the money is back", () => {
    const r = resultOf(tx({ SuccessValue: "" }, [
      receipt(MARKET, { SuccessValue: "" }, [event("withdraw", { trader: "a.near" })]),
      receipt(USDC, panic("The account a.near is not registered")),
      receipt(MARKET, { SuccessValue: "" }, [event("withdraw_refunded", { trader: "a.near" })]),
    ]), MARKET);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/back to your Priced In balance/);
  });
  test("someone else's contract can't fake the refund event", () => {
    const r = resultOf(tx({ SuccessValue: "" }, [receipt("other.near", { SuccessValue: "" }, [event("withdraw_refunded", {})])]), MARKET);
    expect(r.ok).toBe(true);
  });
});

describe("when nobody can say, it says so", () => {
  test("no outcome at all is never success", () => {
    for (const o of [null, undefined]) {
      const r = resultOf(o, MARKET);
      expect([r.ok, r.unknown, r.error]).toEqual([false, true, UNKNOWN_TX]);
    }
  });
  test("a status still in progress is never success", () => {
    const r = resultOf(tx("Started"), MARKET);
    expect([r.ok, r.unknown, r.hash]).toEqual([false, true, "HASH"]);
  });
});

describe("a contract's panic, in plain words", () => {
  test.each([
    ["slippage: fewer shares than min_shares", /price moved/],
    ["slippage: proceeds below minimum", /price moved/],
    ["not enough balance", /balance is too low/],
    ["paused", /paused/],
    ["claim is settled", /has been decided/],
    ["not settled", /isn’t decided yet/],
    ["nothing to redeem", /nothing to collect/],
    ["payout pot exhausted", /payout pot/],
    ["not enough shares", /that many shares/],
    ["the price is at its cap", /at its limit/],
    ["amount too small", /too small/],
  ])("%s", (panicText, words) => expect(plainPanic(panicText)).toMatch(words));
  test("anything else is passed on as a sentence", () => expect(plainPanic("a new refusal")).toBe("a new refusal."));
});
