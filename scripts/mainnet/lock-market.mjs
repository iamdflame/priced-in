// Locks the mainnet market: deletes every access key on market.isitpriced.near, so no key can replace
// its code or sign as the account. There is no way back.
//
//   node scripts/mainnet/lock-market.mjs                 read only: what is there, what would go, what stays
//   CONFIRM_MAINNET=yes CONFIRM_LOCK=yes node scripts/mainnet/lock-market.mjs --apply
//
// What it ends, for good:
//   - replacing the code. The contract has no upgrade method: the only way to change its code is a
//     DeployContract signed with a key of the market account. A fix or a new feature after this is a
//     new contract at a new address; this one keeps its claims and its money.
//   - signing as the market. A key there could send the market's USDC straight out through the USDC
//     contract, and call the market's own #[private] callbacks.
//   - taking the account's NEAR back. The contract never sends NEAR, so what it holds stays there.
//   - reaching a claim's reserve other than by settling the claim: it returns to the treasury only
//     when the claim settles.
// What it leaves exactly as it is: the owner and every owner method. The owner signs from its own
// account, never as the market: pause, set_limits, set_fee_bps (3% at most), set_resolution,
// register_model, set_operator, council_settle on an escalated claim, and withdraw_treasury, which
// reaches the treasury's own money and nothing a bettor holds. Sending the market NEAR for storage
// needs no key of the market.
//
// It refuses to sign unless the code on chain is the code deployments/mainnet.json records, the market
// answers, and the signing key is a full-access key on the market and on the owner (tools/judge/lib/
// lock.mjs, lockPlan). The key (NEAR_DEPLOYER_PRIVATE_KEY) is read from .env only then. It prints no
// key. The transactions go to deployments/mainnet-lock.json, and check 12 of the judge reads the
// result from the chain.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyState, lockPlan } from "../../tools/judge/lib/lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const APPLY = process.argv.includes("--apply");
const M = dep.accounts.market, OWNER = dep.keys?.owner || dep.root, RECORDED = dep.code?.market?.code_hash;
const RPCS = ["https://free.rpc.fastnear.com", "https://near.lava.build", "https://rpc.mainnet.near.org"];
const OUT = path.join(ROOT, "deployments/mainnet-lock.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      if (j.result && !j.result.error) return j.result;
      last = new Error(JSON.stringify(j.error || j.result.error).slice(0, 160));
    } catch (e) { last = e; }
  }
  throw last;
}
const keysOf = async (id, finality = "final") => (await rpc({ request_type: "view_access_key_list", finality, account_id: id })).keys || [];
const accountOf = (id, finality = "final") => rpc({ request_type: "view_account", finality, account_id: id });
const stats = async (finality = "final") => JSON.parse(Buffer.from((await rpc({ request_type: "call_function", finality, account_id: M, method_name: "stats", args_base64: Buffer.from("{}").toString("base64") })).result).toString("utf8"));
const near = (yocto) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toFixed(3);
const usd = (micro) => `$${(Number(micro) / 1e6).toFixed(2)}`;

