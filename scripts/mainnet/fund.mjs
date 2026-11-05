// Puts the USDC that arrived at the owner (isitpriced.near) to work on the MAINNET market.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/fund.mjs --plan        print the split, change nothing
//   CONFIRM_MAINNET=yes node scripts/mainnet/fund.mjs               do it
//   options: --house <USD per agent, default 3> --lane <USD, default 12>
//
// Signed by the owner with NEAR_DEPLOYER_PRIVATE_KEY (read only after CONFIRM_MAINNET=yes).
// Idempotent: each step is checked on chain first. In order:
//   1. three static house agents, h-archivist / h-skeptic / h-quant.<owner>: plain accounts, each
//      with a function-call key on the market limited to buy, sell and redeem (the only key the
//      hosted signer gets) and a USDC bankroll the owner deposits for it inside the market;
//   2. the rest of the owner's USDC into the market's treasury (subsidy reserves and lane credits);
//   3. set_limits: the reserve cap is the treasury minus the lane budget minus $1, so every lane
//      credit stays covered; $1 lane credit; $1 challenge bond.
// Keys go to the git-ignored .apex-test/mainnet/ before their public half is used. Nothing secret
// is printed. The split and every transaction go to deployments/mainnet.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { writeKeyFile } from "../../services/ai/src/keystore.js";

if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== "mainnet") throw new Error("deployments/mainnet.json is not a mainnet deployment");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PLAN = process.argv.includes("--plan");
const usd = (x) => BigInt(Math.round(Number(x) * 1e6));
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;
const HOUSE_EACH = usd(arg("--house", "3"));
const LANE_BUDGET = usd(arg("--lane", "12"));
const NAMES = ["house-archivist", "house-skeptic", "house-quant"];

const RPCS = (env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.near.org").split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const ownerKey = KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY);
const owner = new Account(dep.root, provider, new KeyPairSigner(ownerKey));
const M = dep.accounts.market, U = dep.accounts.usdc;
const TGAS = 10n ** 12n, NEAR = 10n ** 24n;
const view = (contractId, method, args = {}, finality = "final") => provider.callFunction({ contractId, method, args, blockQuery: { finality } });
const txs = [];
async function call(contractId, methodName, args, { deposit = 0n, tgas = 60n, tag = methodName } = {}) {
  const r = await owner.callFunctionRaw({ contractId, methodName, args, gas: tgas * TGAS, deposit });
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  const failed = r.status && typeof r.status === "object" && "Failure" in r.status;
  txs.push({ tag, method: methodName, tx, link: `https://nearblocks.io/txns/${tx}` });
  console.log(`${failed ? "FAILED" : "ok"}  ${tag}: tx ${tx}`);
  if (failed) throw new Error(`${tag} failed: ${JSON.stringify(r.status.Failure).slice(0, 300)}`);
  return r;
}
const exists = async (id) => { try { await provider.query({ request_type: "view_account", finality: "final", account_id: id }); return true; } catch (e) { const all = [e, ...(e.errors || [])].map((x) => String(x?.message || x)).join(" "); if (/does not exist|UNKNOWN_ACCOUNT/i.test(all)) return false; throw e; } };

// ---------- what is there ----------
const have = BigInt(await view(U, "ft_balance_of", { account_id: dep.root }));
const stats = await view(M, "stats");
const ids = NAMES.map((n) => `${n.replace("house-", "h-")}.${dep.root}`);
const balances = await Promise.all(ids.map(async (id) => BigInt(await view(M, "get_balance", { trader: id }))));
const houseNeed = balances.reduce((a, b) => a + (b < HOUSE_EACH ? HOUSE_EACH - b : 0n), 0n);
const treasuryIn = have > houseNeed ? have - houseNeed : 0n;
const treasuryAfter = BigInt(stats.treasury_micro) + treasuryIn;
const reserveCap = treasuryAfter + BigInt(stats.reserved_micro) > LANE_BUDGET + 1_000_000n ? treasuryAfter + BigInt(stats.reserved_micro) - LANE_BUDGET - 1_000_000n : 0n;
console.log(`owner ${dep.root} holds ${fmt(have)} USDC; the market's treasury holds ${fmt(stats.treasury_micro)}, ${fmt(stats.reserved_micro)} of it reserved`);
console.log(`plan: house agents ${fmt(houseNeed)} (${fmt(HOUSE_EACH)} each, topped up), treasury +${fmt(treasuryIn)} -> ${fmt(treasuryAfter)}, lane budget ${fmt(LANE_BUDGET)}, reserve cap ${fmt(reserveCap)}, lane credit $1.00, challenge bond $1.00`);
if (have === 0n && BigInt(stats.treasury_micro) === 0n) { console.log(`no USDC has arrived at ${dep.root} yet`); process.exit(2); }
if (have < houseNeed + 5_000_000n && BigInt(stats.treasury_micro) === 0n) { console.log("too little USDC for the plan: lower --house"); process.exit(2); }
if (PLAN) process.exit(0);

// ---------- 1. the house agents ----------
const OUT = path.join(ROOT, ".apex-test/mainnet");
const HOUSE_FILE = path.join(OUT, "house-keys.json"); // full-access keys, for recovery only
const SIGNER_FILE = path.join(OUT, "signer-keys.json"); // function-call keys, for the hosted signer
const st = fs.existsSync(HOUSE_FILE) ? JSON.parse(fs.readFileSync(HOUSE_FILE, "utf8")) : {};
const signer = { agents: {} };
for (const [i, name] of NAMES.entries()) {
  const id = ids[i];
  if (!st[name]) {
    const full = KeyPair.fromRandom("ed25519"), fc = KeyPair.fromRandom("ed25519");
    st[name] = { accountId: id, full: full.toString(), fc: fc.toString() };
    fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
    fs.writeFileSync(HOUSE_FILE, JSON.stringify(st, null, 1), { mode: 0o600 });
  }
  const full = KeyPair.fromString(st[name].full), fc = KeyPair.fromString(st[name].fc);
  if (!(await exists(id))) {
    await owner.createSubAccount({ accountOrPrefix: name.replace("house-", "h-"), publicKey: full.getPublicKey(), nearToTransfer: 12n * NEAR / 100n });
    console.log(`ok  created ${id} with 0.12 NEAR`);
  }
  const keys = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: id })).keys;
  if (!keys.some((k) => k.public_key === fc.getPublicKey().toString())) {
    const acct = new Account(id, provider, new KeyPairSigner(full));
    await acct.addFunctionCallAccessKey({ publicKey: fc.getPublicKey(), contractId: M, methodNames: ["buy", "sell", "redeem"], allowance: NEAR / 10n });
    console.log(`ok  ${id}: buy/sell/redeem key added`);
  }
  signer.agents[name] = { accountId: id, privateKey: st[name].fc };
  if (balances[i] < HOUSE_EACH) {
    await call(U, "ft_transfer_call", { receiver_id: M, amount: String(HOUSE_EACH - balances[i]), msg: JSON.stringify({ for: id }) }, { deposit: 1n, tgas: 100n, tag: `bankroll ${name} ${fmt(HOUSE_EACH - balances[i])}` });
  }
}
if (fs.existsSync(SIGNER_FILE)) fs.rmSync(SIGNER_FILE);
writeKeyFile(SIGNER_FILE, signer);

