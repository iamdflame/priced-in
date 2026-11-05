// The hosted runtime's keys on the persistent TESTNET deployment (deployments/testnet.json).
// Idempotent; every key is checked on-chain first. Writes only into the git-ignored
// .apex-test/vercel/ and never prints a private key.
//
//   node scripts/vercel/keys.mjs              operator + jury function-call keys, keystore for the signer
//   node scripts/vercel/keys.mjs --rotate-lane replace the hosted lane admin key (the old one is deleted)
//
// What it makes:
//   keystore/operator-market.json  function-call key on the root (the market's operator):
//                                  anchor_rewrite, charge_inference on the market only
//   jury-key.json                  function-call key on the root: submit_verdict on the market only
//   signer-keys.json               the three static house agents' buy/sell/redeem keys (copied
//                                  from .apex-test/live/signer-keys.json, made by the live spike)
//   lane-key.json                  a full-access key on the lane account only, for adding visitors'
//                                  keys (the root's key, which controls everything, never leaves here)
import fs from "node:fs";
import path from "node:path";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { ROOT } from "./env.mjs";
import { operatorKey, writeKeyFile } from "../../services/ai/src/keystore.js";
import { OPERATOR_METHODS } from "../../services/ai/src/signer.js";
import { keyOnChain } from "../../services/ai/src/house.js";

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
if (dep.network !== "testnet") throw new Error("testnet only");
const RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com", "https://testnet-rpc.intea.rs", "https://rpc.testnet.near.org"];
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const OUT = path.join(ROOT, ".apex-test/vercel");
const KS = path.join(OUT, "keystore");
fs.mkdirSync(KS, { recursive: true });

const st = JSON.parse(fs.readFileSync(path.join(ROOT, ".apex-test/judge-testnet.json"), "utf8"));
if (st.root !== dep.root) throw new Error("the judge state does not match deployments/testnet.json");
const root = new Account(dep.root, provider, new KeyPairSigner(KeyPair.fromString(st.key)));
const marketId = dep.accounts.market;
const allowance = 2n * 10n ** 24n;

// 1. the operator's market key: anchor_rewrite and charge_inference, nothing else
const { rec: op } = operatorKey(KS, "market", { accountId: dep.root, receiverId: marketId, methods: OPERATOR_METHODS.market });
if (await keyOnChain(provider, dep.root, op.publicKey)) console.log(`operator-market ${op.publicKey}: already on ${dep.root}`);
else {
  await root.addFunctionCallAccessKey({ publicKey: op.publicKey, contractId: marketId, methodNames: OPERATOR_METHODS.market, allowance });
  console.log(`operator-market ${op.publicKey}: added on ${dep.root} (${OPERATOR_METHODS.market.join(", ")})`);
}

// 2. the jury's key: submit_verdict only
const juryFile = path.join(OUT, "jury-key.json");
let jury = fs.existsSync(juryFile) ? JSON.parse(fs.readFileSync(juryFile, "utf8")) : null;
if (!jury) {
  const kp = KeyPair.fromRandom("ed25519");
  jury = { kind: "jury", accountId: dep.root, receiverId: marketId, methods: ["submit_verdict"], publicKey: kp.getPublicKey().toString(), privateKey: kp.toString(), created_at: new Date().toISOString() };
  writeKeyFile(juryFile, jury);
}
if (await keyOnChain(provider, dep.root, jury.publicKey)) console.log(`jury ${jury.publicKey}: already on ${dep.root}`);
else {
  await root.addFunctionCallAccessKey({ publicKey: jury.publicKey, contractId: marketId, methodNames: ["submit_verdict"], allowance });
  console.log(`jury ${jury.publicKey}: added on ${dep.root} (submit_verdict)`);
}

// 3. the house agents' keys, as the signer reads them (SIGNER_KEYS_FILE)
const houseSrc = path.join(ROOT, ".apex-test/live/signer-keys.json");
const house = JSON.parse(fs.readFileSync(houseSrc, "utf8"));
for (const [name, a] of Object.entries(house.agents)) {
  const pub = KeyPair.fromString(a.privateKey).getPublicKey().toString();
  console.log(`house ${name} ${a.accountId} ${pub}: ${(await keyOnChain(provider, a.accountId, pub)) ? "on chain" : "NOT ON CHAIN"}`);
}
fs.writeFileSync(path.join(OUT, "signer-keys.json"), JSON.stringify(house, null, 1), { mode: 0o600 });

// 4. the lane admin key: a full-access key on the lane account only (adding visitors' keys needs
//    full access there), never the root's own key, which also controls the market and the swarm
const laneId = dep.accounts.lane;
const laneFile = path.join(OUT, "lane-key.json");
let lane = fs.existsSync(laneFile) ? JSON.parse(fs.readFileSync(laneFile, "utf8")) : null;
const rotate = process.argv.includes("--rotate-lane");
if (!lane || rotate) {
  const fresh = KeyPair.fromRandom("ed25519");
  const prev = lane;
  lane = { accountId: laneId, publicKey: fresh.getPublicKey().toString(), privateKey: fresh.toString(), created_at: new Date().toISOString() };
  fs.writeFileSync(laneFile + ".new", JSON.stringify(lane, null, 1), { mode: 0o600 });
  const asRoot = new Account(laneId, provider, new KeyPairSigner(KeyPair.fromString(st.key)));
  await asRoot.addFullAccessKey(lane.publicKey);
  fs.renameSync(laneFile + ".new", laneFile);
  if (prev && (await keyOnChain(provider, laneId, prev.publicKey))) await asRoot.deleteKey(prev.publicKey);
  console.log(`lane ${laneId} ${lane.publicKey}: a dedicated admin key added${prev ? "; the previous one deleted" : ""}`);
} else {
  console.log(`lane ${laneId} ${lane.publicKey}: ${(await keyOnChain(provider, laneId, lane.publicKey)) ? "on chain" : "NOT ON CHAIN"}`);
}
console.log(`written to ${path.relative(ROOT, OUT)} (git-ignored)`);
