// The MAINNET deployment's keys and settings (deployments/mainnet.json, written by
// `CONFIRM_MAINNET=yes node scripts/deploy.mjs mainnet`).
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/keys.mjs
//
// Signed by the owner (isitpriced.near) with NEAR_DEPLOYER_PRIVATE_KEY from .env, read only after
// CONFIRM_MAINNET=yes. Idempotent: every key and setting is checked on chain first. Private keys
// go only to the git-ignored .apex-test/mainnet/, written before their public half is used; this
// script prints public keys, account names and transaction hashes, never a private key.
//
// What it makes, mirroring scripts/vercel/keys.mjs on testnet:
//   keystore/operator-market.json  function-call key on the owner: anchor_rewrite and
//                                  charge_inference on the market, nothing else
//   jury-key.json                  function-call key on the owner: submit_verdict only
//   lane-key.json                  a full-access key on lane.isitpriced.near only, for adding the
//                                  visitors' keys (the owner's key never leaves this machine)
//   planner.json                   a fresh ed25519 planner key; set_planner_key with its public half
// and registers the three jury models (the writer, z-ai/glm-5.3-flash, is one of them, so its entry
// also serves anchor_rewrite) with signing keys from fresh attestations and the tuned extras.
// The public halves and the transactions go to deployments/mainnet.json.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { operatorKey, writeKeyFile } from "../../services/ai/src/keystore.js";
import { OPERATOR_METHODS } from "../../services/ai/src/signer.js";
import { keyOnChain } from "../../services/ai/src/house.js";
import { NearAI, Attestor } from "../../services/ai/src/nearai.js";

if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== "mainnet") throw new Error("deployments/mainnet.json is not a mainnet deployment");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!env.NEAR_DEPLOYER_PRIVATE_KEY) throw new Error("NEAR_DEPLOYER_PRIVATE_KEY is not in .env");

const RPCS = (env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.near.org").split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const ownerKey = KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY);
const owner = new Account(dep.root, provider, new KeyPairSigner(ownerKey));
const marketId = dep.accounts.market;
const laneId = dep.accounts.lane;
const OUT = path.join(ROOT, ".apex-test/mainnet");
const KS = path.join(OUT, "keystore");
fs.mkdirSync(KS, { recursive: true, mode: 0o700 });
const TGAS = 10n ** 12n;
const allowance = 5n * 10n ** 23n; // 0.5 NEAR of gas per hosted key, about 1,000 calls
const view = (method, args = {}) => provider.callFunction({ contractId: marketId, method, args, blockQuery: { finality: "final" } });
const txs = [];
async function call(method, args, tag) {
  const r = await owner.callFunctionRaw({ contractId: marketId, methodName: method, args, gas: 60n * TGAS, deposit: 0n });
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  txs.push({ tag, method, tx, link: `https://nearblocks.io/txns/${tx}` });
  console.log(`${tag}: tx ${tx}`);
  return tx;
}
const ownerOnChain = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: dep.root })).keys.some((k) => k.public_key === ownerKey.getPublicKey().toString());
if (!ownerOnChain) throw new Error(`the deployer's key is not on ${dep.root}`);

// 1. the operator's market key: anchor_rewrite and charge_inference, nothing else
const { rec: op } = operatorKey(KS, "market", { accountId: dep.root, receiverId: marketId, methods: OPERATOR_METHODS.market });
if (await keyOnChain(provider, dep.root, op.publicKey)) console.log(`operator-market ${op.publicKey}: already on ${dep.root}`);
else {
  await owner.addFunctionCallAccessKey({ publicKey: op.publicKey, contractId: marketId, methodNames: OPERATOR_METHODS.market, allowance });
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
  await owner.addFunctionCallAccessKey({ publicKey: jury.publicKey, contractId: marketId, methodNames: ["submit_verdict"], allowance });
  console.log(`jury ${jury.publicKey}: added on ${dep.root} (submit_verdict)`);
}

// 3. the lane admin key: full access on the lane account only (adding visitors' function-call keys
//    needs full access there), never the owner's key, which also controls the market
const laneFile = path.join(OUT, "lane-key.json");
let lane = fs.existsSync(laneFile) ? JSON.parse(fs.readFileSync(laneFile, "utf8")) : null;
if (!lane) {
  const kp = KeyPair.fromRandom("ed25519");
  lane = { accountId: laneId, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString(), created_at: new Date().toISOString() };
  writeKeyFile(laneFile, lane);
}
if (await keyOnChain(provider, laneId, lane.publicKey)) console.log(`lane ${laneId} ${lane.publicKey}: already on chain`);
else {
  const asOwner = new Account(laneId, provider, new KeyPairSigner(ownerKey));
  await asOwner.addFullAccessKey(lane.publicKey);
  console.log(`lane ${laneId} ${lane.publicKey}: a dedicated admin key added`);
}

