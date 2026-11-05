// A reproducible build of the market and swarm contracts.
//
// The flags are the ones scripts/build-contracts.mjs uses (--cfg near, target-cpu=mvp, stripped),
// plus --remap-path-prefix so that no path of this machine ends up in the wasm. Panic messages
// in dependencies carry their source file's path, and without a remap those paths differ on
// every machine (C:\Users\...\.cargo\registry\... here, /home/.../.cargo/registry/... elsewhere).
//
// Canonical paths, on every OS:
//   <CARGO_HOME>/registry/src/<index dir>/near-sdk-5.30.0/src/lib.rs -> /crates/near-sdk-5.30.0/src/lib.rs
//   <repo>/contracts/market/src/lib.rs                                -> contracts/market/src/lib.rs
// On Windows the rest of each path keeps its backslashes after a prefix remap, so every file
// that leaves a path in the wasm is also remapped one by one (repro-paths.json lists them; a
// build that finds a new one adds it and builds again).
//
// The toolchain is pinned: rustc 1.99.1 with the wasm32-unknown-unknown target. The committed
// contracts/swarm/res/agent.wasm is embedded in the swarm as it is; the agent wallet is rebuilt
// separately and compared with it.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUSTC = "1.99.1";
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../../..");
const PATHS_FILE = path.join(here, "../repro-paths.json");
const BASE_FLAGS = ["--cfg", "near", "-C", "target-cpu=mvp", "-C", "link-arg=-s"];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(buf) {
  let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0"));
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}
export const codeHash = (bytes) => base58(createHash("sha256").update(bytes).digest());
export const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

const cargoHome = () => process.env.CARGO_HOME || path.join(os.homedir(), ".cargo");

/** What toolchain is here: { ok, cargo, args, version, reason }. Uses `cargo +1.99.1` through rustup when it can. */
export function toolchain() {
  const env = { ...process.env, PATH: `${path.join(cargoHome(), "bin")}${path.delimiter}${process.env.PATH}` };
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", env, shell: false });
  const plain = run("cargo", ["--version"]);
  if (plain.error || plain.status !== 0) return { ok: false, reason: "Rust is not installed" };
  // the active toolchain if it is the pinned version, else `+1.99.1` through rustup
  let args = [], version = (run("rustc", ["--version"]).stdout || "").trim();
  if (!version.startsWith(`rustc ${RUSTC} `)) {
    const pinned = run("rustc", [`+${RUSTC}`, "--version"]);
    if (!pinned.error && pinned.status === 0 && pinned.stdout.startsWith(`rustc ${RUSTC} `)) { args = [`+${RUSTC}`]; version = pinned.stdout.trim(); }
  }
  if (!version.startsWith(`rustc ${RUSTC} `)) return { ok: false, version, reason: `needs rustc ${RUSTC}, found ${version || "none"}` };
  const targets = run("rustup", ["target", "list", "--installed", ...(args.length ? ["--toolchain", RUSTC] : [])]);
  if (!targets.error && targets.status === 0 && !/wasm32-unknown-unknown/.test(targets.stdout)) return { ok: false, version, reason: "the wasm32-unknown-unknown target is not installed" };
  return { ok: true, cargo: "cargo", args, version, env };
}

function canonical(p) {
  const norm = p.replace(/\\/g, "/");
  const reg = norm.match(/\/registry\/src\/[^/]+\/(.*)$/);
  if (reg) return `/crates/${reg[1]}`;
  const repo = REPO.replace(/\\/g, "/");
  if (norm.toLowerCase().startsWith(repo.toLowerCase() + "/")) return norm.slice(repo.length + 1);
  return norm;
}

function remaps(extraFiles) {
  const out = [];
  const regSrc = path.join(cargoHome(), "registry", "src");
  if (fs.existsSync(regSrc)) for (const d of fs.readdirSync(regSrc)) out.push(`${path.join(regSrc, d)}${path.sep}=/crates/`);
  // per-file remaps come last: rustc applies the last matching one
  for (const f of extraFiles) out.push(`${f}=${canonical(f)}`);
  return out.flatMap((r) => ["--remap-path-prefix", r]);
}

/** Source paths a wasm still carries that aren't canonical (absolute, or with backslashes). */
export function leakedPaths(bytes) {
  const strs = Buffer.from(bytes).toString("latin1").match(/[ -~]{6,}/g) || [];
  const found = new Set();
  for (const s of strs) for (const m of s.matchAll(/(?:[A-Za-z]:\\|\/)?[\w.\-\\/: ]*?[\w\-]+\.rs\b/g)) {
    const p = m[0];
    if (p.startsWith("/rustc/") || p.startsWith("/crates/")) continue;
    if (/\\/.test(p) || /^[A-Za-z]:/.test(p) || (p.startsWith("/") && !p.startsWith("/crates/"))) found.add(p);
  }
  return [...found];
}

