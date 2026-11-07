// A stand-in for the API with today's news switched on, for the e2e tests and the screenshots only. It is
// never shipped: nothing in the app imports it, and the site reaches it only when built with
// API_ORIGIN=http://127.0.0.1:<port> for a test run.
//
// Everything that isn't news is passed through to the live API (reads only), so the Wikipedia facts, the
// bets, the AI traders' records and the rulings are real. The news lines are the real scout run on
// 7 November 2026 (deployments/scout-test.json: real headlines from real feeds, the claims that passed
// every check but capacity) and the real settling backtest (deployments/news-settle-*.json, with the
// outcomes it reached). Picks, nicknames and reports are parsed, signature-checked and counted by the
// API's own code (api/_lib/picks.mjs, api/_lib/news.mjs), so the shapes are the API's by construction.
//
//   node tests/mock/api.mjs            MOCK_PORT=3299 MOCK_UPSTREAM=https://isitpriced.com MOCK_NEWS=on|off
//   POST /__mock {"news":"on"|"off","scenario":"first"|"returning"|"overdue"|"refused"|"bounty"|"closed"}   switch state
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { baseEncode } from "near-api-js";
import { todayOf, v1TodayOf, newsConfig } from "../../../api/_lib/news.mjs";
import {
  PICKS, parsePick, parseProfile, parseReport, firstPicks, pickableOrWhy, nicknames, nicknameTaken, reportsOf, reportView, reportEvidence,
  aiTraders, leaderboard, picksOf, picksOnLine, pickCounts, challengeCall, trustedSource, untrustedSource, Refusal, refusalBody, refusalWords, RULES,
} from "../../../api/_lib/picks.mjs";

const PORT = Number(process.env.MOCK_PORT || 3299);
const UP = (process.env.MOCK_UPSTREAM || "https://isitpriced.com").replace(/\/+$/, "");
const MARKET = "market.isitpriced.near";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const H = 3_600_000;
const DAY = 24 * H;

// ---------- the visitor of the "returning" state: a fixed key, so a test can put it in the browser ----------

export const VISITOR_SEED = createHash("sha256").update("pricedin-e2e-visitor").digest();
const visitor = nacl.sign.keyPair.fromSeed(new Uint8Array(VISITOR_SEED));
export const VISITOR_SECRET = `ed25519:${baseEncode(Buffer.from(visitor.secretKey))}`;
export const VISITOR_KEY = `ed25519:${baseEncode(Buffer.from(visitor.publicKey))}`;
const signHex = (msg) => Buffer.from(nacl.sign.detached(new Uint8Array(Buffer.from(msg, "utf8")), visitor.secretKey)).toString("hex");

// ---------- the lines, from the real scout run and the real backtest ----------

const read = (f) => JSON.parse(readFileSync(`${ROOT}deployments/${f}`, "utf8"));
/** The outlet: the feed's own for BBC Sport's gossip column, else Google News's suffix on the headline. */
const outletOf = (h, link = "") => (/bbc\.(co\.uk|com)/.test(link) ? "BBC Sport" : /\s+-\s+([^-]{2,40})$/.exec(h || "")?.[1]?.trim() ?? null);
const dateWords = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const endOfDay = (iso) => Date.parse(`${iso}T23:59:59.999Z`) + 1;
const searchUrl = (h) => `https://news.google.com/search?q=${encodeURIComponent(h.replace(/\s+-\s+[^-]+$/, ""))}`;

function meta(row, id, { opened_at, settle = null }) {
  return {
    claim_id: id, question: row.question, claim: row.claim, topic: row.topic, why: row.why ?? "",
    // the feeds' own publish times aren't in the run's records, so none is made up: the API allows null
    source: { headline: row.headline, url: row.link ?? searchUrl(row.headline), outlet: outletOf(row.headline, row.link), published_at: null },
    settles: { ...row.settles, by_words: row.settles.by_words ?? dateWords(row.settles.by) },
    first_estimate: row.estimate, opened_at, open_tx: null, b_micro: "1450000",
    coverage: (row.web?.sources ?? []).slice(0, 3), ...(settle ? { settle } : {}),
  };
}

