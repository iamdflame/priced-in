// Deploys Priced In: market.<root>, swarm.<root> and lane.<root> (plus tusdc.<root> on testnet).
//
//   node scripts/deploy.mjs testnet           fresh funded test root under the test funder
//   node scripts/deploy.mjs testnet --delete  deletes what the last testnet run created
//   CONFIRM_MAINNET=yes node scripts/deploy.mjs mainnet
//
// Mainnet root: priced-in.near, signed by NEAR_DEPLOYER_ADDRESS / NEAR_DEPLOYER_PRIVATE_KEY
// from .env. It refuses to run without CONFIRM_MAINNET=yes, before it reads any key.
// Testnet funder: FUNDER_ID / FUNDER_KEY, else the local spike account, else the deployer.
// Optional: PLANNER_PUBLIC_KEY_HEX, OPERATOR_ACCOUNT, COUNCIL_ACCOUNT (proposed as the owner of
// both contracts: it takes over by calling accept_owner on each).
// Each step is skipped if it is already done, so a failed run can be run again.
// It prints account names and code hashes. It never prints a key. The testnet root's key goes
// to the git-ignored .apex-test/deploy-testnet.json.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, baseEncode } from "near-api-js";
import { createHash } from "node:crypto";
import fs from "node:fs";

const TGAS = 1_000_000_000_000n;
const NEAR = 1_000_000_000_000_000_000_000_000n;
const BYTE_COST = 10_000_000_000_000_000_000n; // yoctoNEAR per byte of storage
const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WASM = "target/wasm32-unknown-unknown/release";
const STATE = ".apex-test/deploy-testnet.json";

const network = process.argv[2];
if (network !== "testnet" && network !== "mainnet") {
  console.error("usage: node scripts/deploy.mjs <testnet|mainnet> [--delete]");
  process.exit(1);
}
if (network === "mainnet" && process.env.CONFIRM_MAINNET !== "yes") {
  console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it.");
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
const provider = new JsonRpcProvider({ url: env.NEAR_RPC || (network === "mainnet" ? "https://rpc.fastnear.com" : "https://test.rpc.fastnear.com") });
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
const market = wasm("pricedin_market");
const swarm = wasm("pricedin_swarm");
const tusdc = network === "testnet" ? wasm("pricedin_tusdc") : null;
const margin = network === "mainnet" ? near(1) : near(0.2);
const sizes = {
  market: market.storage + margin,
  swarm: swarm.storage + margin,
  lane: network === "mainnet" ? near(5) : near(0.2),
  ...(tusdc ? { tusdc: tusdc.storage + margin } : {}),
};
const total = Object.values(sizes).reduce((a, b) => a + b, 0n) + near(0.5);

let root, kp, rootId, funderId = null;
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
if (network === "mainnet") {
  if (!env.NEAR_DEPLOYER_ADDRESS || !env.NEAR_DEPLOYER_PRIVATE_KEY) { console.error("NEAR_DEPLOYER_ADDRESS and NEAR_DEPLOYER_PRIVATE_KEY must be in .env"); process.exit(1); }
  kp = KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY);
  rootId = "priced-in.near";
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
const ids = { market: `market.${rootId}`, swarm: `swarm.${rootId}`, lane: `lane.${rootId}` };
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
await deploy(subs.swarm, swarm);
if (!(await initialised(ids.swarm, "stats"))) await call(subs.swarm, ids.swarm, "new", { owner: rootId, market: ids.market, treasury: rootId });

// the market and the owner can hold USDC
for (const id of [ids.market, rootId]) {
  if (tusdc) await call(root, ids.tusdc, "register", { account_id: id });
  else if (!(await view(usdc, "storage_balance_of", { account_id: id }))) await call(root, usdc, "storage_deposit", { account_id: id, registration_only: true }, near(0.00125 * 1000) / 1000n);
}
const res = await view(ids.market, "get_resolution");
if (res.swarm !== ids.swarm) await call(root, ids.market, "set_swarm", { swarm: ids.swarm });
if (env.PLANNER_PUBLIC_KEY_HEX) await call(root, ids.market, "set_planner_key", { key_hex: env.PLANNER_PUBLIC_KEY_HEX });
if (env.OPERATOR_ACCOUNT) {
  await call(root, ids.market, "set_operator", { account: env.OPERATOR_ACCOUNT, allowed: true });
  await call(root, ids.swarm, "set_operator", { account: env.OPERATOR_ACCOUNT, allowed: true });
}
if (env.COUNCIL_ACCOUNT) {
  await call(root, ids.market, "propose_owner", { account: env.COUNCIL_ACCOUNT });
  await call(root, ids.swarm, "propose_owner", { account: env.COUNCIL_ACCOUNT });
}

// ---------- read it back ----------
const stats = await view(ids.market, "stats");
const swarmStats = await view(ids.swarm, "stats");
let bad = 0;
const verify = (name, ok) => { console.log(`${ok ? "ok  " : "BAD "} ${name}`); if (!ok) bad++; };
verify("market code hash matches the local build", (await codeHash(ids.market)) === market.hash);
verify("swarm code hash matches the local build", (await codeHash(ids.swarm)) === swarm.hash);
verify("the market knows the swarm", (await view(ids.market, "get_resolution")).swarm === ids.swarm);
verify("the swarm points at the market", swarmStats.market === ids.market);
verify("the market answers", stats.paused === false);
console.log(JSON.stringify({ network, root: rootId, ...ids, usdc, market_code_hash: market.hash, swarm_code_hash: swarm.hash }, null, 1));
console.log("Next: fund the treasury with ft_transfer_call {\"treasury\":true}, set_limits, set_planner_key and register_model from fresh attestations (npm run ai:attest).");
process.exit(bad ? 1 : 0);
