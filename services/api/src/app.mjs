// The Priced In API: the no-wallet lane, cached claim reads, the market's live event stream,
// outcome-asserting health, the paste planner, and the AI writer's paragraph rewrites.
// Plain node:http, no framework. Other layers (services/ai) attach through addRoute and
// addHealth and publish their events on the same hub.

import http from "node:http";
import { Rpc } from "./rpc.mjs";
import { EventHub, Scanner } from "./events.mjs";
import { Claims, TtlCache } from "./claims.mjs";
import { LaneIssuer, ApiError, parsePublicKey } from "./lane.mjs";
import { DailyLimiter, clientIp } from "./ratelimit.mjs";
import { splitSentences } from "./sentences.mjs";
import { parseSigningKey, labelSentences, signReceipt, pasteSlug, validPage, PRICEABLE, ABOUT_PEOPLE, PEOPLE_REASON, looksLikeInstruction } from "./planner.mjs";
import { RewriteStore } from "./rewrites.mjs";
import { PostStore, parsePostLink, postSlug, pricedText, postNotices } from "./posts.mjs";
import { createCredence } from "./credence.mjs";
import { Paywall, HttpFacilitator, nearFacilitator, paymentHeader, sameRequirements, requirements as x402Requirements, caip2 } from "./x402.mjs";

