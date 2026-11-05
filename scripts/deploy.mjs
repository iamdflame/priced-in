// Deploys Priced In: market.<root>, swarm.<root> and lane.<root> (plus tusdc.<root> on testnet).
//
//   node scripts/deploy.mjs testnet           fresh funded test root under the test funder
//   node scripts/deploy.mjs testnet --delete  deletes what the last testnet run created
//   CONFIRM_MAINNET=yes node scripts/deploy.mjs mainnet
//   LANE_ADMIN_PUBLIC_KEY=ed25519:... node scripts/deploy.mjs <network> --lock
//
// --lock, after deploy and verification, removes the root's full-access key from the market,
// swarm and lane accounts, so no key can replace their code again:
//   market, swarm: every key is deleted. Neither needs one: operators sign from the owner's
//     account with function-call keys there, and the swarm creates agents from its own code.
//     A key left on either could also call its #[private] callbacks, so none stays.
//   lane: the root's key is replaced by LANE_ADMIN_PUBLIC_KEY, the public half of the API's
//     LANE_PRIVATE_KEY, which must be a full-access key because only a full-access key can add
//     the judges' function-call keys. The judges' keys already there stay.
// The default is unlocked. Mainnet also needs CONFIRM_LOCK=yes, given only when the owner says so.
//
// Mainnet root: isitpriced.near (MAINNET_ROOT overrides), created and signed by
// NEAR_DEPLOYER_ADDRESS / NEAR_DEPLOYER_PRIVATE_KEY from .env. It refuses to run without
// CONFIRM_MAINNET=yes, before it reads any key. On mainnet:
//   - the contracts are the reproducible build (tools/judge/lib/repro.mjs), so anyone can rebuild
//     them from this commit and get the code hash on chain (npm run judge, check 3);
//   - the deployment is lean: market and lane only. The swarm, whose agents each lock 5 NEAR,
//     stays on testnet unless --with-swarm is given;
//   - the public values go to deployments/mainnet.json.
// Testnet funder: FUNDER_ID / FUNDER_KEY, else the local spike account, else the deployer.
// Optional: PLANNER_PUBLIC_KEY_HEX, OPERATOR_ACCOUNT, COUNCIL_ACCOUNT (proposed as the owner of
// both contracts: it takes over by calling accept_owner on each).
// Each step is skipped if it is already done, so a failed run can be run again.
// It prints account names and code hashes. It never prints a key. The testnet root's key goes
// to the git-ignored .apex-test/deploy-testnet.json.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, baseEncode } from "near-api-js";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";

const TGAS = 1_000_000_000_000n;
const NEAR = 1_000_000_000_000_000_000_000_000n;
const BYTE_COST = 10_000_000_000_000_000_000n; // yoctoNEAR per byte of storage
const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WASM = "target/wasm32-unknown-unknown/release";
const STATE = ".apex-test/deploy-testnet.json";

const network = process.argv[2];
if (network !== "testnet" && network !== "mainnet") {
  console.error("usage: node scripts/deploy.mjs <testnet|mainnet> [--delete | --lock]");
  process.exit(1);
}
if (network === "mainnet" && process.env.CONFIRM_MAINNET !== "yes") {
  console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it.");
  process.exit(1);
}
const LOCK = process.argv.includes("--lock");
if (LOCK && process.argv.includes("--delete")) { console.error("--lock and --delete don't go together"); process.exit(1); }
if (LOCK && network === "mainnet" && process.env.CONFIRM_LOCK !== "yes") {
  console.error("Refusing to lock mainnet: the code can never be replaced afterwards. Set CONFIRM_LOCK=yes once the owner has said so.");
  process.exit(1);
}
const near = (x) => BigInt(Math.round(x * 1000)) * NEAR / 1000n;
const show = (y) => (Number(y) / 1e24).toFixed(3);

