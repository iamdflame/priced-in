// The Sentinel's account, its key and its bonds. The founder runs this; nothing else does.
//
//   node scripts/mainnet/sentinel.mjs plan                       says what apply would do; reads the chain, changes nothing, opens no key
//   CONFIRM_MAINNET=yes node scripts/mainnet/sentinel.mjs apply  does it, then reads the key back from the chain
//   options: --fund <USD the Sentinel holds in the market, default 10>  --near <NEAR for its gas, default 0.1>
//            --network testnet   the same on the persistent testnet market
//
// A separate account, sentinel.<owner>, not the Checker's: a dispute must land inside a 10-minute window, so
// the Sentinel's bonds can't share a balance with the Checker's daily bond, and the public record should read
// "the Sentinel disputed", never "the Checker disputed". Its key can lose only what that account holds.
//
// Signed by the owner: NEAR_DEPLOYER_PRIVATE_KEY from .env on mainnet (read only by apply, after
// CONFIRM_MAINNET=yes), .apex-test/judge-testnet.json on testnet. Idempotent: every step is checked on chain
// first. In order:
//   1. sentinel.<owner>: a plain sub-account, with a full-access key for recovery only
//   2. its function-call key on the market, limited to dispute: the only Sentinel key the hosted signer gets.
//      Read back from the chain: the method list must be exactly dispute, on the market, or apply fails
//   3. its bonds inside the market: the owner deposits the shortfall for it (ft_transfer_call with
//      {"for": "<sentinel>"}), from the owner's USDC
// Keys go to the git-ignored .apex-test/ before their public half is used. Nothing secret is printed. Then the
// hosted runtime needs the key: node scripts/vercel/secrets.mjs --network <network>, and a deploy. The public
// halves and the transactions go to deployments/<network>.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { operatorKey, writeKeyFile } from "../../services/ai/src/keystore.js";
import { checkPermission, DAILY_DISPUTES, DAILY_DISPUTE_MICRO, MAX_DISPUTE_BOND_MICRO, OPERATOR_METHODS } from "../../services/ai/src/signer.js";
import { fundingOf } from "../../services/ai/src/sentinel.js";

const USAGE = "usage: node scripts/mainnet/sentinel.mjs plan | CONFIRM_MAINNET=yes node scripts/mainnet/sentinel.mjs apply [--fund <USD>] [--near <NEAR>] [--network mainnet|testnet]";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CMD = process.argv[2];
if (CMD !== "plan" && CMD !== "apply") { console.error(USAGE); process.exit(1); }
const APPLY = CMD === "apply";
const NET = arg("--network", "mainnet");
if (NET !== "mainnet" && NET !== "testnet") { console.error("--network is mainnet or testnet"); process.exit(1); }
const MAIN = NET === "mainnet";
if (APPLY && MAIN && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, `deployments/${NET}.json`);
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== NET) throw new Error(`deployments/${NET}.json is not a ${NET} deployment`);
const usd = (x) => BigInt(Math.round(Number(x) * 1e6));
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;
const FUND = usd(arg("--fund", "10"));
const NEAR = 10n ** 24n, TGAS = 10n ** 12n;
const GAS_NEAR = BigInt(Math.round(Number(arg("--near", "0.1")) * 1000)) * NEAR / 1000n;
const nearFmt = (y) => `${(Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3)} NEAR`;
const dotEnv = () => (fs.existsSync(path.join(ROOT, ".env")) ? Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()])) : {});
const RPCS = MAIN ? (dotEnv().NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.drpc.org,https://free.rpc.fastnear.com").split(",") : ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const M = dep.accounts.market, U = dep.accounts.usdc;
const SENTINEL = `sentinel.${dep.root}`;
const OUT = path.join(ROOT, MAIN ? ".apex-test/mainnet" : ".apex-test/vercel");
const KS = path.join(OUT, "keystore");
const view = (contractId, method, args = {}, finality = "final") => provider.callFunction({ contractId, method, args, blockQuery: { finality } });
// an account's balance, or null when it doesn't exist yet: asked plainly, because the library retries and logs a missing account as an error
async function accountNear(id) {
  for (const url of RPCS) {
    const j = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }), signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
    if (j?.result?.amount) return BigInt(j.result.amount);
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j?.error ?? ""))) return null;
  }
  throw new Error(`no RPC could say whether ${id} exists`);
}
const link = (tx) => `https://${MAIN ? "" : "testnet."}nearblocks.io/txns/${tx}`;
const keysOf = async (id) => (await provider.query({ request_type: "view_access_key_list", finality: "optimistic", account_id: id })).keys || [];
const txs = [];