// 4. the planner key: signs the opening price of every pasted sentence (open_and_buy checks it)
const plannerFile = path.join(OUT, "planner.json");
let planner = fs.existsSync(plannerFile) ? JSON.parse(fs.readFileSync(plannerFile, "utf8")) : null;
if (!planner) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  planner = { note: "MAINNET planner key for market.isitpriced.near. Its private half lives here and in the hosted runtime's encrypted environment only.", public_hex: pub.toString("hex"), seed_hex: seed.toString("hex") };
  writeKeyFile(plannerFile, planner);
}
// the market has no view for the planner key, so the record of the last run stands for it
if (dep.keys?.planner_public_hex === planner.public_hex) console.log(`planner ${planner.public_hex.slice(0, 16)}…: already set`);
else await call("set_planner_key", { key_hex: planner.public_hex }, `set_planner_key ${planner.public_hex.slice(0, 16)}…`);

// 5. the jury models, with signing keys from fresh attestations and the extras tuned on testnet
//    (.apex/spikes/live: VERDICT on the first line of content, reasoning off)
const EXTRAS = {
  "deepseek-ai/DeepSeek-V4.1-Flash-1017": '"chat_template_kwargs":{"thinking":false}',
  "Qwen/Qwen3.8-27B": '"chat_template_kwargs":{"enable_thinking":false}',
  "z-ai/glm-5.3-flash": '"max_tokens":2048',
};
const attestor = new Attestor({ client: new NearAI({}), dir: path.join(ROOT, "services/ai/attestations") });
const models = [];
for (const [model, extras] of Object.entries(EXTRAS)) {
  const pre = await attestor.preflight(model);
  if (!pre.ok || pre.verifiedSigners.length !== 1) throw new Error(`${model}: attestation ${pre.ok ? "has several signers" : "failed"}: ${pre.failures.join("; ")}`);
  const key = pre.verifiedSigners[0].signing_address;
  let have = null;
  try { have = await view("get_model", { model }); } catch { have = null; }
  let tx = null;
  if (have && have.signing_address_hex === key && have.extras_json === extras) console.log(`${model}: already registered with key ${key.slice(0, 16)}…`);
  else tx = await call("register_model", { model, signing_address_hex: key, extras_json: extras }, `register_model ${model}`);
  // a fresh write is optimistic before it is final: ask again for a few blocks
  let after = null;
  for (let i = 0; i < 12 && !(after && after.signing_address_hex === key); i++) { after = await provider.callFunction({ contractId: marketId, method: "get_model", args: { model }, blockQuery: { finality: "optimistic" } }); if (!(after && after.signing_address_hex === key)) await new Promise((r) => setTimeout(r, 1000)); }
  if (!after) throw new Error(`${model}: get_model shows nothing after register_model`);
  if (after.signing_address_hex !== key || after.extras_json !== extras) throw new Error(`${model}: get_model does not show what was registered`);
  models.push({ model, signing_address_hex: key, extras_json: extras, attestation_nonce: pre.nonce, tx });
}

// 6. the public record
const writer = models.find((m) => m.model === "z-ai/glm-5.3-flash");
dep.keys = {
  ...(dep.keys || {}),
  owner: dep.root,
  operator_public_key: op.publicKey,
  operator_methods: OPERATOR_METHODS.market,
  jury_public_key: jury.publicKey,
  lane_admin_public_key: lane.publicKey,
  planner_public_hex: planner.public_hex,
  planner: "a mainnet planner key made for this deployment; its private half is not in git",
  writer_model: writer.model,
  writer_public_hex: writer.signing_address_hex,
  writer: "NEAR AI Cloud's provider_tee key for z-ai/glm-5.3-flash, from a verified attestation",
};
dep.models = models.map(({ model, signing_address_hex, extras_json, tx }) => ({ model, signing_address_hex, extras_json, tx: tx || (dep.models || []).find((m) => m.model === model)?.tx || null }));
dep.transactions = [...(dep.transactions || []), ...txs];
dep.keys_set_at = new Date().toISOString();
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log(`recorded in deployments/mainnet.json; private keys in ${path.relative(ROOT, OUT)} (git-ignored)`);
