#!/usr/bin/env node
// Priced In, judge run: one command, no secrets, every claim checked or a plain reason why not.
//
//   npm run judge                  all checks, testnet live (about 3 to 6 minutes)
//   npm run judge -- --offline     no network: chain, 1Click and hosted checks SKIP with the reason
//   npm run judge -- --json        machine-readable output
//   SITE_URL=https://... npm run judge   also checks the hosted demo
//   npm run judge -- --no-build    skip the Rust rebuild (check 3)
//   npm run judge -- --quick       no Rust rebuild and no unit suites (checks 3 and 8 SKIP)
//   npm run judge:quick            --quick, with the hosted site: under a minute
//   npm run judge:full             npm ci, the site's install, then every check against the hosted site, as JSON
//
// Node 22.18 or later (it imports the browser's TypeScript LMSR directly). Needs no Rust and no
// keys; Rust 1.99.1 adds the reproducible-build check. Reads only: it never sends a transaction.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const OFFLINE = argv.includes("--offline"), JSON_OUT = argv.includes("--json"), QUICK = argv.includes("--quick"), NO_BUILD = QUICK || argv.includes("--no-build");
const SITE = (argv.find((a) => a.startsWith("--site="))?.slice(7) || process.env.SITE_URL || "").trim();

// TypeScript type stripping is on by default from Node 22.18 / 23.6; earlier 22.x needs the flag
if (!process.features?.typescript && !process.env.PRICEDIN_JUDGE_CHILD) {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 6)) { console.error(`Node ${process.versions.node} is too old: the judge needs Node 22.18 or later.`); process.exit(2); }
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...argv], { stdio: "inherit", env: { ...process.env, PRICEDIN_JUDGE_CHILD: "1" } });
  process.exit(r.status ?? 1);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { checkLmsr } = await import("./checks/lmsr.mjs");
const { checkRules } = await import("./checks/rules.mjs");
const { checkRepro, checkBooks, checkRewrite, reproBuild } = await import("./checks/chain.mjs");
const { checkOneClick, checkCorpus, checkSuites, checkSite } = await import("./checks/offchain.mjs");
const { checkAttestations } = await import("./checks/attestation.mjs");
const { checkMainnet } = await import("./checks/mainnet.mjs");
const { Rpc, MAINNET_RPCS, crashAsSkip } = await import("./lib/near.mjs");

const dep = JSON.parse(fs.readFileSync(path.join(REPO, "deployments/testnet.json"), "utf8"));
const rpc = new Rpc();
// the real-money deployment, when there is one: check 3 also reads its code hash from mainnet
const mainFile = path.join(REPO, "deployments/mainnet.json");
const mainnet = fs.existsSync(mainFile) ? { dep: JSON.parse(fs.readFileSync(mainFile, "utf8")), rpc: new Rpc(MAINNET_RPCS) } : null;
const t0 = Date.now();

// slow work starts at once and runs while the quick checks do
const build = NO_BUILD ? Promise.resolve({ ok: false, reason: "not built (--no-build)" }) : reproBuild({ learn: false }).catch((e) => ({ ok: false, reason: e.message }));
const suites = QUICK ? Promise.resolve({ status: "SKIP", detail: "--quick: the unit suites were not run", see: "npm run judge (without --quick), or npm run ai:unit, api:unit, site:test and judge:test" }) : checkSuites(REPO);

const offlineSkip = (what) => async () => ({ status: "SKIP", detail: `--offline: ${what} not read`, see: "npm run judge (without --offline)" });
const CHECKS = [
  [1, "LMSR properties", () => checkLmsr(REPO), "npm run site:test (tests/unit/core/lmsr.test.ts); npm run vectors:lmsr regenerates the vectors; cargo test -p lmsr --release"],
  [2, "verdict rule and bond split", () => checkRules(REPO), "cargo run --release --manifest-path tools/judge/rules-vectors/Cargo.toml (regenerates the vectors); cargo test -p rules --release"],
  [3, "reproducible contracts", async () => { const r = await checkRepro(REPO, dep, rpc, { offline: OFFLINE, build, mainnet }); if (r.status === "SKIP" && NO_BUILD) r.see = "npm run judge (without --no-build)"; return r; }],
  [4, "testnet deployment live, books close", OFFLINE ? offlineSkip("testnet") : () => checkBooks(dep, rpc)],
  [5, "signed rewrite verifies, anchored", () => checkRewrite(REPO, dep, rpc, { offline: OFFLINE })],
  [6, "1Click dry quote, Base USDC -> NEAR USDC", OFFLINE ? offlineSkip("the 1Click API (mainnet)") : () => checkOneClick()],
  [7, "the measured number", () => checkCorpus(REPO, "16 of 232")],
  [8, "unit suites: AI, API, site", () => suites],
  [9, "hosted demo", !SITE ? async () => ({ status: "SKIP", detail: "SITE_URL is not set; the hosted demo is https://isitpriced.com", see: "SITE_URL=https://isitpriced.com npm run judge" }) : OFFLINE ? offlineSkip("the hosted demo") : () => checkSite(SITE)],
  [10, "attested models, verified offline, registered on mainnet", () => checkAttestations(REPO, { mainnet, offline: OFFLINE })],
  [11, "mainnet books and rulings", () => checkMainnet(REPO, mainnet, { offline: OFFLINE, site: SITE || "https://isitpriced.com" }), "node tools/judge/snapshot-mainnet-rulings.mjs (remakes the evidence)"],
];

const results = [];
// each check starts after the one before it, so lines print in order, as they finish
for (const [id, name, fn, see] of CHECKS) {
  const s = Date.now();
  let r;
  try { r = await fn(); }
  catch (e) {
    // a network that's down, rate-limited or still catching up is a SKIP with its reason, not a crash
    r = crashAsSkip(e) || { status: "FAIL", detail: `the check itself crashed: ${String(e.stack || e).split("\n").slice(0, 2).join(" ")}` };
  }
  const row = { id, name, status: r.status, detail: r.detail, see: r.see || see || "", seconds: Number(((Date.now() - s) / 1000).toFixed(1)) };
  results.push(row);
  if (!JSON_OUT) console.log(`${row.status.padEnd(4)} ${id}. ${name}: ${row.detail}${row.see ? ` · see: ${row.see}` : ""}`);
}

const count = (st) => results.filter((r) => r.status === st).length;
const secs = (Date.now() - t0) / 1000;
const summary = { pass: count("PASS"), fail: count("FAIL"), skip: count("SKIP"), seconds: Number(secs.toFixed(1)), offline: OFFLINE, node: process.versions.node, platform: process.platform, deployment: dep.accounts.market, mainnet: mainnet?.dep.accounts.market ?? null, commit: (spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout || "").trim() || null };
if (JSON_OUT) console.log(JSON.stringify({ checks: results, summary }, null, 1));
else console.log(`\n${results.length} checks: ${summary.pass} PASS, ${summary.fail} FAIL, ${summary.skip} SKIP in ${Math.floor(Math.round(secs) / 60)}m${String(Math.round(secs) % 60).padStart(2, "0")}s${OFFLINE ? " (offline)" : ""} · testnet market ${dep.accounts.market}${mainnet ? ` · mainnet market ${mainnet.dep.accounts.market}` : ""} · commit ${summary.commit}`);
// the exit code is set first: the unref'd timer below only cuts short sockets a check left open,
// and when nothing holds the loop Node exits before it fires, which used to make every run exit 0
process.exitCode = summary.fail ? 1 : 0;
setTimeout(() => process.exit(), 20).unref();