/** A claim view exactly as /api/claims gives an untraded v3 market at its opening price. */
function view(m, { status = "Open", outcome = null, challengeId = null, bounty = "0" } = {}) {
  const p = Math.min(0.8, Math.max(0.2, m.first_estimate));
  const b = 1.45;
  const ppm = p === 0.5 || p === 0.2 ? Math.round(p * 1e6) : Math.round(p * 1e6) - 1;
  const up = p + 0.1 < 1 ? Math.round(b * Math.log((1 - p) / (0.9 - p)) * 1e6) : 0;
  const down = p - 0.1 > 0 ? Math.round(b * Math.log(p / (p - 0.1)) * 1e6) : 0;
  return {
    id: m.claim_id, text: m.claim, page: `news-${new Date(m.opened_at).toISOString().slice(0, 10)}`, kind: "document",
    price_yes_ppm: ppm, cost_up_10_micro: String(up), cost_down_10_micro: String(down), status, outcome, provisional: null, trades: 0,
    volume_micro: "0", open_interest_micro: "0", collected_micro: "0", payout_left_micro: "0", challenge_id: challengeId, prev: null, next: null,
    bounty_micro: bounty, b_micro: "1450000", d0: String(Math.round(Math.log(p / (1 - p)) * 1e12)), q_yes_micro: "0", q_no_micro: "0", fee_bps: 100,
    price_yes: ppm / 1e6, cost_to_move: { up_10_points_usd: up / 1e6, down_10_points_usd: down / 1e6 }, volume_usd: 0,
  };
}

