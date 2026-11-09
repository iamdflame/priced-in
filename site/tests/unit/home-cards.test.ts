// The home page's cards and counts: card titles are short questions that never cut a word, Wikipedia fact
// cards say what the free $1 wins, the live strip reads in plain words without twins, and every count of
// facts comes from one place.
import { describe, expect, test } from "vitest";
import claimsSnap from "./fixtures/claims.json";
import { betLines, betWords, type Bet } from "@/lib/bets";
import { factCounts, isWikiFact } from "@/lib/counts";
import type { ClaimView } from "@/lib/model";
import { PICK_OR_BET, payoutWords, pickPayout, quoteClaim } from "@/lib/quote";
import { toFact } from "@/lib/server/facts";
import { clip, questionFromSentence, titleFor } from "@/lib/title";

const claims = claimsSnap.claims as ClaimView[];

describe("card titles", () => {
  test("a titled sentence keeps the planner's question", () => {
    expect(titleFor("Is DAI run by MakerDAO?", "DAI is maintained and regulated by MakerDAO.")).toBe("Is DAI run by MakerDAO?");
  });

  test("an untitled sentence becomes a question from its main clause, never a bare statement", () => {
    const q = questionFromSentence("As of November 2026, Tether has completed an audit by an accounting firm: according to Tether, on 13 August 2026 it announced that KPMG U.S. completed a full audit of its 2025 statements with an unqualified opinion, though the audit report is not public.");
    expect(q).toBe("Is it true that as of November 2026, Tether has completed an audit by an accounting firm?");
    const cap = questionFromSentence("Per the token's own contract code, checked on 2026-11-05, there is no hard cap: the contract allows a mint of up to 2% a year.");
    expect(cap).toBe("Is it true that per the token's own contract code, there is no hard cap?");
    // a name keeps its capital; a connective that leans on the sentence before goes
    expect(questionFromSentence("However, Polymarket has operated in much of Canada.")).toBe("Is it true that Polymarket has operated in much of Canada?");
  });

  test("a long sentence is cut at a word, with no dangling word, and fits three lines of a card", () => {
    const long = "Polymarket is a decentralized prediction market built on the Polygon Chain that, according to Polymarket as checked on 2026-11-05, uses pUSD, backed by USDC, as the collateral for all trading.";
    const q = questionFromSentence(long);
    expect(q.length).toBeLessThanOrEqual(90);
    expect(q).toMatch(/^Is it true that Polymarket is a decentralized prediction market built on the Polygon…\?$/);
    // every word in the title is a whole word of the sentence
    for (const w of q.replace(/^Is it true that /, "").replace(/…\?$/, "").split(" ")) expect(long).toContain(w);
  });

  test("a sentence that is already a question stays one", () => {
    expect(questionFromSentence("Is it the largest stablecoin?")).toBe("Is it the largest stablecoin?");
  });

  test("clip never cuts mid-word and marks a cut", () => {
    expect(clip("Is SpaceX buying a legacy telco for its spectrum?", 64)).toBe("Is SpaceX buying a legacy telco for its spectrum?");
    expect(clip("Is SpaceX buying a legacy telco for its spectrum?", 30)).toBe("Is SpaceX buying a legacy…");
    expect(clip("Is SpaceX buying a legacy telco for its spectrum?", 25)).toBe("Is SpaceX buying a legacy…");
    expect(clip("Supercalifragilistic", 8)).toBe("Supercal…");
  });

  test("every fact in the snapshot has a question for a title", () => {
    for (const c of claims) {
      const f = toFact(c);
      expect(f.question, `claim ${c.id}`).toMatch(/\?$/);
      expect(f.question.length, `claim ${c.id}`).toBeLessThanOrEqual(90);
    }
  });

  test("an untitled Wikipedia sentence gets a made question, not itself", () => {
    const c = { ...claims[0], id: 999, text: "Tether has been described as a stablecoin with a history of controversy over its reserves." };
    expect(toFact(c).question).toBe("Is it true that Tether has been described as a stablecoin with a history of controversy…?");
  });
});

describe("Yes and No on a Wikipedia fact card say what the free $1 wins", () => {
  const quotes = quoteClaim(claims.find((c) => c.status === "Open")!)!;
  test("a Wikipedia fact's pick carries the market page's exact words", () => {
    expect(pickPayout(quotes, "yes", true)).toBe(payoutWords(quotes.yes).right);
    expect(pickPayout(quotes, "no", true)).toMatch(/^Right: \$1 becomes \$\d+\.\d\d$/);
  });
  test("a news line's pick, which wins nothing, carries none", () => {
    expect(pickPayout(quotes, "yes", false)).toBeNull();
    expect(pickPayout(null, "yes", true)).toBeNull();
  });
  test("the line under the buttons no longer says a pick wins nothing", () => {
    expect(PICK_OR_BET).toBe("Pick free, or bet the free $1");
    expect(PICK_OR_BET).not.toMatch(/wins nothing/);
  });
});

describe("one source for the counts of facts", () => {
  const f = (page: string, topic: string, status: "open" | "settled" | "deciding" = "open", news = false) => ({ page, topic, status, news: news ? ({} as never) : null });
  const facts = [
    f("tether", "Tether"), f("tether", "Tether"), f("tether", "Tether", "settled"),
    f("prediction-market", "Prediction markets"), f("polymarket", "Prediction markets", "deciding"),
    f("news-2026-11-08", "Sports"), f("news-2026-11-09", "Tech"), f("news-2026-11-07", "Sports", "settled"),
    f("near", "NEAR", "open", true),
  ];
  test("Wikipedia facts, their topics and the news are counted apart", () => {
    const c = factCounts(facts);
    expect(c.wiki).toBe(5);
    expect(c.wikiOpen).toBe(4);
    expect(c.wikiDecided).toBe(1);
    expect(c.topics).toBe(2);
    expect(c.newsOpen).toBe(3);
  });
  test("the footer's per-page counts add up to the grid's total", () => {
    const c = factCounts(facts);
    expect(Object.values(c.byPage).reduce((a, b) => a + b, 0)).toBe(c.wiki);
    expect(c.byPage).toEqual({ tether: 3, "prediction-market": 1, polymarket: 1 });
  });
  test("the snapshot: 9 topics, as many as the home page's topic tabs", () => {
    const all = claims.map((c) => toFact(c));
    const c = factCounts(all);
    expect(c.topics).toBe(new Set(all.filter(isWikiFact).map((x) => x.topic)).size);
    expect(c.topics).toBe(9);
  });
});

describe("the live strip", () => {
  const bet = (o: Partial<Bet>): Bet => ({ claimId: 15, who: "The Archivist", kind: "agent", trader: "a.near", side: "no", usd: 0.12, shares: 0.2, free: false, priceBefore: 0.5, priceAfter: 0.45, at: 1, tx: "t", ...o });
  test("twin bets become one line that says how many", () => {
    const lines = betLines([bet({ tx: "a" }), bet({ tx: "b" }), bet({ claimId: 43, side: "yes", tx: "c" }), bet({ tx: "d", usd: 0.121 })]);
    expect(lines).toHaveLength(2);
    expect(lines[0].times).toBe(3);
    expect(betWords(lines[0])).toBe("bet $0.12 3 times that it’s");
    expect(betWords(lines[1])).toBe("bet $0.12 that it’s");
    expect(betWords(betLines([bet({}), bet({})])[0])).toBe("bet $0.12 twice that it’s");
  });
  test("a free bet says so", () => {
    expect(betWords(betLines([bet({ free: true, kind: "visitor", who: "Someone" })])[0])).toBe("bet the free $1 that it’s");
  });
});
