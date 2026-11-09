// The official pages as the API serves them (docs/API.md, "The official pages"), and the small rules for
// showing them. Browser-safe. `slimPage` keeps only what the article shows, so a page isn't shipped three
// times over (each paragraph comes with Wikipedia's text, the market's and every sentence).

export type WrittenBy = "wikipedia" | "ai" | "ruling" | "correction" | "market";

export interface PageClaim {
  id: number;
  text: string;
  price_yes: number;
  band: string | null;
  trades: number;
  status: "open" | "ruling" | "decided";
  outcome: "true" | "false" | null;
  url: string;
}

/** A decided line: this sentence's own ruling, or a line ruled false before it in the same place. */
export interface RuledLine {
  claim_id: number;
  text: string;
  outcome: "true" | "false" | null;
  by: string;
  challenge_id: number | null;
  decided_at: number | null;
  tx: string | null;
  explorer: string | null;
  url: string;
}

export interface PageSentence {
  text: string;
  /** Wikipedia's words, when the sentence has a market */
  wikipedia?: string;
  opinion?: boolean;
  written_by: WrittenBy;
  claim: PageClaim | null;
  ruled?: RuledLine[];
  decided?: RuledLine;
  written?: { rewrite_id: string; band: string; price_yes: number | null; current: boolean };
}

export interface PageProof {
  id: string;
  version: number;
  written_at: number;
  updated_at: number;
  trigger: string;
  page_writer: string | null;
  prices: { claim_id: number; price_yes: number; band: string }[];
  prices_canonical: string | null;
  prices_hash: string | null;
  signature: { status: string; verified: boolean; model: string | null; signing_address: string | null; request_hash: string | null; response_hash: string | null; reason: string | null };
  anchor: { status: string; tx: string | null; explorer: string | null };
}

export interface DiffOp { op: "eq" | "ins" | "del"; text: string }

export interface PageParagraph {
  index: number;
  section: string;
  written_by: "ai" | "market" | "wikipedia";
  changed: boolean;
  wikipedia: string | null;
  market: string;
  diff: DiffOp[] | null;
  sentences: PageSentence[];
  rewrites: PageProof[];
}

export interface PageTotals {
  paragraphs: number;
  written_by_ai: number;
  sentences: number;
  facts_priced: number;
  facts_decided: number;
  facts_no_bets: number;
  rewrites: number;
  signed: number;
  anchored: number;
  last_changed: number | null;
  models: string[];
}

/** A line on the page ruled false: what Wikipedia said, what replaced it, and the proof. Null where the API has nothing. */
export interface PageCorrection {
  claim_id: number;
  /** the revision's sentence; null for a line opened since */
  wikipedia: string | null;
  text: string;
  outcome: "true" | "false" | null;
  by: string;
  trades: number;
  corrected: { text: string | null; claim_id: number | null; url: string | null } | null;
  source: { name: string | null; url: string | null; figure: string | null; on_page: string | null; checked_on: string | null } | null;
  price_before: number | null;
  price_written: number | null;
  challenge_id: number | null;
  decided_at: number | null;
  tx: string | null;
  explorer: string | null;
  url: string;
  payout: { usd: number; side: "yes" | "no" | null } | null;
  rewrite: { id: string; model: string | null; signed: boolean; tx: string | null; explorer: string | null } | null;
}

export interface OfficialPage {
  slug: string;
  title: string;
  source: { url: string; attribution: string; licence: string; revised_at: string };
  totals: PageTotals;
  /** absent from an API older than the corrections */
  corrections?: PageCorrection[];
  paragraphs: PageParagraph[];
  asOf: number;
}

export interface PageSummary extends PageTotals { slug: string; title: string; url: string }

export interface PagesIndex {
  pages: PageSummary[];
  count: number;
  encyclopedia: number;
  record: { count: number };
  asOf: number;
}

export interface RecordLine {
  claim_id: number;
  question: string;
  topic: string;
  claim: string;
  outcome: "true" | "false" | null;
  text: string;
  decided_at: number | null;
  by: string;
  sources: { kind: string; label: string | null; url: string }[];
  ruling: { challenge_id: number | null; url: string; tx: string | null; explorer: string | null };
  market_url: string;
}

export interface RecordDoc { lines: RecordLine[]; count: number; asOf: number }

// ---------- what the article ships ----------

export interface SlimClaim { id: number; price: number; trades: number; decided: boolean; outcome: "true" | "false" | null }
export interface SlimLine { text: string; wiki?: string; opinion?: true; by: WrittenBy; claim?: SlimClaim; ruled?: number }
export interface SlimRuling { id: number; outcome: "true" | "false" | null; by: string; url: string }
export interface SlimProof { id: string; at: number; model: string | null; prices: number[]; signed: string; tx: string | null; explorer: string | null; correction: boolean }
export interface SlimParagraph { index: number; section: string; lines: SlimLine[]; diff?: DiffOp[]; rulings?: SlimRuling[]; proofs?: SlimProof[] }

