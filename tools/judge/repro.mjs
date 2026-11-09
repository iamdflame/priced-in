// Rebuilds the market and swarm contracts reproducibly and prints their code hashes next to the
// ones recorded in deployments/testnet.json and the ones on testnet.
//   node tools/judge/repro.mjs [--offline]
import fs from "node:fs";
import path from "node:path";
import { reproBuild, REPO } from "./lib/repro.mjs";
import { Rpc } from "./lib/near.mjs";

const dep = JSON.parse(fs.readFileSync(path.join(REPO, "deployments/testnet.json"), "utf8"));
const r = await reproBuild({ log: process.argv.includes("--verbose") ? (s) => process.stderr.write(s) : undefined });
if (!r.ok) { console.error(`not built: ${r.reason}${r.install ? `\nfix: ${r.install}` : ""}`); process.exit(1); }
const rpc = new Rpc();
let bad = 0;
for (const k of ["market", "swarm"]) {
  const live = process.argv.includes("--offline") ? null : (await rpc.account(dep.accounts[k])).code_hash;
  const ok = r.wasm[k].hash === dep.code[k].code_hash && (live === null || live === r.wasm[k].hash);
  if (!ok) bad++;
  console.log(`${ok ? "same" : "DIFF"} ${k.padEnd(6)} built ${r.wasm[k].hash} (sha256 ${r.wasm[k].sha256}, ${r.wasm[k].size} bytes) · recorded ${dep.code[k].code_hash} · testnet ${live ?? "not read"}`);
}
const agentOk = r.wasm.agent.bytes.equals(fs.readFileSync(path.join(REPO, "contracts/swarm/res/agent.wasm")));
if (!agentOk) bad++;
console.log(`${agentOk ? "same" : "DIFF"} agent  built ${r.wasm.agent.hash} · committed contracts/swarm/res/agent.wasm`);
console.log(`${r.toolchain}; wasm in target/judge-repro/wasm32-unknown-unknown/release`);
process.exit(bad ? 1 : 0);
