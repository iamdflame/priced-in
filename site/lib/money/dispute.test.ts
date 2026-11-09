// Objecting to an AI ruling: shown only while its window runs, never to the free-bet lane, at twice the
// current bond, with a reason the contract will take (1..4000 bytes), and the wallet's USDC moved in
// first when the balance is short.
import { describe, expect, test } from "vitest";
import type { ChallengeView, ClaimView } from "./chain";
import { GAS, moneyConfig } from "./config";
import { checkDispute, disputeBond, disputeTxs, evidenceBytes, evidenceProblem, funding, isLaneAccount, liveWindow, objectGate, ownSide, windowOpen, type DisputeCheck } from "./dispute";
import { disputeTx } from "./tx";

const c = moneyConfig("mainnet");
const NOW = 1_000_000;
const OPEN = { status: "window", windowEndsAt: NOW + 60_000, disputes: 0 };
const IN = { status: "in", accountId: "stranger.near" };

const ch = (o: Partial<ChallengeView> = {}): ChallengeView => ({
  claim_id: 9, challenger: "checker.isitpriced.near", claimed_outcome: false, evidence: "e", bond_micro: "1000000", opened_ns: "1", jury_deadline_ns: "2", window_opened_ns: "3", window_ends_ns: "4", disputes: 0,
  stakes: [{ account: "checker.isitpriced.near", side: false, amount_micro: "1000000", evidence: "" }], resolved: false, ...o,
});
const claim = (o: Partial<ClaimView> = {}): ClaimView => ({ id: 9, text: "A line.", price_yes_ppm: 500_000, status: "Challenged", outcome: null, provisional: false, challenge_id: 4, ...o });

describe("the window", () => {
  test("open only while it runs, and before the third objection", () => {
    expect(windowOpen(OPEN, NOW)).toBe(true);
    expect(windowOpen({ ...OPEN, windowEndsAt: NOW }, NOW)).toBe(false);
    expect(windowOpen({ ...OPEN, windowEndsAt: null }, NOW)).toBe(false);
    expect(windowOpen({ ...OPEN, status: "jury" }, NOW)).toBe(false);
    expect(windowOpen({ ...OPEN, status: "settled" }, NOW)).toBe(false);
    expect(windowOpen({ ...OPEN, disputes: 3 }, NOW)).toBe(false);
  });
  test("from the chain: a running challenge with a provisional ruling and its dispute_ends_ns", () => {
    expect(liveWindow(4, ch(), claim(), NOW + 5)).toEqual({ status: "window", windowEndsAt: NOW + 5, disputes: 0 });
    expect(liveWindow(4, ch({ resolved: true }), claim({ status: "Settled" }), null).status).toBe("closed");
    expect(liveWindow(4, ch(), claim({ provisional: null }), null).status).toBe("closed");
    expect(liveWindow(4, ch(), claim({ challenge_id: 5 }), NOW + 5).status).toBe("closed");
    expect(liveWindow(4, ch({ disputes: 3 }), claim({ status: "Escalated" }), null)).toEqual({ status: "escalated", windowEndsAt: null, disputes: 3 });
    expect(liveWindow(4, null, claim(), NOW + 5).status).toBe("closed");
  });
});

describe("who sees the button", () => {
  test("a connected wallet while the window is open", () => {
    expect(objectGate(OPEN, NOW, IN, "open", c.lane)).toBe("ready");
    expect(objectGate(OPEN, NOW, IN, "unknown", c.lane)).toBe("ready");
  });
  test("nobody once the window has closed", () => {
    expect(objectGate({ ...OPEN, windowEndsAt: NOW - 1 }, NOW, IN, "open", c.lane)).toBe("hidden");
    expect(objectGate({ ...OPEN, status: "settled" }, NOW, IN, "open", c.lane)).toBe("hidden");
  });
  test("never the free-bet lane key", () => {
    expect(isLaneAccount("lane:ed25519:abc", c.lane)).toBe(true);
    expect(isLaneAccount(c.lane, c.lane)).toBe(true);
    expect(isLaneAccount("lane.near", c.lane)).toBe(false);
    expect(objectGate(OPEN, NOW, { status: "in", accountId: c.lane }, "open", c.lane)).toBe("hidden");
    expect(objectGate(OPEN, NOW, { status: "in", accountId: "lane:ed25519:abc" }, "open", c.lane)).toBe("hidden");
  });
  test("no wallet yet: the button asks for one", () => {
    expect(objectGate(OPEN, NOW, { status: "out", accountId: null }, "open", c.lane)).toBe("connect");
  });
  test("an objection puts money in, so the regions that can't deposit don't see it", () => {
    expect(objectGate(OPEN, NOW, IN, "close_only", c.lane)).toBe("hidden");
    expect(objectGate(OPEN, NOW, IN, "blocked", c.lane)).toBe("hidden");
  });
});

