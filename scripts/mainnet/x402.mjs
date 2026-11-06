// The truth API's payments on mainnet: the relayer account, its key, and the public record.
//
//   node scripts/mainnet/x402.mjs --plan                 print what it would do, change nothing, needs no key
//   CONFIRM_MAINNET=yes node scripts/mainnet/x402.mjs    do it
//   options: --near <NEAR the relayer should hold, default 0.1>  --price-micro <per call, default 10000 = $0.01>
//
// How a paid call flows: the agent signs a NEP-366 delegate action of one ft_transfer of USDC to
// the pay-to account. The API, as its own facilitator, wraps it in a transaction signed by the
// relayer, which pays the gas (about 0.0003 NEAR a settlement) and the 1 yoctoNEAR deposit.
//
// Two accounts, on purpose:
//   pay-to   the owner, isitpriced.near: it's already registered on USDC, and revenue lands where
//            no hot key can reach it. It needs nothing from this script.
//   relayer  x402.<owner>: a plain sub-account that holds only gas money. NEAR accepts a delegate
//            action only from a full-access key, so this key is full-access, and that is why it
//            sits on its own account: a leak can cost what's left of the gas and nothing else.
//
// Signed by the owner: NEAR_DEPLOYER_PRIVATE_KEY from .env, read only after CONFIRM_MAINNET=yes.
// Idempotent: every step is checked on chain first, and a run tops the relayer up to --near, so the
// same command refills it. The key goes to the git-ignored .apex-test/mainnet/x402-relayer-key.json
// before its public half is used. Nothing secret is printed. Then the hosted runtime needs it:
// node scripts/vercel/secrets.mjs --network mainnet, and a deploy. The public values go to
// deployments/mainnet.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEAR = 10n ** 24n;
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
const OWNER_RESERVE = NEAR / 20n; // the owner keeps 0.05 NEAR free for its own transactions
export const SETTLEMENT_NEAR = 0.0003; // measured: tx 9NTBY2oVBVQGzcV2wcQ4ZQyNmLb3C1sCBKJhtqG492RX burnt 0.000289 NEAR
export const RELAYER_RPC = "https://rpc.fastnear.com";

export const nearFmt = (y) => `${(Number(y / 10n ** 21n) / 1000).toFixed(3)} NEAR`;
export const toYocto = (n) => BigInt(Math.round(Number(n) * 1000)) * NEAR / 1000n;

/** A fresh relayer key, written by the caller's writer before anything uses it. */
function newKey(accountId, KeyPair) {
  const kp = KeyPair.fromRandom("ed25519");
  return { note: "full-access key of the x402 relayer: it holds gas money only. The hosted API gets it as X402_RELAYER_PRIVATE_KEY.", accountId, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString(), created_at: new Date().toISOString() };
}

/**
 * The whole job, on an abstract chain, so it runs in tests with no network.
 * @param {object} o
 * @param {object} o.dep deployments/mainnet.json, updated in place when applying
 * @param {{ account: (id: string) => Promise<{ amount: bigint, storage: bigint }|null>, registered: (id: string) => Promise<boolean>,
 *   keyOn: (id: string, publicKey: string) => Promise<boolean>, create: (publicKey: string, yocto: bigint) => Promise<string|null>,
 *   topUp: (id: string, yocto: bigint) => Promise<string|null> }} o.chain
 * @param {{ read: () => object|null, write: (rec: object) => void, make: (accountId: string) => object, where: string }} o.keys
 * @param {bigint} o.target what the relayer should hold
 * @param {number} o.priceMicro
 * @param {boolean} o.apply false prints the plan and changes nothing
 * @param {(m: string) => void} [o.log]
 * @returns {Promise<{ ok: boolean, changed: boolean }>}
 */
