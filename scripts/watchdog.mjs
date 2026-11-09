// The live watchdog: what a judge needs to work right now, read only, no secrets, no dependencies.
//   node scripts/watchdog.mjs            prints one line per check; exits 1 if any check FAILs
// .github/workflows/watchdog.yml runs it every 10 minutes through judging, which also keeps the site's
// server warm; GitHub emails the repository owner when a run fails. WARN marks something to top up soon,
// and never fails the run. The thresholds are the pure functions below (services/api/test/watchdog.test.mjs);
// the workflow checks out this one file, so it imports nothing from the repository.
import { pathToFileURL } from "node:url";

const SITE = (process.env.SITE_URL || "https://isitpriced.com").replace(/\/+$/, "");
const API = (process.env.API_URL || "https://pricedin-fawn.vercel.app").replace(/\/+$/, "");
const RPCS = ["https://free.rpc.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"];
const MARKET = "market.isitpriced.near", LANE = "lane.isitpriced.near", OWNER = "isitpriced.near", CHECKER = "checker.isitpriced.near";
const HOUSE = ["h-archivist.isitpriced.near", "h-skeptic.isitpriced.near", "h-quant.isitpriced.near"];
const X402 = "x402.isitpriced.near", SENTINEL = "sentinel.isitpriced.near";

// ---------- the thresholds (pure) ----------

/** Judging: the last caught Wikipedia lines sit on 12 and 13 November, the judges look from 15 November. */
export const TWO_BONDS_UNTIL = Date.parse("2026-11-17T15:00:00Z");
export const RESERVE_ENDS = Date.parse("2026-11-15T00:00:00Z");

/**
 * The Checker's bond balance in the market: until the 17 November sitting it must cover two bonds (one
 * sitting, and one to spare should a challenge fail and its bond wait for expiry), then one.
 */
export function checkerBondState(balanceUsd, bondUsd, nowMs) {
  const need = (nowMs < TWO_BONDS_UNTIL ? 2 : 1) * bondUsd;
  const state = balanceUsd < need ? "FAIL" : balanceUsd < need + bondUsd ? "WARN" : "PASS";
  return { state, detail: `$${balanceUsd.toFixed(2)} for a $${bondUsd.toFixed(2)} bond; ${need / bondUsd} bond${need === bondUsd ? "" : "s"} needed${nowMs < TWO_BONDS_UNTIL ? " until 17 November 15:00 UTC" : ""}${state === "PASS" ? "" : ": fund it with scripts/mainnet/checker.mjs --bond <USD>"}` };
}

/** The market's spare NEAR pays the storage of every new claim, position and rewrite. */
export function marketStorageState(spare) {
  return { state: spare < 0.35 ? "FAIL" : spare < 0.5 ? "WARN" : "PASS", detail: `${spare.toFixed(3)} NEAR spare${spare < 0.5 ? ": send NEAR to market.isitpriced.near" : ""}` };
}

/**
 * The free $1, from the site's /lane/status. Until the reserve ends (15 November), the last few are held
 * for the judges on purpose, which is a WARN; from then on, fewer than three left fails.
 */
export function freeBetState(body, nowMs) {
  const left = Number(body?.credits_left ?? 0);
  const topUp = ": move treasury money in with scripts/mainnet/news-funding.mjs --lane-budget max";
  // today's cap (LANE_KEYS_PER_DAY) or this runner's address cap is a limit set on purpose, not an outage
  const capped = !body?.available && (body?.reason === "lane_daily_cap" || body?.reason === "rate_limited");
  if (capped && left >= (nowMs < RESERVE_ENDS ? 1 : 3)) return { state: "WARN", name: "the free $1 is capped for today", detail: `${left} free bets left; ${body.reason === "rate_limited" ? "this address's" : "today's"} limit is reached, and they open again at 00:00 UTC` };
  if (nowMs < RESERVE_ENDS) {
    if (!body?.available && body?.held_for_judges) return { state: "WARN", name: "the free $1 is held for the judges", detail: `${left} left, held until ${body.held_until}${topUp}` };
    return { state: !body?.available || left < 1 ? "FAIL" : left < 4 ? "WARN" : "PASS", name: "the free $1 is available", detail: `${left} free bets left${left < 4 ? topUp : ""}` };
  }
  return { state: !body?.available || left < 3 ? "FAIL" : left < 5 ? "WARN" : "PASS", name: "the free $1 is available", detail: `${left} free bets left${body?.available ? "" : ` (${body?.reason ?? "unavailable"})`}${left < 5 ? topUp : ""}` };
}

