// Objections on a ruling, in words: what the next one costs, what each one did, and at the end which
// bonds came back and which paid the winners. Every figure is the API's (from the chain's events).
import { describe, expect, test } from "vitest";
import { bondFate, nextBondUsd, objectionsSummary, objectionWords } from "@/lib/rulings";
import type { Dispute, Ruling } from "@/lib/server/api";

const d = (o: Partial<Dispute> = {}): Dispute => ({ who: "stranger.near", trader: "stranger.near", bond_usd: 2, round: 1, proposed: "TRUE", at: 2_000, tx: "D1", window_ends_at: 900_000, evidence: "The filing says TRUE.", result: null, paid_usd: null, ...o });

describe("the next objection's bond", () => {
  test("the API's figure, read from get_challenge", () => {
    expect(nextBondUsd({ dispute_bond_usd: 8, disputes: [d()], bond_usd: 1 })).toBe(8);
  });
  test("else twice the last bond posted", () => {
    expect(nextBondUsd({ disputes: [], bond_usd: 1 })).toBe(2);
    expect(nextBondUsd({ dispute_bond_usd: null, disputes: [d(), d({ round: 2, bond_usd: 4, proposed: "FALSE" })], bond_usd: 1 })).toBe(8);
  });
});

describe("each objection", () => {
  test("who, which way, the bond and what it did", () => {
    expect(objectionWords(d())).toBe("stranger.near says it’s true, with a $2.00 bond (twice the last). It flipped the ruling to true and opened a new window.");
    expect(objectionWords(d({ who: "the Sentinel", proposed: "FALSE" }))).toMatch(/^The Sentinel says it’s false/);
    expect(objectionWords(d({ round: 3, bond_usd: 8 }))).toMatch(/\$8\.00 bond \(twice the last\)\. The third objection sends it to the market’s council\.$/);
  });
  test("the window line", () => {
    const r = (o: Partial<Ruling>) => ({ status: "window", disputes: [], escalated: false, ...o }) as Pick<Ruling, "status" | "disputes" | "escalated">;
    expect(objectionsSummary(r({}))).toBe("open now");
    expect(objectionsSummary(r({ disputes: [d()] }))).toBe("1 filed so far, and still open");
    expect(objectionsSummary(r({ status: "settled" }))).toBe("nobody objected");
    expect(objectionsSummary(r({ status: "settled", disputes: [d(), d({ round: 2 })] }))).toBe("2 filed");
    expect(objectionsSummary(r({ status: "escalated", escalated: true, disputes: [d(), d(), d()] }))).toBe("3 filed: the market’s council decides");
  });
});

describe("at the end, which bonds were paid or lost", () => {
  test("each result in one sentence", () => {
    expect(bondFate(null, 2, null)).toBeNull();
    expect(bondFate(undefined, 2, null)).toBeNull();
    expect(bondFate("won", 4, 5.6)).toBe("Its $4.00 bond came back with $1.60 from the losing side: $5.60 in all.");
    expect(bondFate("won", 1, 1)).toBe("Its $1.00 bond came back.");
    expect(bondFate("lost", 2, null)).toBe("Its $2.00 bond paid the winning side.");
    expect(bondFate("forfeit", 1, null, "The challenger’s")).toBe("No bond was on the winning side, so the challenger’s $1.00 went to the treasury.");
    expect(bondFate("returned", 2, 2)).toBe("Its $2.00 bond came back in full.");
    expect(bondFate("won", 1, 1.4, "The challenger’s")).toBe("The challenger’s $1.00 bond came back with $0.40 from the losing side: $1.40 in all.");
  });
});
