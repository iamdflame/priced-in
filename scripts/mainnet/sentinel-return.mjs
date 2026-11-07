// Moves the Sentinel's spare bonds back into the market's treasury, so money already in the project pays for
// news lines instead of new money. The founder runs this; nothing else does.
//
//   node scripts/mainnet/sentinel-return.mjs                         says what it would do; reads the chain, changes nothing
//   CONFIRM_MAINNET=yes node scripts/mainnet/sentinel-return.mjs --apply
//   options: --keep <USD the Sentinel keeps in the market, default 2>
//
// Why $2 is enough today: a first dispute costs twice the $1 challenge bond. An attacker who disputes back
// must post $4, more than any line's pot holds today, so a counter is a sure loss for them. A full escalation
// ($2 + $8, to the council) needs $10; raise it again with sentinel.mjs apply --fund 10 when lines grow.
//
// Signed by the Sentinel's recovery key (.apex-test/mainnet/sentinel-key.json, git-ignored; the hosted signer
// never has it), read only after CONFIRM_MAINNET=yes. In order, each checked on chain first:
//   0. the Sentinel has NEAR for gas: below 0.25 NEAR the owner tops it up to 0.3 (NEAR_DEPLOYER_PRIVATE_KEY)
//   1. the Sentinel is registered with the USDC contract, so it can receive a withdrawal (a storage deposit if not)
//   2. withdraw: the Sentinel's market balance above --keep comes out to its account
//   3. ft_transfer_call back to the market with {"treasury":true}: the treasury grows by the same amount
// Read back: the Sentinel's market balance is --keep, and the treasury grew. Nothing secret is printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes("--apply");
if (APPLY && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== "mainnet") throw new Error("deployments/mainnet.json is not a mainnet deployment");
const M = dep.accounts.market, U = dep.accounts.usdc, SENTINEL = `sentinel.${dep.root}`;
const usd = (x) => BigInt(Math.round(Number(x) * 1e6));
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;
const KEEP = usd(arg("--keep", "2"));
const TGAS = 10n ** 12n, YOCTO1 = 1n, STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, the USDC contract's registration
const NEAR = 10n ** 24n, MIN_GAS_NEAR = NEAR / 4n, TOP_TO = NEAR * 3n / 10n;
const nearFmt = (y) => `${(Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3)} NEAR`;
const dotEnv = () => Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const RPCS = ["https://rpc.fastnear.com", "https://near.drpc.org", "https://free.rpc.fastnear.com"];
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });
const link = (tx) => `https://nearblocks.io/txns/${tx}`;
// what an account can spend: its balance less what its own storage locks
const spendable = async (id) => { const a = await provider.query({ request_type: "view_account", finality: "final", account_id: id }); return BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n; };
const settle = () => new Promise((r) => setTimeout(r, 2500));

const [balance, stats, registered, gasNear] = await Promise.all([
  view(M, "get_balance", { trader: SENTINEL }).then(BigInt),
  view(M, "stats"),
  view(U, "storage_balance_of", { account_id: SENTINEL }),
  spendable(SENTINEL),
]);
const out = balance > KEEP ? balance - KEEP : 0n;
console.log(`${SENTINEL}: ${fmt(balance)} in the market; keep ${fmt(KEEP)}, return ${fmt(out)} to the treasury`);
console.log(`the Sentinel has ${nearFmt(gasNear)} for gas${gasNear < MIN_GAS_NEAR ? `: the owner tops it up to ${nearFmt(TOP_TO)} first` : ""}`);
console.log(`treasury ${fmt(stats.treasury_micro)} now${out ? `, ${fmt(BigInt(stats.treasury_micro) + out)} after` : ""}; ${registered ? "the Sentinel can receive USDC" : "the Sentinel needs a USDC registration first (0.00125 NEAR, from its own account)"}`);
if (KEEP < 2_000_000n) console.log("note: under $2 the Sentinel can't afford a first dispute and won't act");
if (out === 0n) { console.log("nothing to return."); process.exit(0); }
if (!APPLY) { console.log("plan only: nothing was changed. To do it: CONFIRM_MAINNET=yes node scripts/mainnet/sentinel-return.mjs --apply" + (KEEP !== 2_000_000n ? ` --keep ${Number(KEEP) / 1e6}` : "")); process.exit(0); }