// ---------- 2. the treasury ----------
const left = BigInt(await view(U, "ft_balance_of", { account_id: dep.root }, "optimistic"));
if (left > 0n) await call(U, "ft_transfer_call", { receiver_id: M, amount: String(left), msg: "{\"treasury\":true}" }, { deposit: 1n, tgas: 100n, tag: `treasury ${fmt(left)}` });

// ---------- 3. the limits ----------
const s2 = await view(M, "stats", {}, "optimistic");
const cap = BigInt(s2.treasury_micro) + BigInt(s2.reserved_micro) - LANE_BUDGET - 1_000_000n;
if (cap <= 0n) throw new Error("the treasury can't cover the lane budget");
await call(M, "set_limits", { reserve_cap_micro: String(cap), lane_budget_micro: String(LANE_BUDGET), lane_credit_micro: "1000000", challenge_bond_micro: "1000000" }, { tag: `set_limits cap ${fmt(cap)} lane ${fmt(LANE_BUDGET)}` });

// ---------- read back and record ----------
const s3 = await view(M, "stats", {}, "optimistic");
const houses = [];
for (const id of ids) houses.push({ account: id, balance_micro: String(await view(M, "get_balance", { trader: id }, "optimistic")) });
console.log(`treasury ${fmt(s3.treasury_micro)}, lane budget ${fmt(s3.lane_budget_micro)}, house agents ${houses.map((h) => `${h.account.split(".")[0]} ${fmt(h.balance_micro)}`).join(", ")}`);
dep.funding = { at: new Date().toISOString(), house_agents: houses, treasury_micro: s3.treasury_micro, reserve_cap_micro: String(cap), lane_budget_micro: s3.lane_budget_micro, lane_credit_micro: "1000000", challenge_bond_micro: "1000000" };
dep.transactions = [...(dep.transactions || []), ...txs];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log("recorded in deployments/mainnet.json; keys in .apex-test/mainnet (git-ignored)");
