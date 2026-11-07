// GET /api/cron, every 10 minutes (vercel.json). One bounded round:
//   index: every transaction to the market not read yet, into events.jsonl (and the backfill)
//   keeper (its own lock; the ruling loop goes first, because money waits on it):
//     1. finalize every challenge whose window has ended, expire every one past its jury deadline
//     2. a caught line ruled FALSE opens its corrected wording as a new linked market
//     3. the daily sitting: the Checker challenges the caught line with the most bets, one at a
//        time; the jury is called at once. A cap reached or nothing eligible is quiet, not a failure
//   writer (the writer's lock, no agent key):
//     4. a signed correction the keeper asked for (a line ruled FALSE with none yet)
//     5. anchor any signed rewrite not anchored yet (anchor_rewrite through the signer)
//     6. if nothing happened for 20 hours, refresh the stalest paragraph at today's prices
//     6b. with OFFICIAL_PAGES=1, the page sweep: the paragraphs due a rewrite, stalest first (api/_lib/pages.mjs)
//   agents (the jobs' lock, given up between steps when a visitor's trade is waiting for it):
//     7. the agents' cycle: roster, open intents reconciled, settled winnings redeemed; then a look
//        at the stalest open claims (they bet only when their signed credence beats the price,
//        and post why not when it doesn't)
//     8. challenges still waiting for the jury, before their deadline, once their receipts verify
//        (a challenge whose receipts failed is not sent to the models again: the Sentinel watches it)
//   receipts: a past challenge with no receipt check yet, whose evidence our corpus can check
//     with no fetch (the Checker's), gets one, so every ruling on /api/rulings says what it rested on
//   9. the health check: a trade, a rewrite or an agent's answer in the last day, else it fails
// The Sentinel (GET /api/sentinel) runs every minute on its own: a 10-minute window can't wait for this.
// Model calls stop at the daily NEAR AI cap (NEARAI_DAILY_CAP_USD, $1), enforced in code.

import { prepare, sendJson, runJob, log, recordEvents, txEvents } from "./_lib/runtime.mjs";
import { Indexer, sourcesFor } from "./_lib/indexer.mjs";
import { keeperRound, sittingConfig } from "./_lib/keeper.mjs";
import { isNewsPage } from "./_lib/news.mjs";
import { readRulings } from "./_lib/rulings.mjs";
import { putCheck, readLedger } from "./_lib/sentinel.mjs";
import { checkReceipts, FAILED, unsettled } from "../services/ai/src/receipts.js";
import { Rpc } from "../services/api/src/rpc.mjs";
import { labelSentences, PRICEABLE } from "../services/api/src/planner.mjs";
import { cronSweep } from "./_lib/pages-routes.mjs";

