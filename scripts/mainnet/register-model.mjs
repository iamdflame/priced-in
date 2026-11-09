// Re-register a jury model's signing key on the mainnet market, from a fresh verified attestation.
// The market checks every verdict (and the writer's rewrites) against the key registered for the model
// (get_model); when NEAR AI Cloud's TEE for a model starts signing with a new key, the market refuses
// that model's verdicts until this runs. docs/RUNBOOK-jury-keys.md says when.
//
//   node scripts/mainnet/register-model.mjs --plan [<model> ...]
//       read only: attests each model now (a fresh nonce, the Intel quote, the GPU token, the key
//       binding: the same Attestor the jury uses), reads get_model, and prints what it would sign.
//       Reads no key and sends nothing.
//   CONFIRM_MAINNET=yes node scripts/mainnet/register-model.mjs [<model> ...]
//       the same, then register_model for each model whose attested key differs from the market's,
//       signed by the owner (NEAR_DEPLOYER_PRIVATE_KEY from .env, read only after CONFIRM_MAINNET=yes).
//       Each write is read back with get_model; deployments/mainnet.json records the key and the tx, and
//       the attestation bundle that proves it is written to services/ai/attestations/ (check 10's input).
//
// No model named: every model in deployments/mainnet.json `models` (the three jurors; the writer,
// z-ai/glm-5.3-flash, is one of them). extras_json stays what the market holds for the model (the
// tuned settings), or the deployment record's for a model the market does not know yet.
// Refuses when an attestation does not verify, or proves more than one key: nothing is guessed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLAN = process.argv.includes("--plan");
if (!PLAN && process.env.CONFIRM_MAINNET !== "yes") {
  console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it, or add --plan to see what it would do (read only).");
  process.exit(1);
}
const { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } = await import("near-api-js");
const { NearAI, Attestor } = await import("../../services/ai/src/nearai.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== "mainnet") throw new Error("deployments/mainnet.json is not a mainnet deployment");
const marketId = dep.accounts.market;
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const known = (dep.models || []).map((m) => m.model);
const models = named.length ? named : known;
if (!models.length) throw new Error("no model named and none in deployments/mainnet.json");

const env = PLAN ? {} : Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!PLAN && !env.NEAR_DEPLOYER_PRIVATE_KEY) throw new Error("NEAR_DEPLOYER_PRIVATE_KEY is not in .env");
const RPCS = (env.NEAR_RPC_MAINNET || "https://free.rpc.fastnear.com,https://near.drpc.org,https://rpc.mainnet.near.org").split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const getModel = (model, finality = "final") => provider.callFunction({ contractId: marketId, method: "get_model", args: { model }, blockQuery: { finality } });
const attestor = new Attestor({ client: new NearAI({}), dir: null });
const short = (k) => (k ? `${k.slice(0, 16)}…` : "none");

console.log(`${PLAN ? "PLAN (read only)" : "APPLY"}: ${models.length} model(s) on ${marketId}`);
const todo = [];
let refused = 0;
for (const model of models) {
  const [pre, have] = await Promise.all([attestor.preflight(model), getModel(model).catch((e) => ({ error: e.message }))]);
  if (have?.error) { console.log(`REFUSE ${model}: get_model did not answer (${have.error.slice(0, 120)})`); refused++; continue; }
  if (!pre.ok) { console.log(`REFUSE ${model}: the attestation did not verify, so there is no key to trust: ${pre.failures.slice(0, 2).join("; ")}`); refused++; continue; }
  const signers = pre.verifiedSigners.map((s) => s.signing_address.toLowerCase());
  const current = have?.signing_address_hex?.toLowerCase() ?? null;
  if (current && signers.includes(current)) { console.log(`OK     ${model}: the market's key ${short(current)} is the attested key (nonce ${pre.nonce.slice(0, 12)}…)`); continue; }
  if (signers.length !== 1) { console.log(`REFUSE ${model}: the attestation proves ${signers.length} keys (${signers.map(short).join(", ")}); the market holds one. Run again in a few minutes, or pick one by hand.`); refused++; continue; }
  const extras = have ? have.extras_json : (dep.models || []).find((m) => m.model === model)?.extras_json ?? "";
  console.log(`${PLAN ? "WOULD " : ""}REGISTER ${model}: ${short(current)} -> ${short(signers[0])}, extras ${extras || "(none)"}`);
  todo.push({ model, key: signers[0], extras, nonce: pre.nonce });
}

if (PLAN || !todo.length) {
  console.log(PLAN ? `${todo.length} to register${refused ? `, ${refused} refused` : ""}. To sign: CONFIRM_MAINNET=yes node scripts/mainnet/register-model.mjs${named.length ? ` ${named.join(" ")}` : ""}` : `nothing to register${refused ? `; ${refused} refused` : ""}`);
  process.exit(refused ? 1 : 0);
}

const owner = new Account(dep.root, provider, new KeyPairSigner(KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY)));
const TGAS = 10n ** 12n;
const txs = [];
// the bundle the judges' check 10 proves: attested once more, written to services/ai/attestations/, and
// registered only if it proves the same one key
const bundles = new Attestor({ client: new NearAI({}), dir: path.join(ROOT, "services/ai/attestations") });
for (const t of todo) {
  const again = await bundles.preflight(t.model);
  const keys = again.ok ? again.verifiedSigners.map((s) => s.signing_address.toLowerCase()) : [];
  if (keys.length !== 1 || keys[0] !== t.key) throw new Error(`${t.model}: a second attestation proves ${keys.length ? keys.map(short).join(", ") : "nothing"}, not ${short(t.key)}: nothing registered; run again`);
}
for (const t of todo) {
  const r = await owner.callFunctionRaw({ contractId: marketId, methodName: "register_model", args: { model: t.model, signing_address_hex: t.key, extras_json: t.extras }, gas: 60n * TGAS, deposit: 0n });
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  // a fresh write is optimistic before it is final: ask again for a few blocks
  let after = null;
  for (let i = 0; i < 12 && after?.signing_address_hex !== t.key; i++) { after = await getModel(t.model, "optimistic").catch(() => null); if (after?.signing_address_hex !== t.key) await new Promise((res) => setTimeout(res, 1000)); }
  if (after?.signing_address_hex !== t.key || after.extras_json !== t.extras) throw new Error(`${t.model}: get_model does not show what was registered (tx ${tx})`);
  console.log(`registered ${t.model}: ${short(t.key)}, tx ${tx} https://nearblocks.io/txns/${tx}`);
  txs.push({ tag: `register_model ${t.model}`, method: "register_model", tx, link: `https://nearblocks.io/txns/${tx}` });
  const rec = (dep.models ||= []).find((m) => m.model === t.model);
  if (rec) Object.assign(rec, { signing_address_hex: t.key, extras_json: t.extras, tx });
  else dep.models.push({ model: t.model, signing_address_hex: t.key, extras_json: t.extras, tx });
  if (dep.keys?.writer_model === t.model) dep.keys.writer_public_hex = t.key;
}
dep.transactions = [...(dep.transactions || []), ...txs];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log("recorded in deployments/mainnet.json; fresh bundles in services/ai/attestations/. The jury can rule now.");
console.log("Next, for the judges' check 10: node scripts/attestation/prove.mjs, then commit deployments/mainnet.json, services/ai/attestations/ and tools/judge/evidence/attestations/.");
process.exit(refused ? 1 : 0);