// ---------- what is there ----------
const sentinelExists = (await accountNear(SENTINEL)) !== null;
const ownerNear = await accountNear(dep.root);
const [balance, ownerUsdc, res] = await Promise.all([view(M, "get_balance", { trader: SENTINEL }).then(BigInt), view(U, "ft_balance_of", { account_id: dep.root }).then(BigInt), view(M, "get_resolution")]);
const shortfall = FUND > balance ? FUND - balance : 0n;
const fund = fundingOf(res.challenge_bond_micro);
const window0 = res.dispute_tiers?.[0];
console.log(`network ${NET}; market ${M}; owner ${dep.root} holds ${fmt(ownerUsdc)} USDC and ${nearFmt(ownerNear ?? 0n)}`);
console.log(`sentinel ${SENTINEL}: ${sentinelExists ? "exists" : `to create with ${nearFmt(GAS_NEAR)}`}; market balance ${fmt(balance)}, target ${fmt(FUND)}${shortfall ? `, deposit ${fmt(shortfall)}` : ""}`);
console.log(`the bond: ${fmt(res.challenge_bond_micro)} to challenge; ${window0 ? `the window is ${Number(window0[1]) / 60} minutes below ${fmt(window0[0])} of open interest` : ""}`);
console.log(`funding: a first dispute needs ${fmt(fund.first_dispute_micro)}. If the attacker disputes back with ${fmt(fund.attacker_back_micro)}, the Sentinel's next dispute is ${fmt(fund.third_dispute_micro)} and goes to the council: ${fmt(fund.full_escalation_micro)} in all, held until the council rules. --fund sets how many of those it can carry.`);
console.log(`the signer's caps: ${DAILY_DISPUTES} disputes a day, ${fmt(DAILY_DISPUTE_MICRO)} of bonds a day, ${fmt(MAX_DISPUTE_BOND_MICRO)} in one (SIGNER_DAILY_DISPUTES, SIGNER_DAILY_DISPUTE_MICRO, SIGNER_MAX_DISPUTE_BOND_MICRO)`);
if (FUND < BigInt(fund.first_dispute_micro)) console.log(`note: --fund ${fmt(FUND)} is below a first dispute: the Sentinel could not act`);
else if (FUND < BigInt(fund.full_escalation_micro)) console.log(`note: --fund ${fmt(FUND)} covers a first dispute but not a full escalation: an attacker who disputes back would win`);
if (BigInt(fund.third_dispute_micro) > MAX_DISPUTE_BOND_MICRO) console.log(`note: the third round's ${fmt(fund.third_dispute_micro)} bond is over the signer's bond cap: set SIGNER_MAX_DISPUTE_BOND_MICRO`);
if (shortfall > ownerUsdc) { console.log(`the owner holds ${fmt(ownerUsdc)} USDC and this needs ${fmt(shortfall)}: add USDC to ${dep.root} first, then run this again`); process.exit(2); }
if (!APPLY) { console.log(`plan only: nothing was changed. To do it: ${MAIN ? "CONFIRM_MAINNET=yes " : ""}node scripts/mainnet/sentinel.mjs apply --fund ${Number(FUND) / 1e6}${MAIN ? "" : " --network testnet"}`); process.exit(0); }

// ---------- the owner, only now ----------
const ownerSecret = MAIN ? dotEnv().NEAR_DEPLOYER_PRIVATE_KEY : JSON.parse(fs.readFileSync(path.join(ROOT, ".apex-test/judge-testnet.json"), "utf8")).key;
if (!ownerSecret) throw new Error("the owner's key is not available");
const ownerKey = KeyPair.fromString(ownerSecret);
if (!(await keysOf(dep.root)).some((k) => k.public_key === ownerKey.getPublicKey().toString())) throw new Error(`the owner's key is not on ${dep.root}`);
const owner = new Account(dep.root, provider, new KeyPairSigner(ownerKey));