function loadDotEnv() {
  const out = {};
  if (!fs.existsSync(".env")) return out;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = { ...loadDotEnv(), ...process.env };
if (LOCK && !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(env.LANE_ADMIN_PUBLIC_KEY || "")) {
  console.error("--lock needs LANE_ADMIN_PUBLIC_KEY=ed25519:...: the public half of the API's LANE_PRIVATE_KEY, which keeps adding the judges' keys to the lane once the root's key is gone");
  process.exit(1);
}
// NEAR_RPC may list several endpoints, comma-separated: a request refused with a rate limit
// (429, before the endpoint took it) goes to the next one; every other answer stands.
class RotatingProvider extends JsonRpcProvider {
  constructor(urls) { super({ url: urls[0] }); this.urls = urls; this.at = 0; }
  async sendJsonRpc(method, params) {
    for (let n = 0; ; n++) {
      try { return await super.sendJsonRpc(method, params); }
      catch (e) {
        if (n >= 4 * this.urls.length || !(e?.cause === 429 || /-429|Rate limits exceeded|Too Many Requests/i.test(String(e?.message || e)))) throw e;
        this.at = (this.at + 1) % this.urls.length; this.connection.url = this.urls[this.at];
        await new Promise((r) => setTimeout(r, 800 * (1 + Math.floor(n / this.urls.length))));
      }
    }
  }
}
const provider = new RotatingProvider((env.NEAR_RPC || (network === "mainnet" ? "https://rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.near.org" : "https://test.rpc.fastnear.com,https://testnet-rpc.intea.rs")).split(",").map((s) => s.trim()).filter(Boolean));
const acct = (id, kp) => new Account(id, provider, new KeyPairSigner(kp));

async function exists(id) {
  try { await provider.query({ request_type: "view_account", finality: "optimistic", account_id: id }); return true; }
  catch (e) { if (/does not exist|UNKNOWN_ACCOUNT|doesn't exist/i.test(String(e.message || e))) return false; throw e; }
}
const codeHash = async (id) => (await provider.query({ request_type: "view_account", finality: "optimistic", account_id: id })).code_hash;
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } });
const call = (a, contractId, methodName, args = {}, deposit = 0n, gas = 60n) => a.callFunction({ contractId, methodName, args, gas: gas * TGAS, deposit });


function wasm(name) {
  const file = `${WASM}/${name}.wasm`;
  if (!fs.existsSync(file)) { console.error(`${file} is missing: run npm run build:contracts`); process.exit(1); }
  const bytes = new Uint8Array(fs.readFileSync(file));
  return { bytes, hash: baseEncode(createHash("sha256").update(bytes).digest()), storage: BigInt(bytes.length) * BYTE_COST };
}

function funder() {
  if (env.FUNDER_ID && env.FUNDER_KEY) return acct(env.FUNDER_ID, KeyPair.fromString(env.FUNDER_KEY));
  const spike = ".apex/spikes/s3-lane/testnet-accounts.json";
  if (fs.existsSync(spike)) { const f = JSON.parse(fs.readFileSync(spike, "utf8")).lane; return acct(f.id, KeyPair.fromString(f.sk)); }
  if (env.NEAR_DEPLOYER_ADDRESS && env.NEAR_DEPLOYER_PRIVATE_KEY) return acct(env.NEAR_DEPLOYER_ADDRESS, KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY));
  console.error("no testnet funder: set FUNDER_ID and FUNDER_KEY");
  process.exit(1);
}

