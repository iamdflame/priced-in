// The ruling loop's two accounts' keys, and the Checker's bond.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/checker.mjs --plan   print what it would do, change nothing
//   CONFIRM_MAINNET=yes node scripts/mainnet/checker.mjs          do it
//   node scripts/mainnet/checker.mjs --network testnet            the same on the persistent testnet market
//   options: --bond <USD the Checker holds in the market, default 1>  --near <NEAR for its gas, default 0.1>
//
// Signed by the owner: NEAR_DEPLOYER_PRIVATE_KEY from .env on mainnet (read only after
// CONFIRM_MAINNET=yes), .apex-test/judge-testnet.json on testnet. Idempotent: every step is checked
// on chain first. In order:
//   1. checker.<owner>: a plain sub-account, with a full-access key for recovery only
//   2. its function-call key on the market, limited to challenge (the only Checker key the hosted
//      signer gets): it can post the Checker's bond and do nothing else
//   3. a keeper key on the owner: finalize, expire_challenge and open_claim on the market, nothing
//      else. finalize and expire_challenge are permissionless; open_claim is operators only, which
//      is why it sits on the owner, beside the operator's and the jury's narrow keys
//   4. the Checker's bond balance inside the market: the owner deposits the shortfall for it
//      (ft_transfer_call with {"for": "<checker>"}), from the owner's USDC
// Keys go to the git-ignored .apex-test/ before their public half is used. Nothing secret is
// printed. Then the hosted runtime needs them: node scripts/vercel/secrets.mjs --network <network>
// and a deploy. The public halves and the transactions go to deployments/<network>.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { operatorKey, writeKeyFile } from "../../services/ai/src/keystore.js";
import { OPERATOR_METHODS } from "../../services/ai/src/signer.js";
import { keyOnChain } from "../../services/ai/src/house.js";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const NET = arg("--network", "mainnet");
if (NET !== "mainnet" && NET !== "testnet") throw new Error("--network is mainnet or testnet");
const MAIN = NET === "mainnet";
if (MAIN && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const PLAN = process.argv.includes("--plan");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, `deployments/${NET}.json`);
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== NET) throw new Error(`deployments/${NET}.json is not a ${NET} deployment`);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const ownerSecret = MAIN ? env.NEAR_DEPLOYER_PRIVATE_KEY : JSON.parse(fs.readFileSync(path.join(ROOT, ".apex-test/judge-testnet.json"), "utf8")).key;
if (!ownerSecret) throw new Error("the owner's key is not available");

