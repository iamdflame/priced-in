// The transactions a wallet signs: exactly what the contract's methods take, and a sentence that says
// the same thing as the arguments.
import { describe, expect, test } from "vitest";
import { moneyConfig, ONE_YOCTO, USDC_STORAGE_YOCTO } from "./config";
import { bridgeOutTxs, buyTx, depositTx, redeemTx, sellTx, storageTx, withdrawTx } from "./tx";

const c = moneyConfig("mainnet");

describe("each call", () => {
  test("deposit: ft_transfer_call on USDC to the market, with the 1 yocto NEP-141 asks for", () => {
    const t = depositTx(c, 5_000_000n);
    expect(t.receiverId).toBe(c.usdc);
    expect(t.actions).toHaveLength(1);
    expect(t.actions[0]).toMatchObject({ method: "ft_transfer_call", args: { receiver_id: c.market, amount: "5000000", msg: "" }, depositYocto: ONE_YOCTO.toString() });
    expect(t.says).toContain("$5.00");
  });
  test("buy: the slippage floor goes to the chain as min_shares_micro", () => {
    const t = buyTx(c, 32, "no", 1_000_000n, 1_750_000n);
    expect(t.receiverId).toBe(c.market);
    expect(t.actions[0]).toMatchObject({ method: "buy", args: { claim_id: 32, side: "no", amount_micro: "1000000", min_shares_micro: "1750000" }, depositYocto: "0" });
    expect(t.says).toMatch(/\$1\.00.*No.*1\.75 shares/);
  });
  test("sell: the floor goes to the chain as min_proceeds_micro", () => {
    const t = sellTx(c, 32, "yes", 2_000_000n, 900_000n);
    expect(t.actions[0]).toMatchObject({ method: "sell", args: { claim_id: 32, side: "yes", shares_micro: "2000000", min_proceeds_micro: "900000" } });
    expect(t.says).toMatch(/2\.00 Yes shares.*\$0\.90/);
  });
  test("redeem and withdraw", () => {
    expect(redeemTx(c, 18, 4_930_000n).actions[0]).toMatchObject({ method: "redeem", args: { claim_id: 18 } });
    expect(redeemTx(c, 18, 4_930_000n).says).toContain("$4.93");
    expect(withdrawTx(c, 3_000_000n).actions[0]).toMatchObject({ method: "withdraw", args: { amount_micro: "3000000" } });
  });
  test("storage: the registration deposit, and the sentence names the fee", () => {
    const t = storageTx(c, "someone.near");
    expect(t.actions[0]).toMatchObject({ method: "storage_deposit", args: { account_id: "someone.near", registration_only: true }, depositYocto: USDC_STORAGE_YOCTO.toString() });
    expect(t.says).toContain("0.00125 NEAR");
  });
  test("an amount of zero is refused here, before any wallet", () => {
    expect(() => depositTx(c, 0n)).toThrow();
    expect(() => buyTx(c, 1, "yes", 0n, 0n)).toThrow();
    expect(() => sellTx(c, 1, "yes", 0n, 0n)).toThrow();
    expect(() => withdrawTx(c, 0n)).toThrow();
  });
});

describe("out to another chain", () => {
  const o = { amountMicro: 5_000_000n, depositAddress: "cfdc0e1f7d542334b302b80b7cb4035a238e965ac594f317d79bef7758dcfbaa", destination: "0x1111…1111 on Base" };
  test("from the balance: withdraw first, then register the new address and send, in one transaction", () => {
    const [first, second, ...rest] = bridgeOutTxs(c, { ...o, needsStorage: true, fromBalance: true });
    expect(rest).toEqual([]);
    expect(first.actions[0].method).toBe("withdraw");
    expect(second.receiverId).toBe(c.usdc);
    expect(second.actions.map((a) => a.method)).toEqual(["storage_deposit", "ft_transfer"]);
    expect(second.actions[1]).toMatchObject({ args: { receiver_id: o.depositAddress, amount: "5000000" }, depositYocto: ONE_YOCTO.toString() });
    expect(second.says).toContain("0x1111…1111 on Base");
  });
  test("from the wallet, to an address already registered: one send", () => {
    const txs = bridgeOutTxs(c, { ...o, needsStorage: false, fromBalance: false });
    expect(txs).toHaveLength(1);
    expect(txs[0].actions.map((a) => a.method)).toEqual(["ft_transfer"]);
  });
});
