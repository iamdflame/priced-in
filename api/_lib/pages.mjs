// The official pages: an encyclopedia page written by AI from what the market believes right now.
// Off unless OFFICIAL_PAGES=1: no sweep, no route, and the writer as it always was.
//
//   the layout   an article's paragraphs (the pinned Wikipedia revision in api/_data/articles, by
//                section, four sentences at a time, as the site shows them), each sentence joined to
//                its market by its exact text. A line ruled false whose correction opened as a market
//                hands its place to that market, so the page never says both
//   the sweep    every cron run: the paragraphs with no rewrite yet, or with a sentence in another band
//                than the one it was written in, stalest first, up to WRITER_SWEEP_PER_RUN, and only
//                while today's model spend is under WRITER_SWEEP_SHARE of the cap
//   the page     /api/pages/<slug>: per paragraph Wikipedia's words, the market's words, each sentence's
//                claim, price, band and outcome, and the proof of the rewrite
//   the record   /api/record: each decided news line, as ruled, with its sources
//
// What a sentence says on the page, in order:
//   no market          Wikipedia's words, and the page says it has no market
//   ruled true         the claim, stated plainly
//   ruled false        its correction, when one opened; else the model's correction from a source; else
//                      "Three AI judges ruled this false: <the line>". The chain decides these at once:
//                      none of them waits for a sweep
//   no bets yet        its own words: the opening price is an estimate, not a market's view
//   anything else      the newest words a model wrote for it
//
// The pure functions here are what the tests exercise; the routes are in pages-routes.mjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_WRITER, band, pageBand, wordDiff } from "../../services/ai/src/writer.js";
import { corpusEvidence } from "../../services/ai/src/evidence.js";
import { parseEvidence } from "../../services/ai/src/receipts.js";
import { isNewsPage, newsField } from "./news.mjs";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../_data/articles");
const H = 3600_000;
const LEAD = "(lead)";
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Sentences in one paragraph, as the site has always cut them (the corpus keeps no paragraph breaks). */
export const PER_PARAGRAPH = 4;
export const OPENED_SECTION = "Opened since this revision";
/** Only these statuses hold a model's words a page may show. "unverified" failed its signature check. */
const MODEL_WORDS = new Set(["signed", "unsigned"]);
/** The sweep gives a paragraph whose last try came to nothing this long before the next. */
export const RETRY_AFTER_MS = H;
const SWEEP_MARGIN_MS = 30_000; // a rewrite and its anchor, inside the run's time

const whole = (v, min, max, d) => (v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : d);

/** OFFICIAL_PAGES=1 turns it on; anything out of range keeps the default. */
export function pagesConfig(env = process.env) {
  return {
    enabled: env.OFFICIAL_PAGES === "1",
    perRun: whole(env.WRITER_SWEEP_PER_RUN, 0, 20, 3),
    // the sweep stops here, as a share of the daily model cap: the jury and the Sentinel's panel keep the rest
    share: whole(env.WRITER_SWEEP_SHARE, 1, 100, 60) / 100,
  };
}

// ---------- the articles ----------

const articles = new Map();

/** The pinned article for a slug, or null. Kept in memory: a page's text never changes. */
export function readArticle(slug, dir = DIR) {
  if (!SLUG.test(String(slug)) || isNewsPage(slug)) return null;
  const key = `${dir}/${slug}`;
  if (articles.has(key)) return articles.get(key);
  let a = null;
  try { a = JSON.parse(fs.readFileSync(path.join(dir, `${slug}.json`), "utf8")); } catch { /* no such page */ }
  if (a) a.lines = paragraphsOfArticle(a);
  articles.set(key, a);
  return a;
}

/** The encyclopedia's index: slug, title, sentences. */
export function articleIndex(dir = DIR) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")); } catch { return []; }
}

/** An article's paragraphs: its sections, four sentences at a time. */
export function paragraphsOfArticle(article) {
  const sections = new Map();
  for (const s of article.sentences) {
    const lines = sections.get(s.section) ?? [];
    lines.push(s);
    sections.set(s.section, lines);
  }
  const out = [];
  for (const [section, lines] of sections) {
    for (let i = 0; i < lines.length; i += PER_PARAGRAPH) out.push({ section: section === LEAD ? "" : section, lines: lines.slice(i, i + PER_PARAGRAPH) });
  }
  return out;
}

