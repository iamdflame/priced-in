// What the home and the money path decide from the API's lines: which line leads, what a card may take, how a
// source reads, and that a challenge's evidence is in the shape the jury runner checks.
import { describe, expect, it } from "vitest";
import { arrange, blockArt, boardScore, claimParts, headlineOf, isNewsPage, NEWS_ART, newsArt, outletOf, pickableOrWhy, refusalWords, shortDate, type TodayLine } from "@/lib/news";
import { checkChallenge } from "@/lib/money/rules";
import { challengeEvidence, challengeTx } from "@/lib/money/tx";
import { moneyConfig } from "@/lib/money/config";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const DAY = 86_400_000;
const line = (o: Partial<TodayLine> & { claim_id: number }): TodayLine => ({
  section: "today", status: "open", overdue: false, trades: 0, opened_at: NOW - DAY, decided_at: null,
  picks: { yes: 0, no: 0, total: 0 }, settles: { due_at: NOW + 3 * DAY }, ...o,
} as unknown as TodayLine);
const due = (at: number) => ({ due_at: at }) as TodayLine["settles"];

describe("arrange", () => {
  it("leads with the line most people picked or bet on", () => {
    const a = arrange([line({ claim_id: 1 }), line({ claim_id: 2, trades: 3 }), line({ claim_id: 3, picks: { yes: 2, no: 2, total: 4 } as TodayLine["picks"] })], NOW);
    expect(a.lead?.claim_id).toBe(3);
    expect(a.cards.map((l) => l.claim_id)).toEqual([2, 1]);
  });

  it("with no picks or bets yet, keeps the scout's own order", () => {
    const a = arrange([line({ claim_id: 7, opened_at: NOW - 100 }), line({ claim_id: 9, opened_at: NOW - 300 }), line({ claim_id: 8, opened_at: NOW - 200 })], NOW);
    expect([a.lead, ...a.cards].map((l) => l?.claim_id)).toEqual([9, 8, 7]);
  });

  it("falls back to earlier days' lines when today has none, and an empty day has no lead", () => {
    expect(arrange([line({ claim_id: 4, section: "settling" })], NOW).lead?.claim_id).toBe(4);
    expect(arrange([], NOW)).toEqual({ lead: null, cards: [], next: [], decided: [] });
  });

  it("keeps a line past its date, overdue or ruling out of the cards, and lists it as settling", () => {
    const a = arrange([
      line({ claim_id: 1 }),
      line({ claim_id: 2, overdue: true, settles: due(NOW - DAY) }),
      line({ claim_id: 3, settles: due(NOW - 1) }),
      line({ claim_id: 4, status: "ruling" }),
    ], NOW);
    expect(a.lead?.claim_id).toBe(1);
    expect(a.cards).toEqual([]);
    expect(a.next.map((l) => l.claim_id)).toEqual([2, 3, 4]);
  });

  it("puts the overflow in the settling list by date, and the decided newest first", () => {
    const a = arrange([
      ...[1, 2, 3].map((id) => line({ claim_id: id })),
      line({ claim_id: 4, settles: due(NOW + DAY) }),
      line({ claim_id: 5, status: "decided", decided_at: NOW - 2 * DAY }),
      line({ claim_id: 6, status: "decided", decided_at: NOW - DAY }),
    ], NOW, 1);
    expect(a.cards).toHaveLength(1);
    expect(a.next.map((l) => l.claim_id)).toEqual([4, 3]);
    expect(a.decided.map((l) => l.claim_id)).toEqual([6, 5]);
  });
});

describe("a line's words", () => {
  it("says why it takes no picks, or nothing", () => {
    expect(pickableOrWhy(line({ claim_id: 1 }), NOW)).toBeNull();
    expect(pickableOrWhy(line({ claim_id: 1, status: "decided" }), NOW)).toContain("decided");
    expect(pickableOrWhy(line({ claim_id: 1, status: "ruling" }), NOW)).toContain("Three AI judges");
    expect(pickableOrWhy(line({ claim_id: 1, overdue: true }), NOW)).toContain("Its date has passed");
    expect(pickableOrWhy(line({ claim_id: 1, settles: due(NOW) }), NOW)).toContain("Its date has passed");
  });

  it("drops the outlet Google News appends, and finds it there when the source doesn't say", () => {
    const s = { headline: "Tesla Is Ending the Model S - The New York Times", url: "https://x", outlet: "The New York Times", published_at: null };
    expect(headlineOf(s)).toBe("Tesla Is Ending the Model S");
    expect(headlineOf({ ...s, outlet: null })).toBe("Tesla Is Ending the Model S");
    expect(outletOf({ ...s, outlet: null })).toBe("The New York Times");
    expect(headlineOf({ ...s, headline: "No outlet here" })).toBe("No outlet here");
    expect(headlineOf(null)).toBeNull();
  });

  it("writes a date plainly and knows a news page", () => {
    expect(shortDate("2026-11-14")).toBe("14\u00a0Nov");
    expect(shortDate("soon")).toBe("soon");
    expect(isNewsPage("news-2026-11-07")).toBe(true);
    expect(isNewsPage("Tether")).toBe(false);
    expect(newsArt("Football")).toBe("football");
    expect(newsArt("Something new")).toBe("corp");
  });
});

