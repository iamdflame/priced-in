// Settling, backtested on last week's news. The real test of news lines: can the pipeline settle
// them, do its receipts verify, and does the jury rule the way the world went?
//
//   1. the scout as of 7 to 14 days ago: Google News search feeds limited with after: and before:, the
//      scout model told it is that day, and the gate's code blocklist and second model as of that day
//      (the web check can't look back in time, so it is skipped; capacity is not the question here)
//   2. each claim that passed, settled today: NEAR AI web search plus the settling source's own page,
//      fetched as the receipt check fetches; one model picks TRUE, FALSE or UNKNOWN with exact quotes
//   3. the production receipt check on that evidence: every quote at its source, then the three
//      attested models asked whether the source supports it (support.js), as our jury runner requires
//   4. the jury: the contract's exact request to the three models; two of three make the ruling
//   5. an independent check, blind to all of the above: a web search by another model asks what happened
//
// Nothing on-chain: nothing is signed, posted or opened, and no money moves.
//
//   node scripts/measure-news-settle.mjs [--asof 2026-10-24,2026-10-29] [--max 16] [--budget 1.2] [--out deployments/news-settle-test.json]
//
// NEARAI_API_KEY1 from .env (never printed). About $0.03 a claim.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFeeds, proposeClaims, googleSearch, dateWords, isoDay, endOfDay, claimText, NO_THINKING } from "../services/ai/src/scout.js";
import { runGate, reviewRequest, parseReviews, REVIEW_MODEL, searchResults } from "../services/ai/src/gate.js";
import { findReceipts, firstPassing } from "../services/ai/src/settle.js";
import { checkReceipts, fetchSource } from "../services/ai/src/receipts.js";
import { supportPanel } from "../services/ai/src/support.js";
import { Attestor } from "../services/ai/src/nearai.js";
import { meteredClient, juryPanel, JURY_MODELS, write, ROOT } from "./news-measure-lib.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "deployments/news-settle-test.json");
const AS_OF = arg("--asof", "2026-10-24,2026-10-29").split(",").map((s) => s.trim()).filter(Boolean);
const MAX = Number(arg("--max", "16"));
const INDEPENDENT_MODEL = arg("--independent", "deepseek-ai/DeepSeek-V4.1-Flash-1017");
const now = Date.now();
const { client: raw, wrap, spend } = await meteredClient({ budgetUsd: Number(arg("--budget", "1.2")) });

// the feeds as they were: one Google News search per topic, limited to the days before the as-of date
const TOPIC_QUERIES = {
  football: "football transfer OR manager OR \"in talks\" OR bid OR contract",
  sports: "NFL OR NBA OR MLB OR NHL OR F1 trade OR contract OR signing OR deal",
  money: "merger OR acquisition OR \"in talks\" OR stake OR IPO OR layoffs reportedly",
  tech: "Apple OR Google OR Microsoft OR OpenAI OR Nvidia OR Meta OR Amazon reportedly OR plans OR launch",
  entertainment: "Netflix OR Disney OR Warner OR studio OR sequel OR series OR album reportedly OR announce",
  officials: "government OR minister OR \"White House\" OR regulator plans OR announce OR expected",
  crypto: "crypto OR bitcoin OR ethereum OR stablecoin OR ETF approval OR listing",
  rumours: "\"sources say\" OR reportedly OR rumor OR \"in talks\" OR leak",
};
const day = (s, add) => isoDay(Date.parse(`${s}T00:00:00Z`) + add * 86_400_000);

