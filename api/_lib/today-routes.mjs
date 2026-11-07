// The routes for today's claims, free picks, profiles, readers' reports, the leaderboard and the
// money path. api/index.mjs calls newsRoutes only when NEWS_ENABLED=1; off, none of these exist and
// every path below answers as it did before (404 from the services' handler).
//
//   GET  /api/today                   today's lines, then the ones settling soonest, then the ones just decided
//   GET  /v1/today                    the same lines and their odds, compact and cached, for publishers
//   GET  /api/picks?key=|?claim=      a visitor's picks and numbers, or every signed pick on a line
//   POST /api/picks                   a free pick, signed by the browser's key
//   GET  /api/profile?key=            a visitor's nickname and numbers
//   POST /api/profile                 set a nickname, signed the same way
//   GET  /api/leaderboard?period=     people and the house AI traders, ranked by accuracy
//   POST /api/reports                 catch a mistake: a line, a public page and its exact words
//   GET  /api/reports?id=|key=|claim= where reports stand
//   GET  /api/challenge?claim=        what a wallet needs to challenge a line with its own bond
//
// docs/API.md has every shape.

import { waitUntil } from "@vercel/functions";
import { readContext, readBody, sendJson, log } from "./runtime.mjs";
import { cachedLines, mergeNews, newsField, todayOf, v1TodayOf } from "./news.mjs";
import { PICKS, PROFILES, REPORTS, Refusal, refusalBody, parsePick, pickableOrWhy, firstPicks, parseProfile, nicknames, nicknameTaken, parseReport, reportEvidence, reportsOf, reportView, aiTraders, leaderboard, picksOf, picksOnLine, pickCounts, challengeCall, takeLimits, limitsConfig, RULES } from "./picks.mjs";
import { namesOf } from "./rulings.mjs";
import { clientIp } from "../../services/api/src/ratelimit.mjs";

export const TODAY_CACHE = {
  today: "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
  v1: "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
  board: "public, max-age=0, s-maxage=15, stale-while-revalidate=60",
  picks: "public, max-age=0, s-maxage=2, stale-while-revalidate=10",
};
const ROUTES = new Set(["/today", "/v1/today", "/picks", "/profile", "/leaderboard", "/reports", "/challenge"]);
export const isNewsRoute = (route) => ROUTES.has(route);

const ok = (body, headers = {}) => ({ status: 200, body, headers });

/** Everything the read models need, from one read context. */
async function facts(p) {
  const ctx = await readContext();
  const [snap, doc] = await Promise.all([p.claims.decorated(), cachedLines(p.state).catch(() => ({ lines: {} }))]);
  const j = p.journals;
  return { ctx, snap, doc, claims: mergeNews(snap.claims, doc), events: j.readCached("events.jsonl"), picks: firstPicks(j.readCached(PICKS)), profileRecs: j.readCached(PROFILES), reportRecs: j.readCached(REPORTS) };
}

/** Append one record and upload it before answering: the function may stop right after. */
async function append(p, file, rec) {
  p.journals.append(file, rec);
  await p.journals.flush({ only: [file] });
}

/** Ask the news function to check reports now (it also runs every hour). */
function kickReports() {
  const host = process.env.SELF_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!host || !process.env.CRON_SECRET) return;
  const go = fetch(`${host.replace(/\/+$/, "")}/api/news?job=reports`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(8000) }).catch((e) => log(`reports: kick: ${e.message}`));
  try { waitUntil(go); } catch { /* outside Vercel */ }
}

/**
 * Answer a news route, or return undefined for any other path.
 * @param {import('node:http').IncomingMessage} req
 */