// ---------- the layout ----------

/** The line a slot stands for now: follow the corrections from the line on the page to the newest. */
function chainFrom(first, byId, next) {
  const chain = [first];
  for (let id = next.get(first.id); id !== undefined; id = next.get(id)) {
    const c = byId.get(id);
    if (!c || chain.includes(c)) break;
    chain.push(c);
  }
  return chain;
}

/**
 * An article joined to the market. Each paragraph holds its slots: a sentence and, if it has a market,
 * the claim that speaks for it now (`claim`) and the lines ruled false before it (`ruled`). Lines on
 * this page the revision doesn't hold get a last paragraph of their own, so the indices above it never move.
 * @param {{ slug: string, lines?: object[], sentences: object[] }} article
 * @param {object[]} claims the market's claims (any page)
 * @param {{ old_claim_id: number, new_claim_id: number }[]} links corrections
 */
export function layoutOf(article, claims, links = []) {
  const onPage = claims.filter((c) => c.page === article.slug);
  const byText = new Map(onPage.map((c) => [c.text, c]));
  const byId = new Map(onPage.map((c) => [c.id, c]));
  const next = new Map(links.map((l) => [l.old_claim_id, l.new_claim_id]));
  const placed = new Set();
  const paragraphs = (article.lines ?? paragraphsOfArticle(article)).map((p, index) => ({
    index, section: p.section, added: false,
    slots: p.lines.map((s) => {
      const first = byText.get(s.text) ?? null;
      if (!first) return { text: s.text, opinion: s.opinion, claim: null, ruled: [] };
      const chain = chainFrom(first, byId, next);
      for (const c of chain) placed.add(c.id);
      // a correction speaks for this slot: the writer must see its words, never the line it replaced
      const claim = chain.length > 1 ? { ...chain.at(-1), corrects: chain.at(-2).id, replaces: s.text } : first;
      return { text: s.text, opinion: s.opinion, claim, ruled: chain.slice(0, -1) };
    }),
  }));
  // a correction not yet linked is held back by nothing: a line with no sentence here shows at the end
  const rest = onPage.filter((c) => !placed.has(c.id)).sort((a, b) => a.id - b.id);
  if (rest.length) paragraphs.push({ index: paragraphs.length, section: OPENED_SECTION, added: true, slots: rest.map((c) => ({ text: c.text, opinion: false, claim: c, ruled: [] })) });
  return paragraphs;
}

/** The claims speaking in a paragraph, each once. */
export function claimsOf(paragraph) {
  const seen = new Map();
  for (const s of paragraph.slots) if (s.claim) seen.set(s.claim.id, s.claim);
  return [...seen.values()];
}

/**
 * What a ruling's receipts give for a line ruled false: a source's own words, when the receipt check
 * found them at that source. The corpus's own records come first (corpusEvidence); this is a reader's
 * report, or anyone's challenge, that quoted the page.
 */
export function receiptEvidence(r) {
  if (!r || r.outcome !== "FALSE" || r.receipt_check?.result !== "verified") return null;
  const { urls, quotes } = parseEvidence(r.evidence);
  if (!urls.length || !quotes.length) return null;
  let host = null;
  try { host = new URL(urls[0]).host.replace(/^www\./, ""); } catch { return null; }
  return { source_name: host, source_url: urls[0], value_today: quotes[0], value_on_page: null, checked_on: r.receipt_check.checked_at?.slice(0, 10) ?? null };
}

/** The evidence for a claim: our measurement's, or the receipts of its ruling. */
export function evidenceFrom(rulings = []) {
  const settled = new Map();
  for (const r of rulings) if (r.status === "settled") settled.set(r.claim_id, r);
  return (c) => corpusEvidence(c.text) ?? receiptEvidence(settled.get(c.id));
}

/**
 * The official pages' part of the writer (services/ai/src/writer.js `official`).
 * @param {{ links: () => object[], dir?: string }} o
 */
