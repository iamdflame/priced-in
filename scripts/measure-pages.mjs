// The official pages, measured on the real pages, off-chain. Reads the mainnet market and its rulings,
// lays every live page out as the page API does, and rewrites every paragraph the sweep would, once, with
// the real writer: the real model, the real attestation preflight, the real signature check, and no
// anchor. Then the same sentences at set prices, so every band is tried on real text, not only the bands
// today's prices happen to be in. Nothing is opened, signed, posted or stored.
//
//   node scripts/measure-pages.mjs [--out deployments/pages-test.json] [--budget 1] [--no-bands] [--records]
//
// --records keeps every record the writer made, signature and exact bytes included, so they can be checked
// offline (verifyProvenance) and shown: the site's stand-in API serves deployments/pages-sweep.json's.
//
// NEARAI_API_KEY1 from .env (never printed). About $0.02 a run.
import { Attestor } from "../services/ai/src/nearai.js";
import { PAGE_WRITER, Writer, band, pageBand, pageRequest, parseRewriteReply, validatePageRewrite, validateRewrite } from "../services/ai/src/writer.js";
import { EventHub } from "../services/api/src/events.mjs";
import { RewriteStore } from "../services/api/src/rewrites.mjs";
import { claimsOf, evidenceFrom, livePages, officialWriter, pageState, readArticle, sweepPlan } from "../api/_lib/pages.mjs";
import { allClaims, env, meteredClient, write } from "./news-measure-lib.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "deployments/pages-test.json");
const MODEL = arg("--model", env.WRITER_MODEL || "z-ai/glm-5.3-flash");
const { wrap, spend } = await meteredClient({ budgetUsd: Number(arg("--budget", "1")) });
const round = (x, n = 6) => Number(x.toFixed(n));

// ---------- the real pages ----------

const claims = (await allClaims()).map((c) => ({ ...c, id: c.id ?? c.claim_id }));
const rulingsDoc = await (await fetch("https://isitpriced.com/api/rulings", { signal: AbortSignal.timeout(30_000) })).json();
const rulings = rulingsDoc.rulings || [];
const links = rulings.filter((r) => r.correction).map((r) => ({ old_claim_id: r.claim_id, new_claim_id: r.correction.claim_id, rewrite_id: r.correction.rewrite_id }));
const evidenceOf = evidenceFrom(rulings);
const live = livePages(claims, links);
const plan = sweepPlan({ pages: live, records: [], evidenceOf, nowMs: Date.now() });
const paragraphs = live.reduce((n, l) => n + l.paragraphs.length, 0);
const priced = live.reduce((n, l) => n + l.facts, 0);
console.log(`${claims.length} claims, ${live.length} live pages, ${paragraphs} paragraphs, ${priced} priced sentences, ${plan.length} paragraphs the sweep would write`);

// ---------- every paragraph the sweep would write, with the real writer ----------

const replies = []; // every model reply, in order
const base = wrap("sweep");
const client = { ...base, hasKey: true, chat: async (body, o) => { const r = await base.chat(body, o); replies.push({ content: r.content, usage: r.usage, body }); return r; }, signature: base.signature, attestationReport: base.attestationReport, models: base.models, model: base.model };
const attestor = new Attestor({ client, gpuVerifier: undefined, log: (m) => console.log(m.slice(0, 120)) });
const official = officialWriter({ links: () => links });
official.useRulings(rulings);
const writer = new Writer({ client, attestor, model: MODEL, store: new RewriteStore(), hub: new EventHub(), claims: null, official, modelTimeoutMs: 60_000, signatureDeadlineMs: 8000, lateRetriesMs: [], log: (m) => console.log(m.slice(0, 220)) });

const rows = [];
for (const x of plan) {
  const t0 = Date.now();
  const before = replies.length;
  const usdBefore = spend.usd;
  const rec = await writer.rewrite(x.page, x.index, x.claims, new Map(x.claims.map((c) => [c.id, c.price_yes_ppm])), { kind: "measure", claim_id: x.claim_id, txHash: null, trader: null, price_yes_ppm: x.price_yes_ppm, seq: null }).catch((e) => ({ status: "error", sentences: [], provenance: { reason: e.message } }));
  const mine = replies.slice(before);
  const sentences = rec?.sentences ?? [];
  // the first reply, through both checks
  let first = { old: null, page: null };
  try {
    const texts = parseRewriteReply(mine[0]?.content, sentences.map((s) => s.claim_id));
    const full = sentences.map((s) => ({ ...s, evidence: evidenceOf({ id: s.claim_id, text: s.claim }) }));
    first = { old: full.map((s, i) => validateRewrite(s, texts[i])).find(Boolean) ?? null, page: full.map((s, i) => validatePageRewrite(s, texts[i])).find(Boolean) ?? null };
  } catch (e) { first = { old: e.message, page: e.message }; }
  const row = {
    page: x.page, paragraph: x.index, status: rec?.status ?? "nothing", calls: mine.length, passed_first_time: !first.page && mine.length === 1, first_reply_old_check: first.old, first_reply_page_check: first.page,
    usd: round(spend.usd - usdBefore), prompt_tokens: mine.reduce((n, m) => n + (m.usage?.prompt_tokens ?? 0), 0), completion_tokens: mine.reduce((n, m) => n + (m.usage?.completion_tokens ?? 0), 0), ms: Date.now() - t0,
    reason: rec?.status === "signed" ? null : rec?.provenance?.reason ?? null,
    sentences: sentences.map((s) => ({ claim_id: s.claim_id, band: s.band, probability: round(s.probability, 3), claim: s.claim, text: s.text })),
  };
  rows.push(row);
  console.log(`${x.page}#${x.index} ${row.status} calls=${row.calls} $${row.usd} ${row.ms}ms${row.reason ? ` :: ${String(row.reason).slice(0, 140)}` : ""}`);
  for (const s of row.sentences) console.log(`   [${s.band} ${s.probability}] ${s.text}`);
}