const attestor = new Attestor({ client: raw, dir: fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-news-att-")), requireGpu: true, log: () => {} });
const support = supportPanel({ client: wrap("support"), attestor, models: JURY_MODELS.map((m) => m.model), extrasOf: async (m) => JURY_MODELS.find((x) => x.model === m)?.extras || {} });

const INDEPENDENT = (line) => [
  `Today is ${dateWords(isoDay(now))}. Use web search, then answer.`,
  `Did ${line.settles.source || "the people involved"} confirm this on or before ${line.settles.by_words}: "${line.statement}"`,
  "The first line of your answer must be exactly one of: ANSWER: TRUE (confirmed on or before that date), ANSWER: FALSE (denied, or not confirmed by that date), ANSWER: UNKNOWN (you can't tell).",
  "Then one sentence naming the source and the date it was confirmed or denied.",
].join("\n");

const rows = [];
const scouted = [];
// --reuse <file>: settle the claims an earlier run scouted, with today's claim text and settler (a before and after on the same claims)
const REUSE = arg("--reuse", null);
if (REUSE) {
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, REUSE), "utf8"));
  scouted.push(...(prev.summary.scouted || []).map((s) => ({ ...s, reused_from: REUSE })));
  for (const r of prev.results) {
    const statement = r.claim.replace(/^By [^,]+,\s*/, "").replace(/\s*Reports citing unnamed sources don't count\.?$/, "");
    rows.push({ as_of: r.as_of, candidate: { claim: claimText(statement, r.settles.by), question: r.question, statement, topic: r.topic, source: { headline: r.headline }, settles: r.settles, estimate: r.estimate }, review: { definite: r.definite } });
  }
}
for (const asOf of REUSE ? [] : AS_OF) {
  const asOfMs = Date.parse(`${asOf}T12:00:00Z`);
  const feeds = Object.entries(TOPIC_QUERIES).map(([id, q]) => ({ id, url: googleSearch(`${q} after:${day(asOf, -3)} before:${day(asOf, 1)}`) }));
  const { headlines, feeds: fr } = await readFeeds({ feeds, nowMs: asOfMs, since: asOfMs - 4 * 86_400_000, until: asOfMs + 12 * 3600_000 });
  const scout = await proposeClaims({ client: wrap("scout"), headlines, nowMs: asOfMs });
  const gate = await runGate({
    candidates: scout.candidates, nowMs: asOfMs,
    review: async (cands) => parseReviews((await wrap("review").chat(reviewRequest(REVIEW_MODEL, cands, asOfMs), { timeoutMs: 120_000 })).content, cands.length),
    verify: null, open: [], perDay: 99, bMicro: 1_450_000, floorMicro: 0,
    capacity: { treasuryMicro: "1000000000000", reservedMicro: "0", capMicro: "1000000000000", laneBudgetMicro: "0" },
  });
  scouted.push({ as_of: asOf, headlines: headlines.length, feeds: fr, candidates: gate.counts.candidates, refused: Object.fromEntries(Object.entries(gate.counts).filter(([k]) => k.startsWith("refused_")).map(([k, v]) => [k.slice(8), v])), passed: gate.pass.length, refusals: gate.decisions.filter((d) => d.status === "refused").map((d) => ({ question: d.candidate.question, at: d.failed, reason: d.reason })) });
  console.log(`as of ${asOf}: ${headlines.length} headlines, ${gate.counts.candidates} candidates, ${gate.pass.length} passed`);
  for (const d of gate.pass) rows.push({ as_of: asOf, candidate: d.candidate, review: d.review });
}