export function officialWriter({ links, dir = DIR }) {
  let evidence = () => null;
  return {
    /** The sweep knows the rulings; a trade's rewrite doesn't look them up. */
    useRulings(rulings) { const of = evidenceFrom(rulings); evidence = (c) => of(c); },
    evidence: (c) => evidence(c),
    paragraphs(page, claims) {
      const a = readArticle(page, dir);
      return a ? layoutOf(a, claims, links()).map(claimsOf) : null;
    },
    context(page, index, claims = []) {
      const a = readArticle(page, dir);
      if (!a) return null;
      const p = a.lines[index];
      const now = new Map(claims.filter((c) => c.replaces).map((c) => [c.replaces, c.text]));
      return { title: a.title, section: p ? p.section || "Lead" : OPENED_SECTION, text: p ? p.lines.map((l) => now.get(l.text) ?? l.text).join(" ") : "" };
    },
  };
}

// ---------- the records ----------

/** The latest record of each rewrite: a record is appended each time it changes. */
export function latestRecords(lines) {
  const m = new Map();
  for (const r of lines) m.set(r.id, r);
  return [...m.values()];
}

/**
 * For each claim, the newest record the page writer made that holds it (`tried`), and the newest with a
 * model's words a page may show (`words`). Older records came from another prompt, for other paragraphs.
 */
export function recordsByClaim(records) {
  const tried = new Map(), words = new Map();
  const newer = (m, s, r) => { const cur = m.get(s.claim_id); if (!cur || r.createdAt > cur.rec.createdAt || (r.createdAt === cur.rec.createdAt && r.version > cur.rec.version)) m.set(s.claim_id, { rec: r, sentence: s }); };
  for (const r of records) {
    if (!r.page_writer) continue;
    for (const s of r.sentences || []) {
      newer(tried, s, r);
      if (MODEL_WORDS.has(r.status) && r.provenance?.kind === "model") newer(words, s, r);
    }
  }
  return { tried, words };
}

/** The band a claim calls for now, or null when no model should write it. */
const bandNow = (c, evidenceOf) => pageBand(c, c.price_yes_ppm / 1e6, evidenceOf(c));

// ---------- the sweep ----------

const REASON = { new: 0, decided: 1, band: 2, unsigned: 3 };

/**
 * The paragraphs due a rewrite, stalest first (never written first, the page with the most facts first).
 * Pure, so the tests can check the choice.
 * @param {{ pages: { slug: string, paragraphs: object[] }[], records: object[], evidenceOf?: (c: object) => object|null, nowMs: number, retryAfterMs?: number }} a
 *   `pages[].paragraphs` as layoutOf gives them
 * @returns {{ page: string, index: number, claims: object[], why: string, at: number, claim_id: number }[]}
 */
export function sweepPlan({ pages, records, evidenceOf = (c) => corpusEvidence(c.text), nowMs, retryAfterMs = RETRY_AFTER_MS }) {
  const { tried, words } = recordsByClaim(records);
  const due = [];
  pages.forEach(({ slug, paragraphs }, order) => {
    for (const p of paragraphs) {
      const claims = claimsOf(p);
      const wanted = claims.map((c) => ({ c, band: bandNow(c, evidenceOf) })).filter((x) => x.band);
      let why = null, at = Infinity;
      for (const { c, band: b } of wanted) {
        const w = words.get(c.id), t = tried.get(c.id);
        at = Math.min(at, w?.rec.createdAt ?? 0);
        const reason = !w ? (c.status === "Settled" ? "decided" : "new") : w.sentence.band !== b ? "band" : w.rec.status !== "signed" ? "unsigned" : null;
        if (!reason) continue;
        // a try at this band that came to nothing (a template, a late signature) isn't repeated every ten minutes
        if (t && t.sentence.band === b && nowMs - t.rec.createdAt < retryAfterMs) continue;
        if (why === null || REASON[reason] < REASON[why]) why = reason;
      }
      if (why === null) continue;
      due.push({ page: slug, index: p.index, claims, why, at, order, claim_id: wanted[0].c.id, price_yes_ppm: wanted[0].c.price_yes_ppm });
    }
  });
  return due.sort((a, b) => a.at - b.at || a.order - b.order || a.index - b.index).map(({ order, ...x }) => x);
}

