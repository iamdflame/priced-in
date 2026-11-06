// Which positions go where, what a free bet scores, and how the histories join.
import { describe, expect, test } from "vitest";
import type { TxRecord } from "./ledger";
import { chainRow, groupPositions, mergeHistory, scoreOf, unindexedClaims, type HistoryRow, type PositionRow } from "./portfolio";

const row = (o: Partial<PositionRow>): PositionRow => ({ claim_id: 1, side: "no", shares: 2, spent_usd: 1, received_usd: 0, value_usd: 2, pnl_usd: 1, state: "open", redeemable: false, redeem_usd: 0, ...o });
const rec = (o: Partial<TxRecord>): TxRecord => ({ kind: "buy", hash: "H", at: 100, amountMicro: "1000000", claimId: 1, side: "no", ...o });
const hist = (o: Partial<HistoryRow>): HistoryRow => ({ kind: "buy", claim_id: 1, side: "no", amount_usd: 1, tx: "H", at: 100, ...o });

describe("grouping", () => {
  test("each position lands in exactly one place", () => {
    const rows = [row({ claim_id: 1, state: "won", redeemable: true }), row({ claim_id: 2, state: "open" }), row({ claim_id: 3, state: "ruling" }), row({ claim_id: 4, state: "lost" }), row({ claim_id: 5, state: "collected" }), row({ claim_id: 6, state: "closed" }), row({ claim_id: 7, state: "won", redeemable: false })];
    const g = groupPositions(rows);
    expect(g.collect.map((r) => r.claim_id)).toEqual([1]);
    expect(g.open.map((r) => r.claim_id)).toEqual([2, 3]);
    expect(g.past.map((r) => r.claim_id)).toEqual([4, 5, 6, 7]);
  });
});

describe("the free bet's score", () => {
  test("winnings of decided bets only: open and lost bets score nothing", () => {
    expect(scoreOf([row({ state: "won", value_usd: 1.81 }), row({ state: "lost", value_usd: 0 }), row({ state: "open", value_usd: 5 })])).toBeCloseTo(1.81);
  });
  test("a collected win still counts", () => {
    expect(scoreOf([row({ state: "collected", value_usd: 0, received_usd: 1.81 })])).toBeCloseTo(1.81);
  });
  test("no bets, no score", () => expect(scoreOf([])).toBe(0));
});

describe("the history", () => {
  test("a transaction in both appears once, as the server's row", () => {
    const merged = mergeHistory([hist({ amount_usd: 0.99 })], [rec({})]);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount_usd).toBe(0.99);
  });
  test("a fresh trade shows from this browser, and everything is newest first", () => {
    const merged = mergeHistory([hist({ tx: "OLD", at: 50 })], [rec({ hash: "NEW", at: 90 })]);
    expect(merged.map((r) => r.tx)).toEqual(["NEW", "OLD"]);
  });
  test("two steps of one transaction with different kinds both stay", () => {
    expect(mergeHistory([hist({ kind: "withdraw" })], [rec({ kind: "bridge_out", claimId: undefined })])).toHaveLength(2);
  });
  test("a storage registration isn't a money move", () => {
    expect(mergeHistory([], [rec({ kind: "storage", amountMicro: null })])).toEqual([]);
  });
  test("an API without history still gives the browser's own", () => {
    expect(mergeHistory([], [rec({})]).map((r) => r.kind)).toEqual(["buy"]);
  });
});

describe("before the indexer catches up", () => {
  test("only claims this browser bought that the answer doesn't list", () => {
    expect(unindexedClaims([row({ claim_id: 1 })], [rec({ claimId: 1 }), rec({ claimId: 2 }), rec({ claimId: 2 }), rec({ kind: "deposit", claimId: undefined })])).toEqual([2]);
  });
  test("a chain position is priced at today's chance, against what this browser paid", () => {
    const r = chainRow(2, "no", 2_000_000n, 0.3, [rec({ claimId: 2, amountMicro: "1000000" })]);
    expect([r.shares, r.spent_usd, r.state]).toEqual([2, 1, "open"]);
    expect(r.value_usd).toBeCloseTo(1.4);
    expect(r.pnl_usd).toBeCloseTo(0.4);
  });
  test("with no price, value stays unknown rather than zero", () => {
    const r = chainRow(2, "yes", 1_000_000n, null, []);
    expect([r.value_usd, r.pnl_usd]).toEqual([null, null]);
  });
});
