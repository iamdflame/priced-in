// What news lines need from the mainnet treasury, and the owner's calls to give it.
//
//   node scripts/mainnet/news-funding.mjs                       read only: where the money stands, and what N lines need
//   node scripts/mainnet/news-funding.mjs --lines 20            the same for 20 lines at a time
//   CONFIRM_MAINNET=yes node scripts/mainnet/news-funding.mjs --lines 20 --apply
//                                                               deposit what is short into the treasury and raise the reserve cap
//   --market-near 1                                             also send the market 1 NEAR for storage, if its spare is below that
//                                                               (only when asked: the contract can't send NEAR back out)
//   --lane-budget 13 (or max)                                   set the free-bet budget to $13 (13 free $1 bets) out of money the
//                                                               treasury already holds: no deposit, and news lines wait for it
//   --deposit-all                                               put every USDC the owner holds into the treasury first; with
//                                                               --lane-budget max, the free bets get what is left after the floor
//                                                               and the news lines asked for (--lines, --avg-reserve)
//   CONFIRM_MAINNET=yes node scripts/mainnet/news-funding.mjs --lines 0 --lane-budget 13 --apply
//                                                               only that: one set_limits call, nothing sent
//
// Each news line reserves its worst-case loss from the treasury until it settles: about $1.01 at 50%,
// $1.75 at 30% or 70%, $2.34 at 20% or 80%, with b = $1.45 (--avg-reserve sets the average; 1.40 by
// default). The treasury also pays every free $1, so the plan keeps the lane budget and the floor whole.
// Each line and its ruling also grow the market's state, about 0.025 NEAR a line for good: past its
// spare NEAR every call that stores anything fails, free bets and trades included, so the gate keeps
// NEWS_MARKET_MIN_NEAR (0.3) untouched. set_limits keeps the credit and bond exactly as they are, and the lane
// budget too unless --lane-budget names a new one; the gate counts it out of the treasury before any news line.
// --apply signs with the owner's key (NEAR_DEPLOYER_PRIVATE_KEY), read only then. Nothing secret is printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { reserveFromState, spareNearOf } from "../../services/ai/src/gate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const LINES = Number(arg("--lines", "20"));
const AVG = BigInt(Math.round(Number(arg("--avg-reserve", "1.40")) * 1e6));
const FLOOR = BigInt(process.env.NEWS_TREASURY_FLOOR_MICRO || 1_500_000);
const APPLY = process.argv.includes("--apply");
const LANE_TO = arg("--lane-budget", null);
const DEPOSIT_ALL = process.argv.includes("--deposit-all");
const M = dep.accounts.market, U = dep.accounts.usdc;
const RPCS = ["https://free.rpc.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"];
const landed = (r, what) => { if (r.status && typeof r.status === "object" && "Failure" in r.status) throw new Error(`${what} failed: ${JSON.stringify(r.status.Failure).slice(0, 200)}`); return r.transaction_outcome?.id || r.transaction?.hash; };
const usd = (micro) => `$${(Number(micro) / 1e6).toFixed(2)}`;

