// The daily NEAR AI spend cap, enforced in code for every model call this deployment makes:
// the planner, the writer, the house agents and the jury all reach NEAR AI Cloud through fetch,
// so one wrapper sees them all. Before a completion is sent, today's spend (UTC) is summed from
// spend.jsonl; at or over the cap the call is refused before it leaves. After it, the cost is
// worked out from the reported usage at the live /v1/models price and appended. A reply with no
// usage (or an unknown price) is charged a conservative flat amount, so a gap never lets the cap
// be crossed. spend.jsonl is a journal like the others: it is uploaded to the store with them.

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
 * @param {{ baseUrl: string, capUsd: number, dir: string, log?: (m: string) => void }} o
 */
export function installSpendMeter({ baseUrl, capUsd, dir, log = () => {} }) {
  if (globalThis.__pricedinSpend) { Object.assign(globalThis.__pricedinSpend.o, { baseUrl, capUsd, dir }); return globalThis.__pricedinSpend; }
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

  function spentToday() {
    const f = file();
    if (!fs.existsSync(f)) return 0;
    const today = day();
    let usd = 0;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.includes(today)) continue;
      try { const r = JSON.parse(line); if (r.day === today) usd += Number(r.usd) || 0; } catch { /* torn */ }
    }
    return usd;
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
    const spent = spentToday();
    if (spent >= o.capUsd) { log(`spend: refused a model call: ${spent.toFixed(4)} >= ${o.capUsd}`); throw new SpendCapError(spent, o.capUsd); }
    let reqModel = null;
    try { reqModel = JSON.parse(Buffer.from(init.body ?? "").toString("utf8")).model ?? null; } catch { /* not JSON */ }
    const res = await orig(input, init);
    const job = (async () => {
      let usd = UNKNOWN_CALL_USD, basis = "flat: no usage reported";
      let model = reqModel, usage = null;
      try {
        const u = usageOf(await res.clone().text());
        usage = u.usage; model = u.model || reqModel;
        const c = usage ? costOf(await priceOf(model), usage) : null;
        if (Number.isFinite(c)) { usd = c; basis = "usage x /v1/models pricing"; }
        else if (usage) basis = "flat: no price for this model";
      } catch (e) { basis = `flat: ${e.message}`; }
      fs.mkdirSync(o.dir, { recursive: true });
      fs.appendFileSync(file(), JSON.stringify({ at: new Date().toISOString(), day: day(), path: new URL(url).pathname, model, status: res.status, prompt_tokens: usage?.prompt_tokens ?? null, completion_tokens: usage?.completion_tokens ?? null, usd, basis }) + "\n");
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
  };
  globalThis.__pricedinSpend = api;
  return api;
}
