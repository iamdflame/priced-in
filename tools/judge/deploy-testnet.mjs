// One-off: the persistent testnet deployment that the judge checks. Run once; keep it.
//
//   node tools/judge/deploy-testnet.mjs
//
// 1. builds market and swarm reproducibly (tools/judge/lib/repro.mjs), so anyone can rebuild
//    the exact bytes on testnet;
// 2. runs scripts/deploy.mjs testnet on those bytes, from a staging folder so its state file
//    (which holds the test root's key) is kept apart from other runs of deploy.mjs and is
//    never deleted by their `--delete`;
// 3. moves the state to the git-ignored .apex-test/judge-testnet.json.
// The test planner key is made here too (.apex-test/judge-planner.json, git-ignored); deploy.mjs
// registers its public half. Testnet only. Nothing secret is printed.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { reproBuild, REPO } from "./lib/repro.mjs";

const STATE = path.join(REPO, ".apex-test", "judge-testnet.json");
const PLANNER = path.join(REPO, ".apex-test", "judge-planner.json");
const STAGE = path.join(REPO, "target", "judge-deploy");
const MIN_LEFT = 6; // NEAR the shared funder must keep for other test runs

if (fs.existsSync(STATE) && !process.argv.includes("--resume")) {
  console.error(`${path.relative(REPO, STATE)} exists: the judge deployment is already made (pass --resume to finish a failed run)`);
  process.exit(1);
}
const spike = JSON.parse(fs.readFileSync(path.join(REPO, ".apex/spikes/s3-lane/testnet-accounts.json"), "utf8")).lane;
if (!spike.id.endsWith(".testnet")) throw new Error("the funder must be a testnet account");

async function available(id) {
  const r = await fetch("https://test.rpc.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }) });
  const a = (await r.json()).result;
  return Number(BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n) / 1e24;
}

// ---------- the planner's test key ----------
if (!fs.existsSync(PLANNER)) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex");
  fs.mkdirSync(path.dirname(PLANNER), { recursive: true });
  fs.writeFileSync(PLANNER, JSON.stringify({ note: "Test planner key for the judge's testnet deployment. Never use on mainnet.", public_hex: pub, seed_hex: seed }, null, 1));
}
const planner = JSON.parse(fs.readFileSync(PLANNER, "utf8"));

// ---------- reproducible build ----------
console.log("building market and swarm reproducibly (tools/judge/lib/repro.mjs)");
const built = await reproBuild({});
if (!built.ok) { console.error(`build failed: ${built.reason}`); process.exit(1); }
console.log(`market ${built.wasm.market.hash}, swarm ${built.wasm.swarm.hash}, agent ${built.wasm.agent.hash}`);
const committedAgent = fs.readFileSync(path.join(REPO, "contracts/swarm/res/agent.wasm"));
if (!built.wasm.agent.bytes.equals(committedAgent)) { console.error("the agent wallet doesn't rebuild to contracts/swarm/res/agent.wasm"); process.exit(1); }

const dir = path.join(STAGE, "target", "wasm32-unknown-unknown", "release");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "pricedin_market.wasm"), built.wasm.market.bytes);
fs.writeFileSync(path.join(dir, "pricedin_swarm.wasm"), built.wasm.swarm.bytes);
// test USDC and the sweeper aren't part of the reproducibility claim: the standard build
for (const f of ["pricedin_tusdc.wasm", "pricedin_sweeper.wasm"]) fs.copyFileSync(path.join(REPO, "target/wasm32-unknown-unknown/release", f), path.join(dir, f));
fs.mkdirSync(path.join(STAGE, ".apex-test"), { recursive: true });
if (fs.existsSync(STATE)) fs.copyFileSync(STATE, path.join(STAGE, ".apex-test", "deploy-testnet.json"));

const before = await available(spike.id);
console.log(`funder ${spike.id}: ${before.toFixed(3)} NEAR available`);
if (before < MIN_LEFT + 10) { console.error(`the funder needs ${MIN_LEFT + 10} NEAR to deploy and still keep ${MIN_LEFT}`); process.exit(1); }

// ---------- scripts/deploy.mjs testnet ----------
const env = { ...process.env, FUNDER_ID: spike.id, FUNDER_KEY: spike.sk, PLANNER_PUBLIC_KEY_HEX: planner.public_hex };
for (const k of ["NEAR_RPC", "NEAR_DEPLOYER_ADDRESS", "NEAR_DEPLOYER_PRIVATE_KEY", "CONFIRM_MAINNET", "OPERATOR_ACCOUNT", "COUNCIL_ACCOUNT"]) delete env[k];
const r = spawnSync(process.execPath, [path.join(REPO, "scripts", "deploy.mjs"), "testnet"], { cwd: STAGE, env, stdio: "inherit" });
const staged = path.join(STAGE, ".apex-test", "deploy-testnet.json");
if (fs.existsSync(staged)) { fs.copyFileSync(staged, STATE); fs.rmSync(staged); }
console.log(`state kept in ${path.relative(REPO, STATE)} (git-ignored; it holds the test root's key)`);
console.log(`funder ${spike.id}: ${(await available(spike.id)).toFixed(3)} NEAR available`);
process.exit(r.status ?? 1);
