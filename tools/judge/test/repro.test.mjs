// Check 3's build plumbing without building: the path remaps for every OS, the leak check, the
// toolchain pick, and SKIP (never FAIL) when the cause is the machine. No Rust needed: npm run judge:test.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { localFiles, remapFlags, leakedPaths, recordedForm, recordedPaths, toolchain } from "../lib/repro.mjs";
import { checkRepro } from "../checks/chain.mjs";

const NEAR_ENV = "/crates/near-sdk-5.30.1\\src\\environment\\env.rs";

test("repro-paths.json records the deployed strings: registry paths with backslashes, workspace paths with slashes", () => {
  const p = recordedPaths();
  assert.ok(p.includes(NEAR_ENV));
  assert.ok(p.includes("contracts/market/src/lib.rs"));
  for (const x of p) assert.ok(x.startsWith("/crates/") ? !x.slice(8).includes("/") : !x.includes("\\"), x);
});

test("repro-paths.json records the deployed build's host and every wasm crate's -C metadata", () => {
  const rec = JSON.parse(fs.readFileSync(new URL("../repro-paths.json", import.meta.url), "utf8"));
  assert.equal(rec.recorded_host, "x86_64-pc-windows-gnu");
  for (const k of ["pricedin-market@0.1.0 pricedin_market", "pricedin-swarm@0.1.0 pricedin_swarm", "pricedin-agent@0.1.0 pricedin_agent", "near-sdk@5.30.1 near_sdk", "lmsr@0.1.0 lmsr"]) assert.match(rec.metadata[k] || "", /^[0-9a-f]{16}$/, k);
});

test("Linux remaps each registry file to the recorded Windows string", () => {
  const opts = { home: "/home/runner/.cargo", repo: "/home/runner/work/r/r", sep: "/", indexDirs: ["index.crates.io-1949cf8c6b5b557f"] };
  assert.deepEqual(localFiles(NEAR_ENV, opts), ["/home/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/near-sdk-5.30.1/src/environment/env.rs"]);
  const flags = remapFlags([NEAR_ENV, "contracts/market/src/lib.rs"], opts);
  assert.ok(flags.includes(`/home/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/near-sdk-5.30.1/src/environment/env.rs=${NEAR_ENV}`));
  assert.ok(flags.includes("/home/runner/work/r/r/contracts/market/src/lib.rs=contracts/market/src/lib.rs"));
  // the per-file remaps come after the prefix remap: rustc applies the last one that matches
  assert.ok(flags.indexOf("/home/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/=/crates/") < flags.findIndex((f) => f.endsWith(NEAR_ENV)));
});

test("Windows remaps the relative workspace path cargo passes", () => {
  const opts = { home: "C:\\Users\\x\\.cargo", repo: "D:\\a\\r\\r", sep: "\\", indexDirs: ["index.crates.io-1949cf8c6b5b557f"] };
  const flags = remapFlags(["contracts/market/src/lib.rs"], opts);
  assert.ok(flags.includes("contracts\\market\\src\\lib.rs=contracts/market/src/lib.rs"));
  assert.ok(flags.includes("D:\\a\\r\\r\\contracts\\market\\src\\lib.rs=contracts/market/src/lib.rs"));
});

test("the leak check passes recorded strings and flags everything else", () => {
  const rec = [NEAR_ENV, "contracts/market/src/lib.rs"];
  const wasm = Buffer.from(`\0${NEAR_ENV}\0contracts/market/src/lib.rs\0/rustc/58cf8f9c35b355199727627d07ae34a4e2846d67/library/core/src/fmt/mod.rs\0`);
  assert.deepEqual(leakedPaths(wasm, rec), []);
  assert.deepEqual(leakedPaths(Buffer.from("\0/crates/near-sdk-5.30.1/src/environment/env.rs\0"), rec), ["/crates/near-sdk-5.30.1/src/environment/env.rs"]);
  assert.deepEqual(leakedPaths(Buffer.from("\0/home/runner/.cargo/registry/src/i/serde-1.0.0/src/de.rs\0"), rec), ["/home/runner/.cargo/registry/src/i/serde-1.0.0/src/de.rs"]);
  assert.equal(recordedForm("/home/runner/.cargo/registry/src/i/serde-1.0.0/src/de.rs"), "/crates/serde-1.0.0\\src\\de.rs");
  assert.equal(recordedForm("C:\\Users\\x\\.cargo\\registry\\src\\i\\serde-1.0.0\\src\\de.rs"), "/crates/serde-1.0.0\\src\\de.rs");
});