describe("the bond", () => {
  test("twice the current bond, from get_challenge", () => {
    expect(disputeBond(ch())).toBe(2_000_000n);
    expect(disputeBond(ch({ bond_micro: "4000000" }))).toBe(8_000_000n);
  });
  test("paid from the balance, or the shortfall moved in from the wallet first", () => {
    expect(funding(2_000_000n, 5_000_000n, 0n)).toEqual({ shortfall: 0n, depositMicro: null, needsDeposit: false });
    expect(funding(2_000_000n, 500_000n, 3_000_000n)).toEqual({ shortfall: 1_500_000n, depositMicro: 1_500_000n, needsDeposit: false });
    expect(funding(2_000_000n, 500_000n, 1_000_000n)).toEqual({ shortfall: 1_500_000n, depositMicro: null, needsDeposit: true });
    expect(funding(2_000_000n, 500_000n, null).needsDeposit).toBe(true);
  });
  test("the account's own side: the last bond it posted", () => {
    const c2 = ch({ stakes: [{ account: "a.near", side: false, amount_micro: "1", evidence: "" }, { account: "b.near", side: true, amount_micro: "2", evidence: "x" }, { account: "a.near", side: true, amount_micro: "4", evidence: "y" }] });
    expect(ownSide(c2, "a.near")).toBe(true);
    expect(ownSide(c2, "b.near")).toBe(true);
    expect(ownSide(c2, "c.near")).toBeNull();
    expect(ownSide(c2, null)).toBeNull();
  });
});

describe("the reason", () => {
  test("required, and at most 4,000 bytes, counted as the contract counts them", () => {
    expect(evidenceProblem("")).toMatch(/Say why/);
    expect(evidenceProblem("   \n ")).toMatch(/Say why/);
    expect(evidenceProblem("x".repeat(4000))).toBeNull();
    expect(evidenceProblem("x".repeat(4001))).toMatch(/4,001 bytes; the limit is 4,000/);
    // a curly apostrophe is three bytes: 1,334 of them is 4,002 bytes, not 1,334 characters
    expect(evidenceBytes("’".repeat(1334))).toBe(4002);
    expect(evidenceProblem("’".repeat(1334))).toMatch(/4,002 bytes/);
    expect(evidenceBytes("  ab  ")).toBe(2);
  });
});

describe("checkDispute", () => {
  const ok: DisputeCheck = { access: "open", window: OPEN, now: NOW, accountId: "stranger.near", laneAccount: c.lane, evidence: "The filing says otherwise: https://example.org/f", bond: 2_000_000n, provisional: false, mine: null, balance: 5_000_000n, walletUsdc: 0n };
  test("goes ahead with a reason, an open window and the bond covered", () => {
    expect(checkDispute(ok)).toBeNull();
    expect(checkDispute({ ...ok, balance: 0n, walletUsdc: 2_000_000n })).toBeNull();
  });
  test("each refusal in plain words", () => {
    expect(checkDispute({ ...ok, access: "close_only" })).toMatch(/region/);
    expect(checkDispute({ ...ok, window: { ...OPEN, windowEndsAt: NOW - 1 } })).toMatch(/closed/);
    expect(checkDispute({ ...ok, window: { status: "escalated", windowEndsAt: null, disputes: 3 } })).toMatch(/council/);
    expect(checkDispute({ ...ok, accountId: null })).toMatch(/Connect/);
    expect(checkDispute({ ...ok, accountId: c.lane })).toMatch(/free \$1/);
    expect(checkDispute({ ...ok, provisional: null })).toMatch(/haven’t ruled/);
    expect(checkDispute({ ...ok, mine: false })).toMatch(/already backs the ruling \(false\)/);
    expect(checkDispute({ ...ok, mine: true })).toBeNull();
    expect(checkDispute({ ...ok, evidence: "" })).toMatch(/Say why/);
    expect(checkDispute({ ...ok, balance: null })).toMatch(/Reading your balance/);
    expect(checkDispute({ ...ok, balance: 500_000n, walletUsdc: 0n })).toBe("The bond is $2.00 and your balance is $0.50. Deposit $1.50 first.");
  });
});

describe("what the wallet signs", () => {
  test("dispute: challenge_id and the reason, nothing attached", () => {
    const t = disputeTx(c, 4, "why", 2_000_000n, true);
    expect(t.receiverId).toBe(c.market);
    expect(t.actions[0]).toMatchObject({ method: "dispute", args: { challenge_id: 4, evidence: "why" }, gasTgas: GAS.dispute.toString(), depositYocto: "0" });
    expect(t.says).toMatch(/\$2\.00 bond.*flips it to true/);
    expect(() => disputeTx(c, 4, " ", 2_000_000n, true)).toThrow();
  });
  test("the shortfall first when the wallet holds it, then the objection, which flips the ruling", () => {
    const two = disputeTxs(c, 4, "  why  ", 2_000_000n, false, funding(2_000_000n, 500_000n, 9_000_000n));
    expect(two.map((t) => t.actions[0].method)).toEqual(["ft_transfer_call", "dispute"]);
    expect(two[0].actions[0].args).toMatchObject({ receiver_id: c.market, amount: "1500000" });
    expect(two[1].actions[0].args).toEqual({ challenge_id: 4, evidence: "why" });
    expect(two[1].says).toMatch(/flips it to true/);
    expect(disputeTxs(c, 4, "why", 2_000_000n, true, funding(2_000_000n, 9_000_000n, 0n)).map((t) => t.actions[0].method)).toEqual(["dispute"]);
  });
});