export async function runX402({ dep, chain, keys, target, priceMicro, apply, log = console.log }) {
  const payTo = dep.root;
  const relayer = `x402.${dep.root}`;
  const key = keys.read();
  if (key && key.accountId !== relayer) throw new Error(`${keys.where} is for ${key.accountId}, not ${relayer}`);

  // ---------- what is there ----------
  const [owner, onChain, registered] = await Promise.all([chain.account(dep.root), chain.account(relayer), chain.registered(payTo)]);
  if (!owner) throw new Error(`${dep.root} does not exist`);
  const need = onChain ? (onChain.amount < target ? target - onChain.amount : 0n) : target;
  const free = owner.amount - owner.storage * STORAGE_YOCTO_PER_BYTE;
  log(`pay-to ${payTo}: ${registered ? "registered on USDC, ready to receive" : "NOT registered on USDC"}`);
  log(`relayer ${relayer}: ${onChain ? `exists with ${nearFmt(onChain.amount)}` : "to create"}; target ${nearFmt(target)}${need ? `, send ${nearFmt(need)}` : ", nothing to send"}`);
  log(`key: ${key ? `${key.publicKey} in ${keys.where}` : `a new one, written to ${keys.where}`}`);
  log(`owner ${dep.root}: ${nearFmt(free)} free of storage; price $${(priceMicro / 1e6).toFixed(2)} a call; ${nearFmt(target)} pays for about ${Math.floor(Number(target / 10n ** 21n) / 1000 / SETTLEMENT_NEAR)} settlements`);

  const refuse = (m) => { log(`stop: ${m}`); return { ok: false, changed: false }; };
  if (!registered) return refuse(`${payTo} can't receive USDC until it is registered (storage_deposit on ${dep.accounts.usdc})`);
  if (onChain && !key) return refuse(`${relayer} exists but ${keys.where} is missing: this machine can't settle with it`);
  if (onChain && key && !(await chain.keyOn(relayer, key.publicKey))) return refuse(`the key in ${keys.where} is not on ${relayer}`);
  if (need + OWNER_RESERVE > free) return refuse(`the owner would keep less than ${nearFmt(OWNER_RESERVE)}: add NEAR to ${dep.root} or lower --near`);
  if (!apply) { log("plan only: nothing changed"); return { ok: true, changed: false }; }

  // ---------- the key, then the account ----------
  let rec = key;
  if (!rec) { rec = keys.make(relayer); keys.write(rec); log(`ok  key ${rec.publicKey} written`); }
  const txs = [];
  const note = (tag, method, tx) => { txs.push({ tag, method, tx, link: tx ? `https://nearblocks.io/txns/${tx}` : null }); };
  if (!onChain) {
    const tx = await chain.create(rec.publicKey, target);
    note(`create ${relayer}`, "create_account", tx);
    log(`ok  created ${relayer} with ${nearFmt(target)}${tx ? `: tx ${tx}` : ""}`);
  } else if (need > 0n) {
    const tx = await chain.topUp(relayer, need);
    note(`top up ${relayer}`, "transfer", tx);
    log(`ok  sent ${relayer} ${nearFmt(need)}${tx ? `: tx ${tx}` : ""}`);
  } else log(`ok  ${relayer} holds enough`);

  // ---------- read back and record ----------
  const after = await chain.account(relayer);
  if (!after) throw new Error(`${relayer} is not on chain after creating it`);
  if (!(await chain.keyOn(relayer, rec.publicKey))) throw new Error(`${rec.publicKey} is not on ${relayer}`);
  dep.keys = { ...(dep.keys || {}), x402_relayer_public_key: rec.publicKey };
  dep.x402 = { protocol: "x402 v2, NEAR exact", facilitator: "in-process: @fastnear/x402/facilitator inside the API function", pay_to: payTo, relayer, price_micro: priceMicro, rpc: RELAYER_RPC, at: new Date().toISOString() };
  dep.transactions = [...(dep.transactions || []), ...txs];
  log(`the relayer holds ${nearFmt(after.amount)}. Public values recorded; the private key stays in ${keys.where} (git-ignored)`);
  log("next: node scripts/vercel/secrets.mjs --network mainnet, then node scripts/vercel/deploy.mjs");
  return { ok: true, changed: true };
}

// ---------- the command ----------
async function main() {
  const { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } = await import("near-api-js");
  const { writeKeyFile } = await import("../../services/ai/src/keystore.js");
  const { keyOnChain } = await import("../../services/ai/src/house.js");
  const { dotEnv } = await import("../vercel/env.mjs");
  const { Rpc } = await import("../../services/api/src/rpc.mjs");

  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const PLAN = process.argv.includes("--plan");
  if (!PLAN && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it, or use --plan."); process.exit(1); }
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const depFile = path.join(ROOT, "deployments/mainnet.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  if (dep.network !== "mainnet") throw new Error("deployments/mainnet.json is not a mainnet deployment");
  const target = toYocto(arg("--near", "0.1"));
  const priceMicro = Number(arg("--price-micro", dep.x402?.price_micro ?? 10_000));
  if (!Number.isInteger(priceMicro) || priceMicro < 1 || priceMicro > 1_000_000) throw new Error("--price-micro is 1..1000000 (at most $1 a call)");

  const urls = (process.env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.drpc.org,https://free.rpc.fastnear.com").split(",");
  const provider = new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
  const relayerId = `x402.${dep.root}`;
  const rpc = new Rpc(urls, { timeoutMs: 8000 }); // reads: a missing account is an answer here, not an error to log

  // the owner's key is read only on a real run, and only here
  let ownerAcct = null;
  if (!PLAN) {
    const secret = dotEnv().NEAR_DEPLOYER_PRIVATE_KEY;
    if (!secret) throw new Error("NEAR_DEPLOYER_PRIVATE_KEY is not in .env");
    const ownerKey = KeyPair.fromString(secret);
    if (!(await keyOnChain(provider, dep.root, ownerKey.getPublicKey().toString()))) throw new Error(`the owner's key is not on ${dep.root}`);
    ownerAcct = new Account(dep.root, provider, new KeyPairSigner(ownerKey));
  }

  const chain = {
    async account(id) {
      try { const a = await rpc.call("query", { request_type: "view_account", finality: "final", account_id: id }); return { amount: BigInt(a.amount), storage: BigInt(a.storage_usage) }; }
      catch (e) { if (/does not exist|UNKNOWN_ACCOUNT/i.test(e.message)) return null; throw e; }
    },
    registered: async (id) => Boolean(await provider.callFunction({ contractId: dep.accounts.usdc, method: "storage_balance_of", args: { account_id: id }, blockQuery: { finality: "final" } })),
    keyOn: (id, pk) => keyOnChain(provider, id, pk),
    async create(publicKey, yocto) {
      const r = await ownerAcct.createSubAccount({ accountOrPrefix: "x402", publicKey, nearToTransfer: yocto });
      return r?.transaction_outcome?.id || r?.transaction?.hash || null;
    },
    async topUp(id, yocto) {
      const r = await ownerAcct.transfer({ receiverId: id, amount: yocto });
      return r?.transaction_outcome?.id || r?.transaction?.hash || null;
    },
  };
  const file = path.join(ROOT, ".apex-test/mainnet/x402-relayer-key.json");
  const keys = {
    where: path.relative(ROOT, file).replaceAll("\\", "/"),
    read: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null),
    write: (rec) => writeKeyFile(file, rec),
    make: (id) => newKey(id, KeyPair),
  };
  console.log(`relayer ${relayerId} on mainnet, market ${dep.accounts.market}, USDC ${dep.accounts.usdc}`);
  const r = await runX402({ dep, chain, keys, target, priceMicro, apply: !PLAN });
  if (r.changed) fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
  process.exit(r.ok ? 0 : 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
