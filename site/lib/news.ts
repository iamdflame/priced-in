// Today's claims: the shapes the API sends for news lines, free picks, reports and the leaderboard
// (docs/API.md, "Today's claims, picks, reports and the board"), and the plain words every surface uses
// for them. Browser-safe. The API answers none of these routes until NEWS_ENABLED is on, and the site
// finds out at runtime (lib/server/news.ts): with it off, nothing here is shown.

/** The page a news line sits on, on the chain: news-YYYY-MM-DD, the day it opened. */
export const NEWS_PAGE = /^news-\d{4}-\d{2}-\d{2}$/;
export const isNewsPage = (page: string | null | undefined) => NEWS_PAGE.test(String(page ?? ""));

/**
 * The scout's topics (services/ai/src/scout.js TOPICS), each with its objects in both art sets, first one first.
 * The scout opens at most two of a topic a day, and a day can still lead with several, so each topic has more
 * than one object: a block of cards never shows the same object twice while its topic has another (blockArt).
 */
export const NEWS_ART: Record<string, readonly string[]> = {
  Football: ["football", "goal"],
  Sports: ["sports", "podium", "stopwatch"],
  Money: ["money", "growth"],
  Tech: ["tech", "laptop"],
  Entertainment: ["entertainment", "microphone"],
  Officials: ["officials", "lectern"],
  Crypto: ["bitcoin", "blocks"],
};
const NO_TOPIC = ["corp"] as const;
/** A topic's first object: a line on its own (its page, a fact card, a share card). */
export const newsArt = (topic: string) => (NEWS_ART[topic] ?? NO_TOPIC)[0];

/**
 * The objects for one block of cards or rows, in the order shown: each line takes the first object of its topic
 * not already shown in the block, and only once a topic has run out does one repeat (its next in turn).
 */
export function blockArt(lines: readonly { claim_id: number; topic: string }[]): Map<number, string> {
  const shown = new Set<string>();
  const seen: Record<string, number> = {};
  const out = new Map<number, string>();
  for (const l of lines) {
    const set = NEWS_ART[l.topic] ?? NO_TOPIC;
    const n = seen[l.topic] ?? 0;
    const name = set.find((x) => !shown.has(x)) ?? set[n % set.length];
    seen[l.topic] = n + 1;
    shown.add(name);
    out.set(l.claim_id, name);
  }
  return out;
}

/**
 * What a line's claim says Yes means, and its small print: the scout ends a claim with who doesn't count
 * ("Reports citing unnamed sources don't count."), which reads as small print, not as the claim.
 */