async function rpc(params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      if (j.result) return j.result;
      last = new Error(JSON.stringify(j.error).slice(0, 160));
    } catch (e) { last = e; }
  }
  throw last;
}
const view = async (account_id, method_name, args = {}) => JSON.parse(Buffer.from((await rpc({ request_type: "call_function", finality: "final", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString("utf8"));

const [acct, stats, res, raw, ownerUsdc, checker] = await Promise.all([
  rpc({ request_type: "view_account", finality: "final", account_id: M }),
  view(M, "stats"), view(M, "get_resolution"),
  rpc({ request_type: "view_state", finality: "final", account_id: M, prefix_base64: Buffer.from("STATE").toString("base64") }),
  view(U, "ft_balance_of", { account_id: dep.root }), view(M, "get_balance", { trader: dep.keys.checker_account }),
]);
const state = (raw.values || []).find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
const cap = BigInt(reserveFromState(Buffer.from(state.value, "base64")).capMicro);
const treasury = BigInt(stats.treasury_micro), reserved = BigInt(stats.reserved_micro), lane = BigInt(stats.lane_budget_micro);
const credit = BigInt(stats.lane_credit_micro);
// --lane-budget: the free bets' share of the treasury, an absolute amount (each free bet takes one credit off it)
if (LANE_TO !== null && LANE_TO !== "max" && !(Number(LANE_TO) >= 0)) { console.error("--lane-budget takes dollars, e.g. --lane-budget 13, or max"); process.exit(1); }
const need = BigInt(LINES) * AVG;
// --deposit-all: every USDC the owner holds goes into the treasury before anything else
const owned = BigInt(ownerUsdc);
const pre = DEPOSIT_ALL ? owned : 0n;
const pot = treasury + pre; // the treasury once that deposit lands
// max: as many whole free bets as the treasury covers, after the floor and the news lines asked for
const laneMax = credit > 0n && pot > FLOOR + need ? ((pot - FLOOR - need) / credit) * credit : 0n;
const laneNew = LANE_TO === null ? lane : LANE_TO === "max" ? (laneMax > lane ? laneMax : lane) : BigInt(Math.round(Number(LANE_TO) * 1e6));
// every credit must stay covered by money the treasury holds (or the owner deposits), with the floor kept whole
if (LANE_TO !== null && laneNew + FLOOR > treasury + owned) { console.error(`the treasury holds ${usd(treasury)} and the owner ${usd(owned)}: a free-bet budget of at most ${usd(treasury + owned - FLOOR)} keeps the ${usd(FLOOR)} floor whole`); process.exit(1); }
const free = pot - laneNew - FLOOR;
const bets = (m) => (credit > 0n ? Number(m / credit) : 0);
const room = cap - reserved;
const now = free < room ? free : room;
const deposit = pre + (need > free ? need - free : 0n);
const newCap = reserved + need > cap ? reserved + need : cap;

console.log(`treasury ${usd(pot)}${pre > 0n ? ` (after depositing the owner's ${usd(pre)})` : ""}: ${usd(laneNew)} is the free bets' (${bets(laneNew)} free ${usd(credit)} bets${laneNew !== lane ? `, ${laneNew > lane ? "up" : "down"} from ${bets(lane)}` : ""}), ${usd(FLOOR)} the floor, ${usd(free > 0n ? free : 0n)} free`);
console.log(`reserved ${usd(reserved)} of a ${usd(cap)} cap: ${usd(room)} of room`);
console.log(`today that carries ${usd(now > 0n ? now : 0n)}: ${now >= 1_006_100n ? `about ${Number(now / AVG)} news line(s)` : "no news line, at any price"}`);
if (LINES > 0) console.log(`${LINES} lines at a time, about ${usd(AVG)} each, need ${usd(need)}: deposit ${usd(deposit)} into the treasury, and raise the cap to ${usd(newCap)}`);
// the NEAR top-up only when asked: the market can't send NEAR back out
const spare = spareNearOf(acct), TOP = Number(arg("--market-near", "0")) || 0;
console.log(`the market account has ${spare.toFixed(2)} NEAR spare for storage: about ${Math.max(0, Math.floor((spare - 0.3) / 0.025))} more lines before the gate stops opening${spare < TOP ? `; --apply sends ${TOP} NEAR` : ""}`);
console.log(`the owner holds ${usd(ownerUsdc)} of USDC; the Checker holds ${usd(checker)} of bonds (a ruling ties up ${usd(res.challenge_bond_micro)} for about 20 minutes, and it comes back when the Checker is right)`);
if (!APPLY) console.log("nothing changed. --apply, with CONFIRM_MAINNET=yes, makes these calls.");
else {
  if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url })));
  const owner = new Account(dep.root, provider, new KeyPairSigner(KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY)));
  if (deposit > BigInt(ownerUsdc)) { console.error(`the owner holds ${usd(ownerUsdc)} and ${usd(deposit)} is needed: send USDC to ${dep.root} first`); process.exit(1); }
  if (deposit > 0n) {
    const r = await owner.callFunctionRaw({ contractId: U, methodName: "ft_transfer_call", args: { receiver_id: M, amount: String(deposit), msg: "{\"treasury\":true}" }, deposit: 1n, gas: 100n * 10n ** 12n });
    console.log(`deposited ${usd(deposit)}: ${landed(r, "the deposit")}`);
  }
  if (spare < TOP) {
    const r = await owner.transfer({ receiverId: M, amount: BigInt(Math.round(TOP * 1000)) * 10n ** 21n });
    console.log(`sent ${TOP} NEAR to ${M}: ${landed(r, "the NEAR top-up")}`);
  }
  if (newCap !== cap || laneNew !== lane) {
    const r = await owner.callFunctionRaw({ contractId: M, methodName: "set_limits", args: { reserve_cap_micro: String(newCap), lane_budget_micro: String(laneNew), lane_credit_micro: stats.lane_credit_micro, challenge_bond_micro: res.challenge_bond_micro }, gas: 60n * 10n ** 12n });
    console.log(`reserve cap ${usd(newCap)}, free-bet budget ${usd(laneNew)} (${bets(laneNew)} free bets): ${landed(r, "set_limits")}`);
  }
}