const ruling = (r: RuledLine): SlimRuling => ({ id: r.claim_id, outcome: r.outcome, by: r.by, url: r.url });

/** The article's own data: each sentence once, Wikipedia's words only where they differ, the proof as shown. */
export function slimPage(page: OfficialPage): SlimParagraph[] {
  return page.paragraphs.map((p) => {
    const lines = p.sentences.map((s): SlimLine => {
      const l: SlimLine = { text: s.text, by: s.written_by };
      if (s.wikipedia !== undefined && s.wikipedia !== s.text) l.wiki = s.wikipedia;
      if (s.opinion) l.opinion = true;
      if (s.claim) l.claim = { id: s.claim.id, price: s.claim.price_yes, trades: s.claim.trades, decided: s.claim.status === "decided", outcome: s.claim.outcome };
      if (s.ruled?.length) l.ruled = s.ruled[0].claim_id;
      return l;
    });
    const out: SlimParagraph = { index: p.index, section: p.section, lines };
    if (!p.changed) return out;
    const corrections = new Set(p.sentences.filter((s) => s.written_by === "correction").map((s) => s.written?.rewrite_id));
    out.diff = p.diff ? shortDiff(p.diff) : undefined;
    const rulings = p.sentences.flatMap((s) => [...(s.ruled ?? []), ...(s.decided ? [s.decided] : [])]).map(ruling);
    if (rulings.length) out.rulings = rulings;
    if (p.rewrites.length) out.proofs = p.rewrites.map((r) => ({ id: r.id, at: r.written_at, model: r.signature.model, prices: r.prices.map((x) => x.price_yes), signed: r.signature.status, tx: r.anchor.tx, explorer: r.anchor.explorer, correction: corrections.has(r.id) }));
    return out;
  });
}

// ---------- sections ----------

export interface PageGroup<P extends { section: string }> { top: string; sub: string; id: string; first: boolean; paragraphs: P[] }

export const anchorOf = (top: string) => top.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "lead";

/** Paragraphs by section: "History / 2015–2016" is a heading and a subheading, as a real article has them. */
export function groupsOf<P extends { section: string }>(paragraphs: P[]): PageGroup<P>[] {
  const out: PageGroup<P>[] = [];
  let top: string | null = null;
  for (const p of paragraphs) {
    const [head, ...rest] = p.section.split(" / ");
    const sub = rest.join(" / ");
    const last = out.at(-1);
    if (last && last.top === head && last.sub === sub) { last.paragraphs.push(p); continue; }
    out.push({ top: head, sub, id: anchorOf(head), first: head !== top, paragraphs: [p] });
    top = head;
  }
  return out;
}

// ---------- words ----------

const KEEP = 70;

/** A paragraph's diff with the long unchanged stretches cut, so what changed is what you see. */
export function shortDiff(ops: DiffOp[]): DiffOp[] {
  return ops.map((o, i) => {
    if (o.op !== "eq" || o.text.length <= KEEP * 2 + 12) return o;
    const head = i > 0 ? o.text.slice(0, KEEP).replace(/\s+\S*$/, "") : "";
    const tail = i < ops.length - 1 ? o.text.slice(-KEEP).replace(/^\S*\s+/, "") : "";
    return { op: "eq", text: `${head ? `${head} ` : ""}…${tail ? ` ${tail}` : ""}` };
  });
}

/** "81%", "81% and 79%", "81%, 79% and 60%". */
export function pricesWords(prices: number[]): string {
  const p = prices.map((x) => `${Math.round(x * 100)}%`);
  return p.length < 2 ? (p[0] ?? "") : `${p.slice(0, -1).join(", ")} and ${p.at(-1)}`;
}

/** How much of a page the AI has written, in plain words. */
export function writtenWords(t: Pick<PageTotals, "written_by_ai" | "paragraphs">): string {
  if (!t.written_by_ai) return "No paragraph written by AI yet";
  return `${t.written_by_ai} of ${t.paragraphs} ${t.paragraphs === 1 ? "paragraph" : "paragraphs"} written by AI`;
}

/** What a page can say about itself: written from the odds, waiting for bets, or with no market at all. */
export type PageMood = "written" | "unbet" | "unpriced";
export const pageMood = (t: Pick<PageTotals, "written_by_ai" | "facts_priced">): PageMood => (t.written_by_ai > 0 ? "written" : t.facts_priced > 0 ? "unbet" : "unpriced");

/** "30 October 2026", for a revision's date. */
export const dateWords = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