function cargoBuild(tc, pkg, targetDir, flags, log) {
  return new Promise((resolve) => {
    const env = { ...tc.env, CARGO_TARGET_DIR: targetDir, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") };
    delete env.RUSTFLAGS;
    const child = spawn(tc.cargo, [...tc.args, "build", "--locked", "-p", pkg, "--release", "--target", "wasm32-unknown-unknown"], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stdout.on("data", (d) => log?.(String(d)));
    child.stderr.on("data", (d) => { err += d; log?.(String(d)); });
    child.on("error", (e) => resolve({ ok: false, err: String(e.message) }));
    child.on("close", (code) => resolve({ ok: code === 0, err: err.slice(-1500) }));
  });
}

/**
 * Build market, swarm and the agent wallet reproducibly into targetDir.
 * Returns { ok, reason?, wasm: { market, swarm, agent }: { bytes, hash, sha256, size } , flags, rebuilt }.
 */
export async function reproBuild({ targetDir = path.join(REPO, "target", "judge-repro"), log } = {}) {
  const tc = toolchain();
  if (!tc.ok) return { ok: false, reason: tc.reason };
  let known = fs.existsSync(PATHS_FILE) ? JSON.parse(fs.readFileSync(PATHS_FILE, "utf8")).windows : [];
  const onWindows = process.platform === "win32";
  const files = () => (onWindows ? known.flatMap(expandWindows) : []);
  const pkgs = [["pricedin-market", "pricedin_market"], ["pricedin-swarm", "pricedin_swarm"], ["pricedin-agent", "pricedin_agent"]];
  let rebuilt = 0;
  for (let pass = 0; pass < 3; pass++) {
    const flags = [...BASE_FLAGS, ...remaps(files())];
    for (const [pkg] of pkgs) {
      const r = await cargoBuild(tc, pkg, targetDir, flags, log);
      if (!r.ok) return { ok: false, reason: `cargo build -p ${pkg} failed: ${r.err.split("\n").filter(Boolean).slice(-3).join(" | ")}` };
    }
    const wasm = {};
    let leaks = [];
    for (const [, file] of pkgs) {
      const bytes = fs.readFileSync(path.join(targetDir, "wasm32-unknown-unknown", "release", `${file}.wasm`));
      wasm[file.replace("pricedin_", "")] = { bytes, hash: codeHash(bytes), sha256: sha256hex(bytes), size: bytes.length };
      leaks.push(...leakedPaths(bytes));
    }
    leaks = [...new Set(leaks)];
    if (!leaks.length) return { ok: true, wasm, flags: flags.join(" "), toolchain: tc.version, rebuilt };
    if (!onWindows) return { ok: false, reason: `the build still carries local paths: ${leaks.slice(0, 3).join(", ")}` };
    // learn the new Windows paths, store them in their portable form and build again
    const add = leaks.map(portableWindows).filter((p) => !known.includes(p));
    if (!add.length) return { ok: false, reason: `paths survive the remap: ${leaks.slice(0, 3).join(", ")}` };
    known = [...known, ...add].sort();
    fs.writeFileSync(PATHS_FILE, JSON.stringify({ note: "Source files whose paths reach the wasm. On Windows each is remapped one by one, because a prefix remap keeps the backslashes after the prefix. Paths are stored relative to CARGO_HOME/registry/src/<index>/ (registry:) or to the repo (repo:).", windows: known }, null, 1) + "\n");
    rebuilt++;
  }
  return { ok: false, reason: "paths kept leaking after three builds" };
}

// "registry:near-sdk-5.30.0\src\lib.rs" or "repo:contracts\market\src\lib.rs" <-> a full local path
function portableWindows(p) {
  const m = p.match(/[\\/]registry[\\/]src[\\/][^\\/]+[\\/](.*)$/);
  if (m) return `registry:${m[1].replace(/\//g, "\\")}`;
  const repo = REPO + path.sep;
  if (p.toLowerCase().startsWith(repo.toLowerCase())) return `repo:${p.slice(repo.length)}`;
  return `repo:${p}`;
}
function expandWindows(entry) {
  if (entry.startsWith("registry:")) {
    const regSrc = path.join(cargoHome(), "registry", "src");
    const dirs = fs.existsSync(regSrc) ? fs.readdirSync(regSrc) : [];
    return dirs.map((d) => path.join(regSrc, d, entry.slice(9)));
  }
  return [entry.slice(5)];
}
