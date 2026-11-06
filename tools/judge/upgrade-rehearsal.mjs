// A rehearsal of tools/judge/upgrade-testnet.mjs on a throwaway testnet deployment, so the
// persistent one is only upgraded by a script that has already worked. Testnet only.
//
//   node tools/judge/upgrade-rehearsal.mjs --old-wasm <dir> --from-rev <git rev> [--lock] [--keep]
//
// <dir> holds pricedin_market.wasm and pricedin_swarm.wasm as the persistent deployment runs
// them (node tools/judge/repro.mjs at <git rev> builds them into target/judge-repro); their code
// hashes must equal the ones deployments/testnet.json records.
// 1. scripts/deploy.mjs testnet deploys those old bytes on a fresh root, from target/upgrade-rehearsal;
// 2. it seeds that market through the old code: treasury, a claim, a buy and a sale with no fee, a
//    lane key that spent part of its credit, and a house agent that accepted and was charged;
// 3. upgrade-testnet.mjs --set-fee-bps 100, the path mainnet runs, pauses that market, upgrades it
//    to this checkout's reproducible build, verifies it, sets the fee and unpauses;
// 4. it checks the new rules on the state the old code left: the fee on a buy, a sale and the old
//    lane key's credit, every quote equal to its fill, the books closing, the swarm immutable, the
//    house agent's consent carried over. Then the hole itself, on a second throwaway market: the
//    old bytes take set_swarm("testnet") and make alice.testnet chargeable; the new bytes, on that
//    same state, make it not;
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
import { pathToFileURL } from "node:url";
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { codeHash, REPO } from "./lib/repro.mjs";
import { RotatingProvider, TESTNET } from "./lib/provider.mjs";