// what the pages look like with these rewrites
const records = [...writer.store.byKey.values()].flat();
const pages = live.map(({ slug }) => pageState({ article: readArticle(slug), claims, records, links, rulings }));

// ---------- every band, on the real sentences ----------

const CASES = [["assert", 0.95], ["hedge", 0.76], ["hedge", 0.62], ["disputed", 0.5], ["hedge", 0.42], ["negate", 0.2]];
const bands = [];
if (!process.argv.includes("--no-bands")) {
  const chat = wrap("bands");
  const seen = new Set();
  const jobs = [];
  for (const l of live) {
    for (const p of l.paragraphs) {
      const list = claimsOf(p).filter((c) => !seen.has(c.id) && c.status !== "Settled");
      for (const c of list) seen.add(c.id);
      if (!list.length) continue;
      // only what the writer would send at that price: a line that hedges itself isn't hedged again
      for (const [b, price] of CASES) {
        const sent = list.filter((c) => pageBand({ ...c, status: "Open", trades: 1 }, price));
        if (sent.length) jobs.push({ page: l.slug, index: p.index, ctx: official.context(l.slug, p.index, list), band: b, price, list: sent });
      }
    }
  }
  console.log(`\n${jobs.length} requests at set prices`);
  const run = async (j) => {
    const sentences = j.list.map((c) => ({ claim_id: c.id, claim: c.text, probability: j.price, band: band(j.price), current: c.text }));
    const row = { page: j.page, paragraph: j.index, band: j.band, price: j.price, sentences: j.list.length, ok: false, why: null, texts: [] };
    try {
      const r = await chat.chat(pageRequest(MODEL, j.ctx, sentences), { timeoutMs: 60_000 });
      const texts = parseRewriteReply(r.content, sentences.map((s) => s.claim_id));
      row.texts = texts;
      row.why = sentences.map((s, i) => validatePageRewrite(s, texts[i])).find(Boolean) ?? null;
      row.ok = !row.why;
    } catch (e) { row.why = String(e.message).slice(0, 200); }
    bands.push(row);
    if (!row.ok) console.log(`  refused ${j.page}#${j.index} ${j.band} ${j.price}: ${row.why}`);
  };
  for (let i = 0; i < jobs.length; i += 5) await Promise.all(jobs.slice(i, i + 5).map(run));
}

// ---------- the numbers ----------

const asked = rows.filter((r) => r.calls > 0);
const signed = rows.filter((r) => r.status === "signed");
const sum = (l, f) => l.reduce((n, x) => n + f(x), 0);
const usd = sum(rows, (r) => r.usd);
const byBand = {};
for (const [b, p] of CASES) {
  const l = bands.filter((r) => r.band === b && r.price === p);
  byBand[`${b} at ${Math.round(p * 100)}%`] = { requests: l.length, passed: l.filter((r) => r.ok).length };
}
const summary = {
  at: new Date().toISOString(), model: MODEL, prompt: PAGE_WRITER, market: "market.isitpriced.near", note: "Off-chain: nothing was anchored, opened or stored.",
  live_pages: live.length, paragraphs, priced_sentences: priced, rewrites: rows.length,
  sentences_written: sum(rows, (r) => r.sentences.length),
  passed_first_time: rows.filter((r) => r.passed_first_time).length,
  passed_after_retry: signed.filter((r) => !r.passed_first_time).length + rows.filter((r) => r.status === "unsigned" && !r.passed_first_time).length,
  fell_back_to_template: rows.filter((r) => r.status === "template").length,
  signed: signed.length, unsigned: rows.filter((r) => r.status === "unsigned").length, other: rows.filter((r) => !["signed", "unsigned", "template"].includes(r.status)).length,
  usd_total: round(usd), usd_per_rewrite: asked.length ? round(usd / asked.length) : null, usd_per_rewrite_max: round(Math.max(0, ...rows.map((r) => r.usd))),
  ms_per_rewrite_avg: asked.length ? Math.round(sum(asked, (r) => r.ms) / asked.length) : null,
  tokens_per_rewrite: asked.length ? { prompt: Math.round(sum(asked, (r) => r.prompt_tokens) / asked.length), completion: Math.round(sum(asked, (r) => r.completion_tokens) / asked.length) } : null,
  full_sweep_usd: round(usd), band_cases: byBand, band_requests: bands.length, band_passed: bands.filter((r) => r.ok).length, spent_usd_all: round(spend.usd), model_calls: spend.calls,
  pages: pages.map((p) => ({ slug: p.slug, ...p.totals })),
};
write(OUT, { summary, rewrites: rows, bands, ...(process.argv.includes("--records") ? { records } : {}) });
console.log(JSON.stringify(summary, null, 1));
console.log(`\nwrote ${OUT}`);
