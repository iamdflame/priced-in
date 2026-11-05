// Every API route, on Vercel. vercel.json rewrites /api/<route> (and the judge's /health,
// /claims, /events and /v1 at the root) here with ?__p=<route>. The routes are services/api's and
// services/ai's own handlers (createApp + mountAi); this file adds what a function instance needs:
// state from the store, limits that hold across instances, CDN caching, a finite event stream,
// polling with ?since=, and a health check for this runtime.

import { readContext, prepare, sendJson, log } from "./_lib/runtime.mjs";
import { clientIp } from "../services/api/src/ratelimit.mjs";
import { parseSigningKey } from "../services/api/src/planner.mjs";
import { Rpc } from "../services/api/src/rpc.mjs";

/** CDN caching per route: many browsers polling share one function call. */
const CACHE = [
  [/^\/claims(\/|$)/, "public, max-age=0, s-maxage=1, stale-while-revalidate=30"],
  [/^\/(rewrites|rationales|events\/recent|jury)$/, "public, max-age=0, s-maxage=1, stale-while-revalidate=30"],
  [/^\/post(\/|$)/, "public, max-age=0, s-maxage=60, stale-while-revalidate=300"],
  [/^\/attestations/, "public, max-age=60, s-maxage=300"],
  [/^\/v1$/, "public, max-age=0, s-maxage=30"],
];

/** Limits that must hold across function instances (the app's own in-memory ones still apply). */
const LIMITED = {
  "/lane/key": { scope: "lane", limit: () => prepare().api.lane.perIpPerDay, global: () => prepare().api.lane.perDay, message: (n) => `This address has used its ${n} free bets for today.` },
  "/paste": { scope: "paste", limit: () => prepare().api.paste.perIpPerDay, message: () => "Too many pastes from your address today." },
};

