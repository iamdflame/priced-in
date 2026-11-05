// Upgrades the persistent testnet SWARM in place to the reproducible build of this checkout, for a
// change that leaves its source alone (a dependency or toolchain bump), so the judge's check 3
// (reproducible build = chain) holds for the swarm as well as the market.
//
//   node tools/judge/upgrade-swarm-testnet.mjs [--dry-run] [--no-record]
//
// 1. Refuses unless contracts/swarm/src is unchanged since the commit that built the live code
//    (code.swarm.source_rev in deployments/testnet.json, or --from-rev), so the state layout and
//    every stored value type are the deployed ones.
// 2. Builds reproducibly (tools/judge/lib/repro.mjs); the embedded agent wallet must still rebuild
//    to the committed contracts/swarm/res/agent.wasm.
// 3. The live code must be the one the deployment file records.
// 4. Deploys the new swarm wasm to the same account (no init, no migration: same state).
// 5. Verifies: the code hash on chain is the build; the STATE bytes, stats and every agent are
//    unchanged.
// 6. Records the new hash and the upgrade in deployments/testnet.json (unless --no-record).
// Signs with the test root's key from the git-ignored .apex-test/judge-testnet.json. Prints no key.
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { reproBuild, REPO } from "./lib/repro.mjs";
import { RotatingProvider, TESTNET } from "./lib/provider.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const DRY = process.argv.includes("--dry-run");
const RECORD = !process.argv.includes("--no-record");
const depFile = path.join(REPO, "deployments/testnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
const st = JSON.parse(fs.readFileSync(path.join(REPO, ".apex-test/judge-testnet.json"), "utf8"));
const S = dep.accounts.swarm;
if (dep.network !== "testnet" || !S.endsWith(".testnet")) { console.error("testnet only"); process.exit(1); }
if (S !== `swarm.${st.root}`) { console.error(`.apex-test/judge-testnet.json is for ${st.root}, not ${S}`); process.exit(1); }
const provider = new RotatingProvider(process.env.NEAR_TESTNET_RPC || TESTNET.join(","));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= 5 || !/fetch failed|ECONNRESET|ETIMEDOUT|socket|network|503|502|429|Rate limits/i.test(String(e.message || e))) throw e; await sleep(2000 * (i + 1)); }
  }
}
const q = (params) => retry(() => provider.query({ finality: "final", ...params }));
const view = (method, args = {}) => retry(() => provider.callFunction({ contractId: S, method, args, blockQuery: { finality: "final" } }));
const liveHash = async () => (await q({ request_type: "view_account", account_id: S })).code_hash;
const stateBytes = async () => {
  const r = await q({ request_type: "view_state", account_id: S, prefix_base64: Buffer.from("STATE").toString("base64") });
  const v = (r.values || []).find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
  if (!v) throw new Error("no STATE key on the swarm");
  return Buffer.from(v.value, "base64");
};
const agents = async (n) => { const out = []; for (let from = 0; from < n; from += 50) out.push(...(await view("get_agents", { from, limit: 50 }))); return out; };
let bad = 0;
const ok = (name, pass, detail = "") => { console.log(`${pass ? "ok  " : "BAD "} ${name}${detail ? " · " + detail : ""}`); if (!pass) bad++; return pass; };

// ---------- 1. the source is the deployed source ----------
const fromRev = arg("--from-rev", dep.code.swarm.source_rev || null);
if (!fromRev) { console.error("no source_rev recorded for the swarm: pass --from-rev <the commit that built the live code>"); process.exit(1); }
const diff = spawnSync("git", ["diff", "--stat", fromRev, "--", "contracts/swarm/src", "contracts/agent-wallet/src", "contracts/swarm/res/agent.wasm"], { cwd: REPO, encoding: "utf8" });
if (diff.status !== 0) { console.error(`git diff against ${fromRev} failed: ${diff.stderr.trim()}`); process.exit(1); }
ok(`the swarm's source is unchanged since ${fromRev} (state layout and stored types are the deployed ones)`, diff.stdout.trim() === "", diff.stdout.trim().split("\n").pop());
if (bad) process.exit(1);

// ---------- 2. the reproducible build ----------
console.log("building market and swarm reproducibly (tools/judge/lib/repro.mjs)");
const built = await reproBuild({});
if (!built.ok) { console.error(`build failed: ${built.reason}`); process.exit(1); }
const wasm = built.wasm.swarm;
console.log(`     swarm ${wasm.hash} (sha256 ${wasm.sha256}, ${wasm.size} bytes), ${built.toolchain}`);
ok("the agent wallet rebuilds to the committed contracts/swarm/res/agent.wasm", built.wasm.agent.bytes.equals(fs.readFileSync(path.join(REPO, "contracts/swarm/res/agent.wasm"))));

// ---------- 3. what is live ----------
const live = await liveHash();
if (live === wasm.hash) { console.log(`the swarm already runs ${wasm.hash}: nothing to do`); process.exit(0); }
ok("the live swarm runs the code the deployment file records", live === dep.code.swarm.code_hash, `live ${live}, recorded ${dep.code.swarm.code_hash}`);
if (bad) process.exit(1);
const before = { bytes: await stateBytes(), stats: await view("stats") };
before.agents = await agents(Number(before.stats.agents ?? before.stats.agent_count ?? 200));
if (DRY) { console.log(`dry run: would deploy ${wasm.hash} to ${S} (${before.agents.length} agents read)`); process.exit(0); }

// ---------- 4. deploy, same account, same state ----------
const swarm = new Account(S, provider, new KeyPairSigner(KeyPair.fromString(st.key)));
console.log(`deploying ${wasm.hash} to ${S}`);
const tx = await swarm.deployContract(new Uint8Array(wasm.bytes));
const txHash = tx.transaction?.hash || tx.transaction_outcome?.id;
const failure = tx.status?.Failure || tx.receipts_outcome?.find((r) => r.outcome.status?.Failure)?.outcome.status.Failure;
if (failure) { console.error(`deploy failed: ${JSON.stringify(failure).slice(0, 300)}`); process.exit(1); }
console.log(`     tx ${txHash}`);

// ---------- 5. verify ----------
for (let i = 0; i < 20 && (await liveHash()) !== wasm.hash; i++) await sleep(1500);
const after = { hash: await liveHash(), bytes: await stateBytes(), stats: await view("stats") };
after.agents = await agents(Number(after.stats.agents ?? after.stats.agent_count ?? 200));
ok("the code hash on chain is the reproducible build", after.hash === wasm.hash, after.hash);
ok("the STATE bytes are unchanged", after.bytes.equals(before.bytes));
ok("stats are unchanged", JSON.stringify(after.stats) === JSON.stringify(before.stats));
ok("every agent is unchanged", JSON.stringify(after.agents) === JSON.stringify(before.agents), `${after.agents.length} agents`);

// ---------- 6. record ----------
if (RECORD && !bad) {
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  dep.upgrades = [...(dep.upgrades || []), { account: S, from: live, to: wasm.hash, tx: txHash, at: new Date().toISOString(), source_rev: head, note: "same source, rebuilt on near-sdk 5.30.1: code replaced in place, no migration (tools/judge/upgrade-swarm-testnet.mjs)" }];
  dep.code.swarm = { ...dep.code.swarm, code_hash: wasm.hash, sha256: wasm.sha256, source_rev: head };
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
  console.log(`recorded in ${path.relative(REPO, depFile)}`);
}
process.exit(bad ? 1 : 0);
