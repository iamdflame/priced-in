// The curated lead and the grid's first row, on the claims snapshot and on made-up activity.
import { describe, expect, test } from "vitest";
import claimsSnap from "./fixtures/claims.json";
import { feedOrder, leadFact, LEAD_ORDER } from "@/lib/lead";
import type { ClaimView, Fact } from "@/lib/model";
import { toFact } from "@/lib/server/facts";

const facts: Fact[] = (claimsSnap.claims as ClaimView[]).map((c) => toFact(c));
const withBets = (ids: number[]) => facts.map((f) => (ids.includes(f.id) ? { ...f, trades: 3 } : { ...f, trades: 0 }));

describe("the lead", () => {
  test("the first open fact in the curated list when nobody has bet", () => {
    expect(leadFact(withBets([]))?.id).toBe(LEAD_ORDER[0]);
  });
  test("a listed fact with bets goes ahead of one without", () => {
    expect(leadFact(withBets([29]))?.id).toBe(29);
    expect(leadFact(withBets([29, 31]))?.id).toBe(31);
  });
  test("bets on an unlisted fact don't take the lead", () => {
    expect(leadFact(withBets([1]))?.id).toBe(LEAD_ORDER[0]);
  });
  test("a settled fact never leads", () => {
    const settled = facts.map((f) => (f.id === LEAD_ORDER[0] ? { ...f, status: "settled" as const, quotes: null } : { ...f, trades: 0 }));
    expect(leadFact(settled)?.id).toBe(LEAD_ORDER[1]);
  });
});

describe("the grid", () => {
  test("the first row is four different topics, the lead's own last, and nothing is lost", () => {
    const lead = leadFact(facts)!;
    const feed = feedOrder(facts, lead);
    const row = feed.slice(0, 4).map((f) => f.topic);
    expect(new Set(row).size).toBe(4);
    expect(row).not.toContain(lead.topic);
    expect(feed.map((f) => f.id)).not.toContain(lead.id);
    expect(feed).toHaveLength(facts.length - 1);
  });
  test("results come last", () => {
    const feed = feedOrder(facts, null);
    const firstSettled = feed.findIndex((f) => f.status === "settled");
    expect(feed.slice(firstSettled).every((f) => f.status === "settled")).toBe(true);
  });
});