// the exit code is set and the process left to end by itself: process.exit with a socket still closing
// trips an assertion in Node on Windows
async function main() {
const [acct, marketKeys, ownerKeys, st] = await Promise.all([accountOf(M), keysOf(M), keysOf(OWNER), stats()]);
const ks = keyState(marketKeys);
console.log(`${M}: code ${acct.code_hash}${acct.code_hash === RECORDED ? " (the recorded code)" : ` (NOT the recorded ${RECORDED})`}, ${near(acct.amount)} NEAR, ${ks.keys} access key${ks.keys === 1 ? "" : "s"} (${ks.full} full access)`);
for (const k of marketKeys) console.log(`  key ${k.public_key}: ${k.access_key.permission === "FullAccess" ? "full access" : "function calls"}${ownerKeys.some((o) => o.public_key === k.public_key) ? `, also a key of ${OWNER}` : ""}`);
console.log(`owner ${OWNER}: ${ownerKeys.filter((k) => k.access_key.permission === "FullAccess").length} full-access key(s) of its own, untouched by a lock`);
console.log(`the market holds: treasury ${usd(st.treasury_micro)}, reserved in open claims ${usd(st.reserved_micro)}, bettors' balances ${usd(st.balances_micro)}${st.paused ? "; it is PAUSED" : ""}`);

const plan = lockPlan({ market: M, owner: OWNER, marketKeys, ownerKeys, codeHash: acct.code_hash, recordedHash: RECORDED });
if (plan.already) { console.log("already locked: the market has no access key. Nothing to do."); return 0; }
console.log(`\na lock deletes ${plan.order.length} key${plan.order.length === 1 ? "" : "s"} from ${M}, and then, for good:`);
console.log("  - the code can't be replaced: a fix or a new version is a new contract at a new address");
console.log("  - nobody can sign as the market: its USDC leaves only through the contract's own methods");
console.log(`  - the ${near(acct.amount)} NEAR in the account stays there: the contract never sends NEAR`);
console.log(`  - the ${usd(st.reserved_micro)} reserved in open claims comes back to the treasury only as each claim settles`);
console.log(`it leaves ${OWNER} and every owner method as they are: pause, limits, fee (3% at most), the judges' keys, escalated claims, and withdraw_treasury (${usd(st.treasury_micro)} now)`);
if (plan.refusals.length) { console.log(`\nit would refuse now:\n${plan.refusals.map((r) => `  - ${r}`).join("\n")}`); return 1; }
if (!APPLY) { console.log("\nnothing changed. To lock: CONFIRM_MAINNET=yes CONFIRM_LOCK=yes node scripts/mainnet/lock-market.mjs --apply"); return 0; }

if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); return 1; }
if (process.env.CONFIRM_LOCK !== "yes") { console.error("Refusing to lock: the code can never be replaced afterwards. Set CONFIRM_LOCK=yes once the owner has said so."); return 1; }
const { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } = await import("near-api-js");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!env.NEAR_DEPLOYER_PRIVATE_KEY) { console.error("NEAR_DEPLOYER_PRIVATE_KEY is not in .env"); return 1; }
const kp = KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY);
const signerPk = kp.getPublicKey().toString();
// read again at the moment of signing, with the key's public half this time
const [acct2, mk2, ok2, st2] = await Promise.all([accountOf(M), keysOf(M), keysOf(OWNER), stats()]);
const go = lockPlan({ market: M, owner: OWNER, marketKeys: mk2, ownerKeys: ok2, codeHash: acct2.code_hash, recordedHash: RECORDED, signerPk });
if (go.already) { console.log("already locked."); return 0; }
if (go.refusals.length) { console.error(`not locking:\n${go.refusals.map((r) => `  - ${r}`).join("\n")}`); return 1; }
if (st2.claims === undefined) { console.error("not locking: the market did not answer stats"); return 1; }

const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url })));
const market = new Account(M, provider, new KeyPairSigner(kp));
const txs = [];
for (const pk of go.order) {
  const r = await market.deleteKey(pk);
  if (r.status && typeof r.status === "object" && "Failure" in r.status) { console.error(`deleting ${pk} failed: ${JSON.stringify(r.status.Failure).slice(0, 200)}`); return 1; }
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  txs.push({ deleted_key: pk, tx, link: `https://nearblocks.io/txns/${tx}` });
  console.log(`deleted ${pk}: ${tx}`);
}

// a fresh write is optimistic before it is final: ask again for a few blocks
let after = await keysOf(M, "optimistic");
for (let i = 0; i < 20 && after.length; i++) { await sleep(1000); after = await keysOf(M, "optimistic"); }
const [acct3, st3] = await Promise.all([accountOf(M, "optimistic"), stats("optimistic")]);
let bad = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "BAD "} ${name}`); if (!ok) bad++; };
check("the market has no access key: its code can't change, and nobody signs as it", after.length === 0);
check("the code hash is unchanged", acct3.code_hash === RECORDED);
check("the market still answers", st3.claims !== undefined);
check(`the owner ${OWNER} still has its own full-access key`, (await keysOf(OWNER, "optimistic")).some((k) => k.public_key === signerPk));
fs.writeFileSync(OUT, JSON.stringify({ note: "The mainnet market's access keys were deleted: no key can replace its code or sign as the account. Public values only.", account: M, code_hash: acct3.code_hash, owner: OWNER, locked_at: new Date().toISOString(), keys_left: after.length, deletions: txs }, null, 1) + "\n");
console.log(`recorded in deployments/mainnet-lock.json. Check it from the chain: npm run judge:quick (check 12).`);
return bad ? 1 : 0;
}
process.exitCode = await main();
setTimeout(() => process.exit(), 3000).unref();
