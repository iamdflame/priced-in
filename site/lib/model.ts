// The view model every screen shares. A Fact is a claim from the API, joined with its plain question,
// its art direction and its exact $1 quote; lib/server/facts.ts builds it. This module holds only what
// the browser needs too: the types, the words for a %, and refreshing a Fact's numbers from a new view.
// Facts are serializable, so server components hand them to client components as they are.
import type { Claim } from "./core/api";
import type { ClaimMarket } from "./core/lmsr";
import type { NewsField, NewsSettles, NewsSource } from "./news";
import { quoteClaim, type Quotes } from "./quote";

/** A claim as the market contract's v3 views give it, with the exact market behind its price. A news
 *  line also carries `news` when the API has today's claims on (docs/API.md). */
export type ClaimView = Claim & ClaimMarket & { news?: NewsField | null };

/** What a news line adds to a Fact: where it came from and how it settles. */
export interface NewsMeta {
  why: string;
  source: NewsSource | null;
  settles: NewsSettles;
  firstEstimate: number;
  openedAt: number;
}

export interface Caught {
  today: string;
  onPage: string;
  source: string;
  label: string;
  checked: string;
  /** one line for cards: "140+ countries (Kalshi, Oct 2025)" */
  line: string | null;
}

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
  /** "Tether T-Bills $72.6B": a label that reads on its own */
  short: string;
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
  /** null once settled: the contract takes no more bets */
  quotes: Quotes | null;
  challengeId: number | null;
  feeBps: number;
  /** a bounty held on the line, paid to the first challenger proven right (bounty_micro) */
  bountyUsd: number;
  /** a line from today's news, or null for a Wikipedia sentence */
  news: NewsMeta | null;
}

export const statusOf = (c: Pick<Claim, "status">): FactStatus => (c.status === "Settled" ? "settled" : c.status === "Open" ? "open" : "deciding");

/** The numbers of a Fact from a claim view: everything that changes while a page is open. */
export function liveNumbers(c: ClaimView): Pick<Fact, "status" | "chainStatus" | "outcome" | "provisional" | "price" | "trades" | "volumeUsd" | "quotes" | "challengeId" | "feeBps" | "bountyUsd"> {
  const status = statusOf(c);
  return {
    status,
    chainStatus: c.status,
    outcome: c.outcome,
    provisional: c.provisional,
    price: c.price_yes_ppm / 1e6,
    trades: c.trades,
    volumeUsd: c.volume_usd ?? Number(c.volume_micro) / 1e6,
    // the contract refuses a bet only once a claim is settled: a challenged fact can still be bet on
    quotes: status === "settled" ? null : quoteClaim(c),
    challengeId: c.challenge_id ?? null,
    feeBps: Number(c.fee_bps ?? 0),
    bountyUsd: Number(c.bounty_micro ?? 0) / 1e6,
  };
}

/** Topics in the order the tabs show them, with how many facts each has. */
export function topicsOf(facts: Fact[]): { topic: string; n: number }[] {
  const by = new Map<string, number>();
  for (const f of facts) by.set(f.topic, (by.get(f.topic) ?? 0) + 1);
  return [...by.entries()].map(([topic, n]) => ({ topic, n })).sort((a, b) => b.n - a.n || a.topic.localeCompare(b.topic));
}

export interface PriceWords {
  means: string;
  /** whose number it is, in full */
  whose: string;
  /** the same, short enough for a card's art */
  brief: string;
  /** nobody has bet yet: the number is our AI's starting estimate */
  firstRead: boolean;
}

/** What the % means, in words, and whose number it is. */
export function priceWords(f: Pick<Fact, "price" | "trades" | "openPrice" | "status" | "outcome">, reopened = false): PriceWords {
  const means = "chance it’s true";
  if (f.status === "settled") {
    const decided = `Decided: ${f.outcome ? "true" : "false"}`;
    return { means: "chance it’s true, when it was decided", whose: decided, brief: decided, firstRead: false };
  }
  if (f.trades === 0) {
    const open = Math.round((f.openPrice ?? f.price) * 100);
    if (reopened) return { means, whose: `No bets yet · reopened at ${open}%`, brief: `reopened at ${open}%`, firstRead: false };
    return { means, whose: `No bets yet · our AI’s starting estimate: ${open}%`, brief: "our AI’s estimate", firstRead: true };
  }
  if (f.openPrice === null) {
    const after = `after ${f.trades === 1 ? "1 bet" : `${f.trades} bets`}`;
    return { means, whose: after, brief: after, firstRead: false };
  }
  const open = Math.round(f.openPrice * 100);
  const moved = Math.round(f.price * 100) - open;
  if (moved === 0) return { means, whose: `same as the start (${open}%)`, brief: `same as the start`, firstRead: false };
  const from = `${moved < 0 ? "down" : "up"} from ${open}%`;
  return { means, whose: `${from} at the start`, brief: from, firstRead: false };
}
