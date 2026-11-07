// GET /api/news, hourly (vercel.json), and POST /api/news?job=reports (the API's own call when a reader
// sends a report). Only Vercel's cron and this API can call it: Authorization: Bearer <CRON_SECRET>.
// Off unless NEWS_ENABLED=1: then it answers {"ok":true,"off":true} and does nothing at all.
//
// On, one round:
//   reports  readers' reports still waiting: the receipt check (every quote at its page, then the
//            three attested models asked whether the page supports it); a report that passes is
//            challenged by our Checker with its own bond, under the reports' own daily cap
//   settle   news lines whose date has passed (or due an early look): receipts found and checked the
//            same way; a line whose receipts pass is challenged for the outcome they show, under the
//            news lines' own cap, and the jury is called at once (the keeper finalizes it later)
//   scout    at NEWS_SCOUT_HOURS_UTC (06:00 and 18:00 by default): the feeds, the scout, the gate, and
//            each line that passed opens with the keeper's open_claim key, under the news lines' own cap
// Model calls count against the daily NEAR AI cap (NEARAI_DAILY_CAP_USD), like every other.

import { prepare, sendJson, runJob, log, recordEvents, txEvents } from "./_lib/runtime.mjs";
import { newsConfig, linesStore, scoutRound, settleRound, openPassed, postNewsChallenges, readCapacity, SCOUT_JOURNAL } from "./_lib/news.mjs";
import { REPORTS, reportsOf, refusalWords } from "./_lib/picks.mjs";
import { readFeeds, proposeClaims } from "../services/ai/src/scout.js";
import { reviewRequest, parseReviews, verifyOnWeb } from "../services/ai/src/gate.js";
import { findReceipts } from "../services/ai/src/settle.js";
import { checkReceipts, fetchSource } from "../services/ai/src/receipts.js";
import { supportPanel } from "../services/ai/src/support.js";
import { Attestor, NearAI } from "../services/ai/src/nearai.js";
import { Rpc } from "../services/api/src/rpc.mjs";

const RUN_MS = 285_000;

