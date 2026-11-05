// POST /api/after-trade {txHash, signerId?}: what the scanner did on a server, once per trade.
// The browser calls it when its bet is final. The transaction is read from the chain (never
// taken on the browser's word), its market events go to the store at once (so every poller sees
// the trade), and the answer is 202. Then, under the job lock: the writer rewrites the
// paragraph (template, the model's words, the signature, the anchor_rewrite) and the house
// agents look at the new price, research, form signed credences and bet back or say why not.

import { waitUntil } from "@vercel/functions";
import { prepare, readBody, sendJson, txEvents, recordEvents, runJob, log } from "./_lib/runtime.mjs";
import { Rpc } from "../services/api/src/rpc.mjs";
import { clientIp } from "../services/api/src/ratelimit.mjs";

const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use POST {txHash}." } });
  const t0 = Date.now();
  let p, body;
  try { p = prepare(); body = await readBody(req); } catch (e) { return sendJson(res, e.status || 503, { error: { code: e.status ? "bad_request" : "unavailable", message: e.message } }); }
  const txHash = String(body.txHash || "");
  const signerId = String(body.signerId || p.laneAccountId || "");
  if (!TX.test(txHash)) return sendJson(res, 400, { error: { code: "invalid_tx", message: "txHash must be a NEAR transaction hash." } });
  if (!ACCOUNT.test(signerId)) return sendJson(res, 400, { error: { code: "invalid_signer", message: "signerId must be a NEAR account id." } });
  const ip = clientIp({ headers: { "x-forwarded-for": req.headers["x-real-ip"] || req.headers["x-forwarded-for"] }, socket: req.socket }, true);
  const lim = await p.state.take("after-trade", ip, Number(process.env.AFTER_TRADE_PER_IP_PER_DAY || 60)).catch(() => ({ ok: true }));
  if (!lim.ok) return sendJson(res, 429, { error: { code: "rate_limited", message: "Too many trades reported from this address today.", retryAfterS: lim.retryAfterS } });

  const rpc = new Rpc(p.api.rpcUrls, { timeoutMs: 8000 });
  let got;
  try { got = await txEvents(rpc, p.api.marketId, txHash, signerId); } catch (e) {
    await p.state.release("after-trade", ip);
    return sendJson(res, 404, { error: { code: "tx_not_found", message: `That transaction is not on ${p.api.network} yet (${String(e.message).slice(0, 120)}).` } });
  }
  const trades = got.events.filter((e) => e.event === "trade");
  if (!trades.length) return sendJson(res, 422, { error: { code: "not_a_market_trade", message: "That transaction made no trade on this market." } });
  const fresh = await recordEvents(got.events);
  const checkedMs = Date.now() - t0;
  if (!fresh.some((e) => e.event === "trade")) return sendJson(res, 200, { status: "seen", txHash, events: got.events.length, checked_ms: checkedMs });

  sendJson(res, 202, { status: "accepted", txHash, events: fresh.map((e) => e.event), checked_ms: checkedMs, next: "the rewrite and the agents' answers arrive on /api/rewrites?since= and /api/rationales?since=" });
  // two jobs at once: the writer (its own lock; it holds no agent key) and the agents (the jobs' lock)
  const writer = runJob(`writer ${txHash.slice(0, 8)}`, async ({ layer }) => {
    const rewrites = [];
    for (const evt of trades) {
      if (!layer.writer) break;
      const r = await layer.writer.onTrade(evt).catch((e) => { log(`writer: ${e.message}`); return null; });
      rewrites.push(r?.id ? `${r.id} ${r.status}` : null);
    }
    return { rewrites };
  }, { lock: "writer", agents: false, waitMs: 90_000, budgetMs: 120_000 });
  const agents = runJob(`agents ${txHash.slice(0, 8)}`, async ({ layer, started }) => {
    await started;
    if (!layer.crowd) return { agents: "off" };
    const ours = layer.crowd.ours();
    const rounds = [];
    for (const evt of trades) {
      if (ours.has(evt.data?.trader)) continue; // agents never answer their own trades
      const r = await layer.crowd.onTrade(evt).catch((e) => { log(`agents: ${e.message}`); return null; });
      rounds.push({ claim_id: r?.claim_id ?? null, posted: r?.posted?.length ?? 0, skipped: r?.skipped ?? null });
    }
    return { rounds };
  }, { lock: "ai-job", agents: true, waitMs: 120_000, budgetMs: 150_000 });
  waitUntil(Promise.all([writer, agents]).then(([w, a2]) => log(`after-trade ${txHash}: ${JSON.stringify({ writer: w, agents: a2 }).slice(0, 800)}`)).catch((e) => log(`after-trade ${txHash}: ${e.message}`)));
}