/** The live encyclopedia pages, with their layout, the page with the most facts first. */
export function livePages(claims, links, dir = DIR) {
  const slugs = [...new Set(claims.filter((c) => !isNewsPage(c.page)).map((c) => c.page))];
  const out = [];
  for (const slug of slugs) {
    const a = readArticle(slug, dir);
    if (!a) continue;
    const paragraphs = layoutOf(a, claims, links);
    out.push({ slug, paragraphs, facts: paragraphs.reduce((n, p) => n + claimsOf(p).length, 0) });
  }
  return out.sort((a, b) => b.facts - a.facts || a.slug.localeCompare(b.slug));
}

const dollars = (n) => `$${Number(n).toFixed(2)}`;

/**
 * One sweep. Everything it touches comes in `d`, so the tests run it with fakes.
 * @param {{ cfg: ReturnType<typeof pagesConfig>, pages: object[], records: object[], evidenceOf?: Function,
 *   spend: () => Promise<{ spent_usd: number, cap_usd: number, open: boolean }>, rewrite: (page: string, index: number, claims: object[], prices: Map<number, number>, trigger: object) => Promise<object|null>,
 *   left?: () => number, now?: () => number, log?: (m: string) => void }} d
 */
export async function sweepRound(d) {
  const cfg = d.cfg;
  if (!cfg.enabled) return { off: true };
  const nowMs = (d.now || Date.now)();
  const left = d.left || (() => Infinity);
  const plan = sweepPlan({ pages: d.pages, records: d.records, evidenceOf: d.evidenceOf, nowMs });
  const out = { at: new Date(nowMs).toISOString(), due: plan.length, per_run: cfg.perRun, rewritten: [], stopped: null };
  for (const x of plan.slice(0, cfg.perRun)) {
    const s = await d.spend();
    const stop = cfg.share * s.cap_usd;
    if (!s.open || s.spent_usd >= stop) {
      out.stopped = `the sweep stops at ${Math.round(cfg.share * 100)}% of the daily model cap so the jury and the Sentinel keep the rest: ${dollars(s.spent_usd)} of ${dollars(s.cap_usd)} is spent`;
      break;
    }
    if (left() < SWEEP_MARGIN_MS) { out.stopped = "out of time this run: the rest wait for the next"; break; }
    const prices = new Map(x.claims.map((c) => [c.id, c.price_yes_ppm]));
    const trigger = { kind: "sweep", why: x.why, claim_id: x.claim_id, txHash: null, trader: null, price_yes_ppm: x.price_yes_ppm, seq: null };
    const rec = await d.rewrite(x.page, x.index, x.claims, prices, trigger).catch((e) => { d.log?.(`sweep: ${x.page}#${x.index}: ${e.message}`); return null; });
    out.rewritten.push({ id: rec?.id ?? `${x.page}#${x.index}`, why: x.why, status: rec?.status ?? "failed" });
  }
  return out;
}

// ---------- the page ----------

const STATUS = (c) => (c.status === "Settled" ? "decided" : c.status === "Open" ? "open" : "ruling");
const OUTCOME = (c) => (c.outcome === true ? "true" : c.outcome === false ? "false" : null);
const EXPLORER = (network) => (network === "mainnet" ? "https://nearblocks.io/txns/" : "https://testnet.nearblocks.io/txns/");

/** Who decided a line, in words a reader follows. */
const deciderOf = (r) => (r?.escalated ? "The council" : "Three AI judges");

/** The sentence for a line ruled false that no source gives the wording for. */
export const ruledFalseSentence = (claim, ruling) => `${deciderOf(ruling)} ruled this false: ${claim.trim()}`;

function rulingView(r, c, network) {
  return {
    claim_id: c.id, text: c.text, outcome: OUTCOME(c), by: deciderOf(r).toLowerCase().replace(/^three ai/, "three AI"),
    challenge_id: r?.challenge_id ?? c.challenge_id ?? null, decided_at: r?.settled_at ?? null, tx: r?.settle_tx ?? null,
    explorer: r?.settle_tx ? `${EXPLORER(network)}${r.settle_tx}` : null, url: `/c/${c.id}`,
  };
}

function claimView(c) {
  const p = c.price_yes_ppm / 1e6;
  return { id: c.id, text: c.text, price_yes: p, band: c.status === "Settled" ? null : band(p), trades: c.trades ?? 0, status: STATUS(c), outcome: OUTCOME(c), url: `/c/${c.id}` };
}

