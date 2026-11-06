// Free-bet keys issued before claim_lane left the lane's method list still allow it. This re-adds each
// of them with the same public key, the same allowance and the same market, minus claim_lane, so a
// free bet's winnings stay in the market as score. The visitor's browser keeps its key and its
// identity (lane:<key>): only the key's nonce moves, and the browser re-reads it on its next bet.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/lane-rekey.mjs --plan   list them, change nothing
//   CONFIRM_MAINNET=yes node scripts/mainnet/lane-rekey.mjs          re-add them, ten to a transaction
//   node scripts/mainnet/lane-rekey.mjs --network testnet [--plan]
//
// Signed by the lane's own admin key (.apex-test/<mainnet|vercel>/lane-key.json), never the owner's.
// Each transaction deletes and re-adds keys in one go, so no key is ever left out. Prints public keys
// and transaction hashes only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, PublicKey, actions } from "near-api-js";
import { loadConfig } from "../../services/api/src/config.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const NET = arg("--network", "mainnet");
const MAIN = NET === "mainnet";
if (MAIN && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const PLAN = process.argv.includes("--plan");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `deployments/${NET}.json`), "utf8"));
const laneKey = JSON.parse(fs.readFileSync(path.join(ROOT, MAIN ? ".apex-test/mainnet/lane-key.json" : ".apex-test/vercel/lane-key.json"), "utf8"));
const LANE = dep.accounts.lane, M = dep.accounts.market;
if (laneKey.accountId && laneKey.accountId !== LANE) throw new Error(`the lane key is for ${laneKey.accountId}, not ${LANE}`);
const METHODS = loadConfig({ NEAR_NETWORK: NET }).config.lane.methods;
if (METHODS.includes("claim_lane")) throw new Error("the API's lane methods still include claim_lane");
const RPCS = MAIN ? ["https://rpc.fastnear.com", "https://near.drpc.org", "https://free.rpc.fastnear.com"] : ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const admin = new Account(LANE, provider, new KeyPairSigner(KeyPair.fromString(laneKey.privateKey)));

const list = async (finality = "final") => (await provider.query({ request_type: "view_access_key_list", finality, account_id: LANE })).keys;
const stale = (await list()).filter((k) => k.access_key.permission?.FunctionCall?.method_names?.includes("claim_lane"));
console.log(`${LANE}: ${stale.length} free-bet key(s) still allow claim_lane; they become ${METHODS.join(", ")}`);
for (const k of stale) console.log(`  ${k.public_key} allowance ${k.access_key.permission.FunctionCall.allowance ?? "unlimited"}`);
if (PLAN || !stale.length) process.exit(0);

for (let i = 0; i < stale.length; i += 10) {
  const part = stale.slice(i, i + 10);
  const acts = part.flatMap((k) => {
    const fc = k.access_key.permission.FunctionCall;
    if (fc.receiver_id !== M) throw new Error(`${k.public_key} is for ${fc.receiver_id}, not the market`);
    const pk = PublicKey.fromString(k.public_key);
    return [actions.deleteKey(pk), actions.addFunctionCallAccessKey(pk, M, METHODS, fc.allowance === null || fc.allowance === undefined ? undefined : BigInt(fc.allowance))];
  });
  const r = await admin.signAndSendTransaction({ receiverId: LANE, actions: acts });
  const failed = r.status && typeof r.status === "object" && "Failure" in r.status;
  console.log(`${failed ? "FAILED" : "ok"}  ${part.length} key(s): tx ${r.transaction_outcome?.id || r.transaction?.hash}`);
  if (failed) throw new Error(JSON.stringify(r.status.Failure).slice(0, 300));
}
// read back at optimistic finality: the last batch is executed but may not be final yet
const now = await list("optimistic");
const left = now.filter((k) => k.access_key.permission?.FunctionCall?.method_names?.includes("claim_lane"));
const back = now.filter((k) => stale.some((s) => s.public_key === k.public_key));
console.log(`${back.length} of ${stale.length} keys are back without claim_lane; ${left.length} key(s) still allow it`);
process.exit(left.length ? 1 : 0);
