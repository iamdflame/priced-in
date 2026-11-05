// Upgrades a testnet market in place to the reproducible build of this checkout, only if the
// contract's state layout is unchanged, and proves the result. Testnet only.
//
//   node tools/judge/upgrade-testnet.mjs [--dry-run] [--from-rev <git rev>] [--state <file>] [--deployment <file>] [--no-record]
//
// --from-rev names the commit whose source built the live code (default: code.market.source_rev
// in the deployment file); the stored value types are compared with it.
// Defaults: --state .apex-test/judge-testnet.json (git-ignored, holds the test root's key, which
// is the market's full-access key) and --deployment deployments/testnet.json (public values).
//
// 1. Builds market and swarm reproducibly (tools/judge/lib/repro.mjs).
// 2. Layout, twice: `pub struct PricedIn` in contracts/market/src/lib.rs must be LAYOUT below
//    field for field, types included; and the live STATE must decode under LAYOUT with every
//    byte used and the totals equal to the live `stats` view. Either fails: no upgrade (write a
//    migration instead).
// 3. The live code must be the one the deployment file records (or already the new build).
// 4. Deploys the new market wasm to the same account (no init, no migration: same state).
// 5. Verifies: the code hash on chain equals the reproducible build; the STATE bytes, `stats`,
//    `get_resolution` and every claim view are exactly what they were before.
// 6. Records the new code hash and the upgrade in the deployment file (unless --no-record).
// The swarm is not touched; the script says whether its build still matches the chain.
// It prints no key.
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import fs from "node:fs";
import path from "node:path";
import { reproBuild, REPO } from "./lib/repro.mjs";
import { RotatingProvider, TESTNET } from "./lib/provider.mjs";

// The market's state struct, in borsh order, as v2 deployed it (contracts/market/src/lib.rs).
const LAYOUT = [
  ["owner", "AccountId"], ["pending_owner", "Option<AccountId>"], ["usdc", "AccountId"], ["lane", "AccountId"],
  ["swarm", "Option<AccountId>"], ["paused", "bool"], ["operators", "LookupMap<AccountId, bool>"],
  ["house_agents", "LookupMap<AccountId, bool>"], ["planner_key", "Vec<u8>"], ["claims", "LookupMap<u64, Claim>"],
  ["next_claim", "u64"], ["receipts", "LookupMap<Vec<u8>, u64>"], ["balances", "LookupMap<String, u128>"],
  ["positions", "LookupMap<String, Position>"], ["credited", "LookupMap<String, u128>"], ["treasury_micro", "u128"],
  ["reserved_micro", "u128"], ["reserve_cap_micro", "u128"], ["lane_budget_micro", "u128"], ["lane_credit_micro", "u128"],
  ["models", "LookupMap<String, Model>"], ["challenges", "LookupMap<u64, Challenge>"], ["next_challenge", "u64"],
  ["challenge_bond_micro", "u128"], ["jury_deadline_secs", "u64"], ["dispute_tiers", "Vec<(u128, u64)>"],
  ["dispute_top_secs", "u64"], ["bounty_ttl_secs", "u64"], ["bounties", "LookupMap<String, Bounty>"],
  ["rewrites_anchored", "u64"], ["held_micro", "u128"], ["balances_micro", "u128"], ["collected_micro", "i128"],
  ["payouts_micro", "u128"], ["bonds_micro", "u128"], ["bounties_micro", "u128"],
];
// Every type a stored value has. A change to any of these (or to Status) changes stored values
// even when the struct above keeps its bytes, so their source text is pinned too.
const VALUE_TYPES = ["Claim", "Position", "Challenge", "Verdict", "Stake", "Model", "Bounty", "Status"];

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const DRY = process.argv.includes("--dry-run");
const RECORD = !process.argv.includes("--no-record");
const stateFile = path.resolve(REPO, arg("--state", ".apex-test/judge-testnet.json"));
const depFile = path.resolve(REPO, arg("--deployment", "deployments/testnet.json"));
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const M = dep.accounts.market;
if (dep.network !== "testnet" || !M.endsWith(".testnet")) { console.error("testnet only"); process.exit(1); }
if (M !== `market.${st.root}`) { console.error(`${path.relative(REPO, stateFile)} is for ${st.root}, not ${M}`); process.exit(1); }
const RPC = process.env.NEAR_TESTNET_RPC || TESTNET.join(",");
const provider = new RotatingProvider(RPC);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= 5 || !/fetch failed|ECONNRESET|ETIMEDOUT|socket|network|503|502|429|Rate limits/i.test(String(e.message || e))) throw e; await sleep(2000 * (i + 1)); }
  }
}
const q = (params) => retry(() => provider.query({ finality: "final", ...params }));
const view = (method, args = {}) => retry(() => provider.callFunction({ contractId: M, method, args, blockQuery: { finality: "final" } }));
const liveHash = async (id) => (await q({ request_type: "view_account", account_id: id })).code_hash;
const stateBytes = async () => {
  const r = await q({ request_type: "view_state", account_id: M, prefix_base64: Buffer.from("STATE").toString("base64") });
  const v = (r.values || []).find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
  if (!v) throw new Error("no STATE key on the market");
  return Buffer.from(v.value, "base64");
};
let bad = 0;
const ok = (name, pass, detail = "") => { console.log(`${pass ? "ok  " : "BAD "} ${name}${detail ? " · " + detail : ""}`); if (!pass) bad++; return pass; };