// ---------- the Sentinel's recovery key, only now ----------
const keyFile = path.join(ROOT, ".apex-test/mainnet/sentinel-key.json");
if (!fs.existsSync(keyFile)) throw new Error(`${path.relative(ROOT, keyFile)} is missing: it was written by sentinel.mjs apply on this machine`);
const full = JSON.parse(fs.readFileSync(keyFile, "utf8"));
if (full.accountId !== SENTINEL) throw new Error(`that key is for ${full.accountId}, not ${SENTINEL}`);
const kp = KeyPair.fromString(full.privateKey);
const keys = (await provider.query({ request_type: "view_access_key_list", finality: "optimistic", account_id: SENTINEL })).keys || [];
const onChain = keys.find((k) => k.public_key === kp.getPublicKey().toString());
if (!onChain || onChain.access_key.permission !== "FullAccess") throw new Error(`the recovery key is not a full-access key on ${SENTINEL}`);
const acct = new Account(SENTINEL, provider, new KeyPairSigner(kp));
const txs = [];
const call = async (contractId, methodName, args, deposit, tag, tgas = 100n) => {
  const r = await acct.callFunctionRaw({ contractId, methodName, args, gas: tgas * TGAS, deposit });
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  if (r.status && typeof r.status === "object" && "Failure" in r.status) throw new Error(`${tag} failed: ${JSON.stringify(r.status.Failure).slice(0, 300)} (tx ${tx})`);
  txs.push({ tag, method: methodName, tx, link: link(tx) });
  console.log(`ok  ${tag}: tx ${tx}`);
  return r;
};

// ---------- 0. gas for the Sentinel, from the owner ----------
if (gasNear < MIN_GAS_NEAR) {
  const ownerSecret = dotEnv().NEAR_DEPLOYER_PRIVATE_KEY;
  if (!ownerSecret) throw new Error("NEAR_DEPLOYER_PRIVATE_KEY is not in .env");
  const ownerKey = KeyPair.fromString(ownerSecret);
  const ownerKeys = (await provider.query({ request_type: "view_access_key_list", finality: "optimistic", account_id: dep.root })).keys || [];
  if (!ownerKeys.some((k) => k.public_key === ownerKey.getPublicKey().toString())) throw new Error(`the owner's key is not on ${dep.root}`);
  const owner = new Account(dep.root, provider, new KeyPairSigner(ownerKey));
  const amount = TOP_TO - gasNear;
  const r = await owner.transfer({ receiverId: SENTINEL, amount });
  const tx = r?.transaction_outcome?.id || r?.transaction?.hash || null;
  if (tx) txs.push({ tag: `gas ${nearFmt(amount)}`, method: "transfer", tx, link: link(tx) });
  console.log(`ok  the owner sent ${nearFmt(amount)} to ${SENTINEL} for gas${tx ? `: tx ${tx}` : ""}`);
  for (let i = 0; i < 8 && (await spendable(SENTINEL)) < MIN_GAS_NEAR; i++) await settle();
}

// ---------- 1. the USDC registration ----------
if (!registered) await call(U, "storage_deposit", { account_id: SENTINEL, registration_only: true }, STORAGE, "USDC registration", 30n);

// ---------- 2. out of the market ----------
const usdcBefore = BigInt(await view(U, "ft_balance_of", { account_id: SENTINEL }));
await call(M, "withdraw", { amount_micro: String(out) }, 0n, `withdraw ${fmt(out)}`);
let usdcAfter = usdcBefore;
for (let i = 0; i < 10 && usdcAfter < usdcBefore + out; i++) { await settle(); usdcAfter = BigInt(await view(U, "ft_balance_of", { account_id: SENTINEL })); }
if (usdcAfter < usdcBefore + out) throw new Error(`the withdrawal hasn't arrived (USDC on ${SENTINEL}: ${fmt(usdcAfter)}); the market refunds a failed one to its balance. Run this again to finish.`);

// ---------- 3. into the treasury ----------
const treasuryBefore = BigInt((await view(M, "stats")).treasury_micro);
await call(U, "ft_transfer_call", { receiver_id: M, amount: String(out), msg: JSON.stringify({ treasury: true }) }, YOCTO1, `treasury +${fmt(out)}`);

// ---------- read back ----------
let after = await view(M, "stats"), bal = BigInt(await view(M, "get_balance", { trader: SENTINEL }));
for (let i = 0; i < 6 && BigInt(after.treasury_micro) < treasuryBefore + out; i++) { await settle(); after = await view(M, "stats"); }
console.log(`read back: the Sentinel holds ${fmt(bal)} in the market; the treasury is ${fmt(after.treasury_micro)} (was ${fmt(treasuryBefore)})`);
if (BigInt(after.treasury_micro) < treasuryBefore + out) throw new Error("the treasury didn't grow by the amount: look at the transactions above");

dep.sentinel = { ...(dep.sentinel || {}), bond_micro: String(bal), returned: [...(dep.sentinel?.returned || []), { at: new Date().toISOString(), amount_micro: String(out), txs }] };
dep.transactions = [...(dep.transactions || []), ...txs];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log("recorded in deployments/mainnet.json. Next: node scripts/mainnet/news-funding.mjs (see .apex/YOUR-STEPS.md)");
