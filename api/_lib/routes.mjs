// The read routes over the index: /history, /portfolio, /activity, /rulings, /attestations and
// /lane/status. Each answers from the store's journals, the claims snapshot and, where the chain
// is the only honest source (a position, a balance, a running challenge), the market's own views.

import fs from "node:fs";
import path from "node:path";
import { raceView } from "./snapshot.mjs";
import { REPO } from "./runtime.mjs";
import { activityOf, chronological, downsample, parseTrader, portfolioOf, priceHistory, timeOf } from "./views.mjs";
import { namesOf, readRulings } from "./rulings.mjs";
import { checkerFacts, checkerQueue, rulingClock, sittingConfig } from "./keeper.mjs";
import { parsePublicKey } from "../../services/api/src/lane.mjs";
import { clientIp } from "../../services/api/src/ratelimit.mjs";

export const READ_CACHE = {
  history: "public, max-age=0, s-maxage=5, stale-while-revalidate=60",
  portfolio: "public, max-age=0, s-maxage=2, stale-while-revalidate=10",
  activity: "public, max-age=0, s-maxage=2, stale-while-revalidate=30",
  rulings: "public, max-age=0, s-maxage=3, stale-while-revalidate=30",
  attestations: "public, max-age=60, s-maxage=300",
};

const bad = (code, message) => ({ status: 400, body: { error: { code, message } } });
const events = (p) => p.journals.readCached("events.jsonl");

/** GET /history?claim=<id> or ?all=1: compact [t_ms, price_ppm] points. */
export async function historyRoute(url, p) {
  const snap = await p.claims.decorated();
  const series = priceHistory(events(p), snap.claims, { at: snap.at });
  const headers = { "cache-control": READ_CACHE.history };
  if (url.searchParams.get("all") === "1") {
    const claims = {};
    for (const [id, pts] of series) claims[id] = downsample(pts, 32);
    return { status: 200, body: { claims, count: Object.keys(claims).length, points: "[t_ms, price_yes_ppm]", asOf: snap.at }, headers };
  }
  const raw = url.searchParams.get("claim");
  if (raw === null || !/^\d{1,15}$/.test(raw)) return bad("invalid_claim_id", "Ask for /history?claim=<id>, or /history?all=1 for every claim's sparkline.");
  const id = Number(raw);
  if (!snap.claims.some((c) => c.id === id)) return { status: 404, body: { error: { code: "no_such_claim", message: `No claim ${raw}.` } } };
  return { status: 200, body: { claim: id, points: series.get(id) || [], format: "[t_ms, price_yes_ppm]", asOf: snap.at }, headers };
}

const MONEY_EVENTS = { deposit: "deposit", withdraw: "withdraw", withdraw_refunded: "refund", redeem: "collect" };

/** A trader's money moves, newest first, each with its transaction, for the portfolio's history. */
export function traderHistory(events, trader, limit = 50) {
  const rows = [];
  for (const e of chronological(events)) {
    const d = e.data || {};
    if (d.trader !== trader) continue;
    const sold = e.event === "trade" && String(d.side).startsWith("sell_");
    const kind = e.event === "trade" ? (sold ? "sell" : "buy") : MONEY_EVENTS[e.event];
    if (!kind) continue;
    rows.push({ kind, claim_id: d.claim_id ?? null, side: d.side ? String(d.side).replace("sell_", "") : null, amount_usd: Number(d.amount_micro) / 1e6, shares: d.shares_micro ? Number(d.shares_micro) / 1e6 : null, tx: e.txHash ?? null, at: timeOf(e) });
  }
  return rows.reverse().slice(0, limit);
}

