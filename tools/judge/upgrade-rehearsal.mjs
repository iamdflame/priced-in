// A rehearsal of tools/judge/upgrade-testnet.mjs on a throwaway testnet deployment, so the
// persistent one is only upgraded by a script that has already worked. Testnet only.
//
//   node tools/judge/upgrade-rehearsal.mjs --old-wasm <dir> --from-rev <git rev> [--lock] [--keep]
//
// <dir> holds pricedin_market.wasm and pricedin_swarm.wasm as the persistent deployment runs
// them (node tools/judge/repro.mjs at <git rev> builds them into target/judge-repro); their code
// hashes must equal the ones deployments/testnet.json records.
// 1. scripts/deploy.mjs testnet deploys those old bytes on a fresh root, from target/upgrade-rehearsal;
// 2. it seeds that market through the old code: treasury, a claim, a trade, and an account the
//    owner listed as a house agent and charged without its consent (what v2 allowed);
// 3. upgrade-testnet.mjs upgrades it to this checkout's reproducible build and verifies it;
// 4. it checks the new rules on the upgraded state: the listed account is no longer chargeable
//    until it accepts, it can leave, a buy of 50 b stops at the cap, a pause holds the treasury;
// 5. with --lock: deploy.mjs --lock removes the root's key, then it checks that the market and
//    swarm have no keys, that the root key can no longer deploy, that operator calls from the
//    owner's account still work, and that the API's lane key still adds judges' keys that bet.
//    A locked market and swarm can't be deleted afterwards: that NEAR stays on testnet.
// 6. deletes what can be deleted (deploy.mjs --delete), unless --keep or a step crashed (then
//    the deployment stays for inspection: run deploy.mjs testnet --delete from the rehearsal folder).
// Keys stay in the git-ignored target/upgrade-rehearsal/.apex-test; nothing secret is printed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { codeHash, REPO } from "./lib/repro.mjs";
import { RotatingProvider, TESTNET } from "./lib/provider.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OLD = arg("--old-wasm"), FROM = arg("--from-rev");
const LOCK = process.argv.includes("--lock"), KEEP = process.argv.includes("--keep");
if (!OLD || !FROM) { console.error("usage: node tools/judge/upgrade-rehearsal.mjs --old-wasm <dir> --from-rev <git rev> [--lock] [--keep]"); process.exit(1); }
const dep = JSON.parse(fs.readFileSync(path.join(REPO, "deployments/testnet.json"), "utf8"));
const old = { market: fs.readFileSync(path.join(OLD, "pricedin_market.wasm")), swarm: fs.readFileSync(path.join(OLD, "pricedin_swarm.wasm")) };
for (const k of ["market", "swarm"]) {
  if (codeHash(old[k]) !== dep.code[k].code_hash) { console.error(`${k}: ${codeHash(old[k])} is not the recorded ${dep.code[k].code_hash}`); process.exit(1); }
}
const RPC = process.env.NEAR_TESTNET_RPC || TESTNET.join(",");
const provider = new RotatingProvider(RPC);
const TGAS = 10n ** 12n, NEAR = 10n ** 24n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limited = (e) => /-429|Rate limits exceeded|Too Many Requests|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(e?.message || e));
async function retry(fn) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 6 || !limited(e)) throw e; await sleep(2500 * (i + 1)); } } }
const view = (contractId, method, args = {}) => retry(() => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } }));
const keysOf = async (id) => (await retry(() => provider.query({ request_type: "view_access_key_list", finality: "final", account_id: id }))).keys || [];
const call = (a, contractId, methodName, args = {}, deposit = 0n, gas = 60n) => retry(() => a.callFunction({ contractId, methodName, args, gas: gas * TGAS, deposit }));
let bad = 0;
const ok = (name, pass, detail = "") => { console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`); if (!pass) bad++; return pass; };
async function refused(name, fn, pattern) {
  try { await fn(); ok(name, false, "it went through"); }
  catch (e) { const s = String(e.message || e); ok(name, pattern.test(s), pattern.test(s) ? "" : s.slice(0, 200)); }
}
const run = (script, args, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(REPO, script), ...args], { cwd: STAGE, env: { ...process.env, ...env }, stdio: "inherit" });
  return r.status ?? 1;
};
// deploy.mjs skips what is done, so a run cut short by the network is simply run again
const deploy = (args, env) => { let s = 1; for (let i = 0; i < 3 && s !== 0; i++) s = run("scripts/deploy.mjs", args, env); return s; };
// deploy.mjs rewrites its state with its own accounts: keep the house agent's account listed for --delete
const keepListed = (id) => { const s = JSON.parse(fs.readFileSync(STATE, "utf8")); if (!s.subs.includes(id)) { s.subs = [id, ...s.subs]; fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); } };

// ---------- 1. a throwaway deployment of the old bytes ----------
const STAGE = path.join(REPO, "target", "upgrade-rehearsal");
const STATE = path.join(STAGE, ".apex-test", "deploy-testnet.json");
if (fs.existsSync(STATE)) { console.error(`${STATE} exists: a rehearsal is still deployed (run deploy.mjs testnet --delete from ${STAGE})`); process.exit(1); }
const wdir = path.join(STAGE, "target", "wasm32-unknown-unknown", "release");
fs.mkdirSync(wdir, { recursive: true });
fs.writeFileSync(path.join(wdir, "pricedin_market.wasm"), old.market);
fs.writeFileSync(path.join(wdir, "pricedin_swarm.wasm"), old.swarm);
for (const f of ["pricedin_tusdc.wasm", "pricedin_sweeper.wasm"]) fs.copyFileSync(path.join(REPO, "target/wasm32-unknown-unknown/release", f), path.join(wdir, f));
const spike = JSON.parse(fs.readFileSync(path.join(REPO, ".apex/spikes/s3-lane/testnet-accounts.json"), "utf8")).lane;
if (!spike.id.endsWith(".testnet")) throw new Error("the funder must be a testnet account");
const funderEnv = { FUNDER_ID: spike.id, FUNDER_KEY: spike.sk, NEAR_RPC: RPC, OPERATOR_ACCOUNT: "", COUNCIL_ACCOUNT: "", PLANNER_PUBLIC_KEY_HEX: "", CONFIRM_MAINNET: "" };
console.log(`deploying the old bytes (market ${dep.code.market.code_hash}) on a throwaway root`);
if (deploy(["testnet"], funderEnv) !== 0) { console.error("deploy failed"); process.exit(1); }
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
const kp = KeyPair.fromString(st.key);
const R = st.root, M = `market.${R}`, S = `swarm.${R}`, L = `lane.${R}`, T = `tusdc.${R}`, H = `ha.${R}`;
const as = (id, k = kp) => new Account(id, provider, new KeyPairSigner(k));
const root = as(R);

let code = 0;
try {
  // ---------- 2. seed it through the old code ----------
  await retry(() => root.createSubAccount({ accountOrPrefix: "ha", publicKey: kp.getPublicKey(), nearToTransfer: NEAR / 10n }));
  keepListed(H); // so --delete removes it too
  const ha = as(H);
  await call(root, T, "register", { account_id: H });
  await call(root, T, "faucet"); await call(root, T, "faucet");
  await call(root, T, "ft_transfer_call", { receiver_id: M, amount: "4000000", msg: "{\"treasury\":true}" }, 1n, 100n);
  await call(root, T, "ft_transfer_call", { receiver_id: M, amount: "12000000", msg: "" }, 1n, 100n);
  await call(root, T, "ft_transfer_call", { receiver_id: M, amount: "2000000", msg: `{"for":"${H}"}` }, 1n, 100n);
  await call(root, M, "set_limits", { reserve_cap_micro: "50000000", lane_budget_micro: "2000000", lane_credit_micro: "500000", challenge_bond_micro: "1000000" });
  const c0 = await call(root, M, "open_claim", { text: "Rehearsal: a claim opened under v2.", page: "rehearsal", kind: "data", p0_ppm: 500000, b_micro: "1000000" });
  await call(root, M, "buy", { claim_id: c0, side: "yes", amount_micro: "1000000", min_shares_micro: "0" });
  await call(root, M, "set_house_agent", { account: H, allowed: true });
  const usage = createHash("sha256").update("rehearsal usage").digest("hex");
  await call(root, M, "charge_inference", { agent: H, amount_micro: "100000", usage_hash: usage });
  ok("v2, the old code: the owner lists an account and an operator charges it without its consent", BigInt(await view(M, "get_balance", { trader: H })) === 1_900_000n);
  const stats0 = await view(M, "stats");

  // ---------- 3. upgrade ----------
  const depFile = path.join(STAGE, "deployment.json");
  fs.writeFileSync(depFile, JSON.stringify({ network: "testnet", rpc: RPC, root: R, accounts: { market: M, swarm: S, lane: L, usdc: T }, code: { market: { ...dep.code.market, source_rev: FROM }, swarm: dep.code.swarm } }, null, 1));
  console.log("\n$ node tools/judge/upgrade-testnet.mjs --state <rehearsal state> --deployment <rehearsal deployment> --from-rev " + FROM);
  const up = run("tools/judge/upgrade-testnet.mjs", ["--state", STATE, "--deployment", depFile, "--from-rev", FROM], { NEAR_TESTNET_RPC: RPC });
  ok("upgrade-testnet.mjs upgraded the throwaway market and verified it", up === 0);
  const rec = JSON.parse(fs.readFileSync(depFile, "utf8"));
  ok("the upgrade is recorded with the new code hash", rec.upgrades?.length === 1 && rec.code.market.code_hash !== dep.code.market.code_hash && rec.code.market.code_hash === (await retry(() => provider.query({ request_type: "view_account", finality: "final", account_id: M }))).code_hash, rec.code.market.code_hash);
  console.log("$ node tools/judge/upgrade-testnet.mjs (again)");
  ok("a second run finds nothing to do", run("tools/judge/upgrade-testnet.mjs", ["--state", STATE, "--deployment", depFile, "--from-rev", FROM, "--no-record"], { NEAR_TESTNET_RPC: RPC }) === 0);

  // ---------- 4. the new rules, on the state v2 left ----------
  ok("the books carried over", JSON.stringify(await view(M, "stats")) === JSON.stringify(stats0));
  let hv = await view(M, "get_house_agent", { account: H });
  ok("after the upgrade the v2 listing is only a proposal: not chargeable", hv.proposed === true && hv.accepted === false && hv.chargeable === false);
  await refused("an operator can no longer charge it", () => call(root, M, "charge_inference", { agent: H, amount_micro: "100000", usage_hash: usage }), /not an agent/);
  await call(ha, M, "accept_house_agent");
  await call(root, M, "charge_inference", { agent: H, amount_micro: "100000", usage_hash: usage });
  ok("once it accepts with its own key, it is charged", BigInt(await view(M, "get_balance", { trader: H })) === 1_800_000n);
  await call(ha, M, "leave_house_agent");
  hv = await view(M, "get_house_agent", { account: H });
  ok("it leaves, balance intact", !hv.chargeable && BigInt(await view(M, "get_balance", { trader: H })) === 1_800_000n);
  const c1 = await call(root, M, "open_claim", { text: "Rehearsal: fifty times the liquidity.", page: "rehearsal", kind: "data", p0_ppm: 500000, b_micro: "100000" });
  const big = await call(root, M, "buy", { claim_id: c1, side: "yes", amount_micro: "5000000", min_shares_micro: "0" });
  ok("a $5 buy on b = $0.10 stops at the cap and is charged $0.851720", big.amount_micro === "851720" && big.price_yes_ppm_after >= 999_800, `${big.price_yes_ppm_after / 1e4}%`);
  await call(root, M, "pause", { paused: true });
  await refused("paused, the owner's treasury withdrawal waits", () => call(root, M, "withdraw_treasury", { amount_micro: "1" }, 0n, 60n), /paused/);
  await call(root, M, "pause", { paused: false });

  // ---------- 5. --lock ----------
  if (LOCK) {
    // deploy.mjs deploys whatever its folder holds when the chain differs: give it the upgraded
    // bytes (upgrade-testnet.mjs built them reproducibly), so --lock locks the new code
    const newMarket = fs.readFileSync(path.join(REPO, "target/judge-repro/wasm32-unknown-unknown/release/pricedin_market.wasm"));
    if (codeHash(newMarket) !== rec.code.market.code_hash) throw new Error("target/judge-repro holds another market build than the one deployed");
    fs.writeFileSync(path.join(wdir, "pricedin_market.wasm"), newMarket);
    const laneAdmin = KeyPair.fromRandom("ed25519");
    fs.writeFileSync(path.join(STAGE, ".apex-test", "lane-admin.json"), JSON.stringify({ note: "rehearsal lane admin key (testnet)", key: laneAdmin.toString() }));
    console.log("\n$ LANE_ADMIN_PUBLIC_KEY=<new key> node scripts/deploy.mjs testnet --lock");
    const lk = deploy(["testnet", "--lock"], { ...funderEnv, LANE_ADMIN_PUBLIC_KEY: laneAdmin.getPublicKey().toString() });
    keepListed(H);
    ok("deploy.mjs --lock ran and verified", lk === 0);
    ok("the market has no keys", (await keysOf(M)).length === 0);
    ok("the swarm has no keys", (await keysOf(S)).length === 0);
    const lane = await keysOf(L);
    ok("the lane keeps one full-access key, the API's, and not the root's", lane.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key).join() === laneAdmin.getPublicKey().toString());
    const newWasm = fs.readFileSync(path.join(REPO, "target/wasm32-unknown-unknown/release/pricedin_sweeper.wasm"));
    await refused("the root's key can no longer replace the market's code", () => as(M).deployContract(new Uint8Array(newWasm)), /access key|AccessKeyDoesNotExist|does not exist|InvalidAccessKey|not found/i);
    // operator calls come from the owner's account, never as the market
    const tre = BigInt((await view(M, "stats")).treasury_micro);
    await call(root, M, "set_house_agent", { account: H, allowed: true }); // it left above: propose again
    await call(ha, M, "accept_house_agent");
    await call(root, M, "charge_inference", { agent: H, amount_micro: "100000", usage_hash: usage });
    ok("the operator path works with no key on the market: charge_inference from the owner's account", BigInt((await view(M, "stats")).treasury_micro) === tre + 100_000n);
    const c2 = await call(root, M, "open_claim", { text: "Rehearsal: opened after the lock.", page: "rehearsal", kind: "data", p0_ppm: 400000, b_micro: "1000000" });
    ok("an operator opens a claim after the lock", typeof c2 === "number");
    // the API's lane key adds a judge's key, which bets
    const judge = KeyPair.fromRandom("ed25519");
    await retry(() => as(L, laneAdmin).addFunctionCallAccessKey({ publicKey: judge.getPublicKey(), contractId: M, methodNames: ["buy", "sell", "open_and_buy", "redeem", "claim_lane"], allowance: NEAR / 20n }));
    const t = await call(as(L, judge), M, "buy", { claim_id: c2, side: "no", amount_micro: "300000", min_shares_micro: "0" }, 0n, 30n);
    ok("the API's lane key still adds a judge's key, and that key bets", t.trader === `lane:${judge.getPublicKey().toString()}` && Number(t.shares_micro) > 0);
    await call(root, M, "pause", { paused: true });
    await call(root, M, "pause", { paused: false });
    ok("the owner keeps its methods after the lock (pause, unpause)", (await view(M, "stats")).paused === false);
  }
} catch (e) {
  console.log("FATAL", String(e.stack || e).slice(0, 600));
  code = 2;
}
console.log(`\n${code ? "the rehearsal stopped early (FATAL above)" : bad ? `${bad} FAILED` : "every rehearsal check passed"}`);
if (!KEEP && !code) {
  console.log("\n$ node scripts/deploy.mjs testnet --delete (from the rehearsal folder)");
  run("scripts/deploy.mjs", ["testnet", "--delete"], funderEnv);
  if (LOCK && fs.existsSync(STATE)) {
    fs.renameSync(STATE, path.join(STAGE, ".apex-test", `locked-${R}.json`));
    console.log("(a locked market and swarm can't be deleted: that is the point of --lock)");
  }
}
process.exit(code || (bad ? 1 : 0));
