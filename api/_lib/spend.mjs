// The daily NEAR AI spend cap, enforced in code for every model call this deployment makes:
// the planner, the writer, the house agents and the jury all reach NEAR AI Cloud through fetch,
// so one wrapper sees them all. Before a completion is sent, today's spend (UTC) is summed from
// spend.jsonl; at or over the cap the call is refused before it leaves. After it, the cost is
// worked out from the reported usage at the live /v1/models price and appended. A reply with no
// usage (or an unknown price) is charged a conservative flat amount, so a gap never lets the cap
// be crossed. A call NEAR AI refused or failed (any non-2xx answer, or no answer at all) is charged
// nothing: it bought no completion, and a run of refusals must not use up the cap and silence every
// AI role for the rest of the day. Every call is still written down with its status, so the day's
// calls and refusals can be counted (callsToday, and the cron's `ai` health entry). spend.jsonl is a
// journal like the others: it is uploaded to the store with them.

import fs from "node:fs";
import path from "node:path";
import { costOf } from "../../services/ai/src/nearai.js";

const UNKNOWN_CALL_USD = 0.005;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export class SpendCapError extends Error {
  constructor(spent, cap) {
    super(`the NEAR AI daily spend cap ($${cap.toFixed(2)}) is reached: $${spent.toFixed(4)} spent today (UTC); model calls resume at 00:00 UTC`);
    this.name = "SpendCapError";
    this.code = "spend_cap";
  }
}

/**
 * What one finished model call costs: nothing unless NEAR AI answered 2xx. Pure.
 * @param {number|null} status the HTTP status, or null when no answer came
 * @param {{ usd?: number, basis?: string }|null} cost the priced usage, or why it could not be priced
 */
export function chargeOf(status, cost) {
  if (!(status >= 200 && status < 300)) return { usd: 0, basis: status === null ? "no charge: no answer" : `no charge: HTTP ${status}, refused or failed` };
  if (Number.isFinite(cost?.usd)) return { usd: cost.usd, basis: "usage x /v1/models pricing" };
  return { usd: UNKNOWN_CALL_USD, basis: cost?.basis || "flat: no usage reported" };
}

/** The status a journal line is counted under: "200", "429", "network" (no answer) or "spend_cap". */
const statusKey = (r) => (r.refused ? String(r.refused) : r.status === null || r.status === undefined ? "network" : String(r.status));

/**
 * One day's model calls from spend.jsonl lines, by status. A refusal is a call that left and came back
 * without a completion: a non-2xx answer or no answer. Calls the cap stopped before they left are
 * counted apart (cap_refused): they never reached NEAR AI. Pure.
 */
export function countCalls(records, today = day()) {
  const by_status = {};
  let calls = 0, refusals = 0, cap_refused = 0, usd = 0;
  for (const r of records) {
    if (r?.day !== today) continue;
    const k = statusKey(r);
    by_status[k] = (by_status[k] || 0) + 1;
    usd += Number(r.usd) || 0;
    if (k === "spend_cap") { cap_refused++; continue; }
    calls++;
    if (!(r.status >= 200 && r.status < 300)) refusals++;
  }
  return { day: today, calls, refusals, cap_refused, by_status, spent_usd: Number(usd.toFixed(6)) };
}

/**
 * @param {{ baseUrl: string, capUsd: number, dir: string, log?: (m: string) => void }} o
 */
