// The official pages as the site shows them, from real answers of the page API (tests/unit/fixtures/page-*.json:
// the API's own api/_lib/pages.mjs over live data and a real signed sweep): what the article ships, how its
// sections read, what each mark says, and that nothing claims a view the market doesn't have.
import { describe, expect, it } from "vitest";
import tether from "./fixtures/page-tether.json";
import near from "./fixtures/page-near.json";
import { dateWords, groupsOf, pageMood, pricesWords, shortDiff, slimPage, writtenWords, type OfficialPage, type SlimLine } from "@/lib/pages";
import { markOf } from "@/components/pages/MarketArticle";

const T = tether as unknown as OfficialPage;
const N = near as unknown as OfficialPage;

describe("what the article ships", () => {
  it("keeps every paragraph and sentence, in order, with the market's words", () => {
    for (const page of [T, N]) {
      const slim = slimPage(page);
      expect(slim.map((p) => [p.index, p.section])).toEqual(page.paragraphs.map((p) => [p.index, p.section]));
      slim.forEach((p, i) => expect(p.lines.map((l) => l.text)).toEqual(page.paragraphs[i].sentences.map((s) => s.text)));
    }
  });

  it("sends Wikipedia's words only where they differ, so both views rebuild exactly", () => {
    const slim = slimPage(T);
    slim.forEach((p, i) => {
      const api = T.paragraphs[i];
      expect(p.lines.map((l) => l.text).join(" ")).toBe(api.market);
      if (api.wikipedia !== null) expect(p.lines.map((l) => l.wiki ?? l.text).join(" ")).toBe(api.wikipedia);
      p.lines.forEach((l) => { if (l.wiki !== undefined) expect(l.wiki).not.toBe(l.text); });
    });
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(T.paragraphs).length / 2);
  });

  it("gives a changed paragraph its diff and proof, and an unchanged one neither", () => {
    const slim = slimPage(T);
    for (const [i, p] of slim.entries()) {
      const api = T.paragraphs[i];
      expect(Boolean(p.diff), `paragraph ${p.index}`).toBe(Boolean(api.changed && api.diff));
      if (!api.changed) expect(p.proofs).toBeUndefined();
    }
    const first = slim[0].proofs![0];
    expect(first.model).toBe("z-ai/glm-5.3-flash");
    expect(first.signed).toBe("signed");
    expect(first.correction).toBe(false);
    expect(first.prices.every((x) => x > 0 && x < 1)).toBe(true);
    // the T-Bills line, ruled false: its correction speaks in its place, written by an anchored rewrite
    const fixed = slim.find((p) => p.lines.some((l) => l.by === "correction" && /122\.84/.test(l.text)))!;
    const line = fixed.lines.find((l) => l.by === "correction")!;
    expect(line.wiki).toMatch(/\$72\.6 billion/);
    expect(line.text).toMatch(/\$122\.84 billion/);
    expect(line.ruled).toBeTypeOf("number");
    expect(fixed.rulings?.[0].outcome).toBe("false");
    const proof = fixed.proofs!.find((r) => r.correction)!;
    expect(proof.tx).toBeTruthy();
    expect(proof.explorer).toMatch(/^https:\/\/nearblocks\.io\/txns\//);
  });

  it("a thin page: one priced sentence, written from its odds, the rest Wikipedia's", () => {
    const slim = slimPage(N);
    const priced = slim.flatMap((p) => p.lines).filter((l) => l.claim);
    expect(priced).toHaveLength(1);
    expect(priced[0].by).toBe("ai");
    expect(priced[0].wiki).toBe("It was founded in 2018 by Illia Polosukhin and Alexander Skidanov, with mainnet launching in 2020.");
    expect(slim.flatMap((p) => p.lines).filter((l) => !l.claim).every((l) => l.by === "wikipedia" && l.wiki === undefined)).toBe(true);
    expect(writtenWords(N.totals)).toBe("1 of 6 paragraphs written by AI");
  });
});

