// What news lines need from the mainnet treasury, and the owner's two calls to give it.
//
//   node scripts/mainnet/news-funding.mjs                       read only: where the money stands, and what N lines need
//   node scripts/mainnet/news-funding.mjs --lines 20            the same for 20 lines at a time
//   CONFIRM_MAINNET=yes node scripts/mainnet/news-funding.mjs --lines 20 --apply
//                                                               deposit what is short into the treasury, then raise the reserve cap
//
// Each news line reserves its worst-case loss from the treasury until it settles: about $1.01 at 50%,
// $1.75 at 30% or 70%, $2.34 at 20% or 80%, with b = $1.45 (--avg-reserve sets the average; 1.40 by
// default). The treasury also pays every free $1, so the plan keeps the lane budget and the floor whole.
// set_limits keeps the lane budget, the lane credit and the bond exactly as they are.
// --apply signs with the owner's key (NEAR_DEPLOYER_PRIVATE_KEY), read only then. Nothing secret is printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { reserveFromState } from "../../services/ai/src/gate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const LINES = Number(arg("--lines", "20"));
const AVG = BigInt(Math.round(Number(arg("--avg-reserve", "1.40")) * 1e6));
const FLOOR = BigInt(process.env.NEWS_TREASURY_FLOOR_MICRO || 1_500_000);
const APPLY = process.argv.includes("--apply");
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

const [stats, res, raw, ownerUsdc, checker] = await Promise.all([
  view(M, "stats"), view(M, "get_resolution"),
  rpc({ request_type: "view_state", finality: "final", account_id: M, prefix_base64: Buffer.from("STATE").toString("base64") }),
  view(U, "ft_balance_of", { account_id: dep.root }), view(M, "get_balance", { trader: dep.keys.checker_account }),
]);
const state = (raw.values || []).find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
const cap = BigInt(reserveFromState(Buffer.from(state.value, "base64")).capMicro);
const treasury = BigInt(stats.treasury_micro), reserved = BigInt(stats.reserved_micro), lane = BigInt(stats.lane_budget_micro);
const free = treasury - lane - FLOOR;
const room = cap - reserved;
const now = free < room ? free : room;
const need = BigInt(LINES) * AVG;
const deposit = need > free ? need - free : 0n;
const newCap = reserved + need > cap ? reserved + need : cap;

console.log(`treasury ${usd(treasury)}: ${usd(lane)} is the free bets', ${usd(FLOOR)} the floor, ${usd(free > 0n ? free : 0n)} free`);
console.log(`reserved ${usd(reserved)} of a ${usd(cap)} cap: ${usd(room)} of room`);
console.log(`today that carries ${usd(now > 0n ? now : 0n)}: ${now >= 1_006_100n ? `about ${Number(now / AVG)} news line(s)` : "no news line, at any price"}`);
console.log(`${LINES} lines at a time, about ${usd(AVG)} each, need ${usd(need)}: deposit ${usd(deposit)} into the treasury, and raise the cap to ${usd(newCap)}`);
console.log(`the owner holds ${usd(ownerUsdc)} of USDC; the Checker holds ${usd(checker)} of bonds (a ruling ties up ${usd(res.challenge_bond_micro)} for about 20 minutes, and it comes back when the Checker is right)`);
if (!APPLY) console.log("nothing changed. --apply, with CONFIRM_MAINNET=yes, makes these two calls.");
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
  if (newCap !== cap) {
    const r = await owner.callFunctionRaw({ contractId: M, methodName: "set_limits", args: { reserve_cap_micro: String(newCap), lane_budget_micro: stats.lane_budget_micro, lane_credit_micro: stats.lane_credit_micro, challenge_bond_micro: res.challenge_bond_micro }, gas: 60n * 10n ** 12n });
    console.log(`reserve cap ${usd(newCap)}: ${landed(r, "set_limits")}`);
  }
}