/** A record's proof, as a page shows it. The exact bytes stay on /rewrites?page=&history=1. */
function proofOf(rec, network) {
  const p = rec.provenance || {};
  return {
    id: rec.id, version: rec.version, written_at: rec.createdAt, updated_at: rec.updatedAt ?? rec.createdAt, trigger: rec.trigger?.kind ?? "trade", page_writer: rec.page_writer ?? null,
    prices: (rec.sentences || []).map((s) => ({ claim_id: s.claim_id, price_yes: s.probability, band: s.band })), prices_canonical: rec.prices_canonical ?? null, prices_hash: rec.prices_hash ?? null,
    signature: { status: rec.status, verified: p.verified === true, model: p.model ?? null, signing_address: p.signing_address ?? null, request_hash: p.request_hash ?? null, response_hash: p.response_hash ?? null, reason: rec.status === "signed" ? null : p.reason ?? null },
    anchor: rec.anchor ? { status: rec.anchor.status, tx: rec.anchor.tx_hash ?? null, explorer: rec.anchor.tx_hash ? `${EXPLORER(network)}${rec.anchor.tx_hash}` : null } : { status: "none", tx: null, explorer: null },
  };
}

/** What one slot says now, and who wrote it. */
function sentenceOf(slot, ctx, added) {
  const { evidenceOf, words, recordsById, linkOf, rulingOf, network } = ctx;
  const c = slot.claim;
  const wikipedia = slot.text;
  const opinion = slot.opinion ? { opinion: true } : {};
  if (!c) return { text: wikipedia, ...opinion, written_by: "wikipedia", claim: null };
  const base = { wikipedia, ...opinion, claim: claimView(c), ruled: slot.ruled.map((x) => rulingView(rulingOf(x), x, network)) };
  const w = words.get(c.id);
  const written = w ? { rewrite_id: w.rec.id, band: w.sentence.band, price_yes: w.sentence.probability, current: w.sentence.band === bandNow(c, evidenceOf) } : null;
  if (c.status === "Settled") {
    const decided = rulingView(rulingOf(c), c, network);
    if (c.outcome === true) return { ...base, text: c.text, written_by: "ruling", decided };
    if (w && w.sentence.band === "correct") return { ...base, text: w.sentence.text, written_by: "ai", decided, written };
    return { ...base, text: ruledFalseSentence(c.text, rulingOf(c)), written_by: "ruling", decided };
  }
  if (w) return { ...base, text: w.sentence.text, written_by: "ai", written };
  // the words of a correction came from a signed rewrite, whatever its market does next
  const last = slot.ruled.at(-1);
  if (last) {
    const rec = recordsById.get(linkOf(last.id)?.rewrite_id);
    return { ...base, text: c.text, written_by: "correction", ...(rec ? { written: { rewrite_id: rec.id, band: "correct", price_yes: null, current: true } } : {}) };
  }
  return { ...base, text: c.text, written_by: added ? "market" : "wikipedia" };
}

const joined = (list) => list.join(" ");

/**
 * A page's current state.
 * @param {{ article: object, claims: object[], records: object[], links?: object[], rulings?: object[], network?: string, nowMs?: number }} a
 */
