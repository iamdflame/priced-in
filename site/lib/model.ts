// The view model: a claim from the API, joined with its plain question (data/questions.json, keyed by
// sha256 of the exact sentence), its art direction (data/catalog.json) and its exact $1 quote.
// Everything here is serializable, so server components hand it to client components as is.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import catalogJson from "@/data/catalog.json";
import questionsJson from "@/data/questions.json";
import type { Claim } from "./core/api";
import { quoteClaim, type Quotes } from "./quote";

export interface Caught {
  today: string;
  onPage: string;
  source: string;
  label: string;
  checked: string;
  /** one line for cards: "140+ countries (Kalshi, Oct 2025)" */
  line: string | null;
}

interface CatalogEntry { page: string; topic: string; article: string; icon: string; art: string; name: string; caught: Caught | null }
const CATALOG = (catalogJson as { claims: Record<string, CatalogEntry> }).claims;
const PAGES = (catalogJson as unknown as { pages: Record<string, { title: string; url: string; attribution: string }> }).pages;

/** The Wikipedia article (and the exact revision) a page's sentences were read from. */
export function wikiOf(page: string): { title: string; url: string; attribution: string | null } {
  return PAGES[page] ?? { title: page, url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(page)}`, attribution: null };
}
const QUESTIONS = (questionsJson as { questions: Record<string, { q: string }> }).questions;

export type FactStatus = "open" | "deciding" | "settled";

export interface Fact {
  id: number;
  /** the sentence the market prices, word for word */
  text: string;
  /** a short Yes/No question for the sentence */
  question: string;
  page: string;
  topic: string;
  article: string;
  icon: string;
  art: string;
  /** "Tether's T-Bills fact", for live sentences */
  name: string;
  caught: Caught | null;
  status: FactStatus;
  /** chain status: Open, Challenged, Escalated, Settled */
  chainStatus: string;
  outcome: boolean | null;
  provisional: boolean | null;
  /** chance it's true, 0..1 */
  price: number;
  /** the opening price (the planner AI's starting estimate, or the reopening price) */
  openPrice: number | null;
  trades: number;
  volumeUsd: number;
  quotes: Quotes | null;
  challengeId: number | null;
  feeBps: number;
}

export const sentenceKey = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

export function questionFor(text: string): string | null {
  return QUESTIONS[sentenceKey(text)]?.q ?? null;
}

/** Topic art and labels for a claim; a claim the catalog doesn't know gets its page's look. */
export function catalogFor(id: number, page: string): CatalogEntry {
  const hit = CATALOG[String(id)];
  if (hit) return hit;
  const same = Object.values(CATALOG).find((c) => c.page === page);
  const topic = page.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return { page, topic: same?.topic ?? topic, article: same?.article ?? topic, icon: same?.icon ?? "mono:" + topic.slice(0, 2), art: same?.art ?? "reserves", name: "a fact", caught: null };
}

export const statusOf = (c: Pick<Claim, "status">): FactStatus => (c.status === "Settled" ? "settled" : c.status === "Open" ? "open" : "deciding");

export function toFact(c: Claim, openPpm: number | null = null): Fact {
  const cat = catalogFor(c.id, c.page);
  const status = statusOf(c);
  return {
    id: c.id,
    text: c.text,
    question: questionFor(c.text) ?? c.text,
    page: c.page,
    topic: cat.topic,
    article: cat.article,
    icon: cat.icon,
    art: cat.art,
    name: cat.name,
    caught: cat.caught,
    status,
    chainStatus: c.status,
    outcome: c.outcome,
    provisional: c.provisional,
    price: c.price_yes_ppm / 1e6,
    openPrice: openPpm === null ? null : openPpm / 1e6,
    trades: c.trades,
    volumeUsd: c.volume_usd ?? Number(c.volume_micro) / 1e6,
    quotes: status === "open" ? quoteClaim(c as any) : null,
    challengeId: c.challenge_id ?? null,
    feeBps: Number((c as any).fee_bps ?? 0),
  };
}

/** Topics in the order the tabs show them, with how many live facts each has. */
export function topicsOf(facts: Fact[]): { topic: string; n: number }[] {
  const by = new Map<string, number>();
  for (const f of facts) by.set(f.topic, (by.get(f.topic) ?? 0) + 1);
  return [...by.entries()].map(([topic, n]) => ({ topic, n })).sort((a, b) => b.n - a.n || a.topic.localeCompare(b.topic));
}

/** What the % means, in words, and whose number it is. */
export function priceWords(f: Pick<Fact, "price" | "trades" | "openPrice" | "status" | "outcome">, reopened = false): { means: string; whose: string; firstRead: boolean } {
  if (f.status === "settled") return { means: "chance it’s true, when it was decided", whose: `Decided: ${f.outcome ? "true" : "false"}`, firstRead: false };
  if (f.trades === 0) {
    const open = Math.round((f.openPrice ?? f.price) * 100);
    return { means: "chance it’s true", whose: reopened ? `No bets yet · reopened at ${open}%` : `No bets yet · our AI’s starting estimate: ${open}%`, firstRead: !reopened };
  }
  if (f.openPrice === null) return { means: "chance it’s true", whose: `after ${f.trades === 1 ? "1 bet" : `${f.trades} bets`}`, firstRead: false };
  const d = Math.round(f.price * 100) - Math.round(f.openPrice * 100);
  return { means: "chance it’s true", whose: d === 0 ? `same as the start (${Math.round(f.openPrice * 100)}%)` : `${d < 0 ? "down" : "up"} from ${Math.round(f.openPrice * 100)}% at the start`, firstRead: false };
}
