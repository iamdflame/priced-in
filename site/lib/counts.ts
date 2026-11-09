// The site's counts of facts, from one place, so the home page's numbers, its tabs, its "See all" and the
// footer's topics always agree. Each says what it counts: Wikipedia facts are the sentences the grid and
// the footer list (decided ones included); today's news lines are counted apart.
import { isNewsPage } from "./news";
import type { Fact } from "./model";

export interface FactCounts {
  /** every Wikipedia fact on the market, decided ones included: the grid's "See all" and the footer's sum */
  wiki: number;
  /** of those, the ones still taking bets */
  wikiOpen: number;
  /** of those, the ones three AI judges have decided */
  wikiDecided: number;
  /** topics among the Wikipedia facts: one per topic tab */
  topics: number;
  /** today's news lines still taking bets */
  newsOpen: number;
  /** Wikipedia facts per article page (the footer's "22 facts & odds"); they add up to `wiki` */
  byPage: Record<string, number>;
}

/** A news line is never a Wikipedia fact, whatever the API says about news. */
export const isWikiFact = (f: Pick<Fact, "news" | "page">) => !f.news && !isNewsPage(f.page);

export function factCounts(facts: Pick<Fact, "news" | "page" | "topic" | "status">[]): FactCounts {
  const wiki = facts.filter(isWikiFact);
  const byPage: Record<string, number> = {};
  for (const f of wiki) byPage[f.page] = (byPage[f.page] ?? 0) + 1;
  return {
    wiki: wiki.length,
    wikiOpen: wiki.filter((f) => f.status !== "settled").length,
    wikiDecided: wiki.filter((f) => f.status === "settled").length,
    topics: new Set(wiki.map((f) => f.topic)).size,
    newsOpen: facts.filter((f) => !isWikiFact(f) && f.status !== "settled").length,
    byPage,
  };
}