function lines(scenario, now) {
  const scout = read("scout-test.json").rows;
  const fresh = read("news-settle-fresh.json").results;
  const second = read("news-settle-second-look.json").results;
  const pick = (rows, re) => rows.find((r) => re.test(r.question));
  const out = [];
  // today: the scout's four that would open (NEWS_PER_DAY), one per topic, opened this morning at 06:00 UTC
  const morning = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T06:00:00Z`);
  const opened = morning < now ? morning : now - 2 * H;
  [/Anthropic/, /Real Madrid/, /WWE/, /Mariners/].forEach((re, i) => {
    const m = meta(pick(scout, re), 9001 + i, { opened_at: opened + i * 4 * 60_000 });
    out.push({ m, v: view(m, { bounty: scenario === "bounty" && i === 1 ? "2000000" : "0" }) });
  });
  // decided in the last week: the backtest's claims with the outcome it reached, settled the day after their date
  const decided = [
    [fresh, /Microsoft offering buyouts/], [fresh, /DeepSeek raise/], [fresh, /Meta raising/], [fresh, /Dutch government/],
    [fresh, /DoorDash buying/], [fresh, /Troy Aikman/], [fresh, /Solidigm/], [fresh, /Connor Storrie/], [second, /OpenAI buying Google TPUs/],
  ];
  decided.forEach(([rows, re], i) => {
    const r = rows.find((x) => re.test(x.question) && (x.pipeline?.outcome === "TRUE" || x.pipeline?.outcome === "FALSE"));
    const due = endOfDay(r.settles.by);
    const m = meta(r, 9101 + i, { opened_at: Date.parse(`${r.as_of}T08:00:00Z`) });
    m.decided_at = Math.min(due + 7 * H + i * 23 * 60_000, now - (decided.length - i) * 40 * 60_000);
    out.push({ m, v: view(m, { status: "Settled", outcome: r.pipeline.outcome === "TRUE", challengeId: 300 + i }), settledAt: m.decided_at });
  });
  // waiting: date passed, receipts not passing yet (the backtest's own reasons, as the settler would note them)
  if (scenario === "overdue") {
    [[fresh, /Josh Downs/], [fresh, /White Sox/]].forEach(([rows, re], i) => {
      const r = rows.find((x) => re.test(x.question));
      const m = meta(r, 9201 + i, { opened_at: Date.parse(`${r.as_of}T08:00:00Z`), settle: { last_look_at: now - 5 * H, note: `No receipt yet: ${r.pipeline.reason}`.slice(0, 300), challenge_id: null, looks: 2 } });
      out.push({ m, v: view(m) });
    });
  }
  return out;
}

// ---------- state ----------

const state = { news: process.env.MOCK_NEWS || "on", scenario: process.env.MOCK_SCENARIO || "first", picks: [], profiles: [], reports: [], lines: [] };

function reset(scenario, now = Date.now()) {
  state.scenario = scenario;
  state.lines = lines(scenario, now);
  state.picks = []; state.profiles = []; state.reports = [];
  if (scenario === "returning" || scenario === "closed") {
    // the visitor's own calls: four on lines since decided (two right, two not), two on today's
    const mine = [[9101, "yes"], [9102, "yes"], [9103, "yes"], [9104, "yes"], [9001, "no"], [9003, "yes"]];
    for (const [id, side] of mine) {
      const l = state.lines.find((x) => x.m.claim_id === id);
      const at = l.m.opened_at + 95 * 60_000;
      const message = `pricedin|pick|v1|mainnet|${id}|${side}|${at}`;
      state.picks.push({ t: "pick", key: VISITOR_KEY, claim_id: id, side, issued_at: at, at, price_yes_ppm: l.v.price_yes_ppm, page: l.v.page, message, signature: signHex(message) });
    }
  }
  // a report nobody finished: reportsOf closes it after two days, with its own reason
  if (scenario === "closed") state.reports.push({ t: "report", id: "c10sedc10sedc10s", key: VISITOR_KEY, claim_id: 9001, says: "false", url: "https://www.anthropic.com/news", quote: "the words on that page", note: "", issued_at: now - 3 * DAY, at: now - 3 * DAY, message: "", signature: "" });
}
reset(state.scenario);

// ---------- the live API, read through ----------

const cache = new Map();
async function upstream(path, ttl = 20_000) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  const r = await fetch(`${UP}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const body = await r.json();
  if (r.ok) cache.set(path, { at: Date.now(), body });
  return body;
}

async function facts() {
  const [c, e] = await Promise.all([upstream("/api/claims"), upstream("/api/events/recent?since=0")]);
  const mock = state.news === "on" ? state.lines : [];
  const settles = mock.filter((l) => l.settledAt).map((l, i) => ({ seq: 900000 + i, event: "settle", version: "3.0.0", data: { claim_id: l.m.claim_id, challenge_id: l.v.challenge_id, outcome: l.v.outcome, payout_micro: "0", treasury_micro: "0" }, blockTimestampMs: l.settledAt, seenAtMs: l.settledAt }));
  const doc = { lines: Object.fromEntries(mock.map((l) => [l.m.claim_id, l.m])) };
  const claims = [...c.claims, ...mock.map((l) => ({ ...l.v, news: newsOf(l.m) }))];
  return { claims, events: [...e.events, ...settles], doc, asOf: c.asOf };
}

/** The `news` field, as news.mjs's newsField writes it. */
function newsOf(m) {
  return {
    kind: "news", question: m.question, topic: m.topic, why: m.why,
    source: { headline: m.source.headline, url: m.source.url, outlet: m.source.outlet ?? null, published_at: m.source.published_at ?? null },
    settles: { by: m.settles.by, by_words: m.settles.by_words, due_at: endOfDay(m.settles.by), source: m.settles.source, source_url: m.settles.source_url ?? null, event: m.settles.event ?? null, rule: m.claim },
    first_estimate: m.first_estimate, opened_at: m.opened_at, open_tx: m.open_tx ?? null, coverage: m.coverage || [],
  };
}

