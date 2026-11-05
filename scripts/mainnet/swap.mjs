// Converts NEAR on the owner (isitpriced.near) into native USDC on Ref Finance, for when the
// owner was funded with NEAR instead of USDC.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/swap.mjs --near 12.5 [--quote]
//
// Steps, signed by the owner with NEAR_DEPLOYER_PRIVATE_KEY: register on wrap.near if needed;
// wrap the NEAR (near_deposit); quote pool 4512 (wNEAR/USDC, Ref v2) with get_return; swap with
// ft_transfer_call carrying one action and min_amount_out at 1% under the quote; read back the
// USDC balance. --quote stops after the quote. Records the transactions in deployments/mainnet.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const NEAR_IN = Number(arg("--near", "0"));
if (!(NEAR_IN > 0 && NEAR_IN < 50)) { console.error("give --near <amount>, under 50"); process.exit(1); }
const POOL = 4512, REF = "v2.ref-finance.near", WRAP = "wrap.near", USDC = dep.accounts.usdc;
const YOCTO = 10n ** 24n, TGAS = 10n ** 12n;
const amount = BigInt(Math.round(NEAR_IN * 1000)) * YOCTO / 1000n;

const RPCS = "https://rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.near.org".split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const owner = new Account(dep.root, provider, new KeyPairSigner(KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY)));
const view = (contractId, method, args = {}, finality = "final") => provider.callFunction({ contractId, method, args, blockQuery: { finality } });
const txs = [];
async function call(contractId, methodName, args, deposit, tgas, tag) {
  const r = await owner.callFunctionRaw({ contractId, methodName, args, gas: tgas * TGAS, deposit });
  const tx = r.transaction_outcome?.id;
  const failed = JSON.stringify(r.receipts_outcome?.map((o) => o.outcome.status) || []).includes("Failure") || (r.status && "Failure" in r.status);
  txs.push({ tag, method: methodName, tx, link: `https://nearblocks.io/txns/${tx}` });
  console.log(`${failed ? "FAILED" : "ok"}  ${tag}: tx ${tx}`);
  if (failed) throw new Error(`${tag}: a receipt failed: ${JSON.stringify(r.receipts_outcome.map((o) => o.outcome.status)).slice(0, 400)}`);
  return r;
}

const acct = await provider.query({ request_type: "view_account", finality: "final", account_id: dep.root });
const free = BigInt(acct.amount) - BigInt(acct.storage_usage) * 10n ** 19n;
if (free - amount < 2n * YOCTO) { console.error(`the owner would keep under 2 NEAR (it has ${(Number(free / 10n ** 21n) / 1000).toFixed(3)} free)`); process.exit(1); }
const usdcBefore = BigInt(await view(USDC, "ft_balance_of", { account_id: dep.root }));
const quote = BigInt(await view(REF, "get_return", { pool_id: POOL, token_in: WRAP, amount_in: String(amount), token_out: USDC }));
const minOut = quote * 99n / 100n;
const pool = await view(REF, "get_pool", { pool_id: POOL });
if (!(pool.token_account_ids.includes(WRAP) && pool.token_account_ids.includes(USDC))) throw new Error(`pool ${POOL} is not wNEAR/USDC: ${pool.token_account_ids}`);
console.log(`quote: ${NEAR_IN} NEAR -> ${(Number(quote) / 1e6).toFixed(4)} USDC on Ref pool ${POOL} (fee ${pool.total_fee / 100}%), at least ${(Number(minOut) / 1e6).toFixed(4)}; USDC now ${(Number(usdcBefore) / 1e6).toFixed(2)}`);
if (process.argv.includes("--quote")) process.exit(0);

if (!(await view(WRAP, "storage_balance_of", { account_id: dep.root }))) await call(WRAP, "storage_deposit", { account_id: dep.root, registration_only: true }, 1_250_000_000_000_000_000_000n, 30n, "register on wrap.near");
await call(WRAP, "near_deposit", {}, amount, 30n, `wrap ${NEAR_IN} NEAR`);
const msg = JSON.stringify({ force: 0, actions: [{ pool_id: POOL, token_in: WRAP, token_out: USDC, amount_in: String(amount), min_amount_out: String(minOut) }] });
await call(WRAP, "ft_transfer_call", { receiver_id: REF, amount: String(amount), msg }, 1n, 180n, `swap ${NEAR_IN} wNEAR -> USDC`);

let usdcAfter = usdcBefore;
for (let i = 0; i < 15 && usdcAfter === usdcBefore; i++) { await new Promise((r) => setTimeout(r, 1500)); usdcAfter = BigInt(await view(USDC, "ft_balance_of", { account_id: dep.root }, "optimistic")); }
const wleft = BigInt(await view(WRAP, "ft_balance_of", { account_id: dep.root }, "optimistic"));
console.log(`USDC ${(Number(usdcBefore) / 1e6).toFixed(2)} -> ${(Number(usdcAfter) / 1e6).toFixed(4)}; wNEAR left ${(Number(wleft / 10n ** 21n) / 1000).toFixed(3)}`);
dep.swaps = [...(dep.swaps || []), { at: new Date().toISOString(), near_in: NEAR_IN, pool: POOL, quote_micro: String(quote), usdc_received_micro: String(usdcAfter - usdcBefore) }];
dep.transactions = [...(dep.transactions || []), ...txs];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
if (usdcAfter === usdcBefore) { console.error("no USDC arrived yet: check the swap transaction"); process.exit(1); }