const since = (url) => Number(url.searchParams.get("since") || 0) || 0;
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const route = (url.searchParams.get("__p") ?? url.pathname.replace(/^\/api(?=\/|$)/, "")).replace(/\/+$/, "") || "/";
  url.searchParams.delete("__p");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, last-event-id, payment-signature, x-payment", "access-control-max-age": "600" });
    return res.end();
  }
  // claims: from the snapshot, before anything else is read (a cold instance answers in one store read)
  if (req.method === "GET" && /^\/claims(\/[^/]+)?$/.test(route)) return claimsRoute(res, route, url);
  // the site decides at load whether the API is live from /health (3.5 s): it never waits on the store
  if (req.method === "GET" && route === "/health") {
    return health(res, withTimeout(readContext().catch(() => null), 1200, null));
  }
  let ctx;
  try { ctx = await readContext(); } catch (e) {
    log(`startup: ${e.message}`);
    return sendJson(res, 503, { error: { code: "unavailable", message: "Priced In's API is starting or misconfigured. Try again in a moment." } });
  }
  const { app, layer } = ctx;
  const p = prepare();

  // ---------- routes this runtime answers itself ----------
  if (req.method === "GET" && route === "/events") return finiteStream(req, res, url, ctx);
  if (req.method === "GET" && route === "/rewrites" && url.searchParams.has("since")) {
    const page = url.searchParams.get("page");
    const list = (page ? app.rewrites.byPage(page) : app.rewrites.recent(200)).filter((r) => (r.updatedAt || 0) > since(url));
    return sendJson(res, 200, { page, since: since(url), writer: app.rewrites.status, rewrites: list, count: list.length, asOf: Date.now() }, { "cache-control": CACHE[1][1] });
  }
  if (req.method === "GET" && route === "/rationales" && url.searchParams.has("since")) {
    const claim = url.searchParams.get("claim");
    const list = layer.crowd ? layer.crowd.recent({ page: url.searchParams.get("page"), claim: claim === null ? null : Number(claim), n: 200 }).filter((r) => (r.at || 0) > since(url)) : [];
    return sendJson(res, 200, { since: since(url), rationales: list, count: list.length, asOf: Date.now() }, { "cache-control": CACHE[1][1] });
  }
  if (req.method === "GET" && (route === "/ai/status" || route === "/agents")) {
    const snap = await p.state.getDoc("snapshots/status.json").catch(() => null);
    const s = snap?.value?.status ?? null;
    if (route === "/agents") return sendJson(res, 200, { agents: s?.agents?.roster ?? [], unheld: 0, swarm: p.ai.swarmId, state: s?.agents ?? { status: "unknown", reason: "no job has run yet" }, asOf: snap?.value?.at ?? null });
    return sendJson(res, 200, { ...(s || { writer: app.rewrites.status }), spend: p.spend.status(), asOf: snap?.value?.at ?? null, runtime: "vercel: the AI layer runs in POST /api/after-trade, /api/after-challenge and the cron" });
  }
  if (req.method === "GET" && route === "/jury") {
    const id = Number(url.searchParams.get("challenge"));
    const runs = p.journals.read("jury.jsonl").filter((r) => r.challenge_id === id);
    return sendJson(res, 200, { run: runs.at(-1) ?? null, jury: { status: layer.jury ? "on" : "off" } }, { "cache-control": CACHE[1][1] });
  }
  if (route === "/agents/runner-key") {
    return sendJson(res, 503, { error: { code: "agents_off", message: "Strangers' agents are not issued keys on the hosted site: the signer's keystore here is read-only. Run services/ai yourself to host one." } });
  }

  // ---------- limits across instances ----------
  const lim = req.method === "POST" ? LIMITED[route] : null;
  const ip = clientIp(req, true);
  let taken = [];
  if (lim) {
    const a = await p.state.take(lim.scope, ip, lim.limit()).catch(() => ({ ok: true }));
    if (!a.ok) return sendJson(res, 429, { error: { code: "rate_limited", message: lim.message(lim.limit()), retryAfterS: a.retryAfterS } }, { "retry-after": String(a.retryAfterS) });
    taken.push([lim.scope, ip]);
    if (lim.global) {
      const g = await p.state.take(`${lim.scope}-global`, "all", lim.global()).catch(() => ({ ok: true }));
      if (!g.ok) { await p.state.release(lim.scope, ip); return sendJson(res, 429, { error: { code: "lane_daily_cap", message: "Today's free bets are all taken. Come back tomorrow, or fund your own account.", retryAfterS: g.retryAfterS } }); }
      taken.push([`${lim.scope}-global`, "all"]);
    }
  }

  // ---------- everything else: the services' own handler ----------
  req.url = route + (url.search || "");
  const cache = req.method === "GET" ? CACHE.find(([re]) => re.test(route))?.[1] : null;
  const writeHead = res.writeHead.bind(res);
  let status = 200;
  res.writeHead = (code, ...rest) => {
    status = code;
    const h = rest.find((x) => x && typeof x === "object") || {};
    if (cache && code === 200) h["cache-control"] = cache;
    return writeHead(code, h);
  };
  const chunks = [];
  const end = res.end.bind(res);
  // spend records and released limits are written before the answer leaves (the function may stop after it)
  res.end = (body, ...rest) => {
    if (body) chunks.push(Buffer.from(body));
    (async () => {
      if (taken.length) {
        let reused = false;
        try { reused = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.reused === true; } catch { /* not JSON */ }
        if (status !== 200 || reused) for (const [scope, key] of taken) await p.state.release(scope, key);
      }
      await p.spend.settle();
      // a read instance uploads only what it wrote itself: the spend records of planner calls
      if (p.journals.dirty(["spend.jsonl"])) await p.journals.flush({ only: ["spend.jsonl"] }).catch(() => {});
    })().finally(() => end(body, ...rest));
    return res;
  };
  app.server.emit("request", req, res);
}

