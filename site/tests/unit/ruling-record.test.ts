// The ruling record, and the bug that took the home page down while a ruling ran: /rulings sends
// ruling_now as a short summary, not a Ruling, so every reader must get the full record instead.
import { describe, expect, it } from "vitest";
import { median, resolveRulingNow, rulingRecord } from "@/lib/rulings";
import type { Ruling, Rulings } from "@/lib/server/api";

const ruling = (o: Partial<Ruling>): Ruling => ({
  challenge_id: 0, claim_id: 18, claim: "A sentence.", page: "tether", challenger: "checker.isitpriced.near", challenger_name: "the Checker", claimed: "FALSE",
  bond_usd: 1, opened_at: 1_000, open_tx: "tx", jury_deadline_at: 2_000, evidence: "e", verdicts: [], provisional: "FALSE", provisional_at: 1_100, window_ends_at: 1_700,
  disputes: [], escalated: false, status: "settled", outcome: "FALSE", settled_at: 2_200, settle_tx: "s", payout_usd: 1.5, correction: null, ...o,
});

const verdict = (v: string) => ({ model: "m", verdict: v, at: 1_050, tx: "t", signature: "s" });

describe("resolveRulingNow", () => {
  // the shape the live API sent on 2026-11-06, trimmed
  const summary = { challenge_id: 3, claim_id: 21, claim: "A sentence.", stage: "window", provisional: "FALSE", verdicts: [{ model: "m", verdict: "FALSE" }], opened_at: 1_000, window_ends_at: 1_700, live: 1 };

  it("swaps the API's summary for the full record", () => {
    const full = ruling({ challenge_id: 3, claim_id: 21, status: "window", outcome: null, settled_at: null });
    const doc = { ruling_now: summary, next_challenge_at: null, next_ruling_at: 2_000, rulings: [ruling({}), full], asOf: 1 };
    const r = resolveRulingNow(doc);
    expect(r.ruling_now).toBe(full);
    expect(r.ruling_now?.challenger_name).toBe("the Checker");
  });

  it("gives null, never the summary, when the record isn't in the list", () => {
    expect(resolveRulingNow({ ruling_now: summary, next_challenge_at: null, next_ruling_at: null, rulings: [], asOf: 1 }).ruling_now).toBeNull();
  });

  it("leaves a quiet hour alone", () => {
    const doc: Rulings = { ruling_now: null, next_challenge_at: 5, next_ruling_at: 6, rulings: [ruling({})], asOf: 1 };
    expect(resolveRulingNow(doc)).toEqual(doc);
  });
});

describe("rulingRecord", () => {
  it("counts only what settled, and adds up what was paid", () => {
    const r = rulingRecord([
      ruling({ challenge_id: 0, payout_usd: 4.93 }),
      ruling({ challenge_id: 1, payout_usd: 0.94, opened_at: 3_000, settled_at: 4_000 }),
      ruling({ challenge_id: 2, payout_usd: 0, opened_at: 5_000, settled_at: 7_000 }),
      ruling({ challenge_id: 3, status: "window", outcome: null, settled_at: null, payout_usd: null, opened_at: 8_000 }),
    ]);
    expect(r.all.map((x) => x.challenge_id)).toEqual([3, 2, 1, 0]);
    expect(r.settled).toHaveLength(3);
    expect(r.paidUsd).toBeCloseTo(5.87);
    expect(r.medianMs).toBe(1_200);
  });

  it("calls a ruling unanimous only with three matching verdicts", () => {
    const three = (a: string, b: string, c: string) => ruling({ verdicts: [verdict(a), verdict(b), verdict(c)] });
    expect(rulingRecord([three("FALSE", "FALSE", "FALSE"), three("FALSE", "TRUE", "FALSE"), ruling({ verdicts: [verdict("FALSE")] })]).unanimous).toBe(1);
  });

  it("has an honest empty state", () => {
    expect(rulingRecord([])).toEqual({ all: [], settled: [], medianMs: null, paidUsd: 0, unanimous: 0 });
  });
});

describe("median", () => {
  it("takes the middle, or the mean of the two middles", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