const usd = (x) => BigInt(Math.round(Number(x) * 1e6));
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;
const BOND = usd(arg("--bond", "1"));
const NEAR = 10n ** 24n, TGAS = 10n ** 12n;
const GAS_NEAR = BigInt(Math.round(Number(arg("--near", "0.1")) * 1000)) * NEAR / 1000n;
const nearFmt = (y) => `${(Number(y / 10n ** 21n) / 1000).toFixed(3)} NEAR`;
const RPCS = MAIN ? (env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.drpc.org,https://free.rpc.fastnear.com").split(",") : ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const ownerKey = KeyPair.fromString(ownerSecret);
const owner = new Account(dep.root, provider, new KeyPairSigner(ownerKey));
const M = dep.accounts.market, U = dep.accounts.usdc;
const CHECKER = `checker.${dep.root}`;
const OUT = path.join(ROOT, MAIN ? ".apex-test/mainnet" : ".apex-test/vercel");
const KS = path.join(OUT, "keystore");
const view = (contractId, method, args = {}, finality = "final") => provider.callFunction({ contractId, method, args, blockQuery: { finality } });
const exists = async (id) => { try { await provider.query({ request_type: "view_account", finality: "final", account_id: id }); return true; } catch (e) { const all = [e, ...(e.errors || [])].map((x) => String(x?.message || x)).join(" "); if (/does not exist|UNKNOWN_ACCOUNT/i.test(all)) return false; throw e; } };
const link = (tx) => `https://${MAIN ? "" : "testnet."}nearblocks.io/txns/${tx}`;
const txs = [];

// ---------- what is there ----------
const ownerOnChain = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: dep.root })).keys.some((k) => k.public_key === ownerKey.getPublicKey().toString());
if (!ownerOnChain) throw new Error(`the owner's key is not on ${dep.root}`);
const checkerExists = await exists(CHECKER);
const balance = BigInt(await view(M, "get_balance", { trader: CHECKER }));
const ownerUsdc = BigInt(await view(U, "ft_balance_of", { account_id: dep.root }));
const shortfall = BOND > balance ? BOND - balance : 0n;
const res = await view(M, "get_resolution");
const claims = await view(M, "get_claims", { from: 0, limit: 100 });
const { corpusEvidence } = await import("../../services/ai/src/evidence.js");
const lines = claims.filter((c) => c.status === "Open" && corpusEvidence(c.text));
console.log(`network ${NET}; market ${M}; owner ${dep.root} holds ${fmt(ownerUsdc)} USDC`);
console.log(`checker ${CHECKER}: ${checkerExists ? "exists" : `to create with ${nearFmt(GAS_NEAR)}`}; market balance ${fmt(balance)}, target ${fmt(BOND)}${shortfall ? `, deposit ${fmt(shortfall)}` : ""}; the market's bond is ${fmt(res.challenge_bond_micro)}`);
console.log(`caught lines open now: ${lines.length} (${lines.map((c) => `#${c.id} ${corpusEvidence(c.text).corpus_id}`).join(", ") || "none"})`);
if (BOND < BigInt(res.challenge_bond_micro)) console.log(`note: --bond ${fmt(BOND)} is below the market's bond: the Checker could not challenge`);
if (shortfall > ownerUsdc) { console.log(`the owner holds ${fmt(ownerUsdc)} USDC and the bond needs ${fmt(shortfall)}: add USDC first`); process.exit(2); }
if (PLAN) process.exit(0);

// ---------- 1. the Checker, with a recovery key ----------
fs.mkdirSync(KS, { recursive: true, mode: 0o700 });
const fullFile = path.join(OUT, "checker-key.json");
let full = fs.existsSync(fullFile) ? JSON.parse(fs.readFileSync(fullFile, "utf8")) : null;
if (!full) {
  const kp = KeyPair.fromRandom("ed25519");
  full = { note: "full-access key of the Checker, for recovery only: the hosted signer never gets it", accountId: CHECKER, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString(), created_at: new Date().toISOString() };
  writeKeyFile(fullFile, full);
}
if (!checkerExists) {
  const r = await owner.createSubAccount({ accountOrPrefix: "checker", publicKey: full.publicKey, nearToTransfer: GAS_NEAR });
  const tx = r?.transaction_outcome?.id || r?.transaction?.hash || null;
  txs.push({ tag: `create ${CHECKER}`, method: "create_account", tx, link: tx ? link(tx) : null });
  console.log(`ok  created ${CHECKER} with ${nearFmt(GAS_NEAR)}${tx ? `: tx ${tx}` : ""}`);
} else console.log(`ok  ${CHECKER} exists`);

// ---------- 2. its challenge key ----------
const { rec: chk } = operatorKey(KS, "checker", { accountId: CHECKER, receiverId: M, methods: OPERATOR_METHODS.checker });
if (await keyOnChain(provider, CHECKER, chk.publicKey)) console.log(`ok  checker key ${chk.publicKey}: already on ${CHECKER}`);
else {
  const acct = new Account(CHECKER, provider, new KeyPairSigner(KeyPair.fromString(full.privateKey)));
  await acct.addFunctionCallAccessKey({ publicKey: chk.publicKey, contractId: M, methodNames: OPERATOR_METHODS.checker, allowance: GAS_NEAR * 8n / 10n });
  console.log(`ok  checker key ${chk.publicKey}: added on ${CHECKER} (${OPERATOR_METHODS.checker.join(", ")})`);
}

// ---------- 3. the keeper's key on the owner ----------
const { rec: keep } = operatorKey(KS, "keeper", { accountId: dep.root, receiverId: M, methods: OPERATOR_METHODS.keeper });
if (await keyOnChain(provider, dep.root, keep.publicKey)) console.log(`ok  keeper key ${keep.publicKey}: already on ${dep.root}`);
else {
  await owner.addFunctionCallAccessKey({ publicKey: keep.publicKey, contractId: M, methodNames: OPERATOR_METHODS.keeper, allowance: 5n * 10n ** 23n });
  console.log(`ok  keeper key ${keep.publicKey}: added on ${dep.root} (${OPERATOR_METHODS.keeper.join(", ")})`);
}

// ---------- 4. the bond ----------
if (shortfall > 0n) {
  const r = await owner.callFunctionRaw({ contractId: U, methodName: "ft_transfer_call", args: { receiver_id: M, amount: String(shortfall), msg: JSON.stringify({ for: CHECKER }) }, gas: 100n * TGAS, deposit: 1n });
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  if (r.status && typeof r.status === "object" && "Failure" in r.status) throw new Error(`the deposit failed: ${JSON.stringify(r.status.Failure).slice(0, 300)}`);
  txs.push({ tag: `bond ${CHECKER} ${fmt(shortfall)}`, method: "ft_transfer_call", tx, link: link(tx) });
  console.log(`ok  deposited ${fmt(shortfall)} for ${CHECKER}: tx ${tx}`);
}

// ---------- read back and record ----------
const after = BigInt(await view(M, "get_balance", { trader: CHECKER }, "optimistic"));
if (after < BOND) throw new Error(`the Checker holds ${fmt(after)}, expected at least ${fmt(BOND)}`);
for (const [acct, k] of [[CHECKER, chk.publicKey], [dep.root, keep.publicKey]]) if (!(await keyOnChain(provider, acct, k))) throw new Error(`${k} is not on ${acct}`);
dep.keys = { ...(dep.keys || {}), keeper_public_key: keep.publicKey, keeper_methods: OPERATOR_METHODS.keeper, checker_account: CHECKER, checker_public_key: chk.publicKey, checker_methods: OPERATOR_METHODS.checker };
dep.checker = { account: CHECKER, bond_micro: String(after), at: new Date().toISOString() };
dep.transactions = [...(dep.transactions || []), ...txs];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log(`the Checker holds ${fmt(after)} in the market. Recorded in deployments/${NET}.json; private keys in ${path.relative(ROOT, OUT)} (git-ignored)`);
console.log(`next: node scripts/vercel/secrets.mjs --network ${NET} (the hosted signer gets both keys), then node scripts/vercel/deploy.mjs`);