// ---------- testnet teardown ----------
if (process.argv.includes("--delete")) {
  if (network !== "testnet") { console.error("--delete is testnet only"); process.exit(1); }
  if (!fs.existsSync(STATE)) { console.error(`nothing recorded in ${STATE}`); process.exit(1); }
  const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const kp = KeyPair.fromString(s.key);
  let left = 0;
  for (const id of [...s.subs, s.root]) {
    if (!(await exists(id))) continue;
    const a = acct(id, kp);
    try {
      try { await a.deleteAccount(s.funder); }
      catch (e) {
        if (!/large state/i.test(String(e.message || e))) throw e;
        // NEAR won't delete an account with large state: swap in the sweeper, remove every key,
        // swap in an empty module, then delete
        await a.deployContract(wasm("pricedin_sweeper").bytes);
        for (;;) {
          const st = await provider.query({ request_type: "view_state", finality: "final", account_id: id, prefix_base64: "" });
          const keys = (st.values || []).map((v) => v.key);
          if (!keys.length) break;
          for (let i = 0; i < keys.length; i += 200) await a.callFunction({ contractId: id, methodName: "clean", args: { keys: keys.slice(i, i + 200) }, gas: 300n * TGAS });
        }
        await a.deployContract(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        await a.deleteAccount(s.funder);
      }
      console.log(`deleted ${id}`);
    } catch (e) { left++; console.log(`could not delete ${id}: ${String(e.message || e).slice(0, 160)}`); }
  }
  if (!left) fs.rmSync(STATE);
  process.exit(left ? 1 : 0);
}

// ---------- the root ----------
const WITH_SWARM = network === "testnet" || process.argv.includes("--with-swarm");
let market, swarm, repro = null;
if (network === "mainnet") {
  // the reproducible build, so the code hash on chain is one anyone can rebuild from this commit
  const { reproBuild } = await import("../tools/judge/lib/repro.mjs");
  console.log("building the contracts reproducibly (tools/judge/lib/repro.mjs)");
  repro = await reproBuild();
  if (!repro.ok) { console.error(`reproducible build failed: ${repro.reason}`); process.exit(1); }
  const fromRepro = (w) => ({ bytes: new Uint8Array(w.bytes), hash: w.hash, sha256: w.sha256, storage: BigInt(w.size) * BYTE_COST });
  market = fromRepro(repro.wasm.market);
  swarm = fromRepro(repro.wasm.swarm);
  console.log(`market ${market.hash} (${repro.wasm.market.size} bytes), ${repro.toolchain}`);
} else {
  market = wasm("pricedin_market");
  swarm = wasm("pricedin_swarm");
}
const tusdc = network === "testnet" ? wasm("pricedin_tusdc") : null;
const margin = network === "mainnet" ? near(0.6) : near(0.2);
const sizes = {
  market: market.storage + margin,
  ...(WITH_SWARM ? { swarm: swarm.storage + margin } : {}),
  // the lane pays the judges' gas (about 0.0004 NEAR a bet) and their keys' storage
  lane: network === "mainnet" ? near(1) : near(0.2),
  ...(tusdc ? { tusdc: tusdc.storage + margin } : {}),
};
// the root keeps enough for the house agents' accounts and the owner's own calls
const total = Object.values(sizes).reduce((a, b) => a + b, 0n) + (network === "mainnet" ? near(2) : near(0.5));

let root, kp, rootId, funderId = null;
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
if (network === "mainnet") {
  if (!env.NEAR_DEPLOYER_ADDRESS || !env.NEAR_DEPLOYER_PRIVATE_KEY) { console.error("NEAR_DEPLOYER_ADDRESS and NEAR_DEPLOYER_PRIVATE_KEY must be in .env"); process.exit(1); }
  kp = KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY);
  rootId = env.MAINNET_ROOT || "isitpriced.near";
  if (!(await exists(rootId))) {
    const deployer = acct(env.NEAR_DEPLOYER_ADDRESS, kp);
    console.log(`creating ${rootId} from the deployer with ${show(total)} NEAR`);
    await call(deployer, "near", "create_account", { new_account_id: rootId, new_public_key: kp.getPublicKey().toString() }, total, 100n);
  }
  root = acct(rootId, kp);
} else if (state) {
  kp = KeyPair.fromString(state.key);
  rootId = state.root;
  funderId = state.funder;
  root = acct(rootId, kp);
} else {
  const f = funder();
  funderId = f.accountId;
  kp = KeyPair.fromRandom("ed25519");
  const name = `pi${Date.now().toString(36)}`;
  rootId = `${name}.${f.accountId}`;
  fs.mkdirSync(".apex-test", { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ root: rootId, funder: funderId, key: kp.toString(), subs: [] }, null, 1));
  console.log(`creating test root ${rootId} with ${show(total)} NEAR`);
  await f.createSubAccount({ accountOrPrefix: name, publicKey: kp.getPublicKey(), nearToTransfer: total });
  root = acct(rootId, kp);
}

// ---------- sub-accounts ----------
const ids = { market: `market.${rootId}`, ...(WITH_SWARM ? { swarm: `swarm.${rootId}` } : {}), lane: `lane.${rootId}` };
if (tusdc) ids.tusdc = `tusdc.${rootId}`;
const subs = {};
for (const [k, id] of Object.entries(ids)) {
  if (!(await exists(id))) {
    console.log(`creating ${id} with ${show(sizes[k])} NEAR`);
    await root.createSubAccount({ accountOrPrefix: k, publicKey: kp.getPublicKey(), nearToTransfer: sizes[k] });
  }
  subs[k] = acct(id, kp);
}
if (network === "testnet") fs.writeFileSync(STATE, JSON.stringify({ root: rootId, funder: funderId, key: kp.toString(), subs: Object.values(ids) }, null, 1));