// ---------- the news routes, through the API's own code ----------

const json = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*", ...headers }); res.end(JSON.stringify(body)); };
const bodyOf = (req) => new Promise((ok) => { let s = ""; req.on("data", (d) => { s += d; }); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } }); });
const NEWS = new Set(["/api/today", "/api/v1/today", "/api/picks", "/api/profile", "/api/leaderboard", "/api/reports", "/api/challenge"]);

async function news(req, res, url) {
  const now = Date.now();
  const f = await facts();
  const reports = () => reportsOf(state.reports, { claims: f.claims, events: f.events });
  const nicks = nicknames(state.profiles);
  const path = url.pathname;
  try {
    if (path === "/api/today" || path === "/api/v1/today") {
      const today = todayOf({ claims: f.claims, doc: f.doc, events: f.events, pickCounts: pickCounts(firstPicks(state.picks)), nowMs: now, cfg: newsConfig({ NEWS_ENABLED: "1" }) });
      return json(res, 200, path === "/api/today" ? { ...today, asOf: f.asOf } : v1TodayOf(today, { network: "mainnet", marketId: MARKET }));
    }
    if (path === "/api/leaderboard") {
      const period = ["week", "month", "all"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "week";
      return json(res, 200, { ...leaderboard({ picks: firstPicks(state.picks), claims: f.claims, events: f.events, reports: reports(), ai: aiTraders({ names: new Map(), marketId: MARKET }), nicks, period, nowMs: now, minSettled: 5 }), asOf: f.asOf });
    }
    if (path === "/api/picks" && req.method === "GET") {
      if (url.searchParams.has("claim")) return json(res, 200, picksOnLine(Number(url.searchParams.get("claim")), firstPicks(state.picks), nicks));
      const key = url.searchParams.get("key") || "";
      if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) throw new Refusal(400, "invalid_public_key", "Ask for /api/picks?key=ed25519:<your browser's key>, or ?claim=<id>.");
      const newsMap = new Map(Object.values(f.doc.lines).map((m) => [m.claim_id, m]));
      return json(res, 200, picksOf(key, { picks: firstPicks(state.picks), claims: f.claims, events: f.events, nicks, reports: reports(), news: newsMap, nowMs: now, minSettled: 5 }));
    }
    if (path === "/api/picks" && req.method === "POST") {
      const pick = parsePick(await bodyOf(req), { network: "mainnet", nowMs: now });
      const c = f.claims.find((x) => x.id === pick.claim_id);
      pickableOrWhy(c, c?.news ?? null, now);
      const mine = firstPicks(state.picks).find((x) => x.key === pick.key && x.claim_id === pick.claim_id);
      if (mine && mine.side === pick.side) return json(res, 200, { ok: true, duplicate: true, pick: { claim_id: mine.claim_id, side: mine.side, at: mine.at, price_yes_ppm: mine.price_yes_ppm } });
      if (mine) throw new Refusal(409, "already_picked", `You picked ${mine.side === "yes" ? "Yes" : "No"} on this line. Your first pick is the one that counts.`, { pick: { claim_id: mine.claim_id, side: mine.side, at: mine.at } });
      const rec = { t: "pick", key: pick.key, claim_id: pick.claim_id, side: pick.side, issued_at: pick.issued_at, at: now, price_yes_ppm: c.price_yes_ppm, page: c.page, message: pick.message, signature: pick.signature };
      state.picks.push(rec);
      return json(res, 200, { ok: true, pick: { claim_id: rec.claim_id, side: rec.side, at: rec.at, price_yes_ppm: rec.price_yes_ppm }, rules: RULES });
    }
    if (path === "/api/profile" && req.method === "GET") {
      const key = url.searchParams.get("key") || "";
      const mine = picksOf(key, { picks: firstPicks(state.picks), claims: f.claims, events: f.events, nicks, reports: reports(), nowMs: now, minSettled: 5 });
      return json(res, 200, { key, nickname: mine.nickname, name: mine.name, stats: mine.stats, rules: RULES });
    }
    if (path === "/api/profile" && req.method === "POST") {
      const prof = parseProfile(await bodyOf(req), { network: "mainnet", nowMs: now });
      if (nicknameTaken(state.profiles, prof.nickname, prof.key)) throw new Refusal(409, "nickname_taken", "Someone already has that nickname. Pick another.");
      state.profiles.push({ t: "profile", key: prof.key, nickname: prof.nickname, issued_at: prof.issued_at, at: now, message: prof.message, signature: prof.signature });
      return json(res, 200, { ok: true, key: prof.key, nickname: prof.nickname });
    }
    if (path === "/api/reports" && req.method === "POST") {
      const rep = parseReport(await bodyOf(req), { network: "mainnet", nowMs: now });
      const c = f.claims.find((x) => x.id === rep.claim_id);
      if (!c) throw new Refusal(404, "no_such_claim", "There is no line with that id.");
      const source = trustedSource(rep.url, { news: c.news ?? null });
      if (!source.ok) throw untrustedSource(rep.claim_id, source.hosts);
      if (c.status !== "Open") throw new Refusal(409, "line_closed", c.status === "Settled" ? "This line is settled: it can't be challenged now." : "A challenge is already running on this line.");
      const live = [...reports().values()].find((x) => x.claim_id === rep.claim_id && ["received", "retry", "verified", "challenged", "ruling"].includes(x.status));
      if (live) throw new Refusal(409, "already_reported", "Someone's report on this line is already being checked. Its result shows on the line.", { report_id: live.id });
      const rec = { t: "report", id: rep.id, key: rep.key, claim_id: rep.claim_id, says: rep.says, url: rep.url, quote: rep.quote, note: rep.note, issued_at: rep.issued_at, at: now, message: rep.message, signature: rep.signature };
      rec.evidence = reportEvidence(rec);
      state.reports.push(rec);
      // the check, a few seconds later: refused in the "refused" state (the words aren't at the page), else verified
      setTimeout(() => {
        const check = state.scenario === "refused" ? { result: "quote_not_found", support: null } : { result: "verified", support: { verdict: "supported" } };
        state.reports.push({ t: "report_status", id: rec.id, status: state.scenario === "refused" ? "refused" : "verified", at: Date.now(), reason: state.scenario === "refused" ? refusalWords(check) : undefined, check });
      }, 3000);
      return json(res, 202, { ok: true, report: reportView({ ...rec, status: "received", reason: "Received. We are checking that the words are on that page." }), next: `GET /api/reports?id=${rec.id}` });
    }
    if (path === "/api/reports" && req.method === "GET") {
      const all = [...reports().values()];
      const id = url.searchParams.get("id"), key = url.searchParams.get("key"), claim = url.searchParams.get("claim");
      const list = id ? all.filter((x) => x.id === id) : key ? all.filter((x) => x.key === key) : claim !== null ? all.filter((x) => x.claim_id === Number(claim)) : all;
      if (id && !list.length) throw new Refusal(404, "no_such_report", "No report with that id.");
      return json(res, 200, { reports: list.sort((a, b) => b.at - a.at).map(reportView), count: list.length });
    }
    if (path === "/api/challenge") {
      const c = f.claims.find((x) => x.id === Number(url.searchParams.get("claim")));
      if (!c) throw new Refusal(404, "no_such_claim", "There is no line with that id.");
      return json(res, 200, challengeCall(c, { marketId: MARKET, network: "mainnet", bondMicro: "1000000", news: c.news ?? null }));
    }
    throw new Refusal(405, "method_not_allowed", `${req.method} is not used on ${path}.`);
  } catch (e) {
    if (e instanceof Refusal) return json(res, e.status, refusalBody(e));
    return json(res, 502, { error: { code: "upstream_error", message: String(e.message).slice(0, 200) } });
  }
}

