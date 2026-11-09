// The owner sends a little NEAR and USDC to one outside account, on the record: the founder's own wallet
// for the dispute drill (its gas, and the $2 bond it objects with), or a tester the founder pays to try it.
//
//   node scripts/mainnet/send.mjs --to <account> --near 0.1 --usdc 2 --why "<what it is for>"            read only: the plan
//   CONFIRM_MAINNET=yes node scripts/mainnet/send.mjs --to <account> --near 0.1 --usdc 2 --why "<...>" --apply   send it
//
// The rules are in send-plan.mjs: never to the owner's own accounts, at most 1 NEAR and $10 a send, the owner
// keeps 0.5 NEAR spare for the keeper's gas, and a reason is required. With --apply it signs as the owner
// (NEAR_DEPLOYER_PRIVATE_KEY from .env, read only then, and only that line). In order: the recipient's USDC
// storage registration if it has none (registration only, the contract's minimum); the NEAR; the USDC
// (ft_transfer, with the reason as its memo). Every transaction and the reason go to deployments/mainnet.json
// under "sent", so the README can say exactly who was funded by whom. Nothing secret is printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { sendPlan } from "./send-plan.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes("--apply");
const TO = String(arg("--to", "")).trim().toLowerCase();
const NEAR_AMT = Number(arg("--near", "0"));
const USDC_AMT = Number(arg("--usdc", "0"));
const WHY = String(arg("--why", "") ?? "").trim();
if (!TO) { console.error("usage: send.mjs --to <account> [--near <NEAR>] [--usdc <USD>] --why \"<what it is for>\" [--apply]"); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== "mainnet") throw new Error("deployments/mainnet.json is not a mainnet deployment");
const OWNER = dep.root, U = dep.accounts.usdc;
const RPCS = (process.env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.drpc.org,https://free.rpc.fastnear.com").split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });
const account = (id) => provider.query({ request_type: "view_account", finality: "final", account_id: id }).catch(() => null);
const spare = (a) => Number((BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n) / 10n ** 20n) / 1e4;
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;
const link = (tx) => `https://nearblocks.io/txns/${tx}`;
const TGAS = 10n ** 12n;

// ---------- what the chain says ----------
const [ownerAcct, toAcct] = await Promise.all([account(OWNER), account(TO)]);
if (!ownerAcct) throw new Error(`could not read ${OWNER}`);
const ownerUsdc = BigInt(await view(U, "ft_balance_of", { account_id: OWNER }));
const registered = toAcct ? (await view(U, "storage_balance_of", { account_id: TO })) !== null : false;
const bounds = await view(U, "storage_balance_bounds", {});
const storageYocto = BigInt(bounds?.min ?? "1250000000000000000000");
const storageNear = Number(storageYocto / 10n ** 18n) / 1e6;
console.log(`owner ${OWNER}: ${spare(ownerAcct).toFixed(3)} NEAR spare, ${fmt(ownerUsdc)} USDC`);
console.log(`recipient ${TO}: ${toAcct ? `${Math.max(0, spare(toAcct)).toFixed(3)} NEAR spare, ${registered ? "registered for USDC" : "not registered for USDC yet"}` : "does not exist"}`);

const plan = sendPlan({ to: TO, near: NEAR_AMT, usdc: USDC_AMT, why: WHY, owner: OWNER, usdcContract: U, recipientExists: Boolean(toAcct), registered, storageNear, ownerSpareNear: spare(ownerAcct), ownerUsdcMicro: ownerUsdc });
if (!plan.ok) { console.error(`refused: ${plan.why}`); process.exit(2); }
console.log(`plan: ${plan.register ? `register ${TO} for USDC (${storageNear} NEAR), ` : ""}${NEAR_AMT > 0 ? `send ${NEAR_AMT} NEAR, ` : ""}${USDC_AMT > 0 ? `send ${fmt(plan.usdcMicro)} USDC, ` : ""}keeping ${plan.spareAfter.toFixed(3)} NEAR spare on the owner`);
console.log(`reason, kept on chain as the USDC memo and in deployments/mainnet.json: ${WHY}`);
if (!APPLY) { console.log("nothing sent. --apply, with CONFIRM_MAINNET=yes, sends it."); process.exit(0); }
if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }

// ---------- sign ----------
const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^NEAR_DEPLOYER_PRIVATE_KEY=(.*)$/.exec(l.trim())).find(Boolean);
if (!line) throw new Error("the owner's key is not in .env");
const ownerKey = KeyPair.fromString(line[1].trim());
const keys = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: OWNER })).keys;
if (!keys.some((k) => k.public_key === ownerKey.getPublicKey().toString())) throw new Error(`the key in .env is not on ${OWNER}`);
const owner = new Account(OWNER, provider, new KeyPairSigner(ownerKey));

/** A failure in any receipt, not only the last status. */
function landed(r, what) {
  const bad = (s) => (s && typeof s === "object" && "Failure" in s ? s.Failure : null);
  const f = bad(r.status) ?? (r.receipts_outcome || []).map((x) => bad(x.outcome?.status)).find(Boolean);
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  if (f) throw new Error(`${what} failed (tx ${tx}): ${JSON.stringify(f).slice(0, 300)}`);
  console.log(`ok  ${what}: ${link(tx)}`);
  return tx;
}

const txs = [];
if (plan.register) txs.push({ step: "usdc storage", tx: landed(await owner.callFunctionRaw({ contractId: U, methodName: "storage_deposit", args: { account_id: TO, registration_only: true }, gas: 30n * TGAS, deposit: storageYocto }), `registered ${TO} for USDC`) });
if (plan.nearYocto > 0n) txs.push({ step: "near", tx: landed(await owner.transfer({ receiverId: TO, amount: plan.nearYocto }), `sent ${NEAR_AMT} NEAR`) });
if (plan.usdcMicro > 0n) txs.push({ step: "usdc", tx: landed(await owner.callFunctionRaw({ contractId: U, methodName: "ft_transfer", args: { receiver_id: TO, amount: String(plan.usdcMicro), memo: WHY.slice(0, 200) }, gas: 30n * TGAS, deposit: 1n }), `sent ${fmt(plan.usdcMicro)} USDC`) });

const usdcAfter = BigInt(await view(U, "ft_balance_of", { account_id: TO }));
console.log(`${TO} now holds ${fmt(usdcAfter)} USDC`);
dep.sent = [...(dep.sent || []), { at: new Date().toISOString(), from: OWNER, to: TO, near: NEAR_AMT, usdc: USDC_AMT, why: WHY, txs }];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log("recorded in deployments/mainnet.json under \"sent\"");
