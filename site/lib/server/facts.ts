// Builds Facts: a claim view joined with its question (data/questions.json, keyed by sha256 of the exact
// sentence) and its art direction (data/catalog.json). Server-only, so neither file reaches the browser.
import "server-only";
import { createHash } from "node:crypto";
import catalogJson from "@/data/catalog.json";
import questionsJson from "@/data/questions.json";
import { liveNumbers, type Caught, type ClaimView, type Fact } from "../model";
import { isNewsPage, newsArt } from "../news";

interface CatalogEntry { page: string; topic: string; article: string; icon: string; art: string; short: string; caught: Caught | null }
interface WikiPage { title: string; url: string; attribution: string }

const CATALOG: Record<string, CatalogEntry> = catalogJson.claims;
const PAGES: Record<string, WikiPage> = catalogJson.pages;
const QUESTIONS: Record<string, { q: string }> = questionsJson.questions;

/** The planner's short question for a sentence. A sentence nobody has titled yet shows as itself. */
export function questionFor(text: string): string | null {
  return QUESTIONS[createHash("sha256").update(text).digest("hex")]?.q ?? null;
}

/** The Wikipedia article (and the exact revision) a page's sentences were read from. */
export function wikiOf(page: string): { title: string; url: string; attribution: string | null } {
  return PAGES[page] ?? { title: page, url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(page)}`, attribution: null };
}

/**
 * A claim's look. A corrected sentence keeps the look of the sentence it replaced, with nothing left
 * to doubt; a claim the catalog hasn't met yet takes its page's look.
 */
export function catalogFor(id: number, page: string, correctionOf: number | null = null): CatalogEntry {
  const hit = CATALOG[String(id)];
  if (hit) return hit;
  const was = correctionOf === null ? undefined : CATALOG[String(correctionOf)];
  if (was) return { ...was, short: `${was.short} (corrected)`, caught: null };
  const same = Object.values(CATALOG).find((c) => c.page === page);
  const topic = page.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return { page, topic: same?.topic ?? topic, article: same?.article ?? topic, icon: same?.icon ?? `mono:${topic.slice(0, 2)}`, art: same?.art ?? "reserves", short: same?.topic ?? topic, caught: null };
}

/** A line from today's news: its question, topic and art come from the scout, not the catalog. With the
 *  API's news off, a news page carries no `news` field: the sentence stands as its own question. */
function newsFact(c: ClaimView, openPpm: number | null): Fact {
  const n = c.news ?? null;
  const topic = n?.topic ?? "News";
  const question = n?.question ?? c.text;
  return {
    id: c.id,
    text: c.text,
    question,
    page: c.page,
    topic,
    article: n?.source?.outlet ?? "the news",
    icon: `news:${topic.toLowerCase()}`,
    art: newsArt(topic),
    short: question.length > 44 ? `${question.slice(0, 42).replace(/\s+\S*$/, "")}…` : question,
    caught: null,
    openPrice: openPpm === null ? (n ? n.first_estimate : null) : openPpm / 1e6,
    ...liveNumbers(c),
    news: n ? { why: n.why, source: n.source, settles: n.settles, firstEstimate: n.first_estimate, openedAt: n.opened_at } : null,
  };
}

export function toFact(c: ClaimView, openPpm: number | null = null, correctionOf: number | null = null): Fact {
  if (c.news || isNewsPage(c.page)) return newsFact(c, openPpm);
  const cat = catalogFor(c.id, c.page, correctionOf);
  return {
    id: c.id,
    text: c.text,
    question: questionFor(c.text) ?? c.text,
    page: c.page,
    topic: cat.topic,
    article: cat.article,
    icon: cat.icon,
    art: cat.art,
    short: cat.short,
    caught: cat.caught,
    openPrice: openPpm === null ? null : openPpm / 1e6,
    ...liveNumbers(c),
    news: null,
  };
}
