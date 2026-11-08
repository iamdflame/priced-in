// The live watchdog: what a judge needs to work right now, read only, no secrets, no dependencies.
//   node scripts/watchdog.mjs            prints one line per check; exits 1 if any check FAILs
// .github/workflows/watchdog.yml runs it every 10 minutes through judging, which also keeps the site's
// server warm; GitHub emails the repository owner when a run fails. WARN marks something to top up soon,
// and never fails the run.
const SITE = (process.env.SITE_URL || "https://isitpriced.com").replace(/\/+$/, "");
const API = (process.env.API_URL || "https://pricedin-fawn.vercel.app").replace(/\/+$/, "");
const RPCS = ["https://free.rpc.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"];
const MARKET = "market.isitpriced.near", LANE = "lane.isitpriced.near", OWNER = "isitpriced.near", CHECKER = "checker.isitpriced.near";
const rows = [];
let failed = 0;
const say = (state, name, detail) => { if (state === "FAIL") failed++; rows.push(`${state.padEnd(4)} ${name}${detail ? ` · ${detail}` : ""}`); };

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
async function check(name, fn) { try { await fn(); } catch (e) { say("FAIL", name, String(e.message || e).split("\n")[0].slice(0, 160)); } }

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
  const left = Number(r.body.credits_left ?? 0);
  say(!r.body.available || left < 1 ? "FAIL" : left < 4 ? "WARN" : "PASS", "the free $1 is available", `${left} free bets left${left < 4 ? ": move treasury money in with scripts/mainnet/news-funding.mjs --lane-budget" : ""}`);
});
await check("API", async () => {
  const r = await get(`${API}/health`, { json: true });
  const bad = Object.entries(r.body.checks || {}).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  say(r.body.ok && !bad.length ? "PASS" : "FAIL", "the API is healthy", bad.length ? `failing: ${bad.join(", ")}` : `spend $${r.body.checks?.spend?.spent_usd ?? "?"} of $${r.body.checks?.spend?.cap_usd ?? "?"} today`);
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
  say(market.spare < 0.1 ? "FAIL" : market.spare < 0.35 ? "WARN" : "PASS", "the market's storage NEAR", `${market.spare.toFixed(3)} NEAR spare`);
  say(owner.spare < 0.05 ? "FAIL" : owner.spare < 0.2 ? "WARN" : "PASS", "the owner's NEAR (gas for the keeper)", `${owner.spare.toFixed(3)} NEAR spare`);
  say(checker.spare < 0.01 ? "FAIL" : checker.spare < 0.03 ? "WARN" : "PASS", "the Checker's NEAR (gas for challenges)", `${checker.spare.toFixed(3)} NEAR spare`);
});
await check("Checker bond", async () => {
  const [bal, res] = await Promise.all([view("get_balance", { trader: CHECKER }), view("get_resolution")]);
  const b = Number(bal) / 1e6, bond = Number(res.challenge_bond_micro) / 1e6;
  say(b >= bond ? "PASS" : "WARN", "the Checker can post a bond", `$${b.toFixed(2)} for a $${bond.toFixed(2)} bond`);
});

console.log(rows.join("\n"));
console.log(failed ? `${failed} check(s) failed` : "every check passed");
process.exitCode = failed ? 1 : 0;