// ---------- the mock's own lines through /api/claims, /api/claims/<id> and the reads around them ----------

async function claimsRoutes(req, res, url) {
  if (state.news !== "on") return false;
  const path = url.pathname;
  const mine = (id) => state.lines.find((l) => l.m.claim_id === id);
  if (path === "/api/claims") {
    const f = await facts();
    return json(res, 200, { claims: f.claims, asOf: f.asOf }), true;
  }
  const one = /^\/api\/claims\/(\d+)$/.exec(path);
  if (one && mine(Number(one[1]))) {
    const l = mine(Number(one[1]));
    return json(res, 200, { claim: { ...l.v, news: newsOf(l.m) }, asOf: Date.now() }), true;
  }
  const id = Number(url.searchParams.get("claim"));
  if (mine(id) && (path === "/api/history" || path === "/api/rationales")) return json(res, 200, path === "/api/history" ? { points: [] } : { rationales: [] }), true;
  if (path === "/api/events/recent") {
    const f = await facts();
    return json(res, 200, { events: f.events, lastSeq: Math.max(...f.events.map((e) => e.seq)), lastBlockHeight: 0 }), true;
  }
  return false;
}

async function proxy(req, res, url) {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise((ok) => { const b = []; req.on("data", (d) => b.push(d)); req.on("end", () => ok(Buffer.concat(b))); });
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection", "content-length", "accept-encoding"].includes(k)));
  try {
    const r = await fetch(`${UP}${url.pathname}${url.search}`, { method: req.method, headers, body, signal: AbortSignal.timeout(20_000), redirect: "manual" });
    const out = Buffer.from(await r.arrayBuffer());
    const h = {};
    r.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) h[k] = v; });
    res.writeHead(r.status, h);
    res.end(out);
  } catch (e) {
    json(res, 502, { error: { code: "upstream_error", message: `mock: ${e.message}` } });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://mock");
  if (url.pathname === "/__mock") {
    if (req.method === "POST") {
      const b = await bodyOf(req);
      if (b.news) state.news = b.news === "off" ? "off" : "on";
      if (b.scenario) reset(b.scenario);
    }
    return json(res, 200, { news: state.news, scenario: state.scenario, picks: state.picks.length, reports: state.reports.length, visitor: { key: VISITOR_KEY, secret: VISITOR_SECRET } });
  }
  if (NEWS.has(url.pathname)) {
    if (state.news !== "on") return json(res, 404, { error: { code: "not_found", message: `No route ${req.method} ${url.pathname.replace(/^\/api/, "")}.` } });
    return news(req, res, url);
  }
  // the returning visitor's free $1: it went No on the T-Bills fact, won when the AI judges ruled it false,
  // and was added to its score; so its score is $1.20 to bet again (the shape of api/_lib/views.mjs's portfolio)
  if (url.pathname === "/api/portfolio" && state.news === "on" && state.scenario === "returning" && url.searchParams.get("trader") === `lane:${VISITOR_KEY}`) {
    return json(res, 200, {
      trader: `lane:${VISITOR_KEY}`, balance_usd: 1.2,
      totals: { value_usd: 0, spent_usd: 1, received_usd: 1.2, pnl_usd: 0.2, redeemable_usd: 0, positions: 0 },
      positions: [{ claim_id: 18, side: "no", shares: 0, spent_usd: 1, received_usd: 1.2, value_usd: 0, pnl_usd: 0.2, state: "collected", redeemable: false, redeem_usd: 0 }],
      history: [],
    });
  }
  if (await claimsRoutes(req, res, url)) return;
  return proxy(req, res, url);
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock API on :${PORT}, news ${state.news}, scenario ${state.scenario}, upstream ${UP}`));