describe("each topic's objects", () => {
  it("never shows the same object twice in a block while its topic has another", () => {
    // the first live run: four Sports claims at once
    const four = [39, 40, 41, 42].map((claim_id) => ({ claim_id, topic: "Sports" }));
    expect([...blockArt(four).values()]).toEqual(["sports", "podium", "stopwatch", "sports"]);
    const mixed = blockArt([{ claim_id: 1, topic: "Tech" }, { claim_id: 2, topic: "Football" }, { claim_id: 3, topic: "Tech" }, { claim_id: 4, topic: "Nope" }]);
    expect([...mixed.values()]).toEqual(["tech", "football", "laptop", "corp"]);
    // a block on its own starts again from each topic's first object
    expect(blockArt([{ claim_id: 5, topic: "Tech" }]).get(5)).toBe("tech");
  });

  it("gives every scout topic at least two objects, each once, with a file in both sets", async () => {
    const { existsSync } = await import("node:fs");
    const names = Object.values(NEWS_ART).flat();
    expect(new Set(names).size).toBe(names.length);
    for (const [topic, set] of Object.entries(NEWS_ART)) {
      expect(set.length, topic).toBeGreaterThanOrEqual(2);
      for (const n of set) {
        expect(existsSync(`public/art/${n}.webp`), `dark ${n}`).toBe(true);
        expect(existsSync(`public/art/light/${n}.webp`), `light ${n}`).toBe(true);
      }
    }
  });
});

describe("what Yes means", () => {
  it("keeps the claim's deadline and rule, and moves who doesn't count to the small print", () => {
    expect(claimParts("By 14 November 2026, NC State officially confirms Philip Rivers as its next head football coach. Reports citing unnamed sources don't count.")).toEqual({
      yes: "By 14 November 2026, NC State officially confirms Philip Rivers as its next head football coach.",
      fine: "Reports citing unnamed sources don't count.",
    });
    expect(claimParts("By 14 November 2026, Anthropic or a filing confirms it is pressing ahead with an IPO targeting a $1.5tn valuation. Reports citing unnamed sources don’t count.").yes)
      .toBe("By 14 November 2026, Anthropic or a filing confirms it is pressing ahead with an IPO targeting a $1.5tn valuation.");
    expect(claimParts("By 1 December 2026, U.S. officials confirm the deal.")).toEqual({ yes: "By 1 December 2026, U.S. officials confirm the deal.", fine: null });
    // a claim that is only small print stays the claim
    expect(claimParts("Reports citing unnamed sources don't count.").yes).toBe("Reports citing unnamed sources don't count.");
  });
});

describe("a refusal's words", () => {
  it("lose the developer's pointer and nothing else", () => {
    const m = "Our Checker puts up its own money only on official sites and established news outlets. With another page, challenge it yourself with your own bond";
    expect(refusalWords(`${m}: GET /api/challenge?claim=7.`)).toBe(`${m}.`);
    expect(refusalWords("Someone already has that nickname. Pick another.")).toBe("Someone already has that nickname. Pick another.");
  });
});

describe("the board's score", () => {
  it("is the balance and what the bets are worth", () => {
    expect(boardScore({ balance_usd: 1.2, positions: [{ value_usd: 0.3 }, { value_usd: null }] })).toBeCloseTo(1.5, 6);
    expect(boardScore({ balance_usd: 0, positions: [{ value_usd: 0 }] })).toBe(0);
  });

  it("is nothing until the free $1 has been bet", () => {
    expect(boardScore({ balance_usd: 1, positions: [] })).toBeNull();
    expect(boardScore({ balance_usd: null, positions: [] })).toBeNull();
  });
});

describe("a challenge with your own bond", () => {
  const receipt = { url: "https://example.org/page", quote: "the words on that page" };

  it("writes the page and its words the way the jury runner checks them", () => {
    expect(challengeEvidence({ says: "false", ...receipt, note: "" })).toBe('This line is FALSE.\nSource: https://example.org/page\nReceipt excerpt: "the words on that page"');
    expect(challengeEvidence({ says: "true", url: " https://a.b/c ", quote: 'he said\n  "yes" twice', note: "Already confirmed." })).toBe("Already confirmed.\nSource: https://a.b/c\nReceipt excerpt: \"he said 'yes' twice\"");
  });

  it("is one call on the market, and refuses empty evidence", () => {
    const tx = challengeTx(moneyConfig(), 18, false, "evidence", 1_000_000n);
    expect(tx.receiverId).toBe(moneyConfig().market);
    expect(tx.actions).toHaveLength(1);
    expect(tx.actions[0]).toMatchObject({ method: "challenge", args: { claim_id: 18, claimed_outcome: false, evidence: "evidence" } });
    expect(tx.says).toContain("$1.00 bond");
    expect(() => challengeTx(moneyConfig(), 18, false, "  ", 1_000_000n)).toThrow();
  });

  it("is refused for a closed line, a weak receipt or too small a balance", () => {
    const access = "open" as Parameters<typeof checkChallenge>[3];
    expect(checkChallenge(1_000_000n, 5_000_000n, "Open", access, receipt)).toBeNull();
    expect(checkChallenge(1_000_000n, 5_000_000n, "Settled", access, receipt)).toContain("settled");
    expect(checkChallenge(1_000_000n, 5_000_000n, "Challenged", access, receipt)).toContain("already running");
    expect(checkChallenge(1_000_000n, 5_000_000n, "Open", access, { ...receipt, url: "http://example.org/page" })).toContain("https://");
    expect(checkChallenge(1_000_000n, 5_000_000n, "Open", access, { ...receipt, quote: "two words" })).toContain("three words");
    expect(checkChallenge(1_000_000n, 500_000n, "Open", access, receipt)).toContain("Deposit first");
  });
});