// ---------- GET /claims, /claims?page=, /claims/:id: the snapshot ----------
async function claimsRoute(res, route, url) {
  let p;
  try { p = prepare(); } catch (e) { return sendJson(res, 503, { error: { code: "unavailable", message: e.message } }); }
  const t0 = Date.now();
  let snap;
  try { snap = await p.claims.decorated(); } catch (e) {
    return sendJson(res, 502, { error: { code: "upstream_error", message: "The NEAR RPC did not answer. Try again in a moment." } });
  }
  const headers = { "cache-control": CACHE[0][1], "server-timing": `total;dur=${Date.now() - t0}`, "x-snapshot-age-ms": String(Date.now() - snap.at) };
  const m = route.match(/^\/claims\/([^/]+)$/);
  if (m) {
    if (!/^\d{1,15}$/.test(m[1])) return sendJson(res, 400, { error: { code: "invalid_claim_id", message: "Claim ids are whole numbers." } });
    const c = snap.claims.find((x) => x.id === Number(m[1]));
    if (!c) return sendJson(res, 404, { error: { code: "no_such_claim", message: `No claim ${m[1]}.` } });
    return sendJson(res, 200, { claim: c, asOf: snap.at }, headers);
  }
  const page = url.searchParams.get("page");
  if (page !== null && !/^[a-z0-9-]{1,64}$/.test(page)) return sendJson(res, 400, { error: { code: "invalid_page", message: "page must be a slug: lowercase letters, digits and dashes." } });
  const list = page ? snap.claims.filter((c) => c.page === page) : snap.claims;
  return sendJson(res, 200, { page, claims: list, count: list.length, asOf: snap.at, blockHeight: snap.blockHeight }, headers);
}