/** A house agent's USDC inside the market: below a day of its bets ($0.75), it goes quiet soon. Never a FAIL. */
export const houseState = (usd) => ({ state: usd < 0.75 ? "WARN" : "PASS", detail: `$${usd.toFixed(2)} in the market${usd < 0.75 ? ": less than a day of bets ($0.75)" : ""}` });

/** The x402 relayer pays the gas of paid API calls (the API flags it low under 0.02 NEAR). Never a FAIL. */
export const relayerState = (near) => ({ state: near < 0.05 ? "WARN" : "PASS", detail: `${near.toFixed(3)} NEAR spare${near < 0.05 ? ": top it up with scripts/mainnet/x402.mjs" : ""}` });

/** The Sentinel disputes a bad ruling: it needs gas and a first dispute bond (twice the challenge bond). Never a FAIL. */
export function sentinelState(spareNear, balanceUsd, bondUsd) {
  const low = spareNear < 0.03 || balanceUsd < 2 * bondUsd;
  return { state: low ? "WARN" : "PASS", detail: `${spareNear.toFixed(3)} NEAR spare, $${balanceUsd.toFixed(2)} in the market for a $${(2 * bondUsd).toFixed(2)} first dispute${low ? ": top it up with scripts/mainnet/sentinel.mjs" : ""}` };
}

// ---------- the reads ----------