/** Call the jury at once for a challenge just posted (the cron's agents job is the fallback). */
async function triggerJury({ txHash, signerId }) {
  const host = process.env.SELF_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!host) return { ok: false, reason: "no address for this deployment: the cron's agents job runs the jury" };
  const r = await fetch(`${host.replace(/\/+$/, "")}/api/after-challenge`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.CRON_SECRET}` }, body: JSON.stringify({ txHash, signerId }), signal: AbortSignal.timeout(15_000) });
  return { ok: r.status === 202, status: r.status };
}

/** The models, the support panel and the chain, built once per run. */
function tools(p) {
  const client = new NearAI({ apiKey: p.ai.nearai.apiKey, baseUrl: p.ai.nearai.baseUrl, timeoutMs: 120_000 });
  const rpc = new Rpc(p.api.rpcUrls, { timeoutMs: 8000 });
  const view = (method, args = {}) => rpc.viewFunction(p.api.marketId, method, args);
  const attestor = new Attestor({ client, requireGpu: p.ai.requireGpu, dir: p.ai.attestationsDir, log });
  const support = client.hasKey ? supportPanel({ client, attestor, models: p.ai.jury.models, extrasOf: async (model) => JSON.parse(`{${(await view("get_model", { model }))?.extras_json || ""}}`), log }) : null;
  const check = (a) => checkReceipts({ ...a, fetchSource, support, log });
  return { client, rpc, view, check };
}

/** Work that needs the signer, under the keeper's lock: the keeper and these never send at once. */
const withSigner = (name, fn) => runJob(name, async ({ app, layer, started }) => {
  await started;
  const record = async (hash, sender) => { const r = await txEvents(app.rpc, prepare().api.marketId, hash, sender, { attempts: 3 }); await recordEvents(r.events); };
  return fn({ signer: layer.signer, view: (m, a = {}) => app.rpc.viewFunction(prepare().api.marketId, m, a), record });
}, { lock: "keeper", agents: false, waitMs: 60_000, budgetMs: 90_000 });

async function reportsRound(p, t, { left }) {
  const nowMs = Date.now();
  await p.journals.hydrate();
  const claims = (await p.claims.decorated()).claims;
  const events = p.journals.read("events.jsonl");
  const all = [...reportsOf(p.journals.read(REPORTS), { claims, events }).values()];
  const waiting = all.filter((r) => ["received", "retry", "verified"].includes(r.status) && nowMs - r.at < 2 * 86_400_000).sort((a, b) => a.at - b.at).slice(0, 3);
  const out = { waiting: waiting.length, checked: [], challenged: [], errors: [] };
  const status = (r, s, extra = {}) => p.journals.append(REPORTS, { t: "report_status", id: r.id, status: s, at: Date.now(), ...extra });
  const plans = [];
  for (const r of waiting) {
    if (left() < 100_000) break;
    const c = claims.find((x) => x.id === r.claim_id);
    if (!c || c.status !== "Open") { status(r, "closed", { reason: "The line stopped taking challenges before we could act on it." }); continue; }
    if (r.status !== "verified") {
      const check = await t.check({ claim: c.text, evidence: r.evidence, claimed: r.says === "true" });
      const summary = { result: check.result, reason: check.reason, support: check.support?.verdict ?? null };
      out.checked.push({ id: r.id, ...summary });
      const retry = check.result === "unfetchable" || check.support?.verdict === "unanswered";
      if (check.result === "verified" && !["unanswered", "unsupported"].includes(check.support?.verdict)) status(r, "verified", { check: summary });
      else if (retry && (r.attempts || 0) < 2) { status(r, "retry", { check: summary, attempts: (r.attempts || 0) + 1 }); continue; }
      else { status(r, "refused", { check: summary, reason: refusalWords(check) }); continue; }
    }
    plans.push({ claim_id: c.id, claimed_outcome: r.says === "true", evidence: r.evidence, intent: `report:${r.id}`, report_id: r.id, outcome: r.says === "true" ? "TRUE" : "FALSE" });
  }
  await p.journals.flush({ only: [REPORTS] }).catch(() => {});
  if (plans.length) {
    const job = await withSigner("news-reports", (s) => postNewsChallenges(plans, { ...s, trigger: triggerJury }, { kind: "report" }));
    const posted = job.ok ? job : { posted: [], errors: [job.error || "the keeper's lock stayed busy"] };
    for (const x of posted.posted) { status({ id: x.report_id }, "challenged", { challenge_id: x.challenge_id, tx: x.tx }); out.challenged.push(x); }
    out.errors.push(...(posted.errors || []));
    await p.journals.flush({ only: [REPORTS] }).catch(() => {});
  }
  return out;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return sendJson(res, 401, { error: { code: "unauthorized", message: "The news job is Vercel's cron's to call." } });
  const cfg = newsConfig();
  if (!cfg.enabled) return sendJson(res, 200, { ok: true, off: true, note: "News lines are off: NEWS_ENABLED is not 1." });
  let p;
  try { p = prepare(); } catch (e) { return sendJson(res, 503, { ok: false, error: e.message }); }
  const t0 = Date.now();
  const left = () => t0 + RUN_MS - Date.now();
  const url = new URL(req.url, "http://x");
  const job = url.searchParams.get("job") || "all";
  const t = tools(p);
  const store = linesStore(p.state);
  const claims = async () => { await p.claims.refresh().catch(() => {}); return (await p.claims.decorated()).claims; };
  const out = { at: new Date(t0).toISOString(), job };
  if (!t.client.hasKey) return sendJson(res, 200, { ...out, ok: false, note: "NEARAI_API_KEY is not set: the scout and the settler need a model." });
  await p.journals.hydrate().catch(() => {});

  if (job === "all" || job === "reports") {
    try { out.reports = await reportsRound(p, t, { left }); } catch (e) { out.reports = { error: e.message }; }
  }
  if ((job === "all" || job === "settle") && left() > 120_000) {
    try {
      out.settle = await settleRound({
        cfg, store, claims, left,
        find: (meta, nowMs) => findReceipts({ client: t.client, line: { claim: meta.claim, question: meta.question, settles: meta.settles }, nowMs }),
        check: t.check,
        challenge: async (plans) => {
          const r = await withSigner("news-settle", (s) => postNewsChallenges(plans, { ...s, trigger: triggerJury }));
          return r.ok ? r : { posted: [], errors: [r.error || "the keeper's lock stayed busy"] };
        },
      });
    } catch (e) { out.settle = { error: e.message }; }
  }
  if ((job === "all" || job === "scout") && left() > 150_000) {
    try {
      out.scout = await scoutRound({
        cfg, store, claims, force: url.searchParams.get("force") === "1",
        journal: (rec) => p.journals.append(SCOUT_JOURNAL, rec),
        readFeeds: () => readFeeds({ feeds: cfg.feeds }),
        propose: (headlines, nowMs) => proposeClaims({ client: t.client, model: cfg.scoutModel, headlines, nowMs }),
        review: async (cands) => parseReviews((await t.client.chat(reviewRequest(cfg.reviewModel, cands, Date.now()), { timeoutMs: 90_000 })).content, cands.length),
        verify: (c) => verifyOnWeb({ client: t.client, model: cfg.verifyModel, candidate: c }),
        capacity: () => readCapacity(t.rpc, p.api.marketId),
        open: async (pass, ctx) => {
          const r = await withSigner("news-open", (s) => openPassed(pass, ctx, s));
          return r.ok ? r : { opened: [], errors: [r.error || "the keeper's lock stayed busy"], failed: pass.map((d) => ({ candidate_id: d.id, error: "the keeper's lock stayed busy" })) };
        },
      });
    } catch (e) { out.scout = { error: e.message }; }
  }
  await p.spend.settle();
  await p.journals.flush({ only: ["spend.jsonl", SCOUT_JOURNAL, REPORTS] }).catch((e) => log(`news: flush: ${e.message}`));
  out.ms = Date.now() - t0;
  out.spend = p.spend.status();
  const failed = [out.reports, out.settle, out.scout].some((x) => x?.error);
  log(`news: ${JSON.stringify(out).slice(0, 600)}`);
  return sendJson(res, failed ? 500 : 200, { ok: !failed, ...out });
}