// ---------- 2a. the source keeps the layout ----------
const src = fs.readFileSync(path.join(REPO, "contracts/market/src/lib.rs"), "utf8");
const body = src.match(/pub struct PricedIn \{([\s\S]*?)\n\}/)?.[1] ?? "";
const fields = body.split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter(Boolean).map((l) => l.match(/^(\w+):\s*(.+?),?$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+/g, " ")]);
const same = fields.length === LAYOUT.length && fields.every(([n, t], i) => n === LAYOUT[i][0] && t === LAYOUT[i][1]);
ok("the source's PricedIn struct is the deployed layout, field for field", same, same ? `${fields.length} fields` : `differs at ${fields.findIndex(([n, t], i) => !LAYOUT[i] || n !== LAYOUT[i][0] || t !== LAYOUT[i][1])}`);
const typeText = (name) => src.match(new RegExp(`pub (?:struct|enum) ${name} \\{[\\s\\S]*?\\n\\}`))?.[0]?.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ") ?? null;

// ---------- 2b. the live state decodes under the layout ----------
function decode(buf) {
  let o = 0;
  const need = (n) => { if (o + n > buf.length) throw new Error(`STATE ends at byte ${buf.length}, needed ${o + n}`); };
  const u32 = () => { need(4); const v = buf.readUInt32LE(o); o += 4; return v; };
  const bytes = () => { const n = u32(); need(n); const v = buf.subarray(o, o + n); o += n; return v; };
  const str = () => bytes().toString("utf8");
  const u64 = () => { need(8); const v = buf.readBigUInt64LE(o); o += 8; return v; };
  const u128 = () => { const lo = u64(), hi = u64(); return (hi << 64n) | lo; };
  const i128 = () => { const v = u128(); return v >= 1n << 127n ? v - (1n << 128n) : v; };
  const bool = () => { need(1); const b = buf[o++]; if (b > 1) throw new Error(`bad bool at ${o - 1}`); return b === 1; };
  const opt = (f) => { need(1); const t = buf[o++]; if (t > 1) throw new Error(`bad option tag at ${o - 1}`); return t ? f() : null; };
  const read = {
    "AccountId": str, "Option<AccountId>": () => opt(str), "bool": bool, "Vec<u8>": () => bytes().toString("hex"), "u64": u64, "u128": u128, "i128": i128,
    "Vec<(u128, u64)>": () => { const n = u32(); return Array.from({ length: n }, () => [u128(), u64()]); },
  };
  const out = {};
  for (const [name, type] of LAYOUT) out[name] = type.startsWith("LookupMap<") ? bytes().toString("latin1") : read[type]();
  return { value: out, used: o };
}
const before = { bytes: await stateBytes() };
let decoded;
try { decoded = decode(before.bytes); } catch (e) { decoded = { error: e.message }; }
ok("the live STATE decodes under the layout with every byte used", !decoded.error && decoded.used === before.bytes.length, decoded.error || `${before.bytes.length} bytes`);
before.stats = await view("stats");
before.resolution = await view("get_resolution");
const totals = ["treasury_micro", "reserved_micro", "lane_budget_micro", "lane_credit_micro", "held_micro", "balances_micro", "collected_micro", "payouts_micro", "bonds_micro", "bounties_micro"];
const d = decoded.value || {};
ok("the decoded totals equal the live stats view", !decoded.error && totals.every((k) => String(d[k]) === String(before.stats[k])) && String(d.next_claim) === String(before.stats.claims) && String(d.next_challenge) === String(before.stats.challenges) && d.paused === before.stats.paused && String(d.rewrites_anchored) === String(before.stats.rewrites_anchored), `${before.stats.claims} claims, held ${before.stats.held_micro}`);
const prefixes = LAYOUT.filter(([, t]) => t.startsWith("LookupMap<")).map(([n]) => `${n}=${JSON.stringify(d[n])}`).join(" ");
console.log(`     owner ${d.owner}, lane ${d.lane}, swarm ${d.swarm}, map prefixes ${prefixes}`);

