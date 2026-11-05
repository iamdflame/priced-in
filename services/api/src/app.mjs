// The Priced In API: the no-wallet lane, cached claim reads, the market's live event stream,
// outcome-asserting health, and the paste planner. Plain node:http, no framework.

import http from "node:http";
import { Rpc } from "./rpc.mjs";
import { EventHub, Scanner } from "./events.mjs";
import { Claims, TtlCache } from "./claims.mjs";
import { LaneIssuer, ApiError, parsePublicKey } from "./lane.mjs";
import { DailyLimiter, clientIp } from "./ratelimit.mjs";
import { splitSentences } from "./sentences.mjs";
import { parseSigningKey, labelSentences, signReceipt, pasteSlug, validPage, PRICEABLE } from "./planner.mjs";

const MAX_BODY = { "/lane/key": 2048, "/paste": 64 * 1024 };

/**
 * @param {object} config from loadConfig
 * @param {{ fetchImpl?: typeof fetch, log?: (m: string) => void, now?: () => number }} [deps]
 */
export function createApp(config, deps = {}) {
  const log = deps.log || ((m) => console.log(`${new Date().toISOString()} ${m}`));
  const now = deps.now || Date.now;
  const rpc = new Rpc(config.rpcUrls, { timeoutMs: config.rpcTimeoutMs, fetchImpl: deps.fetchImpl });
  const hub = new EventHub({ size: config.events.ringSize, now });
  const scanner = new Scanner({
    rpc, marketId: config.marketId, usdcId: config.usdcId, hub, log, now,
    intervalMs: config.scan.intervalMs, finality: config.scan.finality,
    maxCatchupBlocks: config.scan.maxCatchupBlocks, backfillBlocks: config.scan.backfillBlocks,
  });
  const claims = config.marketId ? new Claims({ rpc, marketId: config.marketId, ttlMs: config.claimsTtlMs, now }) : null;
  const lane = new LaneIssuer({ rpc, config, stats: () => claims.statsFast(config.lane.statsMaxStaleMs), now, log });
  const laneIp = new DailyLimiter(config.lane.perIpPerDay, { now });
  const laneGlobal = new DailyLimiter(config.lane.perDay, { now });
  const pasteIp = new DailyLimiter(config.paste.perIpPerDay, { now });
  const plannerCache = new TtlCache(6 * 3600_000, { max: 500, now });
  hub.subscribe((e) => { if (e.event === "trade") lane.noteTrade(e.data?.trader); });

  let plannerKey = null;
  let plannerReason = null;
  const pc = config.planner;
  if (!pc.apiKey) plannerReason = "NEARAI_API_KEY is not set";
  else if (!pc.model) plannerReason = "PLANNER_MODEL is not set";
  else if (!pc.privateKey) plannerReason = "PLANNER_PRIVATE_KEY is not set";
  else {
    try { plannerKey = parseSigningKey(pc.privateKey); } catch (e) { plannerReason = `PLANNER_PRIVATE_KEY is unusable (${e.message})`; }
  }
  const plannerPublicKeyHex = plannerKey ? Buffer.from(plannerKey.publicKey).toString("hex") : null;

  // ---------- health: outcomes, not liveness ----------
  // RPC probes run in the background (a slow fallback RPC must not make /health slow);
  // /health reads the latest round, or waits for the first one.
  let probe = { at: 0, value: null, pending: null };
  function runProbe() {
    if (!probe.pending) {
      probe.pending = rpc.probe({ timeoutMs: 5000 }).then((v) => { probe = { at: now(), value: v, pending: null }; return v; });
    }
    return probe.pending;
  }
  async function probeRpc() {
    if (probe.value && now() - probe.at < 15000) {
      if (now() - probe.at > 4000) runProbe();
      return probe.value;
    }
    return runProbe();
  }

  async function health() {
    const failures = [];
    const probes = await probeRpc();
    const reachable = probes.filter((p) => p.ok);
    if (!reachable.length) failures.push(`rpc: no RPC reachable (${probes.map((p) => `${p.url}: ${p.error}`).join("; ")})`);
    const expectChain = config.network;
    for (const p of reachable) if (p.chainId && p.chainId !== expectChain) failures.push(`rpc: ${p.url} serves chain "${p.chainId}" but NEAR_NETWORK=${expectChain}`);
    const st = scanner.state;
    const scanAgeS = st.lastScanAt ? (now() - st.lastScanAt) / 1000 : null;
    if (scanAgeS === null) failures.push("scanner: no block scanned yet");
    else if (scanAgeS > config.health.maxScanAgeS) failures.push(`scanner: last block scanned ${scanAgeS.toFixed(1)} s ago (max ${config.health.maxScanAgeS} s)${st.lastError ? `; last error: ${st.lastError}` : ""}`);
    const eventAgeS = hub.lastEventAt ? (now() - hub.lastEventAt) / 1000 : null;
    if (config.health.maxEventAgeS > 0 && (eventAgeS === null || eventAgeS > config.health.maxEventAgeS)) {
      failures.push(`events: no market event in the last ${config.health.maxEventAgeS} s`);
    }
    if (!config.marketId) failures.push("market: MARKET_CONTRACT_ID is not set");
    const chainLagS = st.lastBlockTimestampMs ? Math.max(0, (now() - st.lastBlockTimestampMs) / 1000) : null;
    let laneInfo = { configured: lane.enabled };
    if (lane.enabled) {
      try {
        const b = await lane.budget();
        laneInfo = { ...laneInfo, open: !b.paused && b.free > 0, creditsLeft: b.credits, outstandingKeys: b.outstanding, paused: b.paused, keysIssued: lane.issuedTotal, lastIssueMs: lane.lastIssueMs };
      } catch (e) { laneInfo = { ...laneInfo, open: null, error: e.message }; }
    }
    return {
      ok: failures.length === 0,
      network: config.network,
      marketId: config.marketId,
      failures,
      checks: {
        scanner: { lastBlockHeight: st.lastHeight, lastScanAgeS: scanAgeS, maxAgeS: config.health.maxScanAgeS, chainLagS, blocksScanned: st.blocksScanned, txsTracked: st.txsTracked, skippedBlocks: st.skippedBlocks, lostTxs: st.lostTxs, lastError: st.lastError },
        rpc: { reachable: reachable.length, urls: probes },
        events: { lastEventAgeS: eventAgeS, maxAgeS: config.health.maxEventAgeS || null, buffered: hub.buf.length, streams: sse.size },
        lane: laneInfo,
        planner: { status: plannerKey ? "ok" : "unavailable", reason: plannerReason, plannerPublicKeyHex },
      },
    };
  }

  // ---------- paste ----------
  async function paste(body, ip) {
    if (!body || typeof body.text !== "string") throw new ApiError(400, "bad_request", 'Send JSON {"text": "..."}');
    if (!body.text.trim()) throw new ApiError(400, "empty_text", "Paste some text first.");
    if (body.text.length > config.paste.maxInputChars) throw new ApiError(413, "text_too_long", `Paste at most ${config.paste.maxInputChars} characters.`);
    if (body.page !== undefined && !validPage(body.page)) throw new ApiError(400, "invalid_page", "page must be a slug: lowercase letters, digits and dashes, at most 64.");
    const split = splitSentences(body.text, { maxSentences: config.paste.maxSentences, maxBytes: config.paste.maxSentenceBytes });
    if (!split.sentences.length) throw new ApiError(422, "no_sentences", "No sentences found in that text.");
    const page = body.page || pasteSlug(split.sentences.map((s) => s.text));
    const base = { page, truncated: split.truncated, totalSentences: split.total, bMicro: String(pc.bMicro) };

    if (!plannerKey) {
      return {
        ...base, planner: "unavailable", plannerReason,
        message: "Pricing soon: the planner is offline, so nothing here is priced yet.",
        sentences: split.sentences.map((s) => ({ index: s.index, text: s.text, status: s.tooLong ? "too_long" : "pricing_soon", label: null })),
      };
    }

    const lim = pasteIp.take(ip);
    if (!lim.ok) throw new ApiError(429, "rate_limited", "Too many pastes from your address today.", { retryAfterS: lim.retryAfterS });

    const texts = split.sentences.map((s) => s.text);
    let labels;
    try {
      labels = await plannerCache.get(`${page}\n${texts.join("\n")}`, () => labelSentences(pc, texts, deps.fetchImpl));
    } catch (e) {
      pasteIp.release(ip);
      log(`planner unavailable: ${e.message}`);
      return {
        ...base, planner: "unavailable", plannerReason: e.message,
        message: "Pricing soon: the planner did not answer, so nothing here is priced yet.",
        sentences: split.sentences.map((s) => ({ index: s.index, text: s.text, status: s.tooLong ? "too_long" : "pricing_soon", label: null })),
      };
    }

    // sentences that already have a market on this page trade with buy, not open_and_buy
    let existing = new Map();
    if (claims) {
      try {
        const list = await Promise.race([claims.byPage(page), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 1500))]);
        existing = new Map(list.map((c) => [c.text, c]));
      } catch { /* unknown is fine: the contract still opens a fresh market */ }
    }

    const sentences = split.sentences.map((s, i) => {
      const l = labels[i];
      const out = { index: s.index, text: s.text, label: l?.label ?? null };
      if (s.tooLong) return { ...out, status: "too_long", reason: `Over ${config.paste.maxSentenceBytes} bytes: too long to price as one claim.` };
      if (!l) return { ...out, status: "unlabelled", reason: "The planner gave no label for this sentence." };
      if (l.label === "person") return { ...out, status: "person", reason: "About a private person: never priced." };
      if (!PRICEABLE.has(l.label)) return { ...out, status: "unfalsifiable", reason: "Opinion or uncheckable: not priced." };
      const kind = l.label;
      const c = existing.get(s.text);
      if (c) return { ...out, kind, status: "listed", claim: c };
      const receipt = signReceipt(plannerKey, { page, text: s.text, kind, p0_ppm: l.p0_ppm, b_micro: pc.bMicro });
      return { ...out, kind, status: "priced", p0_ppm: l.p0_ppm, receipt };
    });
    const priced = sentences.filter((s) => s.status === "priced" || s.status === "listed").length;
    return {
      ...base, planner: "ok", model: pc.model, plannerPublicKeyHex,
      message: priced ? undefined : "Nothing here can be priced: every line is opinion, personal or uncheckable.",
      sentences,
    };
  }

  // ---------- lane ----------
  async function laneKey(body, ip) {
    if (!body || typeof body !== "object") throw new ApiError(400, "bad_request", 'Send JSON {"publicKey": "ed25519:..."}');
    const pk = parsePublicKey(body.publicKey);
    if (!lane.enabled) throw new ApiError(503, "lane_unavailable", "The judges' lane is not configured on this server.");
    const a = laneIp.take(ip);
    if (!a.ok) throw new ApiError(429, "rate_limited", `This address has used its ${config.lane.perIpPerDay} free bets for today.`, { retryAfterS: a.retryAfterS });
    const g = laneGlobal.take("global");
    if (!g.ok) { laneIp.release(ip); throw new ApiError(429, "lane_daily_cap", "Today's free bets are all taken. Come back tomorrow, or fund your own account.", { retryAfterS: g.retryAfterS }); }
    try {
      let b;
      try { b = await lane.budget(); } catch (e) { throw new ApiError(502, "lane_upstream_error", "Could not read the lane budget from the market. Try again."); }
      if (b.paused) throw new ApiError(503, "market_paused", "The market is paused.");
      if (b.free <= 0) throw new ApiError(503, "lane_used_up", "The judges' lane is used up for now: no free credit is left on the market.");
      const r = await lane.issue(pk);
      if (r.reused) { laneIp.release(ip); laneGlobal.release("global"); }
      return r;
    } catch (e) {
      laneIp.release(ip);
      laneGlobal.release("global");
      throw e;
    }
  }

  // ---------- HTTP ----------
  const sse = new Set();

  function cors(req, res) {
    const origin = req.headers.origin;
    const allow = config.corsOrigins.includes("*") ? "*" : origin && config.corsOrigins.includes(origin) ? origin : null;
    if (allow) {
      res.setHeader("access-control-allow-origin", allow);
      if (allow !== "*") res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, last-event-id");
      res.setHeader("access-control-max-age", "600");
    }
  }

  function send(res, status, obj, headers = {}) {
    const body = JSON.stringify(obj, (k, v) => (typeof v === "bigint" ? v.toString() : v));
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
    res.end(body);
  }

  function sendError(res, e) {
    if (e instanceof ApiError) {
      const headers = e.extra.retryAfterS ? { "retry-after": String(e.extra.retryAfterS) } : {};
      return send(res, e.status, { error: { code: e.code, message: e.message, ...e.extra } }, headers);
    }
    log(`error: ${e?.message || e}`);
    return send(res, 502, { error: { code: "upstream_error", message: "The NEAR RPC did not answer. Try again in a moment." } });
  }

  function readJson(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let over = false;
      const parts = [];
      const tooLarge = () => new ApiError(413, "body_too_large", `Request body over ${limit} bytes.`);
      if (Number(req.headers["content-length"] || 0) > limit) over = true;
      req.on("data", (c) => {
        if (over) return; // drain and discard
        size += c.length;
        if (size > limit) { over = true; parts.length = 0; return; }
        parts.push(c);
      });
      req.on("end", () => {
        if (over) return reject(tooLarge());
        const raw = Buffer.concat(parts).toString("utf8");
        if (!raw.trim()) return reject(new ApiError(400, "bad_request", "Empty body: send JSON."));
        try { resolve(JSON.parse(raw)); } catch { reject(new ApiError(400, "invalid_json", "The body is not valid JSON.")); }
      });
      req.on("error", reject);
    });
  }

  function openStream(req, res, url) {
    if (sse.size >= config.events.maxClients) return send(res, 503, { error: { code: "too_many_streams", message: "Too many live connections. Poll /events/recent instead." } });
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const since = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0) || 0;
    const write = (s) => {
      if (res.writableLength > 1_000_000) { res.destroy(); return; } // a stuck client is dropped, never buffered forever
      res.write(s);
    };
    const frame = (e) => `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
    write(`retry: 2000\n\n`);
    const backlog = hub.since(since);
    for (const e of backlog) write(frame(e));
    write(`event: hello\ndata: ${JSON.stringify({ lastBlockHeight: scanner.state.lastHeight, replayed: backlog.length, marketId: config.marketId })}\n\n`);
    const unsub = hub.subscribe((e) => write(frame(e)));
    const ping = setInterval(() => write(`: ping ${now()}\n\n`), 15000);
    const client = { res, close: () => { clearInterval(ping); unsub(); sse.delete(client); } };
    sse.add(client);
    req.on("close", client.close);
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ip = clientIp(req, config.trustProxy);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    if (path === "/" && req.method === "GET") {
      return send(res, 200, {
        name: "Priced In API", network: config.network, marketId: config.marketId,
        endpoints: ["POST /lane/key", "GET /claims?page=<slug>", "GET /claims/:id", "GET /events (SSE)", "GET /events/recent", "GET /health", "POST /paste"],
      });
    }
    if (path === "/health" && req.method === "GET") {
      const h = await health();
      return send(res, h.ok ? 200 : 503, h);
    }
    if (path === "/events" && req.method === "GET") {
      if (!config.marketId) return send(res, 503, { error: { code: "market_not_configured", message: "MARKET_CONTRACT_ID is not set." } });
      return openStream(req, res, url);
    }
    if (path === "/events/recent" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") || 0) || 0;
      return send(res, 200, { events: hub.since(since), lastBlockHeight: scanner.state.lastHeight, lastSeq: hub.seq });
    }
    if (path === "/claims" && req.method === "GET") {
      if (!claims) return send(res, 503, { error: { code: "market_not_configured", message: "MARKET_CONTRACT_ID is not set." } });
      const page = url.searchParams.get("page");
      if (page !== null && !validPage(page)) throw new ApiError(400, "invalid_page", "page must be a slug: lowercase letters, digits and dashes.");
      const list = page ? await claims.byPage(page) : await claims.all();
      return send(res, 200, { page, claims: list, count: list.length, asOf: now() });
    }
    const m = path.match(/^\/claims\/([^/]+)$/);
    if (m && req.method === "GET") {
      if (!claims) return send(res, 503, { error: { code: "market_not_configured", message: "MARKET_CONTRACT_ID is not set." } });
      if (!/^\d{1,15}$/.test(m[1])) throw new ApiError(400, "invalid_claim_id", "Claim ids are whole numbers.");
      const c = await claims.one(Number(m[1]));
      if (!c) throw new ApiError(404, "no_such_claim", `No claim ${m[1]}.`);
      return send(res, 200, { claim: c, asOf: now() });
    }
    if (path === "/lane/key") {
      if (req.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use POST.");
      const t0 = now();
      const r = await laneKey(await readJson(req, MAX_BODY["/lane/key"]), ip);
      log(`lane key ${r.reused ? "reused" : "issued"} in ${now() - t0} ms`);
      return send(res, 200, r);
    }
    if (path === "/paste") {
      if (req.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use POST.");
      return send(res, 200, await paste(await readJson(req, MAX_BODY["/paste"]), ip));
    }
    throw new ApiError(404, "not_found", `No route ${req.method} ${path}.`);
  }

  const server = http.createServer((req, res) => {
    cors(req, res);
    route(req, res).catch((e) => { if (!res.headersSent) sendError(res, e); else res.end(); });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  return {
    server, rpc, hub, scanner, lane, claims, health, config,
    async start() {
      scanner.start();
      runProbe();
      this.probeTimer = setInterval(runProbe, 5000);
      this.probeTimer.unref();
      if (lane.enabled) {
        lane.warm();
        claims.stats().catch(() => {});
        this.warmTimer = setInterval(() => { lane.warm(); }, 30_000);
        this.warmTimer.unref();
      }
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
      return server.address();
    },
    async stop() {
      scanner.stop();
      clearInterval(this.warmTimer);
      clearInterval(this.probeTimer);
      for (const c of [...sse]) { c.close(); c.res.end(); }
      const closed = new Promise((r) => server.close(() => r()));
      server.closeAllConnections?.();
      await closed;
    },
  };
}