// ---------- GET /events: a finite stream ----------
// No connection is held open: the stream sends what the store has after ?since= (or
// Last-Event-ID), a hello, and closes with retry: 2000, so an EventSource reconnects and polls.
function finiteStream(req, res, url, ctx) {
  const from = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0) || 0;
  const backlog = ctx.app.hub.since(from);
  let out = "retry: 2000\n\n";
  for (const e of backlog) out += `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
  out += `event: hello\ndata: ${JSON.stringify({ replayed: backlog.length, marketId: ctx.app.config.marketId, mode: "finite: reconnect after retry, or poll /events/recent" })}\n\n`;
  // the whole body with its length: delivered as one response, never a connection held open
  const body = Buffer.from(out, "utf8");
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "content-length": String(body.length), "cache-control": "no-cache, no-transform", "access-control-allow-origin": "*" });
  res.end(body);
}

// ---------- GET /health: outcomes, for this runtime ----------
let bareRpc = null;

/** Every RPC's status, answered as soon as one is good (the rest get a short grace), never past maxMs. */
function quickProbe(rpc, maxMs = 1200, graceMs = 250) {
  return new Promise((resolve) => {
    const out = rpc.urls.map((url) => ({ url, ok: false, error: "no answer in time" }));
    let done = false, grace = null;
    const finish = () => { if (!done) { done = true; resolve(out); } };
    setTimeout(finish, maxMs);
    rpc.urls.forEach((url, i) => {
      const t0 = Date.now();
      rpc.callOn(url, "status", [], { timeoutMs: maxMs }).then((st) => {
        out[i] = { url, ok: true, latencyMs: Date.now() - t0, chainId: st.chain_id, height: st.sync_info?.latest_block_height };
        grace ||= setTimeout(finish, graceMs);
        if (out.every((x) => x.ok)) finish();
      }, (e) => { out[i] = { url, ok: false, error: String(e.message).slice(0, 120) }; if (out.every((x) => x.error !== "no answer in time")) finish(); });
    });
  });
}

async function health(res, ctxP) {
  const t0 = Date.now();
  let p;
  try { p = prepare(); } catch (e) { return sendJson(res, 503, { ok: false, failures: [`config: ${e.message}`] }); }
  const rpc = bareRpc ||= new Rpc(p.api.rpcUrls, { timeoutMs: 1500 });
  const config = p.api;
  const failures = [];
  // the lane's budget is read once the app is up, alongside the rest (a cached view)
  const ctxLane = ctxP.then(async (c) => [c, c?.app?.lane.enabled ? await withTimeout(c.app.lane.budget().catch((e) => ({ error: e.message })), 800, { error: "the lane budget read timed out" }) : null]);
  const [probes, [ctx, laneB], snapDoc, cronDoc] = await Promise.all([
    quickProbe(rpc, 1200),
    ctxLane,
    withTimeout(p.state.getDoc("snapshots/status.json").catch(() => null), 1200, null),
    withTimeout(p.state.getDoc("snapshots/health.json").catch(() => null), 1200, null),
  ]);
  const app = ctx?.app ?? null;
  const reachable = probes.filter((x) => x.ok);
  if (!reachable.length) failures.push(`rpc: no RPC reachable (${probes.map((x) => `${x.url}: ${x.error}`).join("; ") || "probe timed out"})`);
  for (const x of reachable) if (x.chainId && x.chainId !== config.network) failures.push(`rpc: ${x.url} serves chain "${x.chainId}" but NEAR_NETWORK=${config.network}`);
  if (!config.marketId) failures.push("market: MARKET_CONTRACT_ID is not set");
  if (ctx?.storeError) failures.push(`store: ${ctx.storeError}`);
  const cron = cronDoc?.value ?? null;
  const cronAgeS = cron?.at ? (Date.now() - Date.parse(cron.at)) / 1000 : null;
  if (cronAgeS !== null && cronAgeS > 30 * 60) failures.push(`cron: the last run was ${Math.round(cronAgeS / 60)} min ago (it runs every 10 min)`);
  // the outcome assertion: something real happened in the last day (the cron's record when this instance has no state yet)
  const last = ctx ? lastOutcomes(ctx) : { trade: Date.parse(cron?.last?.trade) || 0, rewrite: Date.parse(cron?.last?.rewrite) || 0, answer: Date.parse(cron?.last?.answer) || 0 };
  const newest = Math.max(last.trade || 0, last.rewrite || 0, last.answer || 0);
  if (!newest || Date.now() - newest > 26 * 3600_000) failures.push(`outcomes: no trade, rewrite or agent answer in the last day (newest ${newest ? new Date(newest).toISOString() : "never"})`);
  let planner = { status: "unavailable" };
  try { if (config.planner.apiKey && config.planner.model && config.planner.privateKey) planner = { status: "ok", model: config.planner.model, plannerPublicKeyHex: Buffer.from(parseSigningKey(config.planner.privateKey).publicKey).toString("hex") }; } catch { planner = { status: "unavailable", reason: "PLANNER_PRIVATE_KEY is unusable" }; }
  const lane = laneB && !laneB.error ? { configured: true, open: !laneB.paused && laneB.free > 0, creditsLeft: laneB.credits, paused: laneB.paused } : { configured: Boolean(config.lane.accountId && config.lane.privateKey), error: laneB?.error ?? (app ? null : "not read: cold start") };
  const body = {
    ok: failures.length === 0,
    network: config.network,
    marketId: config.marketId,
    failures,
    checks: {
      runtime: { kind: "vercel functions", scanner: "none: trades are recorded by POST /api/after-trade (checked on-chain) and by the agents' own transactions; browsers poll", region: process.env.VERCEL_REGION ?? null },
      rpc: { reachable: reachable.length, urls: probes },
      lane,
      planner,
      outcomes: { last_trade: iso(last.trade), last_rewrite: iso(last.rewrite), last_answer: iso(last.answer), maxAgeH: 26 },
      cron: cron ? { last_run: cron.at, age_s: cronAgeS, ok: cron.ok, failures: cron.failures ?? [] } : { last_run: null },
      spend: p.spend.status(),
      ai: snapDoc?.value ? { at: snapDoc.value.at, writer: snapDoc.value.status?.writer?.writer ?? null, agents: snapDoc.value.status?.agents?.status ?? null, jury: snapDoc.value.status?.jury?.status ?? null, anchoring: snapDoc.value.status?.anchoring ?? null } : null,
      events: app ? { buffered: app.hub.buf.length, lastSeq: app.hub.seq } : null,
      store: ctx ? { ok: !ctx.storeError, hydratedAt: iso(p.journals.hydratedAt) } : { ok: null, note: "this instance is still reading the store (cold start); outcomes are the cron's" },
    },
  };
  return sendJson(res, failures.length ? 503 : 200, body, { "server-timing": `total;dur=${Date.now() - t0}` });
}

const iso = (t) => (t ? new Date(t).toISOString() : null);

function lastOutcomes(ctx) {
  const { app, layer } = ctx;
  let trade = 0, rewrite = 0, answer = 0;
  for (const e of app.hub.buf) if (e.event === "trade") trade = Math.max(trade, e.blockTimestampMs || e.seenAtMs || 0);
  for (const r of app.rewrites.recent(20)) if (!r.evidence_file) rewrite = Math.max(rewrite, r.updatedAt || 0);
  for (const r of layer.crowd?.rationales || []) answer = Math.max(answer, r.at || 0);
  return { trade, rewrite, answer };
}