export function claimParts(claim: string): { yes: string; fine: string | null } {
  const text = claim.replace(/\s+/g, " ").trim();
  // a sentence ends at . ! or ? before a space and a capital, so "$1.5tn" and "U.S. officials" stay whole
  const sentences = text.split(/(?<=[a-z0-9)”’"'][.!?])\s+(?=[A-Z“‘"'])/).filter(Boolean);
  const small = (x: string) => /\b(unnamed|anonymous)\b|\b(don[’']t|do not|does not|doesn[’']t) count\b/i.test(x);
  let cut = sentences.length;
  while (cut > 1 && small(sentences[cut - 1])) cut--;
  const fine = sentences.slice(cut).join(" ");
  return { yes: sentences.slice(0, cut).join(" "), fine: fine || null };
}

export interface NewsSource { headline: string; url: string; outlet: string | null; published_at: number | null }

export interface NewsSettles {
  /** YYYY-MM-DD */
  by: string;
  /** "13 November 2026" */
  by_words: string;
  /** the end of the settle-by day (UTC), in ms: picks close then */
  due_at: number;
  source: string;
  source_url: string | null;
  event: string | null;
  rule: string;
}

/** The `news` field /api/claims carries on a news line (and on no other claim). */
export interface NewsField {
  kind: "news";
  question: string;
  topic: string;
  why: string;
  source: NewsSource | null;
  settles: NewsSettles;
  first_estimate: number;
  opened_at: number;
  open_tx: string | null;
  coverage?: unknown[];
}

export type TodaySection = "today" | "settling" | "decided";

/** One line of GET /api/today. */
export interface TodayLine {
  claim_id: number;
  section: TodaySection;
  kind: "news";
  question: string;
  claim: string;
  topic: string;
  why: string;
  source: NewsSource | null;
  settles: NewsSettles;
  first_estimate: number;
  price_yes: number | null;
  price_yes_ppm: number | null;
  trades: number;
  volume_usd: number;
  open_interest_usd: number;
  liquidity_b_usd: number;
  cost_to_move: { up_10_points_usd: number; down_10_points_usd: number } | null;
  status: "open" | "ruling" | "decided" | "unknown";
  chain_status: string | null;
  overdue: boolean;
  outcome: "true" | "false" | null;
  decided_at: number | null;
  ruling: { challenge_id: number; provisional: string | null } | null;
  settler: { last_look_at: number | null; note: string | null; challenge_id: number | null } | null;
  picks: { yes: number; no: number; total: number };
  bounty_usd: number;
  opened_at: number;
  open_tx: string | null;
  url: string;
}

export interface Today {
  as_of: number;
  date: string;
  counts: { today: number; settling: number; decided: number };
  next_scout_at: number | null;
  lines: TodayLine[];
  rules: { lines: string; picks: string };
  asOf?: number;
}

export type Side = "yes" | "no";

export interface PickStats {
  accuracy: number | null;
  settled: number;
  right: number;
  points: number;
  streak: { current: number; best: number };
  picks_today: number;
  picks_total: number;
  open_picks: number;
  caught: number;
  ranked: boolean;
  min_settled: number;
}

export type PickState = "open" | "ruling" | "right" | "wrong" | "unknown";

export interface MyPick {
  claim_id: number;
  side: Side;
  at: number;
  price_yes_ppm: number;
  question: string | null;
  claim: string | null;
  state: PickState;
  points: number;
  settled_at: number | null;
}

/** GET /api/picks?key= */
export interface MyRecord { key: string; nickname: string | null; name: string; stats: PickStats; picks: MyPick[]; rules: string }

export type Period = "week" | "month" | "all";

export interface BoardRow {
  rank?: number | null;
  kind: "person" | "ai";
  id: string;
  name: string;
  accuracy: number | null;
  settled: number;
  right: number;
  points: number;
  streak: { current: number; best: number };
  picks_today: number;
  picks_total: number;
  open_picks: number;
  caught: number;
  ranked: boolean;
  needs?: number;
}

/**
 * The board's rows not ranked yet, with the people still waiting for their first result folded into one
 * line: a row each of "Visitor… 1 pick, 0 settled" read as an empty board. AI traders, people with a result,
 * and you (by key) keep their rows.
 */
export function foldWaiting(rows: BoardRow[], me: string | null): { rows: BoardRow[]; first: { people: number; picks: number } } {
  const folded = rows.filter((r) => r.kind === "person" && r.settled === 0 && r.id !== me && !r.caught);
  const out = new Set(folded);
  return { rows: rows.filter((r) => !out.has(r)), first: { people: folded.length, picks: folded.reduce((n, r) => n + r.picks_total, 0) } };
}

/** "7 people are waiting for their first result, with 8 picks between them" */
export function waitingWords({ people, picks }: { people: number; picks: number }): string | null {
  if (!people) return null;
  const who = people === 1 ? "1 person is waiting for a first result" : `${people} people are waiting for their first result`;
  return `${who}, with ${picks === 1 ? "1 pick" : `${picks} picks`} ${people === 1 ? "open" : "between them"}. A pick counts here once its fact is decided.`;
}

/** GET /api/leaderboard?period= */
export interface Board {
  period: Period;
  window: { from: number | null; to: number };
  min_settled: number;
  board: BoardRow[];
  waiting: BoardRow[];
  ai: BoardRow[];
  you_vs_ai: { best_ai: { id: string; name: string; accuracy: number | null; settled: number; rank: number | null } | null; people_ranked: number; people_ahead_of_best_ai: number };
  totals: { people: number; picks: number; ai_picks: number; settled_picks: number; catches_upheld: number };
  rules: string;
  asOf?: number;
}

export type ReportStatus = "received" | "retry" | "refused" | "verified" | "challenged" | "ruling" | "upheld" | "rejected" | "expired" | "closed";

export interface Report {
  id: string;
  key: string;
  claim_id: number;
  says: "false" | "true";
  url: string;
  quote: string;
  note: string;
  at: number;
  status: ReportStatus;
  reason: string | null;
  challenge_id: number | null;
  challenge_tx: string | null;
  decided_at: number | null;
  check: { result: string; support: unknown } | null;
}

/** GET /api/challenge?claim= */
export interface ChallengeInfo {
  claim_id: number;
  claim: string;
  status: string;
  open: boolean;
  why_not: string | null;
  call: { contract: string; method: string; args: Record<string, unknown>; deposit: string; gas_tgas: number };
  bond: { micro: string; usd: number; from: string };
  evidence: { max_bytes: number; format: string; checked: string };
  outcomes: { right: string; wrong: string };
  bounty: { usd: number; pays: string };
  settles?: NewsSettles;
}

// ---------- words ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-14" to "14 Nov". */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso;
}

/** A headline without the outlet Google News appends: "Tesla Is Ending… - The New York Times". */
export function headlineOf(s: NewsSource | null): string | null {
  if (!s?.headline) return null;
  const h = s.headline.trim();
  const out = s.outlet?.trim();
  if (out && h.endsWith(` - ${out}`)) return h.slice(0, -(out.length + 3)).trim();
  const m = /^(.*\S)\s+-\s+([^-]{2,40})$/.exec(h);
  return m ? m[1] : h;
}

/** The outlet, from the source or the headline's tail. */
export function outletOf(s: NewsSource | null): string | null {
  if (!s) return null;
  if (s.outlet) return s.outlet;
  const m = /\s+-\s+([^-]{2,40})$/.exec(s.headline ?? "");
  return m ? m[1].trim() : null;
}

/** What a decided line's outcome means, in words. */
export const outcomeWord = (o: "true" | "false" | null) => (o === "true" ? "true" : o === "false" ? "false" : null);

/** Whether a line takes picks now, or the sentence that says why not. */
export function pickableOrWhy(l: Pick<TodayLine, "status" | "overdue" | "settles">, now: number): string | null {
  if (l.status === "decided") return "It’s decided: picks are closed.";
  if (l.status === "ruling") return "Three AI judges are ruling on it, so picks are closed until they finish.";
  if (l.overdue || now >= l.settles.due_at) return "Its date has passed: picks are closed while it settles.";
  return null;
}

/**
 * A person's free $1 score from their lane identity's portfolio: its balance and what its bets are worth.
 * Null until they've bet it: a free $1 only credited is still the free $1.
 */
export function boardScore(p: { balance_usd: number | null; positions: { value_usd: number | null }[] }): number | null {
  return p.positions.length ? Math.max(0, p.balance_usd ?? 0) + p.positions.reduce((n, r) => n + (r.value_usd ?? 0), 0) : null;
}

/** A refusal's sentence without the developer's pointer at its end: the sheet has a button for that. */
export const refusalWords = (message: string) => message.replace(/: GET \/api\/challenge\?claim=\d+\.$/, ".");

/** "71%" from 0.71; null stays null. */
export const pctWords = (a: number | null) => (a === null ? "—" : `${Math.round(a * 100)}%`);

/** "4 of 5 right", "No settled picks yet". */
export const recordWords = (right: number, settled: number) => (settled ? `${right} of ${settled} right` : "No settled picks yet");

/** What a report's status means for the person who sent it. The API's own sentence wins when it has one. */
export const REPORT_WORDS: Record<ReportStatus, { label: string; tone: "wait" | "ok" | "bad" | "done" }> = {
  received: { label: "Received: being checked", tone: "wait" },
  retry: { label: "Checking again soon", tone: "wait" },
  refused: { label: "Refused", tone: "bad" },
  verified: { label: "Verified: the Checker challenges next", tone: "ok" },
  challenged: { label: "Challenged: three AI judges rule next", tone: "ok" },
  ruling: { label: "Three AI judges are ruling", tone: "wait" },
  upheld: { label: "Upheld: a catch", tone: "ok" },
  rejected: { label: "Not upheld", tone: "bad" },
  expired: { label: "Ran out of time", tone: "done" },
  closed: { label: "Closed", tone: "done" },
};

/** A report still moving: worth asking again. */
export const reportLive = (s: ReportStatus) => s === "received" || s === "retry" || s === "verified" || s === "challenged" || s === "ruling";

/** The AI traders as the board names them ("Quant") to the persona the site uses ("The Quant"). */
export const aiName = (name: string) => (/^the /i.test(name) ? name.replace(/^the /i, "The ") : `The ${name}`);

// ---------- what leads, what follows ----------

export interface Arranged {
  /** the claim people are on most today (else the next to settle) */
  lead: TodayLine | null;
  /** the next few open claims, today's first */
  cards: TodayLine[];
  /** waiting for its result first (date passed, or the AI judges ruling), then the rest by date */
  next: TodayLine[];
  /** decided in the last week, newest first */
  decided: TodayLine[];
}

const takesPicks = (l: TodayLine, now: number) => l.status === "open" && !l.overdue && now < l.settles.due_at;
const heat = (l: TodayLine) => l.picks.total + l.trades;

export function arrange(lines: TodayLine[], now: number, cards = 4): Arranged {
  const open = lines.filter((l) => takesPicks(l, now));
  // the scout opens a day's claims in its own order, best first: with no picks or bets yet, that order leads
  const today = open.filter((l) => l.section === "today").sort((a, b) => heat(b) - heat(a) || a.opened_at - b.opened_at || a.claim_id - b.claim_id);
  const later = open.filter((l) => l.section !== "today").sort((a, b) => a.settles.due_at - b.settles.due_at || a.claim_id - b.claim_id);
  const lead = today[0] ?? later[0] ?? null;
  const rest = [...today, ...later].filter((l) => l !== lead);
  const waiting = lines.filter((l) => l.status !== "decided" && !takesPicks(l, now)).sort((a, b) => a.settles.due_at - b.settles.due_at || a.claim_id - b.claim_id);
  const byDate = (a: TodayLine, b: TodayLine) => a.settles.due_at - b.settles.due_at || a.claim_id - b.claim_id;
  return {
    lead,
    cards: rest.slice(0, cards),
    next: [...waiting, ...rest.slice(cards).sort(byDate)],
    decided: lines.filter((l) => l.status === "decided").sort((a, b) => (b.decided_at ?? 0) - (a.decided_at ?? 0) || b.claim_id - a.claim_id),
  };
}