export async function newsRoutes(req, res, route, url, p, cfg) {
  if (!isNewsRoute(route)) return undefined;
  const nowMs = Date.now();
  const network = p.api.network;
  const lim = limitsConfig();
  try {
    let r;
    if (req.method === "GET" && (route === "/today" || route === "/v1/today")) {
      const f = await facts(p);
      const today = todayOf({ claims: f.claims, doc: f.doc, events: f.events, pickCounts: pickCounts(f.picks), nowMs, cfg });
      r = route === "/today" ? ok({ ...today, asOf: f.snap.at }, { "cache-control": TODAY_CACHE.today }) : ok(v1TodayOf(today, { network, marketId: p.api.marketId }), { "cache-control": TODAY_CACHE.v1 });
    } else if (req.method === "GET" && route === "/leaderboard") {
      const f = await facts(p);
      const period = ["week", "month", "all"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "week";
      const reports = reportsOf(f.reportRecs, { claims: f.claims, events: f.events });
      r = ok({ ...leaderboard({ picks: f.picks, claims: f.claims, events: f.events, reports, ai: aiTraders({ names: namesOf(p), marketId: p.api.marketId }), nicks: nicknames(f.profileRecs), period, nowMs, minSettled: lim.minSettled }), asOf: f.snap.at }, { "cache-control": TODAY_CACHE.board });
    } else if (req.method === "GET" && route === "/picks") {
      const f = await facts(p);
      const nicks = nicknames(f.profileRecs);
      if (url.searchParams.has("claim")) {
        const id = Number(url.searchParams.get("claim"));
        if (!Number.isSafeInteger(id) || id < 0) throw new Refusal(400, "invalid_claim_id", "claim must be a line's id.");
        r = ok(picksOnLine(id, f.picks, nicks), { "cache-control": TODAY_CACHE.picks });
      } else {
        const key = String(url.searchParams.get("key") || "");
        if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) throw new Refusal(400, "invalid_public_key", "Ask for /api/picks?key=ed25519:<your browser's key>, or ?claim=<id>.");
        const news = new Map(Object.values(f.doc.lines || {}).map((m) => [m.claim_id, m]));
        r = ok(picksOf(key, { picks: f.picks, claims: f.claims, events: f.events, nicks, reports: reportsOf(f.reportRecs, { claims: f.claims, events: f.events }), news, nowMs, minSettled: lim.minSettled }), { "cache-control": "no-store" });
      }
    } else if (req.method === "POST" && route === "/picks") {
      const b = await readBody(req, 4096);
      const pick = parsePick(b, { network, nowMs });
      const ip = clientIp(req, true);
      const release = await takeLimits(p.state, [["picks-key", pick.key, lim.picksPerKey, `This key has made its ${lim.picksPerKey} picks for today.`], ["picks-ip", ip, lim.picksPerIp, "This network has made too many picks today."]]);
      try {
        const f = await facts(p);
        await p.journals.hydrate().catch(() => {});
        const c = f.claims.find((x) => x.id === pick.claim_id);
        pickableOrWhy(c, c?.news ?? null, nowMs);
        const mine = firstPicks(p.journals.read(PICKS)).find((x) => x.key === pick.key && x.claim_id === pick.claim_id);
        if (mine && mine.side === pick.side) { await release(); r = ok({ ok: true, duplicate: true, pick: { claim_id: mine.claim_id, side: mine.side, at: mine.at, price_yes_ppm: mine.price_yes_ppm } }); }
        else if (mine) throw new Refusal(409, "already_picked", `You picked ${mine.side === "yes" ? "Yes" : "No"} on this line. Your first pick is the one that counts.`, { pick: { claim_id: mine.claim_id, side: mine.side, at: mine.at } });
        else {
          const rec = { t: "pick", key: pick.key, claim_id: pick.claim_id, side: pick.side, issued_at: pick.issued_at, at: nowMs, price_yes_ppm: c.price_yes_ppm, page: c.page, message: pick.message, signature: pick.signature };
          await append(p, PICKS, rec);
          r = ok({ ok: true, pick: { claim_id: rec.claim_id, side: rec.side, at: rec.at, price_yes_ppm: rec.price_yes_ppm }, rules: RULES });
        }
      } catch (e) { await release(); throw e; }
    } else if (req.method === "GET" && route === "/profile") {
      const key = String(url.searchParams.get("key") || "");
      if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) throw new Refusal(400, "invalid_public_key", "Ask for /api/profile?key=ed25519:<your browser's key>.");
      const f = await facts(p);
      const nicks = nicknames(f.profileRecs);
      const mine = picksOf(key, { picks: f.picks, claims: f.claims, events: f.events, nicks, reports: reportsOf(f.reportRecs, { claims: f.claims, events: f.events }), nowMs, minSettled: lim.minSettled });
      r = ok({ key, nickname: mine.nickname, name: mine.name, stats: mine.stats, rules: RULES }, { "cache-control": "no-store" });
    } else if (req.method === "POST" && route === "/profile") {
      const b = await readBody(req, 4096);
      const prof = parseProfile(b, { network, nowMs });
      const ip = clientIp(req, true);
      const release = await takeLimits(p.state, [["profile-key", prof.key, lim.profilesPerKey, `This key has changed its nickname ${lim.profilesPerKey} times today.`], ["profile-ip", ip, lim.profilesPerIp, "This network has changed too many nicknames today."]]);
      try {
        await readContext();
        await p.journals.hydrate().catch(() => {});
        if (nicknameTaken(p.journals.read(PROFILES), prof.nickname, prof.key)) throw new Refusal(409, "nickname_taken", "Someone already has that nickname. Pick another.");
        await append(p, PROFILES, { t: "profile", key: prof.key, nickname: prof.nickname, issued_at: prof.issued_at, at: nowMs, message: prof.message, signature: prof.signature });
        r = ok({ ok: true, key: prof.key, nickname: prof.nickname });
      } catch (e) { await release(); throw e; }
    } else if (req.method === "POST" && route === "/reports") {
      const b = await readBody(req, 8192);
      const rep = parseReport(b, { network, nowMs });
      const ip = clientIp(req, true);
      const release = await takeLimits(p.state, [["reports-key", rep.key, lim.reportsPerKey, `This key has sent its ${lim.reportsPerKey} reports for today.`], ["reports-ip", ip, lim.reportsPerIp, "This network has sent too many reports today."]]);
      try {
        const f = await facts(p);
        await p.journals.hydrate().catch(() => {});
        const c = f.claims.find((x) => x.id === rep.claim_id);
        if (!c) throw new Refusal(404, "no_such_claim", "There is no line with that id.");
        if (c.status !== "Open") throw new Refusal(409, "line_closed", c.status === "Settled" ? "This line is settled: it can't be challenged now." : "A challenge is already running on this line.");
        const live = [...reportsOf(p.journals.read(REPORTS), { claims: f.claims, events: f.events }).values()].find((x) => x.claim_id === rep.claim_id && ["received", "retry", "verified", "challenged", "ruling"].includes(x.status));
        if (live) throw new Refusal(409, "already_reported", "Someone's report on this line is already being checked. Its result shows on the line.", { report_id: live.id });
        const rec = { t: "report", id: rep.id, key: rep.key, claim_id: rep.claim_id, says: rep.says, url: rep.url, quote: rep.quote, note: rep.note, issued_at: rep.issued_at, at: nowMs, message: rep.message, signature: rep.signature };
        rec.evidence = reportEvidence(rec);
        await append(p, REPORTS, rec);
        kickReports();
        r = { status: 202, body: { ok: true, report: reportView({ ...rec, status: "received", reason: "Received. We are checking that the words are on that page." }), next: `GET /api/reports?id=${rec.id}` } };
      } catch (e) { await release(); throw e; }
    } else if (req.method === "GET" && route === "/reports") {
      const f = await facts(p);
      const all = [...reportsOf(f.reportRecs, { claims: f.claims, events: f.events }).values()];
      const id = url.searchParams.get("id"), key = url.searchParams.get("key"), claim = url.searchParams.get("claim");
      const list = id ? all.filter((x) => x.id === id) : key ? all.filter((x) => x.key === key) : claim !== null ? all.filter((x) => x.claim_id === Number(claim)) : all;
      if (id && !list.length) throw new Refusal(404, "no_such_report", "No report with that id.");
      r = ok({ reports: list.sort((a, b) => b.at - a.at).slice(0, 100).map(reportView), count: list.length }, { "cache-control": "no-store" });
    } else if (req.method === "GET" && route === "/challenge") {
      const id = Number(url.searchParams.get("claim"));
      if (!Number.isSafeInteger(id) || id < 0) throw new Refusal(400, "invalid_claim_id", "Ask for /api/challenge?claim=<id>.");
      const f = await facts(p);
      const c = f.claims.find((x) => x.id === id);
      if (!c) throw new Refusal(404, "no_such_claim", "There is no line with that id.");
      const res2 = await f.ctx.app.rpc.viewFunction(p.api.marketId, "get_resolution", {}).catch(() => null);
      r = ok(challengeCall(c, { marketId: p.api.marketId, network, bondMicro: res2?.challenge_bond_micro ?? null, news: c.news ?? null }), { "cache-control": TODAY_CACHE.picks });
    } else {
      throw new Refusal(405, "method_not_allowed", `${req.method} is not used on ${route}.`);
    }
    return sendJson(res, r.status, r.body, r.headers || {});
  } catch (e) {
    if (e instanceof Refusal) return sendJson(res, e.status, refusalBody(e), e.status === 429 && e.extra.retryAfterS ? { "retry-after": String(e.extra.retryAfterS) } : {});
    if (e?.status === 400 || e?.status === 413) return sendJson(res, e.status, { error: { code: "bad_request", message: e.message } });
    log(`${route}: ${e.message}`);
    return sendJson(res, 502, { error: { code: "upstream_error", message: "That didn't work just now. Try again in a moment." } });
  }
}

/** /api/claims with each news line's metadata (only when news is on). */
export async function claimsWithNews(p, claims) {
  const doc = await cachedLines(p.state).catch(() => null);
  return doc ? mergeNews(claims, doc) : claims;
}

export { newsField };