export function installSpendMeter({ baseUrl, capUsd, dir, log = () => {} }) {
  if (globalThis.__pricedinSpend) { Object.assign(globalThis.__pricedinSpend.o, { baseUrl: baseUrl.replace(/\/+$/, ""), capUsd, dir }); return globalThis.__pricedinSpend; }
  const orig = globalThis.fetch;
  const o = { baseUrl: baseUrl.replace(/\/+$/, ""), capUsd, dir };
  const file = () => path.join(o.dir, "spend.jsonl");
  let models = { at: 0, list: null };
  const pending = new Set();

  async function priceOf(model) {
    if (!models.list || Date.now() - models.at > 600_000) {
      try {
        const r = await orig(`${o.baseUrl}/models`, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) models = { at: Date.now(), list: (await r.json()).data || [] };
      } catch { /* priced as unknown below */ }
    }
    return models.list?.find((m) => m.id === model) || null;
  }

  /** Today's journal lines (UTC). */
  function linesOf(today) {
    const f = file();
    if (!fs.existsSync(f)) return [];
    const out = [];
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.includes(today)) continue;
      try { const r = JSON.parse(line); if (r.day === today) out.push(r); } catch { /* torn */ }
    }
    return out;
  }

  function spentToday() {
    let usd = 0;
    for (const r of linesOf(day())) usd += Number(r.usd) || 0;
    return usd;
  }

  function write(rec) {
    fs.mkdirSync(o.dir, { recursive: true });
    fs.appendFileSync(file(), JSON.stringify({ at: new Date().toISOString(), day: day(), ...rec }) + "\n");
  }

  function usageOf(text) {
    try { const j = JSON.parse(text); return { usage: j.usage ?? null, model: j.model ?? null }; } catch { /* SSE */ }
    let usage = null, model = null;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try { const j = JSON.parse(line.slice(5).trim()); if (j.usage) usage = j.usage; if (j.model) model = j.model; } catch { /* [DONE] */ }
    }
    return { usage, model };
  }

  const metered = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const method = String(init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    if (!url || !url.startsWith(o.baseUrl) || method !== "POST") return orig(input, init);
    const where = new URL(url).pathname;
    let reqModel = null;
    try { reqModel = JSON.parse(Buffer.from(init.body ?? "").toString("utf8")).model ?? null; } catch { /* not JSON */ }
    const spent = spentToday();
    if (spent >= o.capUsd) {
      log(`spend: refused a model call: ${spent.toFixed(4)} >= ${o.capUsd}`);
      try { write({ path: where, model: reqModel, status: null, refused: "spend_cap", usd: 0, basis: "not sent: the daily cap is reached" }); } catch { /* the refusal stands */ }
      throw new SpendCapError(spent, o.capUsd);
    }
    let res;
    try { res = await orig(input, init); } catch (e) {
      // no answer at all: nothing was bought, but the call is counted
      try { write({ path: where, model: reqModel, status: null, prompt_tokens: null, completion_tokens: null, usd: 0, basis: `no charge: no answer (${String(e?.message || e).slice(0, 120)})` }); } catch { /* the error stands */ }
      throw e;
    }
    const job = (async () => {
      let model = reqModel, usage = null, cost = null;
      if (res.ok) {
        try {
          const u = usageOf(await res.clone().text());
          usage = u.usage; model = u.model || reqModel;
          const c = usage ? costOf(await priceOf(model), usage) : null;
          cost = Number.isFinite(c) ? { usd: c } : { basis: usage ? "flat: no price for this model" : "flat: no usage reported" };
        } catch (e) { cost = { basis: `flat: ${e.message}` }; }
      }
      const { usd, basis } = chargeOf(res.status, cost);
      write({ path: where, model, status: res.status, prompt_tokens: usage?.prompt_tokens ?? null, completion_tokens: usage?.completion_tokens ?? null, usd, basis });
    })().catch(() => {});
    pending.add(job);
    job.finally(() => pending.delete(job));
    return res;
  };
  globalThis.fetch = metered;
  const api = {
    o,
    spentToday,
    /** Wait for the costs of calls already made to be written. */
    settle: () => Promise.all([...pending]),
    status: () => { const s = spentToday(); return { day: day(), spent_usd: Number(s.toFixed(6)), cap_usd: o.capUsd, open: s < o.capUsd }; },
    /** Today's (UTC) model calls by status, and the refusals among them. */
    callsToday: () => countCalls(linesOf(day())),
  };
  globalThis.__pricedinSpend = api;
  return api;
}
