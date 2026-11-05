// Builds every contract to wasm the way cargo-near would: with --cfg near (near-sdk's host
// functions) and target-cpu=mvp (no WASM features the NEAR runtime may reject).
import { execSync } from "node:child_process";
const env = { ...process.env, RUSTFLAGS: "--cfg near -C target-cpu=mvp -C link-arg=-s" };
import fs from "node:fs";
// the agent wallet goes first: the swarm embeds it (contracts/swarm/res/agent.wasm)
execSync("cargo build -p pricedin-agent --release --target wasm32-unknown-unknown", { stdio: "inherit", env });
fs.mkdirSync("contracts/swarm/res", { recursive: true });
fs.copyFileSync("target/wasm32-unknown-unknown/release/pricedin_agent.wasm", "contracts/swarm/res/agent.wasm");
for (const p of ["pricedin-market", "pricedin-swarm", "pricedin-tusdc", "pricedin-sweeper"]) {
  execSync(`cargo build -p ${p} --release --target wasm32-unknown-unknown`, { stdio: "inherit", env });
}
console.log("built: target/wasm32-unknown-unknown/release/{pricedin_market,pricedin_swarm,pricedin_tusdc,pricedin_sweeper,pricedin_agent}.wasm");