const RUN_MS = 285_000; // Vercel stops this function at 300 s
const CORRECTIONS = "keeper/corrections.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Call the jury at once for a challenge the Checker just posted; the agents job below is the fallback. */
async function triggerJury({ txHash, signerId }) {
  const host = process.env.SELF_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!host) return { ok: false, reason: "no address for this deployment: the cron's agents job runs the jury" };
  const r = await fetch(`${host.replace(/\/+$/, "")}/api/after-challenge`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.CRON_SECRET}` }, body: JSON.stringify({ txHash, signerId }), signal: AbortSignal.timeout(15_000) });
  return { ok: r.status === 202, status: r.status };
}

/** The open lines no agent traded or answered in the last day (the promise is: none). */
function coverage(p, claims, now = Date.now()) {
  const since = now - 24 * 3600_000;
  const seen = new Set();
  for (const r of p.journals.read("rationales.jsonl")) if ((r.at || 0) >= since) seen.add(r.claim_id);
  const open = claims.filter((c) => c.status === "Open");
  const missing = open.filter((c) => !seen.has(c.id)).map((c) => c.id);
  return { open: open.length, answered_today: open.length - missing.length, missing };
}

function newestOutcome(p) {
  const trade = Math.max(0, ...p.journals.read("events.jsonl").filter((e) => e.event === "trade").map((e) => e.blockTimestampMs || e.seenAtMs || 0));
  const rewrite = Math.max(0, ...p.journals.read("rewrites.jsonl").filter((x) => !x.evidence_file).map((x) => x.createdAt || 0)); // a new rewrite, not a re-anchored one
  const answer = Math.max(0, ...p.journals.read("rationales.jsonl").map((x) => x.at || 0));
  return { trade, rewrite, answer };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return sendJson(res, 401, { error: { code: "unauthorized", message: "The cron is Vercel's to call." } });
  const p = prepare();
  const t0 = Date.now();
  const failures = [];
  const remaining = () => t0 + RUN_MS - Date.now();

  // the market's transactions, before anything reads them
  let index = null;
  try {
    const ix = new Indexer({ state: p.state, rpc: new Rpc(p.api.rpcUrls, { timeoutMs: 8000 }), marketId: p.api.marketId, sources: sourcesFor(p.api.network, p.api.marketId), record: recordEvents, log });
    index = await ix.run({ mode: "full", budgetMs: 25_000 });
    if (!index.source) failures.push(`index: no source answered (${index.errors.join("; ").slice(0, 200)})`);
  } catch (e) { failures.push(`index: ${e.message}`); }

  let keeper;
  try {
    keeper = await runJob("cron-keeper", async ({ app, layer, started, deadline }) => {
      await started;
      const fresh = async () => { await p.claims.refresh().catch(() => {}); return (await p.claims.decorated()).claims; };
      const pc = p.api.planner;
      const round = await keeperRound({
        signer: layer.signer,
        view: (method, args = {}) => app.rpc.viewFunction(p.api.marketId, method, args),
        claims: fresh,
        events: () => p.journals.read("events.jsonl"),
        rewrites: () => p.journals.read("rewrites.jsonl"),
        links: () => p.journals.read("links.jsonl"),
        addLink: async (l) => {
          p.journals.append("links.jsonl", l);
          await p.journals.flush();
          await p.state.updateDoc("snapshots/links.json", (cur = {}) => ({ ...cur, [l.old_claim_id]: l.new_claim_id }));
        },
        wantCorrection: (id) => p.state.updateDoc(CORRECTIONS, (cur = {}) => ({ ...cur, [id]: cur[id] ?? Date.now() })),
        record: async (hash, sender) => { const r = await txEvents(app.rpc, p.api.marketId, hash, sender, { attempts: 3 }); await recordEvents(r.events); },
        trigger: triggerJury,
        rulings: async (claims) => readRulings(p, claims, { ledger: await readLedger(p.state).catch(() => null) }),
        plannerP0: pc.apiKey && pc.model && p.spend.status().open ? async (text) => { const [l] = await labelSentences(pc, [text]); return PRICEABLE.has(l?.label) ? l.p0_ppm : null; } : null,
        sitting: sittingConfig(),
        checkerOn: process.env.CHECKER_ENABLED !== "0",
        left: () => deadline - Date.now(),
        log,
      });
      await p.state.updateDoc("snapshots/keeper.json", () => round).catch((e) => log(`keeper: record: ${e.message}`));
      return { round };
    }, { lock: "keeper", agents: false, waitMs: 5_000, budgetMs: 60_000 });
  } catch (e) { keeper = { ok: false, error: e.message }; }
  for (const e of keeper.round?.errors || []) failures.push(`keeper: ${e}`);

  // receipts for past rulings that have none: only what the committed corpus can check, no fetch
  let receipts = null;
  try {
    const ledger = await readLedger(p.state);
    const rulings = await readRulings(p, (await p.claims.decorated()).claims);
    receipts = { checked: 0 };
    for (const r of rulings) {
      if (receipts.checked >= 10 || ledger.checks[r.challenge_id] || !r.evidence || !r.claim) continue;
      const c = await checkReceipts({ claim: r.claim, evidence: r.evidence, claimed: r.claimed === "TRUE" ? true : r.claimed === "FALSE" ? false : null, fetchSource: null });
      if (c.via === "source") continue; // a live source: the jury's gate or the Sentinel checks it
      await putCheck(p.state, r.challenge_id, c);
      receipts.checked++;
    }
  } catch (e) { log(`cron: receipts backfill: ${e.message}`); }

  const writer = await runJob("cron-writer", async ({ app, layer, started, reanchor, deadline }) => {
    const out = {};
    await started;
    // a line ruled FALSE with no signed correction yet: its paragraph is rewritten with that line at 0
    const wanted = (await p.state.getDoc(CORRECTIONS).catch(() => null))?.value || {};
    if (layer.writer && Object.keys(wanted).length && p.spend.status().open) {
      out.corrections = [];
      const claims = await app.claims.all();
      for (const key of Object.keys(wanted).slice(0, 2)) {
        const c = claims.find((x) => x.id === Number(key));
        const paras = c ? layer.writer.paragraphsFor(c.page, claims.filter((x) => x.page === c.page)) : [];
        const i = paras.findIndex((para) => para.some((x) => x.id === Number(key)));
        if (i >= 0 && deadline - Date.now() > 45_000) {
          const prices = new Map(paras[i].map((x) => [x.id, x.price_yes_ppm]));
          prices.set(c.id, 0);
          const rec = await layer.writer.rewrite(c.page, i, paras[i], prices, { kind: "ruling", claim_id: c.id, txHash: null, trader: null, price_yes_ppm: 0, seq: null }).catch((e) => { failures.push(`correction ${key}: ${e.message}`); return null; });
          out.corrections.push(rec ? `${rec.id} ${rec.status}` : null);
        }
        await p.state.updateDoc(CORRECTIONS, (cur = {}) => { const { [key]: _done, ...rest } = cur; return rest; }).catch(() => {});
      }
    }
    // the writer's own reanchor, bounded by this run's time: a backlog drains over several runs
    if (reanchor && layer.writer) {
      out.reanchored = 0;
      const todo = [];
      for (const list of layer.writer.store.byKey.values()) for (const r of list) if (r.status === "signed" && r.anchor?.status !== "anchored") todo.push(r);
      for (const r of todo) {
        if (deadline - Date.now() < 45_000) { out.anchor_backlog = todo.length - out.reanchored; break; }
        await layer.writer.anchor(r).catch((e) => failures.push(`anchor ${r.id}: ${e.message}`));
        out.reanchored++;
      }
    }
    const last = newestOutcome(p);
    const newest = Math.max(last.trade, last.rewrite, last.answer);
    if (layer.writer && Date.now() - newest > 20 * 3600_000 && deadline - Date.now() > 60_000 && p.spend.status().open) {
      const claims = (await app.claims.all()).filter((c) => c.status === "Open");
      let stalest = null;
      for (const page of [...new Set(claims.map((c) => c.page))].filter((pg) => !isNewsPage(pg))) {
        layer.writer.paragraphsFor(page, claims.filter((c) => c.page === page)).forEach((para, i) => {
          const at = app.rewrites.byPage(page).find((x) => x.paragraph === i)?.createdAt || 0;
          if (para.length && (!stalest || at < stalest.at)) stalest = { page, i, para, at };
        });
      }
      if (stalest) {
        const prices = new Map(stalest.para.map((c) => [c.id, c.price_yes_ppm]));
        const rec = await layer.writer.rewrite(stalest.page, stalest.i, stalest.para, prices, { kind: "refresh", claim_id: stalest.para[0].id, txHash: null, trader: null, price_yes_ppm: stalest.para[0].price_yes_ppm, seq: null });
        out.refreshed = rec ? `${rec.id} ${rec.status}` : null;
      }
    }
    const sweep = await cronSweep({ p, app, layer, deadline, log }).catch((e) => { failures.push(`sweep: ${e.message}`); return null; });
    if (sweep !== undefined) out.sweep = sweep;
    out.compacted = await p.journals.compact().catch((e) => { failures.push(`compact: ${e.message}`); return 0; });
    return out;
  }, { lock: "writer", agents: false, waitMs: 20_000, budgetMs: Math.max(50_000, Math.min(100_000, remaining() - 130_000)), reanchor: true });

  const agents = await runJob("cron-agents", async ({ app, layer, started, deadline, wanted, track }) => {
    const out = {};
    await started;
    const left = () => deadline - Date.now();
    if (layer.crowd) {
      // starting the AI layer ran the crowd's first cycle; wait for it to finish
      const tc = Date.now();
      while (layer.crowd.stats.lastCycleAt === 0 && Date.now() - tc < 60_000) await sleep(250);
      if (layer.crowd.stats.lastCycleError) failures.push(`agents cycle: ${layer.crowd.stats.lastCycleError}`);
      const sw = await p.state.getDoc("snapshots/sweep.json").catch(() => null);
      const lastBy = sw?.value || {};
      for (const a of layer.crowd.roster) for (const [cid, t] of Object.entries(lastBy)) layer.crowd.last.set(`${a.accountId}|${cid}`, t);
      out.swept = [];
      for (let i = 0; i < 2; i++) {
        if (left() < 60_000 || !p.spend.status().open) break;
        if (await wanted()) { out.yielded = "a visitor's trade is waiting for the agents"; break; }
        const before = new Map(layer.crowd.last);
        await layer.crowd.sweep(1).catch((e) => failures.push(`agents sweep: ${e.message}`));
        const looked = {};
        for (const [k, t] of layer.crowd.last) if (before.get(k) !== t) looked[k.split("|")[1]] = t;
        out.swept.push(...Object.keys(looked).map(Number));
        await p.state.updateDoc("snapshots/sweep.json", (cur = {}) => ({ ...cur, ...looked })).catch(() => {});
      }
    } else out.agents = "off";
    if (layer.jury && left() > 60_000 && !out.yielded) {
      const stats = await app.rpc.viewFunction(p.api.marketId, "stats", {});
      const ledger = await readLedger(p.state).catch(() => ({ checks: {} }));
      out.jury = [];
      for (let id = Math.max(0, stats.challenges - 20); id < stats.challenges; id++) {
        const ch = await app.rpc.viewFunction(p.api.marketId, "get_challenge", { challenge_id: id }).catch(() => null);
        if (!ch || ch.resolved) continue;
        const ruled = new Set(ch.verdicts.map((v) => v.model));
        if (layer.jury.models.every((m) => ruled.has(m))) continue;
        if (BigInt(ch.jury_deadline_ns) < BigInt(Date.now()) * 1_000_000n) continue;
        // a juror still finishing a run that just ended (quorum and grace) lands on its own
        if (p.journals.read("jury.jsonl").some((x) => x.challenge_id === id && Date.now() - (x.at || 0) < 180_000)) continue;
        // receipts that failed for good are not sent to the models again (an unreadable source is tried again by the gate)
        const known = ledger.checks[id];
        if (known && FAILED.includes(known.result) && !unsettled(known)) { out.jury.push({ id, status: "refused", receipts: known.result }); continue; }
        if (known?.result === "no_receipt") { out.jury.push({ id, status: "refused", receipts: known.result }); continue; }
        if (left() < 60_000 || (await wanted())) break;
        const rr = await layer.jury.run(id);
        p.journals.append("jury.jsonl", { ...rr, jurors: (rr.jurors || []).map(({ signature, ...j }) => j), at: Date.now() });
        for (const j of rr.jurors || []) track(j.tx_hash, layer.jury.sender?.accountId);
        out.jury.push({ id, status: rr.status ?? rr.skipped });
      }
    }
    return out;
  }, { lock: "ai-job", agents: true, waitMs: 20_000, budgetMs: Math.max(40_000, Math.min(110_000, remaining() - 10_000)) });

  // 9. health: outcomes, not liveness
  const last = newestOutcome(p);
  const newest = Math.max(last.trade, last.rewrite, last.answer);
  for (const [n, r] of [["keeper", keeper], ["writer", writer], ["agents", agents]]) if (!r.ok) failures.push(r.busy ? `${n}: its lock was held for the whole wait (a visitor's job was running)` : `${n}: ${r.error}`);
  if (Date.now() - newest > 24 * 3600_000) failures.push(`outcomes: no trade, rewrite or agent answer in the last 24 h (newest ${newest ? new Date(newest).toISOString() : "never"})`);
  const busyOnly = failures.length > 0 && failures.every((f) => /lock was held/.test(f));
  const claimsNow = await p.claims.decorated().then((x) => x.claims).catch(() => []);
  const record = { at: new Date().toISOString(), ok: failures.length === 0 || busyOnly, failures, ms: Date.now() - t0, index, keeper: keeper.round ?? keeper, receipts, writer, agents, coverage: coverage(p, claimsNow), last: Object.fromEntries(Object.entries(last).map(([k, v]) => [k, v ? new Date(v).toISOString() : null])), spend: p.spend.status() };
  const cur = await p.state.getDoc("snapshots/health.json").catch(() => null);
  await p.state.putDoc("snapshots/health.json", record, { etag: cur?.etag ?? null }).catch((e) => log(`cron: health record: ${e.message}`));
  if (!record.ok) console.error(`cron: FAIL ${failures.join(" | ")}`);
  else log(`cron: ok in ${record.ms} ms ${JSON.stringify({ writer, agents }).slice(0, 500)}`);
  return sendJson(res, record.ok ? 200 : 500, record);
}