// ---------- 1. the account, with a recovery key ----------
fs.mkdirSync(KS, { recursive: true, mode: 0o700 });
const fullFile = path.join(OUT, "sentinel-key.json");
let full = fs.existsSync(fullFile) ? JSON.parse(fs.readFileSync(fullFile, "utf8")) : null;
if (!full) {
  const kp = KeyPair.fromRandom("ed25519");
  full = { note: "full-access key of the Sentinel, for recovery only: the hosted signer never gets it", accountId: SENTINEL, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString(), created_at: new Date().toISOString() };
  writeKeyFile(fullFile, full);
}
if (!sentinelExists) {
  const r = await owner.createSubAccount({ accountOrPrefix: "sentinel", publicKey: full.publicKey, nearToTransfer: GAS_NEAR });
  const tx = r?.transaction_outcome?.id || r?.transaction?.hash || null;
  txs.push({ tag: `create ${SENTINEL}`, method: "create_account", tx, link: tx ? link(tx) : null });
  console.log(`ok  created ${SENTINEL} with ${nearFmt(GAS_NEAR)}${tx ? `: tx ${tx}` : ""}`);
} else console.log(`ok  ${SENTINEL} exists`);

// ---------- 2. its dispute key ----------
const { rec: key } = operatorKey(KS, "sentinel", { accountId: SENTINEL, receiverId: M, methods: OPERATOR_METHODS.sentinel });
if ((await keysOf(SENTINEL)).some((k) => k.public_key === key.publicKey)) console.log(`ok  sentinel key ${key.publicKey}: already on ${SENTINEL}`);
else {
  const acct = new Account(SENTINEL, provider, new KeyPairSigner(KeyPair.fromString(full.privateKey)));
  await acct.addFunctionCallAccessKey({ publicKey: key.publicKey, contractId: M, methodNames: OPERATOR_METHODS.sentinel, allowance: GAS_NEAR * 8n / 10n });
  console.log(`ok  sentinel key ${key.publicKey}: added on ${SENTINEL} (${OPERATOR_METHODS.sentinel.join(", ")})`);
}

// ---------- read the key back from the chain: exactly dispute, on the market ----------
let granted = null;
for (let i = 0; i < 8 && !granted; i++) {
  granted = (await keysOf(SENTINEL)).find((k) => k.public_key === key.publicKey) ?? null;
  if (!granted) await new Promise((r) => setTimeout(r, 1500));
}
if (!granted) throw new Error(`${key.publicKey} is not on ${SENTINEL}`);
const wrong = checkPermission(granted.access_key, M, OPERATOR_METHODS.sentinel);
if (wrong) throw new Error(`the key on ${SENTINEL} is not what it should be: ${wrong}`);
console.log(`ok  read back: ${key.publicKey} on ${SENTINEL} may call only ${granted.access_key.permission.FunctionCall.method_names.join(", ")} on ${granted.access_key.permission.FunctionCall.receiver_id}`);

// ---------- 3. its bonds ----------
if (shortfall > 0n) {
  const r = await owner.callFunctionRaw({ contractId: U, methodName: "ft_transfer_call", args: { receiver_id: M, amount: String(shortfall), msg: JSON.stringify({ for: SENTINEL }) }, gas: 100n * TGAS, deposit: 1n });
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  if (r.status && typeof r.status === "object" && "Failure" in r.status) throw new Error(`the deposit failed: ${JSON.stringify(r.status.Failure).slice(0, 300)}`);
  txs.push({ tag: `bonds ${SENTINEL} ${fmt(shortfall)}`, method: "ft_transfer_call", tx, link: link(tx) });
  console.log(`ok  deposited ${fmt(shortfall)} for ${SENTINEL}: tx ${tx}`);
}
const after = BigInt(await view(M, "get_balance", { trader: SENTINEL }, "optimistic"));
if (after < FUND) throw new Error(`the Sentinel holds ${fmt(after)}, expected at least ${fmt(FUND)}`);

// ---------- record ----------
dep.keys = { ...(dep.keys || {}), sentinel_account: SENTINEL, sentinel_public_key: key.publicKey, sentinel_methods: OPERATOR_METHODS.sentinel };
dep.sentinel = { account: SENTINEL, bond_micro: String(after), at: new Date().toISOString() };
dep.transactions = [...(dep.transactions || []), ...txs];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log(`the Sentinel holds ${fmt(after)} in the market. Recorded in deployments/${NET}.json; private keys in ${path.relative(ROOT, OUT)} (git-ignored)`);
console.log(`next: node scripts/vercel/secrets.mjs --network ${NET} (the hosted signer gets the key), then node scripts/vercel/deploy.mjs`);
