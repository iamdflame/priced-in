// The ruling record's rules, on a snapshot of /api/rulings with three settled rulings: counts come from
// the data, and the lead is never a fact nobody bet on.
import { describe, expect, test } from "vitest";
import claimsSnap from "./fixtures/claims.json";
import rulingsSnap from "./fixtures/rulings.json";
import { correctionsOf, leadRuling, settledRulings, verdictOf, winningSide } from "@/lib/rulings";
import type { Ruling } from "@/lib/server/api";

const rulings = rulingsSnap.rulings as unknown as Ruling[];
const trades = new Map(claimsSnap.claims.map((c) => [c.id, c.trades]));
const betsOn = (id: number) => trades.get(id) ?? 0;

describe("rulings", () => {
  test("settled rulings come newest first, and count what the API says", () => {
    const s = settledRulings(rulings);
    expect(s).toHaveLength(rulings.filter((r) => r.status === "settled").length);
    for (let i = 1; i < s.length; i++) expect(s[i - 1].settled_at!).toBeGreaterThanOrEqual(s[i].settled_at!);
  });
  test("the lead is the ruling with the most real bets: claim 18, not the newest", () => {
    expect(settledRulings(rulings)[0].claim_id).not.toBe(18);
    expect(leadRuling(rulings, betsOn)?.claim_id).toBe(18);
  });
  test("a ruling nobody bet on never leads", () => {
    expect(leadRuling(rulings, () => 0)).toBeNull();
  });
  test("a verdict names the side that gets paid", () => {
    expect(verdictOf({ outcome: "FALSE", provisional: null })).toBe("FALSE");
    expect(verdictOf({ outcome: null, provisional: "TRUE" })).toBe("TRUE");
    expect(winningSide("FALSE")).toBe("No");
    expect(winningSide("TRUE")).toBe("Yes");
  });
  test("each corrected claim points back at the claim it replaced", () => {
    expect(correctionsOf(rulings).get(32)).toBe(18);
  });
});
