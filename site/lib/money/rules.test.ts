// Every go or no-go for real money. A region can stop new money and still let existing money leave.
import { describe, expect, test } from "vitest";
import { canBuy, canSell, checkBet, checkBridgeIn, checkCollect, checkDeposit, checkSell, checkWithdraw, LIMITS, MAX_BET_MICRO, MAX_DEPOSIT_MICRO } from "./rules";

const $ = (n: number) => BigInt(n) * 1_000_000n;

describe("deposits", () => {
  test("go ahead inside the wallet's USDC and the cap", () => {
    expect(checkDeposit($(5), $(5), "open")).toBeNull();
    expect(checkDeposit($(5), null, "unknown")).toBeNull();
    expect(checkDeposit(MAX_DEPOSIT_MICRO, MAX_DEPOSIT_MICRO, "open")).toBeNull();
  });
  test("refused with the reason", () => {
    expect(checkDeposit(null, $(5), "open")).toMatch(/above zero/);
    expect(checkDeposit($(6), $(5), "open")).toMatch(/\$5\.00 USDC/);
    expect(checkDeposit(MAX_DEPOSIT_MICRO + 1n, null, "open")).toContain(`$${LIMITS.maxDepositUsd}`);
    expect(checkDeposit($(1), $(5), "close_only")).toMatch(/region/);
    expect(checkDeposit($(1), $(5), "blocked")).toMatch(/region/);
  });
  test("from another chain: the same region rule and cap", () => {
    expect(checkBridgeIn(20, "open")).toBeNull();
    expect(checkBridgeIn(null, "open")).toBeNull();
    expect(checkBridgeIn(LIMITS.maxDepositUsd + 1, "open")).toContain(`$${LIMITS.maxDepositUsd}`);
    expect(checkBridgeIn(20, "close_only")).toMatch(/region/);
  });
});

describe("bets", () => {
  test("go ahead on an open market, inside the balance and the cap", () => {
    expect(checkBet($(1), $(1), "Open", "open")).toBeNull();
    expect(checkBet(MAX_BET_MICRO, MAX_BET_MICRO, "Open", "open")).toBeNull();
  });
  test("refused with the reason", () => {
    expect(checkBet(null, $(1), "Open", "open")).toMatch(/above zero/);
    expect(checkBet($(2), $(1), "Open", "open")).toMatch(/Your balance is \$1\.00/);
    expect(checkBet(MAX_BET_MICRO + 1n, null, "Open", "open")).toContain(`$${LIMITS.maxBetUsd}`);
    expect(checkBet($(1), $(1), "Challenged", "open")).toMatch(/isn’t open/);
    expect(checkBet($(1), $(1), "Settled", "open")).toMatch(/isn’t open/);
    expect(checkBet($(1), $(1), "Open", "close_only")).toMatch(/region/);
  });
});

describe("a holder can always leave", () => {
  test("a sale runs through a ruling, and only a settled market stops it", () => {
    expect([canBuy("Open"), canBuy("Challenged"), canBuy("Escalated"), canBuy("Settled")]).toEqual([true, false, false, false]);
    expect([canSell("Open"), canSell("Challenged"), canSell("Escalated"), canSell("Settled")]).toEqual([true, true, true, false]);
    expect(checkSell($(1), $(1), "Challenged", "open")).toBeNull();
  });
  test("a close-only region can sell, collect and withdraw", () => {
    expect(checkSell($(1), $(1), "Open", "close_only")).toBeNull();
    expect(checkCollect("Settled", "close_only")).toBeNull();
    expect(checkWithdraw($(1), $(1), "close_only")).toBeNull();
  });
  test("a blocked region can't", () => {
    expect(checkSell($(1), $(1), "Open", "blocked")).toMatch(/region/);
    expect(checkCollect("Settled", "blocked")).toMatch(/region/);
    expect(checkWithdraw($(1), $(1), "blocked")).toMatch(/region/);
  });
  test("each refuses what isn't there", () => {
    expect(checkSell($(2), $(1), "Open", "open")).toMatch(/that many/);
    expect(checkSell($(1), 0n, "Open", "open")).toMatch(/any shares/);
    expect(checkSell(null, $(1), "Open", "open")).toMatch(/how many/);
    expect(checkSell($(1), $(1), "Settled", "open")).toMatch(/decided/);
    expect(checkCollect("Open", "open")).toMatch(/isn’t decided/);
    expect(checkWithdraw($(2), $(1), "open")).toMatch(/\$1\.00 to withdraw/);
    expect(checkWithdraw(null, $(1), "open")).toMatch(/above zero/);
  });
});