/** The page's voice line when nothing in a post can be checked. */
export const ALL_OPINION = "Nothing here to price. Unfalsifiable from start to finish.";

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
  const posts = new PostStore({ config: config.post, fetchImpl: deps.fetchImpl, now, log });
  const postPlans = new TtlCache(config.post.planTtlMs, { max: config.post.cacheMax, now });
  const postIp = new DailyLimiter(config.post.perIpPerDay, { now });
  const postGlobal = new DailyLimiter(config.post.perDay, { now });
  hub.subscribe((e) => { if (e.event === "trade") lane.noteTrade(e.data?.trader); });
  const rewrites = new RewriteStore();
  /** Routes and health checks attached by other layers: "GET /path" -> handler(ctx). */
  const extraRoutes = new Map();
  const extraHealth = new Map();

  // ---------- the truth API: credence answers, free tier, x402 beyond it ----------
  const credenceIp = new DailyLimiter(config.credence.freePerIpPerDay, { now });
  const credence = createCredence({
    config, claims, hub, rewrites, rpc, now, log,
    // the AI layer's rationale journal, when services/ai is mounted on this app
    rationales: async (claimId) => {
      const h = extraRoutes.get("GET /rationales");
      if (!h) return [];
      const r = await h({ url: new URL(`http://x/rationales?claim=${claimId}`), path: "/rationales", ip: "internal" });
      return r?.rationales || r?.body?.rationales || [];
    },
    paste: (body, ip) => paste(body, ip),
  });
  const x402 = config.x402;
  let paywallP = null;
  /** The paywall, with its facilitator: injected (tests), in-process with our relayer, or remote. */
  function paywall() {
    if (!paywallP) {
      paywallP = (async () => {
        let f = deps.facilitator || null;
        if (!f && x402.relayerId && x402.relayerKey) f = await nearFacilitator(x402, x402.rpcUrl || config.rpcUrls[0]);
        else if (!f && x402.facilitatorUrl) f = new HttpFacilitator(x402.facilitatorUrl, { fetchImpl: deps.fetchImpl });
        return new Paywall(x402, f, { log });
      })().catch((e) => { log(`x402: facilitator unavailable: ${e.message}`); paywallP = null; return new Paywall(x402, null, { log }); });
    }
    return paywallP;
  }
  const CREDENCE_DESCRIPTION = "Priced In credence: the market's price, open interest, cost to move, agents' rationales with sources, resolution and provenance for the claims matching your question.";
  const resourceUrl = (req, url) => `${req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "https" : "http"}://${req.headers.host || "localhost"}${url.pathname}${url.search}`;

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
    const extra = {};
    for (const [name, fn] of extraHealth) {
      try {
        const r = await fn();
        extra[name] = r?.check ?? r;
        for (const f of r?.failures || []) failures.push(`${name}: ${f}`);
      } catch (e) { extra[name] = { error: e.message }; failures.push(`${name}: health check failed: ${e.message}`); }
    }
    return {
      ok: failures.length === 0,
      network: config.network,
      marketId: config.marketId,
      failures,
      checks: {
        ...extra,
        scanner: { lastBlockHeight: st.lastHeight, lastScanAgeS: scanAgeS, maxAgeS: config.health.maxScanAgeS, chainLagS, blocksScanned: st.blocksScanned, txsTracked: st.txsTracked, skippedBlocks: st.skippedBlocks, lostTxs: st.lostTxs, lastError: st.lastError },
        rpc: { reachable: reachable.length, urls: probes },
        events: { lastEventAgeS: eventAgeS, maxAgeS: config.health.maxEventAgeS || null, buffered: hub.buf.length, streams: sse.size },
        lane: laneInfo,
        planner: { status: plannerKey ? "ok" : "unavailable", reason: plannerReason, plannerPublicKeyHex },
        posts: { cached: posts.size, fetches: posts.fetches, lastFetchMs: posts.lastFetchMs, lastError: posts.lastError, newToday: postGlobal.used("global"), newPerDay: config.post.perDay },
        credence: await (async () => {
          const pw = await paywall();
          return { freePerIpPerDay: config.credence.freePerIpPerDay, payments: pw.enabled ? "x402" : "off", network: caip2(x402.network), priceMicro: x402.priceMicro, asset: x402.asset, payTo: x402.payTo, facilitator: pw.f?.kind ?? null, relayer: pw.f?.relayer ?? null, stats: pw.stats };
        })(),
      },
    };
  }

  // ---------- paste ----------
  /**
   * @param {{ text: string, page?: string }} body
   * @param {string} ip
   * @param {{ planCache?: TtlCache, limit?: boolean }} [opts] the post route brings its own cache and limits
   */
  async function paste(body, ip, { planCache = plannerCache, limit = true } = {}) {
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

    if (limit) {
      const lim = pasteIp.take(ip);
      if (!lim.ok) throw new ApiError(429, "rate_limited", "Too many pastes from your address today.", { retryAfterS: lim.retryAfterS });
    }

    const texts = split.sentences.map((s) => s.text);
    let labels;
    try {
      labels = await planCache.get(`${page}\n${texts.join("\n")}`, () => labelSentences(pc, texts, deps.fetchImpl));
    } catch (e) {
      if (limit) pasteIp.release(ip);
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
      if (looksLikeInstruction(s.text)) return { ...out, status: "unfalsifiable", guard: "instruction", reason: "Written to a model, not about the world: not priced." };
      if (ABOUT_PEOPLE.has(l.label)) return { ...out, status: l.label, greyed: true, reason: PEOPLE_REASON };
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

  // ---------- posts: change x.com to our domain and the post opens priced ----------
  async function post(link, ip) {
    const { id, user } = parsePostLink(link, { selfHosts: config.post.selfHosts });
    const page = postSlug(id);
    const entry = await posts.read(id, user, {
      // only a request that makes us read a post nobody has opened yet pays: views of a viral post are free
      take() {
        const a = postIp.take(ip);
        if (!a.ok) throw new ApiError(429, "rate_limited", `This address has opened ${config.post.perIpPerDay} new posts today. Posts anyone has opened already still load.`, { retryAfterS: a.retryAfterS });
        const g = postGlobal.take("global");
        if (!g.ok) { postIp.release(ip); throw new ApiError(429, "post_daily_cap", "We've read today's share of new posts. Posts already opened still load; new ones open tomorrow.", { retryAfterS: g.retryAfterS }); }
      },
      release() { postIp.release(ip); postGlobal.release("global"); },
    });
    if (entry.gone) {
      // we honour deletions: no text, no author, nothing of the post but its number
      const message = entry.gone === "private"
        ? "This post is private or its account is protected, so we show nothing from it."
        : "This post was deleted, so we show nothing from it.";
      return { status: 410, body: { source: "x", page, id, gone: true, reason: entry.gone, link: `https://x.com/i/status/${id}`, message, error: { code: entry.gone === "private" ? "post_private" : "post_deleted", message } } };
    }
    const p = entry.post;
    const notices = postNotices(p);
    if (entry.stale) notices.push({ code: "stale", message: `X didn't answer just now, so this is the copy we read at ${new Date(entry.checkedAt).toISOString()}.` });
    const base = { source: "x", page, gone: false, post: { ...p, fetchedAt: entry.fetchedAt, checkedAt: entry.checkedAt }, notices };
    const text = pricedText(p).slice(0, config.paste.maxInputChars);
    const noText = { ...base, noText: true, planner: plannerKey ? "ok" : "unavailable", sentences: [], bMicro: String(pc.bMicro), message: "This post has no words to price: only a picture, a video or a link." };
    if (!text) return { status: 200, body: noText };
    let r;
    try {
      r = await paste({ text, page }, ip, { planCache: postPlans, limit: false });
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_sentences") return { status: 200, body: noText };
      throw e;
    }
    if (r.truncated) notices.push({ code: "truncated", message: `Priced the first ${r.sentences.length} of ${r.totalSentences} sentences.` });
    const allOpinion = r.planner === "ok" && r.sentences.length > 0 && r.sentences.every((s) => s.status === "unfalsifiable");
    return { status: 200, body: { ...base, ...r, allOpinion, ...(allOpinion ? { voice: ALL_OPINION, message: ALL_OPINION } : {}) } };
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
      res.setHeader("access-control-allow-headers", "content-type, last-event-id, payment-signature, x-payment");
      res.setHeader("access-control-expose-headers", "payment-required, payment-response, x-free-calls-remaining, retry-after");
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
        endpoints: ["GET /v1", "GET /v1/credence?q=<question or claim>", "GET /v1/credence?claim=<id>", "GET /v1/quote?claim=<id>&side=yes|no&amount_usd=<n>", "POST /lane/key", "GET /claims?page=<slug>", "GET /claims/:id", "GET /events (SSE)", "GET /events/recent", "GET /health", "POST /paste", "GET /rewrites?page=<slug>", "GET /post/:id", "GET /post?url=<link>", ...[...extraRoutes.keys()]],
      });
    }
    if (path === "/v1" && req.method === "GET") {
      const pw = await paywall();
      return send(res, 200, {
        name: "Priced In truth API", network: config.network, contract: config.marketId, usdc: config.usdcId, rpc: config.publicRpcUrls,
        credence: {
          path: "/v1/credence?q=<question or claim>", free_per_ip_per_day: config.credence.freePerIpPerDay,
          payments: pw.enabled ? { protocol: "x402", version: 2, ...x402Requirements(x402), usd: x402.priceMicro / 1e6, facilitator: pw.f?.kind ?? null } : null,
        },
        quote: "/v1/quote?claim=<id>&side=yes|no&amount_usd=<n>",
        mcp: "From a clone of the repo: claude mcp add pricedin -- npx -y ./tools/mcp (tools: ask, get_claim, quote, bet).",
      });
    }
    if (path === "/v1/credence" && req.method === "GET") {
      const q = (url.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
      const claimParam = url.searchParams.get("claim");
      const page = url.searchParams.get("page");
      const limit = Math.min(config.credence.maxResults, Math.max(1, Number(url.searchParams.get("limit") || config.credence.maxResults) || 1));
      if (claimParam === null && !q) throw new ApiError(400, "empty_query", "Ask something: /v1/credence?q=<a question or a claim>, or ?claim=<id>.");
      if (claimParam !== null && !/^\d{1,15}$/.test(claimParam)) throw new ApiError(400, "invalid_claim_id", "Claim ids are whole numbers.");
      if (q.length > config.credence.maxQueryChars) throw new ApiError(413, "query_too_long", `Ask in at most ${config.credence.maxQueryChars} characters.`);
      if (page !== null && !validPage(page)) throw new ApiError(400, "invalid_page", "page must be a slug: lowercase letters, digits and dashes.");
      const args = { q: claimParam !== null ? null : q, claim: claimParam !== null ? Number(claimParam) : null, page, limit, open: url.searchParams.get("open") !== "0" };
      const work = async () => {
        try { return await credence.answer(args, ip); } catch (e) {
          if (e instanceof ApiError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
          log(`credence: ${e.message}`);
          return { status: 502, body: { error: { code: "upstream_error", message: "The NEAR RPC did not answer. Try again in a moment." } } };
        }
      };
      const resource = resourceUrl(req, url);
      const header = paymentHeader(req);
      if (header) {
        const pw = await paywall();
        if (!pw.enabled) throw new ApiError(400, "payments_off", "This server takes no payments; use the free tier.");
        const r = await pw.charge(String(header), resource, CREDENCE_DESCRIPTION, work);
        return send(res, r.status, r.body, r.headers || {});
      }
      const lim = credenceIp.take(ip);
      if (!lim.ok) {
        const pw = await paywall();
        if (pw.enabled) {
          const msg = `The free tier is ${config.credence.freePerIpPerDay} credence calls a day per address, and this address has used them. Each further call costs $${(x402.priceMicro / 1e6).toFixed(2)} in USDC by x402.`;
          const r = pw.challenge(resource, msg, CREDENCE_DESCRIPTION);
          return send(res, 402, { ...r.body, free: { limit: config.credence.freePerIpPerDay, remaining: 0, resets_in_s: lim.retryAfterS } }, r.headers);
        }
        throw new ApiError(429, "free_tier_used", `The free tier is ${config.credence.freePerIpPerDay} credence calls a day per address, and this server takes no payments yet. Come back tomorrow.`, { retryAfterS: lim.retryAfterS });
      }
      const r = await work();
      if (r.status >= 400) credenceIp.release(ip);
      const remaining = r.status >= 400 ? lim.remaining + 1 : lim.remaining;
      return send(res, r.status, { ...r.body, free: { limit: config.credence.freePerIpPerDay, remaining } }, { "x-free-calls-remaining": String(remaining) });
    }
    if (path === "/v1/quote" && req.method === "GET") {
      const claimParam = url.searchParams.get("claim") ?? "";
      const side = (url.searchParams.get("side") || "").toLowerCase();
      const amountUsd = Number(url.searchParams.get("amount_usd") ?? url.searchParams.get("amount") ?? 1);
      if (!/^\d{1,15}$/.test(claimParam)) throw new ApiError(400, "invalid_claim_id", "claim=<id>: claim ids are whole numbers.");
      if (side !== "yes" && side !== "no") throw new ApiError(400, "invalid_side", 'side must be "yes" or "no".');
      if (!(amountUsd > 0) || amountUsd > 1000) throw new ApiError(400, "invalid_amount", "amount_usd must be more than 0 and at most 1000.");
      const r = await credence.quote({ claim: Number(claimParam), side, amountUsd });
      return send(res, r.status, r.body);
    }
    if (path.startsWith("/x402/") && x402.relayerKey && x402.facilitatorRoutes) {
      // our own facilitator's HTTP interface. It only verifies and settles payments to us,
      // so nobody can spend our relayer's gas on their own transfers.
      const pw = await paywall();
      if (!pw.f) throw new ApiError(503, "facilitator_unavailable", "The facilitator is not ready.");
      if (path === "/x402/supported" && req.method === "GET") return send(res, 200, await pw.f.getSupported());
      if ((path === "/x402/verify" || path === "/x402/settle") && req.method === "POST") {
        const b = await readJson(req, 64 * 1024);
        if (!sameRequirements(b?.paymentRequirements, x402Requirements(x402))) throw new ApiError(403, "not_our_payment", "This facilitator only verifies and settles payments to Priced In, on the requirements GET /v1 lists.");
        const r = path === "/x402/verify" ? await pw.f.verify(b.paymentPayload, x402Requirements(x402)) : await pw.f.settle(b.paymentPayload, x402Requirements(x402));
        return send(res, 200, r);
      }
    }
    if (path === "/rewrites" && req.method === "GET") {
      const page = url.searchParams.get("page");
      if (page !== null && !validPage(page)) throw new ApiError(400, "invalid_page", "page must be a slug: lowercase letters, digits and dashes.");
      const history = url.searchParams.get("history") === "1";
      const list = page ? rewrites.byPage(page, { history }) : rewrites.recent(50);
      return send(res, 200, { page, writer: rewrites.status, rewrites: list, count: list.length, asOf: now() });
    }
    const extra = extraRoutes.get(`${req.method} ${path}`) || [...extraRoutes.entries()].find(([k]) => k.endsWith("/*") && `${req.method} ${path}`.startsWith(k.slice(0, -1)))?.[1];
    if (extra) {
      const r = await extra({ req, url, path, ip, readJson: (limit = 64 * 1024) => readJson(req, limit) });
      if (typeof r?.raw === "string") { res.writeHead(r.status || 200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(r.headers || {}) }); return res.end(r.raw); } // exact bytes, e.g. a hashed record
      return send(res, r?.status || 200, r?.body ?? r, r?.headers || {});
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
    if (path === "/post" || path.startsWith("/post/")) {
      if (req.method !== "GET") throw new ApiError(405, "method_not_allowed", "Use GET.");
      // /post/<id>, /post/x-<id>, /post/<user>/status/<id>, /post/https://x.com/..., or /post?url=<any post link>
      let link = path === "/post" ? url.searchParams.get("url") ?? url.searchParams.get("id") : url.pathname.slice("/post/".length);
      try { link = decodeURIComponent(link ?? ""); } catch { /* keep as is: the parser rejects it */ }
      const r = await post(link, ip);
      return send(res, r.status, r.body);
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
    server, rpc, hub, scanner, lane, claims, health, config, rewrites, posts, ApiError,
    /** Attach a route: addRoute("GET", "/rationales", handler); a path ending in /* matches a prefix. */
    addRoute(method, p, handler) { extraRoutes.set(`${method.toUpperCase()} ${p}`, handler); },
    /** Attach a health check: fn() -> { check, failures? }. */
    addHealth(name, fn) { extraHealth.set(name, fn); },
    /** Extra start/stop work from attached layers. */
    hooks: { start: [], stop: [] },
    credence, paywall,
    async start() {
      paywall();
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
      for (const fn of this.hooks.start) await fn();
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
      return server.address();
    },
    async stop() {
      scanner.stop();
      for (const fn of this.hooks.stop) { try { await fn(); } catch { /* keep stopping */ } }
      clearInterval(this.warmTimer);
      clearInterval(this.probeTimer);
      for (const c of [...sse]) { c.close(); c.res.end(); }
      const closed = new Promise((r) => server.close(() => r()));
      server.closeAllConnections?.();
      await closed;
    },
  };
}