async function deploy(a, w) {
  if ((await codeHash(a.accountId)) === w.hash) return;
  console.log(`deploying ${a.accountId}`);
  await a.deployContract(w.bytes);
}
async function initialised(id, method) {
  try { await view(id, method); return true; } catch { return false; }
}

// ---------- contracts ----------
let usdc = MAINNET_USDC;
if (tusdc) {
  await deploy(subs.tusdc, tusdc);
  if (!(await initialised(ids.tusdc, "ft_total_supply"))) await call(subs.tusdc, ids.tusdc, "new");
  usdc = ids.tusdc;
}
await deploy(subs.market, market);
if (!(await initialised(ids.market, "stats"))) await call(subs.market, ids.market, "new", { owner: rootId, usdc, lane: ids.lane });
if (WITH_SWARM) {
  await deploy(subs.swarm, swarm);
  if (!(await initialised(ids.swarm, "stats"))) await call(subs.swarm, ids.swarm, "new", { owner: rootId, market: ids.market, treasury: rootId });
}

// the market and the owner can hold USDC
for (const id of [ids.market, rootId]) {
  if (tusdc) await call(root, ids.tusdc, "register", { account_id: id });
  else if (!(await view(usdc, "storage_balance_of", { account_id: id }))) await call(root, usdc, "storage_deposit", { account_id: id, registration_only: true }, near(0.00125 * 1000) / 1000n);
}
const res = await view(ids.market, "get_resolution");
if (WITH_SWARM && res.swarm !== ids.swarm) await call(root, ids.market, "set_swarm", { swarm: ids.swarm });
if (env.PLANNER_PUBLIC_KEY_HEX) await call(root, ids.market, "set_planner_key", { key_hex: env.PLANNER_PUBLIC_KEY_HEX });
if (env.OPERATOR_ACCOUNT) {
  await call(root, ids.market, "set_operator", { account: env.OPERATOR_ACCOUNT, allowed: true });
  if (WITH_SWARM) await call(root, ids.swarm, "set_operator", { account: env.OPERATOR_ACCOUNT, allowed: true });
}
if (env.COUNCIL_ACCOUNT) {
  await call(root, ids.market, "propose_owner", { account: env.COUNCIL_ACCOUNT });
  if (WITH_SWARM) await call(root, ids.swarm, "propose_owner", { account: env.COUNCIL_ACCOUNT });
}

// ---------- read it back ----------
const stats = await view(ids.market, "stats");
let bad = 0;
const verify = (name, ok) => { console.log(`${ok ? "ok  " : "BAD "} ${name}`); if (!ok) bad++; };
verify(`market code hash matches the ${repro ? "reproducible" : "local"} build`, (await codeHash(ids.market)) === market.hash);
if (WITH_SWARM) {
  const swarmStats = await view(ids.swarm, "stats");
  verify("swarm code hash matches the local build", (await codeHash(ids.swarm)) === swarm.hash);
  verify("the market knows the swarm", (await view(ids.market, "get_resolution")).swarm === ids.swarm);
  verify("the swarm points at the market", swarmStats.market === ids.market);
}
verify("the market answers", stats.paused === false);
if (!tusdc) verify("the market can hold USDC", !!(await view(usdc, "storage_balance_of", { account_id: ids.market })));
console.log(JSON.stringify({ network, root: rootId, ...ids, usdc, market_code_hash: market.hash, ...(WITH_SWARM ? { swarm_code_hash: swarm.hash } : {}) }, null, 1));
if (network === "mainnet" && !bad) {
  // the public record of the mainnet deployment: no key is written here
  const file = "deployments/mainnet.json";
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const rev = (() => { try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return null; } })();
  const nb = (id) => `https://nearblocks.io/address/${id}`;
  const rec = {
    ...prev,
    note: "The mainnet deployment of Priced In. Public values only: no key is here. Real USDC (native, issued by Circle) on NEAR.",
    network: "mainnet",
    rpc: "https://rpc.fastnear.com",
    root: rootId,
    accounts: { ...ids, usdc },
    usdc: { account: usdc, kind: "native USDC on NEAR (Circle), 6 decimals" },
    code: {
      ...(prev.code || {}),
      market: { code_hash: market.hash, sha256: market.sha256, size: Number(market.storage / BYTE_COST), source: "contracts/market", build: "node tools/judge/repro.mjs", source_rev: rev },
      toolchain: repro ? repro.toolchain : undefined,
    },
    swarm: WITH_SWARM ? ids.swarm : "not on mainnet: the open swarm runs on testnet, where each agent's 5 NEAR escrow costs nothing",
    deployed_at: prev.deployed_at || new Date().toISOString(),
    verified_at: new Date().toISOString(),
    explorer: Object.fromEntries(Object.entries({ root: rootId, ...ids }).map(([k, id]) => [k, nb(id)])),
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rec, null, 1) + "\n");
  console.log(`recorded in ${file}`);
}