function fakeRust({ active, toolchains, withTarget }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-test-"));
  const lib = (name) => { const d = path.join(dir, name); fs.mkdirSync(d, { recursive: true }); if (withTarget.includes(name)) fs.writeFileSync(path.join(d, "libcore-abc.rlib"), ""); return d; };
  const ok = (stdout) => ({ status: 0, stdout });
  return (cmd, args) => {
    if (cmd === "cargo") return ok("cargo 1.99.1");
    if (cmd === "rustup") return ok(Object.keys(toolchains).map((n) => (n === active ? `${n} (active, default)` : n)).join("\n") + "\n");
    const name = args[0]?.startsWith("+") ? args[0].slice(1) : active;
    if (!toolchains[name]) return { status: 1, stdout: "", stderr: "toolchain not installed" };
    if (args.includes("--print")) return ok(lib(name) + "\n");
    return ok(`rustc ${toolchains[name]} (58cf8f9c3 2026-10-13)\n`);
  };
}

test("toolchain() picks a rustc 1.99.1 that has the wasm target, whatever it is called", () => {
  // the runner case: active stable is 1.99.1 without the target, 1.99.1-x86_64-unknown-linux-gnu has it
  const run = fakeRust({ active: "stable-x86_64-unknown-linux-gnu", toolchains: { "stable-x86_64-unknown-linux-gnu": "1.99.1", "1.99.1-x86_64-unknown-linux-gnu": "1.99.1" }, withTarget: ["1.99.1-x86_64-unknown-linux-gnu"] });
  const t = toolchain({ run });
  assert.equal(t.ok, true);
  assert.deepEqual(t.args, ["+1.99.1-x86_64-unknown-linux-gnu"]);
  // the active one is preferred when it has the target
  assert.deepEqual(toolchain({ run: fakeRust({ active: "stable", toolchains: { stable: "1.99.1" }, withTarget: ["stable"] }) }).args, []);
});

test("toolchain() without the target says the command that fixes the active toolchain", () => {
  const t = toolchain({ run: fakeRust({ active: "stable", toolchains: { stable: "1.99.1" }, withTarget: [] }) });
  assert.equal(t.ok, false);
  assert.match(t.reason, /wasm32-unknown-unknown target is not installed/);
  assert.equal(t.install, "rustup target add wasm32-unknown-unknown");
  const old = toolchain({ run: fakeRust({ active: "stable", toolchains: { stable: "1.80.0" }, withTarget: ["stable"] }) });
  assert.match(old.reason, /needs rustc 1\.99\.1, found rustc 1\.80\.0/);
  assert.equal(old.install, "rustup toolchain install 1.99.1 --target wasm32-unknown-unknown");
});

test("check 3 SKIPs, with the reason and the evidence, when the cause is the machine; a real mismatch FAILs", async () => {
  const dep = { accounts: { market: "m", swarm: "s" }, code: { market: { code_hash: "A" }, swarm: { code_hash: "B" } } };
  const skip = await checkRepro("", dep, null, { offline: true, build: Promise.resolve({ ok: false, env: true, reason: "the build carries source paths the recorded build doesn't" }) });
  assert.equal(skip.status, "SKIP");
  assert.match(skip.detail, /actions\/runs\/42542226417/);
  const tc = await checkRepro("", dep, null, { offline: true, build: Promise.resolve({ ok: false, env: true, reason: "needs rustc 1.99.1", install: "rustup toolchain install 1.99.1 --target wasm32-unknown-unknown" }) });
  assert.equal(tc.status, "SKIP");
  assert.match(tc.see, /^rustup toolchain install/);
  const fail = await checkRepro("", dep, null, { offline: true, build: Promise.resolve({ ok: false, reason: "cargo build -p pricedin-market failed: error[E0425]" }) });
  assert.equal(fail.status, "FAIL");
});
