// POST /api/after-challenge {txHash, signerId}: the jury, once per challenge. The transaction is
// read from the chain; for each challenge event in it, the challenge's receipts are checked at
// their source first (services/ai/src/receipts.js; the result goes to the Sentinel's ledger and
// GET /api/rulings). Only when they verify do the three jurors (NEAR AI Cloud models in attested
// TEEs) receive the contract's canonical request bytes; their signatures are checked here, and
// their verdicts are submitted with a key that can only call submit_verdict. Two of three sets the
// provisional outcome. The cron picks up any challenge still waiting.

import { waitUntil } from "@vercel/functions";
import { prepare, readBody, sendJson, txEvents, recordEvents, runJob, log } from "./_lib/runtime.mjs";
import { Rpc } from "../services/api/src/rpc.mjs";
import { clientIp, visitorIp } from "../services/api/src/ratelimit.mjs";

const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use POST {txHash, signerId}." } });
  let p, body;
  try { p = prepare(); body = await readBody(req); } catch (e) { return sendJson(res, e.status || 503, { error: { code: e.status ? "bad_request" : "unavailable", message: e.message } }); }
  const txHash = String(body.txHash || "");
  const signerId = String(body.signerId || p.laneAccountId || "");
  if (!TX.test(txHash) || !ACCOUNT.test(signerId)) return sendJson(res, 400, { error: { code: "invalid_tx", message: "Send {txHash, signerId}: the challenge transaction and the account that signed it." } });
  const ip = clientIp({ headers: { "x-forwarded-for": visitorIp(req.headers) || req.headers["x-forwarded-for"] }, socket: req.socket }, true);
  // the Checker's challenges come from the cron, with its secret: they never use a visitor's allowance
  const fromCron = Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const lim = fromCron ? { ok: true } : await p.state.take("after-challenge", ip, 10).catch(() => ({ ok: true }));
  if (!lim.ok) return sendJson(res, 429, { error: { code: "rate_limited", message: "Too many challenges reported from this address today.", retryAfterS: lim.retryAfterS } });
  const rpc = new Rpc(p.api.rpcUrls, { timeoutMs: 8000 });
  let got;
  try { got = await txEvents(rpc, p.api.marketId, txHash, signerId); } catch (e) {
    if (!fromCron) await p.state.release("after-challenge", ip);
    return sendJson(res, 404, { error: { code: "tx_not_found", message: `That transaction is not on ${p.api.network} yet.` } });
  }
  const ids = [...new Set(got.events.filter((e) => e.event === "challenge" && Number.isInteger(e.data?.challenge_id)).map((e) => e.data.challenge_id))];
  if (!ids.length) return sendJson(res, 422, { error: { code: "not_a_challenge", message: "That transaction opened no challenge on this market." } });
  await recordEvents(got.events);
  sendJson(res, 202, { status: "accepted", challenges: ids, next: "GET /api/jury?challenge=<id>" });
  waitUntil(runJob(`after-challenge ${ids.join(",")}`, async ({ layer, p: pp, started, track }) => {
    await started;
    if (!layer.jury) return { jury: "off" };
    const runs = [];
    for (const id of ids) {
      const r = await layer.jury.run(id);
      pp.journals.append("jury.jsonl", { ...r, jurors: (r.jurors || []).map(({ signature, ...j }) => j), at: Date.now() });
      // each verdict's transaction becomes market events now, not at the next index
      for (const j of r.jurors || []) track(j.tx_hash, layer.jury.sender?.accountId);
      runs.push({ id, status: r.status ?? r.skipped });
    }
    return { runs };
  }, { waitMs: 120_000, budgetMs: 200_000 }).then((r) => log(`after-challenge: ${JSON.stringify(r).slice(0, 500)}`)).catch((e) => log(`after-challenge: ${e.message}`)));
}