async function get(url, { json = false, timeout = 25_000 } = {}) {
  const t0 = Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { "user-agent": "pricedin-watchdog" } });
  const body = json ? await r.json() : await r.text();
  return { status: r.status, body, ms: Date.now() - t0 };
}
async function rpc(params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }), signal: AbortSignal.timeout(12_000) });
      const j = await r.json();
      if (j.result && !j.result.error) return j.result;
      last = new Error(JSON.stringify(j.error || j.result).slice(0, 120));
    } catch (e) { last = e; }
  }
  throw last;
}
const view = async (method, args = {}) => JSON.parse(Buffer.from((await rpc({ request_type: "call_function", finality: "final", account_id: MARKET, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString("utf8"));
const near = async (id) => { const a = await rpc({ request_type: "view_account", finality: "final", account_id: id }); return { total: Number(BigInt(a.amount) / 10n ** 18n) / 1e6, spare: Number(BigInt(a.amount) / 10n ** 18n) / 1e6 - a.storage_usage / 1e5 }; };
const balanceUsd = async (trader) => Number(await view("get_balance", { trader })) / 1e6;

async function main() {
  const rows = [];
  let failed = 0;
  const say = (state, name, detail) => { if (state === "FAIL") failed++; rows.push(`${state.padEnd(4)} ${name}${detail ? ` · ${detail}` : ""}`); };
  const check = async (name, fn) => { try { await fn(); } catch (e) { say("FAIL", name, String(e.message || e).split("\n")[0].slice(0, 160)); } };
  // a read that only feeds a WARN never fails the run, even when it can't be read
  const warnCheck = async (name, fn) => { try { await fn(); } catch (e) { say("WARN", name, `not read: ${String(e.message || e).split("\n")[0].slice(0, 120)}`); } };
  const now = Date.now();

  await check("home page", async () => {
    const r = await get(`${SITE}/`);
    const ok = r.status === 200 && r.body.includes("Bet on whether facts are true.") && r.body.includes("% chance it’s true");
    say(ok ? "PASS" : "FAIL", "home page leads with a priced fact", `${r.status} in ${(r.ms / 1000).toFixed(1)} s`);
  });
  for (const [path, what] of [["/c/18", "the Tether market"], ["/p/tether", "the Tether page"], ["/rulings", "the rulings"], ["/ilblackdragon/status/2118027843980366222", "an X post, priced"]]) {
    await check(what, async () => { const r = await get(`${SITE}${path}`); say(r.status === 200 ? "PASS" : "FAIL", `${what} (${path})`, `${r.status} in ${(r.ms / 1000).toFixed(1)} s`); });
  }
  await check("free $1", async () => {
    const r = await get(`${SITE}/lane/status`, { json: true });
    const s = freeBetState(r.body, now);
    say(s.state, s.name, s.detail);
  });
  await check("API", async () => {
    const r = await get(`${API}/health`, { json: true });
    const bad = Object.entries(r.body.checks || {}).filter(([, v]) => v && v.ok === false);
    const why = bad.map(([k, v]) => (v.note ? `${k} (${String(v.note).slice(0, 140)})` : k));
    say(r.body.ok && !bad.length ? "PASS" : "FAIL", "the API is healthy", bad.length ? `failing: ${why.join("; ")}` : !r.body.ok ? `failures: ${(r.body.failures || []).join("; ").slice(0, 200)}` : `spend $${r.body.checks?.spend?.spent_usd ?? "?"} of $${r.body.checks?.spend?.cap_usd ?? "?"} today`);
  });
  await check("keeper", async () => {
    const r = await get(`${API}/api/rulings`, { json: true });
    const age = (Date.now() - Date.parse(r.body.keeper_ran_at)) / 60_000;
    say(age < 90 ? "PASS" : "FAIL", "the keeper ran recently", `${Math.round(age)} min ago; ${r.body.count} rulings; next: ${r.body.next_ruling_note || "-"}`);
  });
  await check("today", async () => {
    const r = await get(`${API}/api/today`, { json: true });
    const n = (r.body.lines || []).length;
    say(n ? "PASS" : "WARN", "today's claims", `${n} lines (${JSON.stringify(r.body.counts || {})})`);
  });
  await check("market", async () => {
    const s = await view("stats");
    const treasury = Number(s.treasury_micro) / 1e6, lane = Number(s.lane_budget_micro) / 1e6;
    say(!s.paused && treasury >= lane ? "PASS" : "FAIL", "the market is live and covers every free bet", `${s.paused ? "PAUSED; " : ""}treasury $${treasury.toFixed(2)}, free bets $${lane.toFixed(2)}, ${s.claims} claims`);
  });
  await check("NEAR for gas and storage", async () => {
    const [lane, market, owner, checker] = await Promise.all([near(LANE), near(MARKET), near(OWNER), near(CHECKER)]);
    say(lane.spare < 0.05 ? "FAIL" : lane.spare < 0.3 ? "WARN" : "PASS", "the lane's NEAR (gas for free bets)", `${lane.spare.toFixed(3)} NEAR spare`);
    const m = marketStorageState(market.spare);
    say(m.state, "the market's storage NEAR", m.detail);
    say(owner.spare < 0.05 ? "FAIL" : owner.spare < 0.2 ? "WARN" : "PASS", "the owner's NEAR (gas for the keeper)", `${owner.spare.toFixed(3)} NEAR spare`);
    say(checker.spare < 0.01 ? "FAIL" : checker.spare < 0.03 ? "WARN" : "PASS", "the Checker's NEAR (gas for challenges)", `${checker.spare.toFixed(3)} NEAR spare`);
  });
  let bond = null;
  await check("Checker bond", async () => {
    const [bal, res] = await Promise.all([balanceUsd(CHECKER), view("get_resolution")]);
    bond = Number(res.challenge_bond_micro) / 1e6;
    const s = checkerBondState(bal, bond, now);
    say(s.state, "the Checker can post its bonds", s.detail);
  });
  for (const id of HOUSE) await warnCheck(`house agent ${id}`, async () => { const s = houseState(await balanceUsd(id)); say(s.state, `house agent ${id.split(".")[0]}'s USDC`, s.detail); });
  await warnCheck("x402 relayer", async () => { const s = relayerState((await near(X402)).spare); say(s.state, "the x402 relayer's NEAR (gas for paid API calls)", s.detail); });
  await warnCheck("Sentinel", async () => {
    const [acct, bal, res] = await Promise.all([near(SENTINEL), balanceUsd(SENTINEL), bond === null ? view("get_resolution") : null]);
    const s = sentinelState(acct.spare, bal, bond ?? Number(res.challenge_bond_micro) / 1e6);
    say(s.state, "the Sentinel can dispute a bad ruling", s.detail);
  });

  console.log(rows.join("\n"));
  console.log(failed ? `${failed} check(s) failed` : "every check passed");
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