export function pageState({ article, claims, records, links = [], rulings = [], network = "mainnet", nowMs = Date.now() }) {
  const evidenceOf = evidenceFrom(rulings);
  const { words } = recordsByClaim(records);
  const recordsById = new Map(records.map((r) => [r.id, r]));
  const link = new Map(links.map((l) => [l.old_claim_id, l]));
  const settled = new Map();
  for (const r of rulings) if (r.status === "settled") settled.set(r.claim_id, r);
  const ctx = { evidenceOf, words, recordsById, linkOf: (id) => link.get(id) ?? null, rulingOf: (c) => settled.get(c.id) ?? null, network };
  let aiParagraphs = 0, last = 0;
  const seenRec = new Set(), facts = new Set(), decided = new Set(), unbet = new Set();
  const paragraphs = layoutOf(article, claims, links).map((p) => {
    const sentences = p.slots.map((s) => sentenceOf(s, ctx, p.added));
    const wikipedia = p.added ? null : joined(p.slots.map((s) => s.text));
    const market = joined(sentences.map((s) => s.text));
    const ids = [...new Set(sentences.map((s) => s.written?.rewrite_id).filter(Boolean))];
    const rewrites = ids.map((id) => recordsById.get(id)).filter(Boolean);
    const by = sentences.some((s) => s.written_by === "ai" || s.written_by === "correction") ? "ai" : sentences.some((s) => s.written_by === "ruling" || s.written_by === "market") ? "market" : "wikipedia";
    if (by === "ai") aiParagraphs++;
    for (const r of rewrites) { seenRec.add(r.id); last = Math.max(last, r.createdAt || 0); }
    for (const s of sentences) {
      if (!s.claim) continue;
      facts.add(s.claim.id);
      if (s.claim.status === "decided") decided.add(s.claim.id);
      else if (!s.claim.trades) unbet.add(s.claim.id);
      for (const x of [s.decided, ...(s.ruled ?? [])]) if (x?.decided_at) last = Math.max(last, x.decided_at);
    }
    return {
      index: p.index, section: p.section, written_by: by, changed: wikipedia !== null && market !== wikipedia,
      wikipedia, market, diff: wikipedia !== null && market !== wikipedia ? wordDiff(wikipedia, market) : null,
      sentences, rewrites: rewrites.map((r) => proofOf(r, network)),
    };
  });
  const used = [...seenRec].map((id) => recordsById.get(id));
  const models = [...new Set(used.map((r) => r.provenance?.model).filter(Boolean))];
  return {
    slug: article.slug, title: article.title,
    source: { url: article.url, attribution: article.attribution, licence: article.licence ?? "CC BY-SA 4.0", revised_at: article.revisedAt },
    totals: {
      paragraphs: paragraphs.length, written_by_ai: aiParagraphs, sentences: paragraphs.reduce((n, p) => n + p.sentences.length, 0),
      facts_priced: facts.size, facts_decided: decided.size, facts_no_bets: unbet.size,
      rewrites: used.length, signed: used.filter((r) => r.status === "signed").length, anchored: used.filter((r) => r.anchor?.status === "anchored").length,
      last_changed: last || null, models,
    },
    paragraphs, asOf: nowMs,
  };
}

/** One line of /api/pages: how much of a page the market has written. */
export const pageSummary = (state) => ({ slug: state.slug, title: state.title, ...state.totals, url: `/p/${state.slug}` });

// ---------- the record ----------

/** Where a decided news line's sources are: what it came from, what settled it, what the jury read. */
function sourcesOf(n, ruling) {
  const seen = new Set();
  const out = [];
  const add = (kind, label, url) => { if (url && !seen.has(url)) { seen.add(url); out.push({ kind, label, url }); } };
  add("settled_by", n.settles.source, n.settles.source_url);
  add("headline", n.source?.headline ?? null, n.source?.url);
  for (const s of ruling?.receipt_check?.sources ?? []) add("receipt", null, s.final_url ?? s.url);
  for (const u of n.coverage ?? []) add("coverage", null, u);
  return out;
}

/**
 * The record: each decided news line, in the market's words, newest first.
 * @param {{ doc: object|null, claims: object[], rulings?: object[], network?: string }} a
 */
export function recordOf({ doc, claims, rulings = [], network = "mainnet" }) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const settled = new Map();
  for (const r of rulings) if (r.status === "settled") settled.set(r.claim_id, r);
  const lines = [];
  for (const meta of Object.values(doc?.lines ?? {})) {
    const c = byId.get(meta.claim_id);
    if (!c || c.status !== "Settled") continue;
    const r = settled.get(c.id) ?? null;
    const n = newsField(meta);
    lines.push({
      claim_id: c.id, question: n.question, topic: n.topic, claim: c.text, outcome: OUTCOME(c),
      text: c.outcome === true ? c.text : ruledFalseSentence(c.text, r),
      decided_at: r?.settled_at ?? null, by: rulingView(r, c, network).by,
      sources: sourcesOf(n, r),
      ruling: { challenge_id: r?.challenge_id ?? c.challenge_id ?? null, url: `/c/${c.id}#ruling`, tx: r?.settle_tx ?? null, explorer: r?.settle_tx ? `${EXPLORER(network)}${r.settle_tx}` : null },
      market_url: `/c/${c.id}`,
    });
  }
  lines.sort((a, b) => (b.decided_at || 0) - (a.decided_at || 0) || b.claim_id - a.claim_id);
  return { lines, count: lines.length };
}

export { PAGE_WRITER };