const lines = rows.filter((r) => endOfDay(r.candidate.settles.by) <= now).slice(0, MAX);
console.log(`settling ${lines.length} claims whose date has passed`);
const results = [];
for (const r of lines) {
  const c = r.candidate;
  const line = { claim: c.claim, question: c.question, statement: c.statement, settles: c.settles };
  const out = { as_of: r.as_of, question: c.question, claim: c.claim, topic: c.topic, headline: c.source?.headline ?? null, settles: c.settles, estimate: c.estimate, definite: r.review?.definite ?? null };
  try {
    const f = await findReceipts({ client: wrap("settle"), line, nowMs: now });
    out.pipeline = { outcome: f.outcome, basis: f.basis, when: f.when, receipts: f.receipts, reason: f.reason, sources_read: f.sources.filter((s) => !s.error).length, sources_tried: f.sources.length, dropped_quotes: f.dropped.length, search: f.search };
    out.evidence = f.evidence;
    if (f.evidence) {
      const passed = await firstPassing((a) => checkReceipts({ ...a, fetchSource, support }), { claim: c.claim, claimed: f.outcome === "TRUE", variants: f.variants });
      const check = passed.check;
      out.receipt_check = { result: check.result, reason: check.reason, tries: passed.tries, support: check.support ? { verdict: check.support.verdict, unanimous: check.support.unanimous, answers: check.support.answers.map((a) => ({ model: a.model, answer: a.answer, verified: a.verified })) } : null };
      out.jury_would_be_called = Boolean(passed.evidence);
      // the jury reads what production would post; a line refused above is still asked, to see what a stranger's challenge would get
      out.jury = await juryPanel(wrap("jury"), { claim: c.claim, evidence: passed.evidence || f.evidence, n: 950 + results.length });
    }
  } catch (e) { out.error = String(e.message).slice(0, 300); }
  try {
    const ind = await wrap("independent").chatStream({ model: INDEPENDENT_MODEL, messages: [{ role: "user", content: INDEPENDENT(line) }], tools: [{ type: "web_context_search" }], max_tokens: 400, ...(NO_THINKING[INDEPENDENT_MODEL] || {}) }, { timeoutMs: 90_000 });
    const m = /ANSWER:\s*\**\s*(TRUE|FALSE|UNKNOWN)/i.exec(ind.content || "");
    out.independent = { model: INDEPENDENT_MODEL, answer: m ? m[1].toUpperCase() : "UNPARSEABLE", searched: searchResults(ind).length, note: String(ind.content || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(1, 3).join(" ").slice(0, 300) };
  } catch (e) { out.independent = { model: INDEPENDENT_MODEL, answer: "ERROR", note: String(e.message).slice(0, 200) }; }
  const p = out.jury?.panel ?? null;
  out.agrees = p && (p === "TRUE" || p === "FALSE") && ["TRUE", "FALSE"].includes(out.independent.answer) ? p === out.independent.answer : null;
  results.push(out);
  console.log(`${String(out.pipeline?.outcome ?? "ERR").padEnd(7)} ${String(out.receipt_check?.result ?? "-").padEnd(15)} support ${String(out.receipt_check?.support?.verdict ?? "-").padEnd(11)} jury ${String(p ?? "-").padEnd(9)} independent ${out.independent.answer.padEnd(8)} ${c.question}`);
}

const n = (f) => results.filter(f).length;
const settled = results.filter((r) => r.pipeline && r.pipeline.outcome !== "UNKNOWN");
const ruled = results.filter((r) => r.jury && ["TRUE", "FALSE"].includes(r.jury.panel));
const byBasis = {};
for (const r of settled) {
  const b = (byBasis[r.pipeline.basis] ||= { found: 0, receipts_verified: 0, support_ok: 0, jury_called: 0, jury_ruled_as_claimed: 0, jury_no_quorum: 0, matches_independent: 0, independent_known: 0 });
  b.found++;
  if (r.receipt_check?.result === "verified") b.receipts_verified++;
  if (r.receipt_check?.result === "verified" && r.receipt_check.support?.verdict !== "unanswered") b.support_ok++;
  if (r.jury_would_be_called) b.jury_called++;
  if (r.jury?.panel === r.pipeline.outcome) b.jury_ruled_as_claimed++;
  if (r.jury && !["TRUE", "FALSE"].includes(r.jury.panel)) b.jury_no_quorum++;
  if (["TRUE", "FALSE"].includes(r.independent?.answer)) { b.independent_known++; if (r.agrees) b.matches_independent++; }
}
const summary = {
  at: new Date(now).toISOString(),
  method: "As-of scouting on Google News search feeds (after:/before:), the scout and the gate's code blocklist and second model as of that day; settling today with NEAR AI web search plus the settling source, the production receipt check with the attested support panel, the contract's jury request to the three models (two of three), and an independent web-search check by another model, blind to the rest. One run; nothing on-chain.",
  as_of: AS_OF,
  scouted,
  claims_settled_today: results.length,
  pipeline: { true: n((r) => r.pipeline?.outcome === "TRUE"), false: n((r) => r.pipeline?.outcome === "FALSE"), unknown: n((r) => r.pipeline?.outcome === "UNKNOWN"), errors: n((r) => r.error), search_failed: n((r) => r.pipeline?.search?.error) },
  // would the gate's NEWS_REQUIRE_DEFINITE have changed anything? claims with a definite event against the rest
  definite: Object.fromEntries([true, false].map((v) => [v, { claims: n((r) => r.definite === v), challenged: n((r) => r.definite === v && r.jury_would_be_called), jury_ruled: n((r) => r.definite === v && r.jury_would_be_called && ["TRUE", "FALSE"].includes(r.jury?.panel)) }])),
  receipts_verified: n((r) => r.receipt_check?.result === "verified"),
  receipt_results: Object.fromEntries([...new Set(results.map((r) => r.receipt_check?.result).filter(Boolean))].map((k) => [k, n((r) => r.receipt_check?.result === k)])),
  jury_would_be_called: n((r) => r.jury_would_be_called),
  jury_ruled: ruled.length,
  jury_ruled_as_the_pipeline_claimed: n((r) => r.jury && r.pipeline && r.jury.panel === r.pipeline.outcome),
  jury_matches_independent: n((r) => r.agrees === true),
  jury_differs_from_independent: n((r) => r.agrees === false),
  by_basis: byBasis,
  spend_usd: Number(spend.usd.toFixed(4)),
  spend_by_step: Object.fromEntries(Object.entries(spend.byPurpose).map(([k, v]) => [k, Number(v.toFixed(4))])),
};
write(OUT, { summary, results });
console.log(JSON.stringify(summary, null, 1));