// ---------- --lock: no key can replace the code ----------
const keysOf = async (id) => (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: id })).keys || [];
const full = (k) => k.access_key.permission === "FullAccess";
if (LOCK) {
  if (bad) { console.error("not locking: the deployment didn't verify"); process.exit(1); }
  const rootPk = kp.getPublicKey().toString();
  const laneAdmin = env.LANE_ADMIN_PUBLIC_KEY;
  if (laneAdmin === rootPk) { console.error("LANE_ADMIN_PUBLIC_KEY is the root's key: give the API its own lane key"); process.exit(1); }
  // the lane first: its new admin key goes on before the root's key comes off
  if (!(await keysOf(ids.lane)).some((k) => k.public_key === laneAdmin && full(k))) {
    console.log(`lane: adding the API's lane key ${laneAdmin}`);
    await subs.lane.addFullAccessKey(laneAdmin);
  }
  // market and swarm: every key, the root's last, since it signs the deletions
  for (const k of WITH_SWARM ? ["market", "swarm"] : ["market"]) {
    const keys = (await keysOf(ids[k])).map((x) => x.public_key);
    for (const pk of [...keys.filter((p) => p !== rootPk), ...keys.filter((p) => p === rootPk)]) {
      console.log(`${k}: deleting key ${pk}`);
      await subs[k].deleteKey(pk);
    }
  }
  if ((await keysOf(ids.lane)).some((x) => x.public_key === rootPk)) {
    console.log(`lane: deleting the root's key ${rootPk}`);
    await subs.lane.deleteKey(rootPk);
  }
  const after = {};
  for (const k of WITH_SWARM ? ["market", "swarm", "lane"] : ["market", "lane"]) after[k] = await keysOf(ids[k]);
  const lockedOk = (name, ok) => { console.log(`${ok ? "ok  " : "BAD "} ${name}`); if (!ok) bad++; };
  lockedOk("market has no keys: its code can't change", after.market.length === 0);
  if (WITH_SWARM) lockedOk("swarm has no keys: its code can't change", after.swarm.length === 0);
  lockedOk("lane: the root's key is gone", !after.lane.some((x) => x.public_key === rootPk));
  lockedOk("lane: one full-access key, the API's, to add the judges' keys", after.lane.filter(full).map((x) => x.public_key).join() === laneAdmin);
  lockedOk("lane: every other key is a function-call key on the market", after.lane.filter((x) => !full(x)).every((x) => x.access_key.permission.FunctionCall?.receiver_id === ids.market));
  lockedOk("the contracts still answer", (await view(ids.market, "stats")).claims !== undefined && (!WITH_SWARM || (await view(ids.swarm, "stats")).market === ids.market));
  lockedOk("code hashes unchanged", (await codeHash(ids.market)) === market.hash && (!WITH_SWARM || (await codeHash(ids.swarm)) === swarm.hash));
  console.log(`locked. Operators sign from their own accounts (the owner ${rootId} is one), never as the market; the owner keeps every owner method.`);
}
console.log("Next: fund the treasury with ft_transfer_call {\"treasury\":true}, set_limits, set_planner_key and register_model from fresh attestations (npm run ai:attest).");
process.exit(bad ? 1 : 0);