describe("sections", () => {
  it("a section path is a heading and a subheading, each heading once", () => {
    const g = groupsOf([{ section: "" }, { section: "" }, { section: "History / Creation" }, { section: "History / 2015–2016" }, { section: "History / 2015–2016" }, { section: "Reserves" }]);
    expect(g.map((x) => [x.top, x.sub, x.first, x.paragraphs.length])).toEqual([["", "", true, 2], ["History", "Creation", true, 1], ["History", "2015–2016", false, 2], ["Reserves", "", true, 1]]);
    expect(g[1].id).toBe("history");
    const ids = groupsOf(T.paragraphs).filter((x) => x.first && x.top).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("words", () => {
  it("cuts long unchanged stretches and keeps every change", () => {
    const long = "word ".repeat(80);
    const d = shortDiff([{ op: "eq", text: long }, { op: "del", text: "old " }, { op: "ins", text: "new " }, { op: "eq", text: long }]);
    expect(d[0].text.startsWith("…")).toBe(true);
    expect(d[0].text.length).toBeLessThan(90);
    expect(d[1]).toEqual({ op: "del", text: "old " });
    expect(d[2]).toEqual({ op: "ins", text: "new " });
    expect(d[3].text.endsWith("…")).toBe(true);
    expect(shortDiff([{ op: "eq", text: "short " }])).toEqual([{ op: "eq", text: "short " }]);
  });

  it("prices, shares and dates in plain words", () => {
    expect(pricesWords([0.812063])).toBe("81%");
    expect(pricesWords([0.81, 0.79])).toBe("81% and 79%");
    expect(pricesWords([0.81, 0.79, 0.6])).toBe("81%, 79% and 60%");
    expect(writtenWords({ written_by_ai: 0, paragraphs: 61 })).toBe("No paragraph written by AI yet");
    expect(writtenWords({ written_by_ai: 1, paragraphs: 1 })).toBe("1 of 1 paragraph written by AI");
    expect(dateWords("2026-10-30T17:27:49Z")).toBe("30 October 2026");
  });

  it("a page says it was written by AI only when it was, and never claims bets on a page with no market", () => {
    expect(pageMood(T.totals)).toBe("written");
    expect(pageMood({ written_by_ai: 0, facts_priced: 1 })).toBe("unbet");
    expect(pageMood({ written_by_ai: 0, facts_priced: 0 })).toBe("unpriced");
  });
});

describe("what each mark says", () => {
  const line = (o: Partial<SlimLine> & { claim: SlimLine["claim"] }): SlimLine => ({ text: "A line.", by: "ai", ...o });
  const open = { id: 7, price: 0.62, trades: 2, decided: false, outcome: null };

  it("a traded line: its % and what it means", () => {
    expect(markOf(line({ claim: open }), "market")).toMatchObject({ id: 7, sup: "62%", said: "62% chance it’s true", cls: "" });
  });

  it("a line nobody has bet on says so, and never shows the estimate as the market's view", () => {
    const m = markOf(line({ by: "wikipedia", claim: { ...open, trades: 0, price: 0.5 } }), "market");
    expect(m.sup).toBe("No bets");
    expect(m.said).toMatch(/No bets yet; our AI’s starting estimate is 50%/);
    expect(m.cls).toBe("unbet");
  });

  it("decided lines read as decided, in both views", () => {
    const yes = { ...open, decided: true, outcome: "true" as const };
    const no = { ...open, decided: true, outcome: "false" as const };
    expect(markOf(line({ by: "ruling", claim: yes }), "market")).toMatchObject({ sup: "Ruled true", h: 1 });
    expect(markOf(line({ by: "ruling", claim: yes }), "wikipedia")).toMatchObject({ sup: "Ruled true", h: 1 });
    expect(markOf(line({ by: "ruling", claim: no }), "market")).toMatchObject({ sup: "Ruled false", h: 0, cls: "decided" });
    expect(markOf(line({ by: "ai", claim: no }), "market")).toMatchObject({ sup: "Corrected", cls: "new" });
    expect(markOf(line({ by: "ai", claim: no }), "wikipedia")).toMatchObject({ sup: "Ruled false", cls: "gone" });
  });

  it("in Wikipedia's words, a replaced line is the original, struck, and opens its own ruling", () => {
    const replaced = line({ by: "correction", ruled: 18, claim: { ...open, id: 32, trades: 0 } });
    expect(markOf(replaced, "wikipedia")).toMatchObject({ id: 18, sup: "Ruled false", cls: "gone" });
    expect(markOf(replaced, "market")).toMatchObject({ id: 32, sup: "No bets" });
  });
});