/** GET /portfolio?trader=<lane:ed25519:... | ed25519:... | account>. */
export async function portfolioRoute(url, p) {
  const who = parseTrader(url.searchParams.get("trader"));
  if (!who) return bad("invalid_trader", "trader must be a NEAR account, or a free-bet key: lane:ed25519:<key>.");
  const snap = await p.claims.decorated();
  const all = events(p);
  const ids = [...new Set(all.filter((e) => e.data?.trader === who.trader && Number.isInteger(e.data?.claim_id)).map((e) => e.data.claim_id))].slice(0, 100);
  const view = (method, args) => raceView(p.api.rpcUrls, p.api.marketId, method, args, { timeoutMs: 2500 }).then((r) => r.value);
  const [balance, ...held] = await Promise.all([
    view("get_balance", { trader: who.trader }).catch(() => null),
    ...ids.map((id) => view("get_position", { claim_id: id, trader: who.trader }).catch(() => null)),
  ]);
  const positions = new Map();
  ids.forEach((id, i) => { if (held[i]) positions.set(id, held[i]); });
  const body = portfolioOf({ ...who, events: all, claims: snap.claims, positions, balanceMicro: balance });
  return { status: 200, body: { ...body, history: traderHistory(all, who.trader), asOf: snap.at }, headers: { "cache-control": READ_CACHE.portfolio } };
}

/** GET /activity?limit=: the latest trades, rewrites, agents' answers and rulings. */
export async function activityRoute(url, p) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const snap = await p.claims.decorated();
  const rewrites = new Map();
  for (const r of p.journals.readCached("rewrites.jsonl")) rewrites.set(r.id, r); // the latest record of each
  const list = activityOf({ events: events(p), rewrites: [...rewrites.values()], rationales: p.journals.readCached("rationales.jsonl").slice(-400), claims: snap.claims, names: namesOf(p), limit });
  return { status: 200, body: { activity: list, count: list.length, asOf: snap.at }, headers: { "cache-control": READ_CACHE.activity } };
}

/** The clock: the queue as it stands now, the rulings, and the cron's record of the Checker. */
export async function clockOf(p, rulings, claims) {
  const doc = await p.state.getDoc("snapshots/keeper.json").catch(() => null);
  const k = doc?.value ?? null;
  const c = k?.checker ?? null;
  const nowMs = Date.now();
  const sitting = sittingConfig();
  const q = checkerQueue({ claims, rulings, account: c?.account ?? null, nowMs, sitting });
  const clock = rulingClock({ rulings, nowMs, sitting, checker: checkerFacts(c, q, nowMs) });
  return { ...clock, checker: c ? { account: c.account, balance_usd: c.balance_micro === null ? null : Number(c.balance_micro) / 1e6, lines_left: clock.queue, note: c.note ?? c.reason ?? null } : null, keeper_ran_at: k?.at ?? null };
}

/** GET /rulings: live and past challenges, and the clock. */
export async function rulingsRoute(p) {
  const snap = await p.claims.decorated();
  const rulings = await readRulings(p, snap.claims);
  const clock = await clockOf(p, rulings, snap.claims);
  return { status: 200, body: { ...clock, rulings, count: rulings.length, asOf: snap.at }, headers: { "cache-control": READ_CACHE.rulings } };
}

// ---------- attestation proofs ----------

const PROOFS = path.join(REPO, "tools/judge/evidence/attestations");

export function readProofs() {
  if (!fs.existsSync(PROOFS)) return [];
  return fs.readdirSync(PROOFS).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(PROOFS, f), "utf8")));
}

/** GET /attestations: each model's published proof; ?model=<id> adds the collateral it was checked with. */
export function attestationsRoute(url, layer) {
  const proofs = readProofs();
  const model = url.searchParams.get("model");
  const headers = { "cache-control": READ_CACHE.attestations };
  if (model !== null) {
    const hit = proofs.find((x) => x.model === model);
    if (!hit) return { status: 404, body: { error: { code: "no_such_model", message: "No published proof for that model." } } };
    return { status: 200, body: hit, headers };
  }
  const summary = proofs.map(({ collateral, gpu, ...x }) => ({ ...x, gpu: gpu ? (({ jwt, ...g }) => g)(gpu) : null }));
  return { status: 200, body: { proofs: summary, attestations: layer?.attestor?.snapshot?.() ?? [], files: summary.map((x) => x.bundle), full: "/api/attestations?model=<model id> adds the Intel collateral and NVIDIA's token", check: "npm run judge: check 10 verifies these offline and matches them to the keys registered on mainnet" }, headers };
}

