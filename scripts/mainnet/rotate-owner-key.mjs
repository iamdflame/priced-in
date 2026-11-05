// Replaces the owner's key (NEAR_DEPLOYER_PRIVATE_KEY) on every mainnet account it controls, and
// never leaves an account without a working key.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/rotate-owner-key.mjs
//
// 1. A backup of .env is written (.env.bak-<time>, git-ignored), then the new key is saved in .env
//    as NEAR_DEPLOYER_PRIVATE_KEY_NEXT before it is used anywhere. A run that stops part-way picks
//    the same new key up again.
// 2. The new key is added as a full-access key to the deployer (NEAR_DEPLOYER_ADDRESS),
//    isitpriced.near, market.isitpriced.near and lane.isitpriced.near, signed by the old key.
// 3. Each account then signs one transaction with the new key (a 1 yoctoNEAR transfer to itself).
// 4. Only then is the old key deleted from each account, signed by the new key.
// 5. .env: NEAR_DEPLOYER_PRIVATE_KEY becomes the new key and the _NEXT line goes.
// Prints public keys and transaction hashes only. The house agents' and the hosted keys are separate
// keys and are not touched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENV = path.join(ROOT, ".env");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const lines = fs.readFileSync(ENV, "utf8").split(/\r?\n/);
const get = (k) => { const l = lines.find((x) => x.startsWith(`${k}=`)); return l ? l.slice(k.length + 1).trim() : null; };
const oldKey = KeyPair.fromString(get("NEAR_DEPLOYER_PRIVATE_KEY"));
const deployer = get("NEAR_DEPLOYER_ADDRESS");
if (!deployer) throw new Error("NEAR_DEPLOYER_ADDRESS is not in .env");

// 1. the new key, saved before use
let nextStr = get("NEAR_DEPLOYER_PRIVATE_KEY_NEXT");
if (!nextStr) {
  fs.copyFileSync(ENV, `${ENV}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  nextStr = KeyPair.fromRandom("ed25519").toString();
  fs.writeFileSync(ENV, [...lines.filter((l) => l !== ""), `NEAR_DEPLOYER_PRIVATE_KEY_NEXT=${nextStr}`, ""].join("\n"), { mode: 0o600 });
}
const newKey = KeyPair.fromString(nextStr);
const OLD = oldKey.getPublicKey().toString(), NEW = newKey.getPublicKey().toString();
if (OLD === NEW) throw new Error("the new key equals the old one");
console.log(`old key ${OLD}\nnew key ${NEW}`);

const RPCS = ["https://near.drpc.org", "https://rpc.fastnear.com", "https://free.rpc.fastnear.com"];
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const accounts = [deployer, dep.root, dep.accounts.market, dep.accounts.lane];
const keysOf = async (id) => (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: id })).keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(id, test) { for (let i = 0; i < 20; i++) { if (test(await keysOf(id))) return true; await sleep(1500); } return false; }

// 2. add the new key everywhere, signed by the old one
for (const id of accounts) {
  const keys = await keysOf(id);
  if (keys.includes(NEW)) { console.log(`${id}: new key already there`); continue; }
  if (!keys.includes(OLD)) throw new Error(`${id}: neither the old nor the new key is a full-access key here; stopping`);
  await new Account(id, provider, new KeyPairSigner(oldKey)).addFullAccessKey(NEW);
  if (!(await waitFor(id, (k) => k.includes(NEW)))) throw new Error(`${id}: the new key did not appear`);
  console.log(`${id}: new key added`);
}

// 3. prove the new key signs for each account
for (const id of accounts) {
  const r = await new Account(id, provider, new KeyPairSigner(newKey)).transfer({ receiverId: id, amount: 1n });
  console.log(`${id}: signed with the new key, tx ${r.transaction_outcome?.id || r.transaction?.hash}`);
}

// 4. remove the old key, signed by the new one
for (const id of accounts) {
  const keys = await keysOf(id);
  if (!keys.includes(OLD)) { console.log(`${id}: old key already gone`); continue; }
  if (!keys.includes(NEW)) throw new Error(`${id}: the new key is missing; not deleting the old one`);
  await new Account(id, provider, new KeyPairSigner(newKey)).deleteKey(OLD);
  if (!(await waitFor(id, (k) => !k.includes(OLD)))) throw new Error(`${id}: the old key is still there`);
  console.log(`${id}: old key deleted`);
}

// 5. .env
const now = fs.readFileSync(ENV, "utf8").split(/\r?\n/);
const out = now.filter((l) => !l.startsWith("NEAR_DEPLOYER_PRIVATE_KEY_NEXT=")).map((l) => (l.startsWith("NEAR_DEPLOYER_PRIVATE_KEY=") ? `NEAR_DEPLOYER_PRIVATE_KEY=${nextStr}` : l));
fs.writeFileSync(ENV, out.join("\n"), { mode: 0o600 });
for (const id of accounts) console.log(`${id}: full-access keys now ${(await keysOf(id)).join(", ")}`);
console.log("done: .env holds the new key. Back up .env again.");
