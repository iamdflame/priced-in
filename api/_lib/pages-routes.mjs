// The official pages' routes and the cron's sweep. api/index.mjs reads these only when
// OFFICIAL_PAGES=1; off, none of them exist and every path answers as it did before (404).
//
//   GET /api/pages           every live page: how much of it the AI has written
//   GET /api/pages/<slug>    one page, per paragraph: Wikipedia's words, the market's, the proof
//   GET /api/record          each decided news line (empty while NEWS_ENABLED is off)
//   GET /v1/pages, /v1/pages/<slug>, /v1/record   the same, for agents: free, like /v1/quote
//
// docs/API.md has every shape.

import { articleIndex, evidenceFrom, latestRecords, livePages, pageState, pageSummary, pagesConfig, readArticle, recordOf, sweepRound } from "./pages.mjs";
import { readRulings } from "./rulings.mjs";
import { readLedger } from "./sentinel.mjs";
import { cachedLines, newsConfig } from "./news.mjs";
import { priceHistory } from "./views.mjs";

export const SWEEP_DOC = "snapshots/pages-sweep.json";
export const PAGES_CACHE = "public, max-age=0, s-maxage=10, stale-while-revalidate=60";
const PAGE = /^\/(?:v1\/)?pages(?:\/([^/]+))?$/;
const RECORD = /^\/(?:v1\/)?record$/;
export const isPagesRoute = (route) => PAGE.test(route) || RECORD.test(route);

/** Claims, corrections, rewrites, rulings and prices: everything a page is made of. */
async function facts(p) {
  const snap = await p.claims.decorated();
  const ledger = await readLedger(p.state).catch(() => null);
  const rulings = await readRulings(p, snap.claims, { ledger });
  const history = priceHistory(p.journals.readCached("events.jsonl"), snap.claims, { at: snap.at });
  return { claims: snap.claims, asOf: snap.at, rulings, history, links: p.journals.readCached("links.jsonl"), records: latestRecords(p.journals.readCached("rewrites.jsonl")) };
}

async function record(p, f) {
  if (!newsConfig(p.env).enabled) return { lines: [], count: 0 };
  const doc = await cachedLines(p.state).catch(() => null);
  return recordOf({ doc, claims: f.claims, rulings: f.rulings, network: p.api.network });
}

/** Answer a page route: { status, body, headers }. */
export async function pagesRoute(route, p, { articles = articleIndex() } = {}) {
  const headers = { "cache-control": PAGES_CACHE };
  const network = p.api.network;
  const m = PAGE.exec(route);
  if (m?.[1]) {
    const article = readArticle(m[1], p.articlesDir);
    if (!article) return { status: 404, body: { error: { code: "no_such_page", message: `No page ${String(m[1]).slice(0, 64)}.` } } };
    const f = await facts(p);
    return { status: 200, body: { ...pageState({ article, ...f, network }), asOf: f.asOf }, headers };
  }
  const f = await facts(p);
  if (!m) return { status: 200, body: { ...(await record(p, f)), asOf: f.asOf }, headers };
  const pages = livePages(f.claims, f.links, p.articlesDir).map(({ slug }) => pageSummary(pageState({ article: readArticle(slug, p.articlesDir), ...f, network })));
  const sweep = (await p.state.getDoc(SWEEP_DOC).catch(() => null))?.value ?? null;
  return { status: 200, body: { pages, count: pages.length, encyclopedia: articles.length, record: { count: (await record(p, f)).count }, sweep, asOf: f.asOf }, headers };
}

/** The cron's sweep, inside the writer's job. Undefined with the flag off. */
export async function cronSweep({ p, app, layer, deadline, log = () => {} }) {
  const cfg = pagesConfig(p.env);
  if (!cfg.enabled) return undefined;
  if (!layer.writer?.official || layer.writer.modelReason) return { off: true, why: layer.writer?.modelReason ?? "no writer" };
  const claims = await app.claims.all();
  const ledger = await readLedger(p.state).catch(() => null);
  const rulings = await readRulings(p, claims, { ledger }).catch(() => []);
  layer.writer.official.useRulings(rulings);
  const out = await sweepRound({
    cfg, pages: livePages(claims, p.journals.read("links.jsonl")), records: latestRecords(p.journals.read("rewrites.jsonl")), evidenceOf: evidenceFrom(rulings),
    spend: async () => { await p.spend.settle(); return p.spend.status(); },
    rewrite: (...a) => layer.writer.rewrite(...a),
    left: () => deadline - Date.now(), log,
  });
  await p.state.updateDoc(SWEEP_DOC, () => out).catch((e) => log(`sweep: record: ${e.message}`));
  return out;
}
