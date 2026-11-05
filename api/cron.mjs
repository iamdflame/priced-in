// GET /api/cron, every 10 minutes (vercel.json). One bounded round, in two jobs:
//   writer (the writer's lock, no agent key):
//     1. anchor any signed rewrite not anchored yet (anchor_rewrite through the signer)
//     2. if nothing happened for 20 hours, refresh the stalest paragraph at today's prices
//   agents (the jobs' lock, given up between steps when a visitor's trade is waiting for it):
//     3. the agents' cycle: roster, open intents reconciled, settled winnings redeemed; then a look
//        at the stalest open claims (they bet only when their signed credence beats the price)
//     4. challenges still waiting for the jury, before their deadline
//   5. the health check: a trade, a rewrite or an agent's answer in the last day, else it fails
// Model calls stop at the daily NEAR AI cap (NEARAI_DAILY_CAP_USD, $1), enforced in code.

import { prepare, sendJson, runJob, log } from "./_lib/runtime.mjs";
import { paragraphsOf } from "../services/ai/src/writer.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const writer = await runJob("cron-writer", async ({ app, layer, started, reanchor, deadline }) => {
    const out = {};
    await started;
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
      for (const page of [...new Set(claims.map((c) => c.page))]) {
        paragraphsOf(page, claims.filter((c) => c.page === page), layer.writer.pagesDoc).forEach((para, i) => {
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
    out.compacted = await p.journals.compact().catch((e) => { failures.push(`compact: ${e.message}`); return 0; });
    return out;
  }, { lock: "writer", agents: false, waitMs: 20_000, budgetMs: 100_000, reanchor: true });

  const agents = await runJob("cron-agents", async ({ app, layer, started, deadline, wanted }) => {
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
      out.jury = [];
      for (let id = Math.max(0, stats.challenges - 20); id < stats.challenges; id++) {
        const ch = await app.rpc.viewFunction(p.api.marketId, "get_challenge", { challenge_id: id }).catch(() => null);
        if (!ch || ch.resolved) continue;
        const ruled = new Set(ch.verdicts.map((v) => v.model));
        if (layer.jury.models.every((m) => ruled.has(m))) continue;
        if (BigInt(ch.jury_deadline_ns) < BigInt(Date.now()) * 1_000_000n) continue;
        if (left() < 60_000 || (await wanted())) break;
        const rr = await layer.jury.run(id);
        p.journals.append("jury.jsonl", { ...rr, jurors: (rr.jurors || []).map(({ signature, ...j }) => j), at: Date.now() });
        out.jury.push({ id, status: rr.status ?? rr.skipped });
      }
    }
    return out;
  }, { lock: "ai-job", agents: true, waitMs: 20_000, budgetMs: 110_000 });

  // 5. health: outcomes, not liveness
  const last = newestOutcome(p);
  const newest = Math.max(last.trade, last.rewrite, last.answer);
  for (const [n, r] of [["writer", writer], ["agents", agents]]) if (!r.ok) failures.push(r.busy ? `${n}: its lock was held for the whole wait (a visitor's job was running)` : `${n}: ${r.error}`);
  if (Date.now() - newest > 24 * 3600_000) failures.push(`outcomes: no trade, rewrite or agent answer in the last 24 h (newest ${newest ? new Date(newest).toISOString() : "never"})`);
  const busyOnly = failures.length > 0 && failures.every((f) => /lock was held/.test(f));
  const record = { at: new Date().toISOString(), ok: failures.length === 0 || busyOnly, failures, ms: Date.now() - t0, writer, agents, last: Object.fromEntries(Object.entries(last).map(([k, v]) => [k, v ? new Date(v).toISOString() : null])), spend: p.spend.status() };
  const cur = await p.state.getDoc("snapshots/health.json").catch(() => null);
  await p.state.putDoc("snapshots/health.json", record, { etag: cur?.etag ?? null }).catch((e) => log(`cron: health record: ${e.message}`));
  if (!record.ok) console.error(`cron: FAIL ${failures.join(" | ")}`);
  else log(`cron: ok in ${record.ms} ms ${JSON.stringify({ writer, agents }).slice(0, 500)}`);
  return sendJson(res, record.ok ? 200 : 500, record);
}