// the browser's own quoting code, unchanged
const lmsr = await import(pathToFileURL(path.join(REPO, "web/src/core/lmsr.ts")).href);

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
  const c0 = await call(root, M, "open_claim", { text: "Rehearsal: a claim opened under the old code.", page: "rehearsal", kind: "data", p0_ppm: 620000, b_micro: "1000000" });
  const t0 = await call(root, M, "buy", { claim_id: c0, side: "yes", amount_micro: "1000000", min_shares_micro: "0" });
  const s0 = await call(root, M, "sell", { claim_id: c0, side: "yes", shares_micro: String(BigInt(t0.shares_micro) / 4n), min_proceeds_micro: "0" });
  ok("the old code takes no fee", t0.fee_micro === undefined && s0.fee_micro === undefined && (await view(M, "stats")).fee_bps === undefined, `a buy of ${t0.amount_micro}, a sale of ${s0.amount_micro}`);
  const laneKey = KeyPair.fromRandom("ed25519");
  await retry(() => as(L).addFunctionCallAccessKey({ publicKey: laneKey.getPublicKey(), contractId: M, methodNames: ["buy", "sell", "open_and_buy", "redeem", "claim_lane"], allowance: NEAR / 20n }));
  const laneId = `lane:${laneKey.getPublicKey().toString()}`, laneAcct = as(L, laneKey);
  await call(laneAcct, M, "buy", { claim_id: c0, side: "no", amount_micro: "200000", min_shares_micro: "0" }, 0n, 30n);
  const usage = createHash("sha256").update("rehearsal usage").digest("hex");
  await call(root, M, "set_house_agent", { account: H, allowed: true });
  await call(ha, M, "accept_house_agent");
  await call(root, M, "charge_inference", { agent: H, amount_micro: "100000", usage_hash: usage });
  ok("the old code charges a house agent that accepted", BigInt(await view(M, "get_balance", { trader: H })) === 1_900_000n);
  const stats0 = await view(M, "stats");

  // ---------- 3. upgrade, the way mainnet will ----------
  const depFile = path.join(STAGE, "deployment.json");
  fs.writeFileSync(depFile, JSON.stringify({ network: "testnet", rpc: RPC, root: R, accounts: { market: M, swarm: S, lane: L, usdc: T }, code: { market: { ...dep.code.market, source_rev: FROM }, swarm: dep.code.swarm } }, null, 1));
  console.log("\n$ node tools/judge/upgrade-testnet.mjs --state <rehearsal state> --deployment <rehearsal deployment> --from-rev " + FROM + " --set-fee-bps 100");
  const up = run("tools/judge/upgrade-testnet.mjs", ["--state", STATE, "--deployment", depFile, "--from-rev", FROM, "--set-fee-bps", "100"], { NEAR_TESTNET_RPC: RPC });
  ok("upgrade-testnet.mjs upgraded the throwaway market and verified it", up === 0);
  const rec = JSON.parse(fs.readFileSync(depFile, "utf8"));
  ok("the upgrade is recorded with the new code hash", rec.upgrades?.length === 1 && rec.upgrades[0].fee_bps === 100 && rec.code.market.code_hash !== dep.code.market.code_hash && rec.code.market.code_hash === (await retry(() => provider.query({ request_type: "view_account", finality: "final", account_id: M }))).code_hash, rec.code.market.code_hash);
  console.log("$ node tools/judge/upgrade-testnet.mjs (again)");
  ok("a second run finds nothing to do", run("tools/judge/upgrade-testnet.mjs", ["--state", STATE, "--deployment", depFile, "--from-rev", FROM, "--no-record"], { NEAR_TESTNET_RPC: RPC }) === 0);

  // ---------- 4. the new rules, on the state the old code left ----------
  const stats1 = await view(M, "stats");
  ok("the books carried over: every field the old code reported, unchanged", Object.keys(stats0).every((k) => JSON.stringify(stats0[k]) === JSON.stringify(stats1[k])) && stats1.fee_bps === 100 && stats1.fees_micro === "0", `held ${stats1.held_micro}, ${stats1.fee_bps} bps`);
  const treasury = async () => BigInt((await view(M, "stats")).treasury_micro);
  const booksClose = async () => {
    const s = await view(M, "stats"), held = BigInt(await view(T, "ft_balance_of", { account_id: M }));
    const sum = ["treasury_micro", "reserved_micro", "balances_micro", "collected_micro", "payouts_micro", "bonds_micro", "bounties_micro"].reduce((a, k) => a + BigInt(s[k]), 0n);
    return held === BigInt(s.held_micro) && held === sum;
  };
  // a position opened under the old code, quoted from get_claim by the browser's port, then filled
  const ppmOf = (m) => Number(lmsr.priceYes(m) / lmsr.MICRO);
  const quotedBuy = async (name, who, side, amount) => {
    const v = await view(M, "get_claim", { claim_id: c0 }), tre = await treasury();
    const q = lmsr.contractBuy(lmsr.marketFromClaim(v), side, BigInt(amount), lmsr.feeBpsOf(v));
    const t = await call(who, M, "buy", { claim_id: c0, side, amount_micro: String(amount), min_shares_micro: "0" }, 0n, 30n);
    ok(`${name}: the browser's quote is the fill to the micro, and the 1% fee reaches the treasury`, q.sharesMicro === BigInt(t.shares_micro) && q.paidMicro === BigInt(t.amount_micro) && q.feeMicro === BigInt(t.fee_micro) && q.feeMicro > 0n && ppmOf(q.after) === t.price_yes_ppm_after && (await treasury()) === tre + q.feeMicro, `${t.shares_micro} shares for ${t.amount_micro}, fee ${t.fee_micro}`);
    return t;
  };
  const t1 = await quotedBuy("a buy on a market the old code opened", root, "yes", 1_000_000);
  const v1 = await view(M, "get_claim", { claim_id: c0 }), tre1 = await treasury();
  const sq = lmsr.contractSell(lmsr.marketFromClaim(v1), "yes", BigInt(t1.shares_micro) / 2n, lmsr.feeBpsOf(v1));
  const s1 = await call(root, M, "sell", { claim_id: c0, side: "yes", shares_micro: String(BigInt(t1.shares_micro) / 2n), min_proceeds_micro: "0" });
  ok("a sale of shares: the browser's quote is the fill to the micro, and the fee reaches the treasury", sq.receivedMicro === BigInt(s1.amount_micro) && sq.feeMicro === BigInt(s1.fee_micro) && sq.feeMicro > 0n && (await treasury()) === tre1 + sq.feeMicro, `received ${s1.amount_micro}, fee ${s1.fee_micro}`);
  const lane0 = BigInt(await view(M, "get_balance", { trader: laneId }));
  const tl = await quotedBuy("the old lane key's remaining credit", laneAcct, "no", 100_000);
  ok("the credit given under the old code pays the fee too", BigInt(await view(M, "get_balance", { trader: laneId })) === lane0 - BigInt(tl.amount_micro), `${lane0} -> ${lane0 - BigInt(tl.amount_micro)}`);
  await refused("only the owner sets the fee", () => call(ha, M, "set_fee_bps", { fee_bps: 0 }), /owner only/);
  await refused("the fee can't pass its cap", () => call(root, M, "set_fee_bps", { fee_bps: 301 }), /at most 300 bps/);
  ok("the books close with fees in the treasury", await booksClose());

  const r1 = await view(M, "get_resolution");
  ok("the swarm the old code stored is unchanged, and it is swarm.<the market's parent>", r1.swarm === S);
  await refused("it can't be changed now, not even to the same name", () => call(root, M, "set_swarm", { swarm: S }), /set once and can't be changed/);
  ok("its direct sub-accounts are agents; the swarm itself and a top-level account aren't", (await view(M, "get_house_agent", { account: `a0.${S}` })).chargeable === true && (await view(M, "get_house_agent", { account: S })).chargeable === false && (await view(M, "get_house_agent", { account: "testnet" })).chargeable === false);

  let hv = await view(M, "get_house_agent", { account: H });
  ok("a house agent's consent carried over", hv.proposed && hv.accepted && hv.chargeable);
  await call(root, M, "charge_inference", { agent: H, amount_micro: "100000", usage_hash: usage });
  ok("so it can still be charged", BigInt(await view(M, "get_balance", { trader: H })) === 1_800_000n);
  await call(ha, M, "leave_house_agent");
  hv = await view(M, "get_house_agent", { account: H });
  ok("it leaves, balance intact", !hv.chargeable && BigInt(await view(M, "get_balance", { trader: H })) === 1_800_000n);
  const c1 = await call(root, M, "open_claim", { text: "Rehearsal: fifty times the liquidity.", page: "rehearsal", kind: "data", p0_ppm: 500000, b_micro: "100000" });
  const big = await call(root, M, "buy", { claim_id: c1, side: "yes", amount_micro: "5000000", min_shares_micro: "0" });
  ok("a $5 buy on b = $0.10 stops at the cap: $0.851720 and a 1% fee on that", big.amount_micro === "860238" && big.fee_micro === "8518" && big.price_yes_ppm_after >= 999_800, `${big.price_yes_ppm_after / 1e4}%`);

  // the hole itself: the old bytes on a market of their own, which an upgrade can't take back
  const spikeKey = KeyPair.fromString(spike.sk);
  const funder = as(spike.id, spikeKey);
  const holeName = `pih${Date.now().toString(36)}`, HOLE = `${holeName}.${spike.id}`, victim = "alice.testnet";
  await retry(() => funder.createSubAccount({ accountOrPrefix: holeName, publicKey: kp.getPublicKey(), nearToTransfer: NEAR * 47n / 10n }));
  const hole = as(HOLE);
  try {
    await hole.deployContract(new Uint8Array(old.market));
    await call(hole, HOLE, "new", { owner: R, usdc: T, lane: L });
    await call(root, HOLE, "set_swarm", { swarm: "testnet" });
    ok(`the hole, on the old bytes: set_swarm("testnet") makes ${victim} chargeable`, (await view(HOLE, "get_house_agent", { account: victim })).chargeable === true);
    const newMarket = fs.readFileSync(path.join(REPO, "target/judge-repro/wasm32-unknown-unknown/release/pricedin_market.wasm"));
    if (codeHash(newMarket) !== rec.code.market.code_hash) throw new Error("target/judge-repro holds another market build than the one deployed");
    await hole.deployContract(new Uint8Array(newMarket));
    ok("the same state on the new bytes: no account is an agent of a swarm that isn't swarm.<...>", (await view(HOLE, "get_house_agent", { account: victim })).chargeable === false && (await view(HOLE, "get_resolution")).swarm === "testnet");
    await refused("and the bad name can't be swapped for another", () => call(root, HOLE, "set_swarm", { swarm: `swarm.${R}` }), /set once and can't be changed/);
  } finally {
    await retry(() => hole.deleteAccount(spike.id));
  }

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
    await retry(() => as(L, laneAdmin).addFunctionCallAccessKey({ publicKey: judge.getPublicKey(), contractId: M, methodNames: ["buy", "sell", "open_and_buy", "redeem"], allowance: NEAR / 20n }));
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