// ---------- the free bet: can this visitor still get one? ----------

const MESSAGES = {
  ok: "Your free $1 bet is ready.",
  key_ready: "Your free $1 bet is ready on this browser.",
  credit_spent: "This browser has used its free $1.",
  lane_unavailable: "Free bets are not available on this server.",
  market_paused: "The market is paused.",
  lane_used_up: "The free bets are used up for now: no free credit is left on the market.",
  lane_daily_cap: "Today's free bets are all taken. Come back tomorrow, or fund your own account.",
};

/** GET /lane/status[?publicKey=ed25519:...]: said before the tap, so a refusal never costs one. */
export async function laneStatusRoute(url, req, ctx, p) {
  const { app } = ctx;
  const cfg = p.api.lane;
  const ip = clientIp(req, true);
  const say = (reason, extra = {}) => ({ status: 200, body: { available: reason === "ok" || reason === "key_ready", reason, message: extra.message ?? MESSAGES[reason], per_ip_per_day: cfg.perIpPerDay, ...extra }, headers: { "cache-control": "no-store" } });
  if (!app.lane.enabled) return say("lane_unavailable");
  let budget;
  try { budget = await app.lane.budget(); } catch { return { status: 502, body: { error: { code: "upstream_error", message: "The market's lane budget could not be read. Try again in a moment." } } }; }
  if (budget.paused) return say("market_paused");
  const credits = { credits_left: budget.credits };
  // a visitor who already holds a key: their free bet is that key's $1
  const raw = url.searchParams.get("publicKey");
  if (raw !== null) {
    let pk;
    try { pk = parsePublicKey(raw); } catch (e) { return bad("invalid_public_key", e.message); }
    const onLane = await app.rpc.viewAccessKey(cfg.accountId, pk, "optimistic").then((r) => Boolean(r && !r.error)).catch(() => false);
    if (onLane) {
      const trader = `lane:${pk}`;
      const credited = events(p).some((e) => e.event === "lane_credit" && e.data?.trader === trader);
      const balance = await raceView(p.api.rpcUrls, p.api.marketId, "get_balance", { trader }, { timeoutMs: 2500 }).then((r) => Number(r.value)).catch(() => null);
      if (!credited && !(balance > 0)) return budget.credits > 0 ? say("key_ready", { ...credits, key: { on_lane: true, credited: false, balance_usd: 0 } }) : say("lane_used_up", credits);
      return say(balance > 0 ? "key_ready" : "credit_spent", { ...credits, key: { on_lane: true, credited, balance_usd: balance === null ? null : balance / 1e6 } });
    }
  }
  if (budget.free <= 0) return say("lane_used_up", credits);
  const [byIp, today] = await Promise.all([
    p.state.peek("lane", ip, cfg.perIpPerDay).catch(() => ({ remaining: cfg.perIpPerDay, retryAfterS: 0 })),
    p.state.peek("lane-global", "all", cfg.perDay).catch(() => ({ remaining: cfg.perDay, retryAfterS: 0 })),
  ]);
  const left = { ...credits, ip_left_today: byIp.remaining, left_today: today.remaining };
  if (today.remaining <= 0) return say("lane_daily_cap", { ...left, retry_after_s: today.retryAfterS });
  if (byIp.remaining <= 0) return say("rate_limited", { ...left, retry_after_s: byIp.retryAfterS, message: `This network has used its ${cfg.perIpPerDay} free bets for today. Come back tomorrow, or fund your own account.` });
  return say("ok", left);
}
