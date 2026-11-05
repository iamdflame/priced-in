// Spawns the three house agents (archivist, skeptic, quant) through the swarm contract and sets
// up the operator's function-call keys. Idempotent: run it again and nothing changes.
//
//   node services/ai/scripts/house-agents.mjs testnet [--deposit <NEAR>] [--bankroll <USD>]
//   CONFIRM_MAINNET=yes node services/ai/scripts/house-agents.mjs mainnet [--deposit <NEAR>] [--bankroll <USD>]
//
// Owner (who spawns, owns the agents and is the operator):
//   testnet  --owner-file <json {accountId, privateKey}>, else the root in .apex-test/deploy-testnet.json
//   mainnet  isitpriced.near with NEAR_DEPLOYER_PRIVATE_KEY from .env (read only after CONFIRM_MAINNET=yes)
// Contracts: MARKET_CONTRACT_ID, SWARM_CONTRACT_ID, USDC_CONTRACT_ID, else market.<root>,
// swarm.<root> and tusdc.<root> (mainnet USDC on mainnet).
// Keys go to KEYSTORE_DIR (default services/ai/data/keystore, git-ignored), one file per key, and
// the jury's function-call key to <DATA_DIR>/jury-key.json. It never prints a private key.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { ensureHouseAgents, setupOperator } from "../src/house.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const network = process.argv[2];
if (network !== "testnet" && network !== "mainnet") { console.error("usage: house-agents.mjs <testnet|mainnet> [--deposit NEAR] [--bankroll USD] [--owner-file path]"); process.exit(1); }
if (network === "mainnet" && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

function dotEnv() {
  const out = {};
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) out[m[1]] = m[2].trim(); }
  return out;
}
const env = { ...dotEnv(), ...process.env };
const provider = new JsonRpcProvider({ url: env.NEAR_RPC || (network === "mainnet" ? "https://rpc.fastnear.com" : "https://test.rpc.fastnear.com") });

let ownerId, ownerKey, rootId;
if (arg("--owner-file")) { const o = JSON.parse(fs.readFileSync(arg("--owner-file"), "utf8")); ownerId = o.accountId; ownerKey = o.privateKey; rootId = ownerId; }
else if (network === "mainnet") { rootId = ownerId = "isitpriced.near"; ownerKey = env.NEAR_DEPLOYER_PRIVATE_KEY; }
else {
  const f = path.join(ROOT, ".apex-test/deploy-testnet.json");
  if (!fs.existsSync(f)) { console.error("no owner: pass --owner-file or run node scripts/deploy.mjs testnet first"); process.exit(1); }
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  rootId = ownerId = s.root; ownerKey = s.key;
}
if (!ownerKey) { console.error(`no key for ${ownerId}`); process.exit(1); }
if (ownerId.endsWith(network === "testnet" ? ".near" : ".testnet")) { console.error(`${ownerId} is not a ${network} account`); process.exit(1); }
const owner = new Account(ownerId, provider, new KeyPairSigner(KeyPair.fromString(ownerKey)));
const marketId = env.MARKET_CONTRACT_ID || `market.${rootId}`;
const swarmId = env.SWARM_CONTRACT_ID || `swarm.${rootId}`;
const usdcId = env.USDC_CONTRACT_ID || (network === "mainnet" ? MAINNET_USDC : `tusdc.${rootId}`);
const dataDir = env.DATA_DIR || path.join(ROOT, "services/ai/data");
const keystoreDir = env.KEYSTORE_DIR || path.join(dataDir, "keystore");
const deposit = arg("--deposit") ? BigInt(Math.round(Number(arg("--deposit")) * 1000)) * 10n ** 21n : null;
const bankroll = arg("--bankroll") ? BigInt(Math.round(Number(arg("--bankroll")) * 1e6)) : null;
fs.mkdirSync(dataDir, { recursive: true });

// the first height P&L has to scan from: recorded before the first spawn
const chainFile = path.join(dataDir, "chain.json");
if (!fs.existsSync(chainFile)) {
  const h = (await provider.viewBlock({ finality: "final" })).header.height;
  fs.writeFileSync(chainFile, JSON.stringify({ network, market: marketId, swarm: swarmId, usdc: usdcId, owner: ownerId, from_height: h }, null, 1));
}
const log = (m) => console.log(m);
const op = await setupOperator({ owner, provider, marketId, swarmId, keystoreDir, dataDir, log });
const rows = await ensureHouseAgents({ owner, provider, swarmId, marketId, usdcId, keystoreDir, depositYocto: deposit, bankrollMicro: bankroll, faucet: network === "testnet", log });
for (const r of rows) console.log(`${r.error ? "BAD " : "ok  "} ${r.key.padEnd(16)} ${r.account}  ${r.model}  ${r.created ? "spawned now" : "already spawned"}${r.bankroll_micro ? `  bankroll $${Number(r.bankroll_micro) / 1e6}` : ""}${r.error ? `  ${r.error}` : ""}`);
console.log("\nFor the runner (services/ai/.env):");
console.log(`SWARM_CONTRACT_ID=${swarmId}\nHOUSE_OWNER_IDS=${ownerId}\nKEYSTORE_DIR=${keystoreDir}\nJURY_KEY_FILE=${op.jury.file}\nDATA_DIR=${dataDir}`);
process.exit(rows.some((r) => r.error) ? 1 : 0);