// value types: pinned against the source of the deployed build, when git has it
const from = arg("--from-rev", dep.code.market.source_rev);
if (from) {
  const old = (await import("node:child_process")).spawnSync("git", ["show", `${from}:contracts/market/src/lib.rs`], { cwd: REPO, encoding: "utf8" });
  if (old.status === 0) {
    const oldText = (name) => old.stdout.match(new RegExp(`pub (?:struct|enum) ${name} \\{[\\s\\S]*?\\n\\}`))?.[0]?.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ") ?? null;
    const changed = VALUE_TYPES.filter((t) => oldText(t) !== typeText(t));
    ok(`every stored value type is unchanged since ${from}`, changed.length === 0, changed.length ? `changed: ${changed.join(", ")}` : VALUE_TYPES.join(", "));
  } else ok(`the deployed source ${from} is in git`, false, old.stderr.trim().slice(0, 120));
} else console.log("     (no code.market.source_rev in the deployment file: stored value types not compared)");
if (bad) { console.error("not upgrading: the layout check failed. Write a migration instead."); process.exit(1); }

// ---------- 1. the reproducible build ----------
console.log("building market and swarm reproducibly (tools/judge/lib/repro.mjs)");
const built = await reproBuild({});
if (!built.ok) { console.error(`build failed: ${built.reason}`); process.exit(1); }
const wasm = built.wasm.market;
console.log(`     market ${wasm.hash} (sha256 ${wasm.sha256}, ${wasm.size} bytes), ${built.toolchain}`);

// ---------- 3. what is live ----------
const live = await liveHash(M);
if (live === wasm.hash) { console.log(`the market already runs ${wasm.hash}: nothing to do`); process.exit(0); }
ok("the live market runs the code the deployment file records", live === dep.code.market.code_hash, `live ${live}, recorded ${dep.code.market.code_hash}`);
const swarmLive = await liveHash(dep.accounts.swarm);
console.log(`     swarm: build ${built.wasm.swarm.hash}, live ${swarmLive}${built.wasm.swarm.hash === swarmLive ? " (same, not touched)" : " (DIFFERENT: this script does not upgrade the swarm)"}`);
if (bad) process.exit(1);
before.claims = [];
for (let from = 0; from < before.stats.claims; from += 100) before.claims.push(...(await view("get_claims", { from, limit: 100 })));
if (DRY) { console.log(`dry run: would deploy ${wasm.hash} to ${M} (${before.claims.length} claims read)`); process.exit(0); }

// ---------- 4. deploy, same account, same state ----------
const market = new Account(M, provider, new KeyPairSigner(KeyPair.fromString(st.key)));
console.log(`deploying ${wasm.hash} to ${M}`);
const tx = await market.deployContract(new Uint8Array(wasm.bytes));
const txHash = tx.transaction?.hash || tx.transaction_outcome?.id;
const failure = tx.status?.Failure || tx.receipts_outcome?.find((r) => r.outcome.status?.Failure)?.outcome.status.Failure;
if (failure) { console.error(`deploy failed: ${JSON.stringify(failure).slice(0, 300)}`); process.exit(1); }
console.log(`     tx ${txHash}`);

// ---------- 5. verify ----------
for (let i = 0; i < 20 && (await liveHash(M)) !== wasm.hash; i++) await sleep(1500);
const after = { hash: await liveHash(M), bytes: await stateBytes(), stats: await view("stats"), resolution: await view("get_resolution"), claims: [] };
for (let from = 0; from < after.stats.claims; from += 100) after.claims.push(...(await view("get_claims", { from, limit: 100 })));
ok("the code hash on chain is the reproducible build", after.hash === wasm.hash, after.hash);
ok("the STATE bytes are unchanged", after.bytes.equals(before.bytes));
ok("stats are unchanged", JSON.stringify(after.stats) === JSON.stringify(before.stats));
ok("the resolution settings are unchanged", JSON.stringify(after.resolution) === JSON.stringify(before.resolution));
ok("every claim view is unchanged", JSON.stringify(after.claims) === JSON.stringify(before.claims), `${after.claims.length} claims`);
let hv = null;
try { hv = await view("get_house_agent", { account: dep.accounts.lane }); } catch (e) { hv = { error: String(e.message || e).slice(0, 120) }; }
ok("the new code answers its new view (get_house_agent)", hv && hv.chargeable === false, JSON.stringify(hv));

// ---------- 6. record ----------
if (RECORD && !bad) {
  const head = (await import("node:child_process")).spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  dep.upgrades = [...(dep.upgrades || []), { account: M, from: live, to: wasm.hash, tx: txHash, at: new Date().toISOString(), source_rev: head, note: "same state layout: code replaced in place, no migration (tools/judge/upgrade-testnet.mjs)" }];
  dep.code.market = { ...dep.code.market, code_hash: wasm.hash, sha256: wasm.sha256, source_rev: head };
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
  console.log(`recorded in ${path.relative(REPO, depFile)}`);
}
process.exit(bad ? 1 : 0);
