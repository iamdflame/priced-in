// GET /api/sentinel, every minute (vercel.json): the Sentinel's look at every live challenge.
// When nothing is live it costs one view call and returns. When a provisional outcome sides
// with a challenger whose receipts failed the check, it disputes, once per round, inside the
// window (api/_lib/sentinel.mjs, services/ai/src/sentinel.js). The cron is Vercel's to call.

import { prepare, sendJson, log } from "./_lib/runtime.mjs";
import { runSentinel } from "./_lib/sentinel.mjs";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return sendJson(res, 401, { error: { code: "unauthorized", message: "The Sentinel's minute is Vercel's to call." } });
  let p;
  try { p = prepare(); } catch (e) { return sendJson(res, 503, { ok: false, error: e.message }); }
  const out = await runSentinel(p, { budgetMs: 50_000, log });
  if (!out.idle) log(`sentinel: ${JSON.stringify(out).slice(0, 600)}`);
  return sendJson(res, out.ok ? 200 : 500, out);
}
