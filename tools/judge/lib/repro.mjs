// A reproducible build of the market and swarm contracts, byte for byte the code on chain, on any OS.
//
// The flags are the ones scripts/build-contracts.mjs uses (--cfg near, target-cpu=mvp, stripped),
// plus --remap-path-prefix. Panic messages in dependencies carry their source file's path, and
// without a remap those paths differ on every machine. The deployed wasm was built on Windows and
// carries these paths exactly as tools/judge/repro-paths.json records them, for example
//   /crates/near-sdk-5.30.1\src\environment\env.rs     (a registry crate: the prefix remap kept the backslashes)
//   contracts/market/src/lib.rs                         (a workspace file)
// So every OS remaps each of those source files, one by one, to its recorded string: the local file
// <CARGO_HOME>/registry/src/<index dir>/near-sdk-5.30.1/src/environment/env.rs becomes
// /crates/near-sdk-5.30.1\src\environment\env.rs on Linux and macOS too.
//
// The other thing that depends on the machine is cargo's -C metadata (see "the recorded -C metadata"
// below): a RUSTC_WRAPPER sets the deployed build's values. Not machine-dependent (tested): the
// workspace and CARGO_HOME locations and RUSTFLAGS. CI rebuilds the deployed hashes on clean Linux,
// macOS and Windows runners (.github/workflows/repro.yml, run 42542226417).
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
export const TARGET = "wasm32-unknown-unknown";
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../../..");
const PATHS_FILE = path.join(here, "../repro-paths.json");
const BASE_FLAGS = ["--cfg", "near", "-C", "target-cpu=mvp", "-C", "link-arg=-s"];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** The evidence that the build reproduces on other machines: the deployed hashes rebuilt on clean ubuntu, macos and windows runners. */
export const CI_EVIDENCE = "https://github.com/iamdflame/priced-in/actions/runs/42542226417";

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

/**
 * Which toolchain to build with: { ok, cargo, args, version, env, toolchain } or { ok: false, reason, install }.
 * Prefers a rustc 1.99.1 that has the wasm target: the active one, then `+1.99.1`, then any installed
 * toolchain that is 1.99.1 under another name (a runner's preinstalled stable, say).
 */
export function toolchain({ run } = {}) {
  const env = { ...process.env, PATH: `${path.join(cargoHome(), "bin")}${path.delimiter}${process.env.PATH}` };
  run ||= (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", env, shell: false });
  const ok = (r) => r && !r.error && r.status === 0;
  if (!ok(run("cargo", ["--version"]))) return { ok: false, reason: "Rust is not installed", install: `install rustup (https://rustup.rs), then: rustup toolchain install ${RUSTC} --target ${TARGET}` };
  const names = [null, RUSTC];
  const listed = run("rustup", ["toolchain", "list"]);
  if (ok(listed)) for (const line of listed.stdout.split("\n")) { const n = line.trim().split(/\s+/)[0]; if (n && !names.includes(n)) names.push(n); }
  const tried = [];
  for (const name of names) {
    const plus = name ? [`+${name}`] : [];
    const v = run("rustc", [...plus, "--version"]);
    if (!ok(v) || !v.stdout.startsWith(`rustc ${RUSTC} `)) { if (name === null && ok(v)) tried.push({ name, version: v.stdout.trim() }); continue; }
    const version = v.stdout.trim();
    const lib = run("rustc", [...plus, "--print", "target-libdir", "--target", TARGET]);
    const dir = ok(lib) ? lib.stdout.trim() : "";
    const has = dir && fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /^libcore-/.test(f));
    if (has) return { ok: true, cargo: "cargo", args: plus, version, env, toolchain: name || "active" };
    tried.push({ name, version, noTarget: true });
  }
  const noTarget = tried.find((t) => t.noTarget);
  if (noTarget) {
    // fix the toolchain that cargo would use: the active one if it is 1.99.1, else the pinned one
    const tcArg = noTarget.name ? ` --toolchain ${noTarget.name}` : "";
    return { ok: false, version: noTarget.version, reason: `the ${TARGET} target is not installed for rustc ${RUSTC}${noTarget.name ? ` (toolchain ${noTarget.name})` : ""}`, install: `rustup target add ${TARGET}${tcArg}` };
  }
  const found = tried[0]?.version || "none";
  return { ok: false, version: found, reason: `needs rustc ${RUSTC}, found ${found}`, install: `rustup toolchain install ${RUSTC} --target ${TARGET}` };
}

// ---------- the recorded paths ----------

/** The source-path strings the deployed wasm carries, from repro-paths.json. */
export function recordedPaths(file = PATHS_FILE) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")).paths || [];
}

/**
 * The local files a recorded path stands for, each as rustc may see it:
 *   "/crates/near-sdk-5.30.1\src\lib.rs" -> <CARGO_HOME>/registry/src/<every index dir>/near-sdk-5.30.1/src/lib.rs
 *   "contracts/market/src/lib.rs"        -> contracts/market/src/lib.rs (cargo passes workspace files relative) and <REPO>/contracts/...
 */
export function localFiles(recorded, { home = cargoHome(), repo = REPO, sep = path.sep, indexDirs } = {}) {
  const parts = recorded.replace(/^\/crates\//, "").split(/[\\/]/);
  const join = (...xs) => xs.join(sep);
  if (recorded.startsWith("/crates/")) {
    const regSrc = join(home, "registry", "src");
    const dirs = indexDirs || (fs.existsSync(regSrc) ? fs.readdirSync(regSrc) : []);
    return dirs.map((d) => join(regSrc, d, ...parts));
  }
  return [...new Set([join(...parts), join(repo, ...parts)])];
}

/** The recorded form of a path a build leaked: registry files keep the deployed build's backslashes. */
export function recordedForm(p, { repo = REPO } = {}) {
  const norm = p.replace(/\\/g, "/");
  const reg = norm.match(/\/registry\/src\/[^/]+\/(.*)$/) || norm.match(/^\/crates\/(.*)$/);
  if (reg) return `/crates/${reg[1].replace(/\//g, "\\")}`;
  const r = repo.replace(/\\/g, "/");
  if (norm.toLowerCase().startsWith(r.toLowerCase() + "/")) return norm.slice(r.length + 1);
  return norm;
}

export function remapFlags(recorded, opts = {}) {
  const out = [];
  const home = opts.home || cargoHome(), sep = opts.sep || path.sep;
  const regSrc = [home, "registry", "src"].join(sep);
  const dirs = opts.indexDirs || (fs.existsSync(regSrc) ? fs.readdirSync(regSrc) : []);
  // a prefix remap first, for any registry path not recorded (it shows up as a leak: it has no recorded form)
  for (const d of dirs) out.push(`${[regSrc, d].join(sep)}${sep}=/crates/`);
  // then each recorded file: rustc applies the last matching remap
  for (const r of recorded) for (const f of localFiles(r, { ...opts, home, sep, indexDirs: dirs })) if (f !== r) out.push(`${f}=${r}`);
  return out.flatMap((r) => ["--remap-path-prefix", r]);
}

/** Source paths a wasm carries that the recorded build doesn't (local paths, or a form not in repro-paths.json). */
export function leakedPaths(bytes, recorded = recordedPaths()) {
  const known = new Set(recorded);
  const strs = Buffer.from(bytes).toString("latin1").match(/[ -~]{6,}/g) || [];
  const found = new Set();
  for (const s of strs) for (const m of s.matchAll(/(?:[A-Za-z]:\\|\/)?[\w.\-\\/: ]*?[\w\-]+\.rs\b/g)) {
    const p = m[0];
    if (p.startsWith(`/rustc/`) || known.has(p)) continue;
    if (/\\/.test(p) || /^[A-Za-z]:/.test(p) || p.startsWith("/")) found.add(p);
  }
  return [...found];
}

function spawnCargo(tc, args, env, log) {
  return new Promise((resolve) => {
    const child = spawn(tc.cargo, [...tc.args, ...args], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stdout.on("data", (d) => log?.(String(d)));
    child.stderr.on("data", (d) => { err += d; log?.(String(d)); });
    child.on("error", (e) => resolve({ ok: false, err: String(e.message) }));
    child.on("close", (code) => resolve({ ok: code === 0, err: err.slice(-1500) }));
  });
}
const lastLines = (s) => s.split("\n").filter(Boolean).slice(-3).join(" | ");

// ---------- the recorded -C metadata ----------
// Cargo gives each crate a -C metadata hash that seeds its symbol names, and so the order of functions
// in the wasm. For a crate that depends on a proc macro or a build script, that hash includes the
// host triple (the host crates' own hashes do), so Linux, macOS and Windows-msvc hosts name the same
// functions differently from the Windows-gnu host the deployed build ran on. tools/judge/repro-wrapper,
// a std-only RUSTC_WRAPPER, sets each wasm crate's -C metadata to the value recorded from that build.

const WRAPPER_DIR = path.join(here, "../repro-wrapper");
const HOST_TROUBLE = /linker `[^`]+` not found|error: linking with|link\.exe|No space left|Permission denied|Access is denied|failed to run custom build command/;
const readRecord = () => (fs.existsSync(PATHS_FILE) ? JSON.parse(fs.readFileSync(PATHS_FILE, "utf8")) : {});
function saveRecord(rec) {
  const out = { note: PATHS_NOTE, recorded_host: rec.recorded_host, paths: [...(rec.paths || [])].sort(), metadata_note: META_NOTE, metadata: rec.metadata || {} };
  fs.writeFileSync(PATHS_FILE, JSON.stringify(out, null, 1) + "\n");
}
/** The host triple of a toolchain, from `rustc -vV`. */
export function hostTriple(tc) {
  const r = spawnSync("rustc", [...tc.args, "-vV"], { encoding: "utf8", env: tc.env });
  return (r.stdout || "").match(/^host: (\S+)/m)?.[1] || "unknown";
}

async function buildWrapper(tc, targetDir, log) {
  const dir = path.join(targetDir, "wrapper");
  const r = await spawnCargo(tc, ["build", "--release", "--locked", "--manifest-path", path.join(WRAPPER_DIR, "Cargo.toml"), "--target-dir", dir], { ...tc.env }, log);
  if (!r.ok) return { ok: false, reason: `the build wrapper (tools/judge/repro-wrapper) did not build: ${lastLines(r.err)}` };
  return { ok: true, exe: path.join(dir, "release", `repro-wrapper${process.platform === "win32" ? ".exe" : ""}`) };
}

/**
 * Build market, swarm and the agent wallet reproducibly into targetDir.
 * Returns { ok, wasm: { market, swarm, agent }: { bytes, hash, sha256, size }, flags, toolchain, host, rebuilt }
 * or { ok: false, reason, env } where env is true when the cause is this machine (no toolchain, no
 * network for the crates, a path that couldn't be remapped), not the source.
 * learn: add newly leaked paths to repro-paths.json and build again (the deploy scripts do; the judge doesn't).
 * record: on the recorded host, store cargo's own -C metadata values in repro-paths.json (after a dependency change).
 */
export async function reproBuild({ targetDir = path.join(REPO, "target", "judge-repro"), log, learn = true, record = false } = {}) {
  const tc = toolchain();
  if (!tc.ok) return { ok: false, env: true, reason: tc.reason, install: tc.install };
  const host = hostTriple(tc);
  let rec = readRecord();
  if (record && rec.recorded_host && rec.recorded_host !== host) return { ok: false, env: true, reason: `the -C metadata values are recorded on ${rec.recorded_host}; this host is ${host}` };
  const env = { ...tc.env, CARGO_TARGET_DIR: targetDir };
  delete env.RUSTFLAGS; delete env.RUSTC_WRAPPER; delete env.RUSTC_WORKSPACE_WRAPPER;
  // the registry must be unpacked before the remaps are listed: a clean machine has no registry/src yet
  const fetched = await spawnCargo(tc, ["fetch", "--locked", "--target", TARGET], env, log);
  if (!fetched.ok) return { ok: false, env: true, reason: `cargo fetch failed (the crates could not be downloaded): ${lastLines(fetched.err)}` };
  const wrapper = await buildWrapper(tc, targetDir, log);
  if (!wrapper.ok) return { ok: false, env: true, reason: wrapper.reason };
  fs.mkdirSync(targetDir, { recursive: true });
  const metaFile = path.join(targetDir, "repro-metadata.txt"), missFile = path.join(targetDir, "repro-misses.txt"), recFile = path.join(targetDir, "repro-recorded.txt");
  const pkgs = [["pricedin-market", "pricedin_market"], ["pricedin-swarm", "pricedin_swarm"], ["pricedin-agent", "pricedin_agent"]];
  let rebuilt = 0;
  for (let pass = 0; pass < 3; pass++) {
    const meta = record ? "" : Object.entries(rec.metadata || {}).map(([k, v]) => `${k} ${v}`).join("\n") + "\n";
    // cargo doesn't see the table, so it wouldn't recompile a crate whose recorded value changed: a stamp does
    const stamp = sha256hex(Buffer.from(JSON.stringify({ meta, record, wrapper: fs.readFileSync(path.join(WRAPPER_DIR, "src", "main.rs"), "utf8") })));
    const stampFile = path.join(targetDir, "repro-stamp");
    if (record || !fs.existsSync(stampFile) || fs.readFileSync(stampFile, "utf8") !== stamp) fs.rmSync(path.join(targetDir, TARGET), { recursive: true, force: true });
    fs.writeFileSync(metaFile, meta);
    for (const f of [missFile, recFile]) fs.rmSync(f, { force: true });
    const flags = [...BASE_FLAGS, ...remapFlags(rec.paths || [])];
    const benv = { ...env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f"), RUSTC_WRAPPER: wrapper.exe, PRICEDIN_REPRO_MISSES: missFile, ...(record ? { PRICEDIN_REPRO_RECORD: recFile } : { PRICEDIN_REPRO_METADATA: metaFile }) };
    for (const [pkg] of pkgs) {
      const r = await spawnCargo(tc, ["build", "--locked", "-p", pkg, "--release", "--target", TARGET], benv, log);
      // a missing host linker or a full disk is this machine; a compile error is the source
      if (!r.ok) return { ok: false, env: HOST_TROUBLE.test(r.err), reason: `cargo build -p ${pkg} failed: ${lastLines(r.err)}` };
    }
    fs.writeFileSync(stampFile, stamp);
    if (record) {
      const metadata = {};
      for (const line of fs.readFileSync(recFile, "utf8").split("\n").filter(Boolean)) { const i = line.lastIndexOf(" "); metadata[line.slice(0, i)] = line.slice(i + 1).trim(); }
      rec = { ...rec, recorded_host: host, metadata };
      saveRecord(rec);
    } else if (fs.existsSync(missFile)) {
      const missing = [...new Set(fs.readFileSync(missFile, "utf8").split("\n").filter(Boolean))];
      return { ok: false, env: true, reason: `${missing.length} crates have no recorded -C metadata (the dependencies changed since the recorded build; node tools/judge/repro.mjs --record on ${rec.recorded_host} records them): ${missing.slice(0, 3).join(", ")}` };
    }
    const wasm = {};
    let leaks = [];
    for (const [, file] of pkgs) {
      const bytes = fs.readFileSync(path.join(targetDir, TARGET, "release", `${file}.wasm`));
      wasm[file.replace("pricedin_", "")] = { bytes, hash: codeHash(bytes), sha256: sha256hex(bytes), size: bytes.length };
      leaks.push(...leakedPaths(bytes, rec.paths || []));
    }
    leaks = [...new Set(leaks)];
    if (!leaks.length) return { ok: true, wasm, flags: flags.join(" "), toolchain: tc.version, host, rebuilt };
    const known = rec.paths || [];
    const add = [...new Set(leaks.map((p) => recordedForm(p)))].filter((p) => !known.includes(p));
    if (!learn || !add.length) return { ok: false, env: true, reason: `the build carries source paths the recorded build doesn't, so its bytes can't match: ${leaks.slice(0, 3).join(", ")}` };
    rec = { ...rec, paths: [...known, ...add] };
    saveRecord(rec);
    rebuilt++;
  }
  return { ok: false, env: true, reason: "paths kept leaking after three builds" };
}

const PATHS_NOTE = "What the deployed market and swarm wasm were built with, so any OS rebuilds the same bytes (tools/judge/lib/repro.mjs). paths: the source-file paths the deployed wasm carries in panic messages, exactly as they are in its bytes. The deployed build ran on Windows: a registry crate's path is /crates/ then the crate's own path with backslashes, a workspace file's path is relative with forward slashes. Each local source file is remapped to its string here.";
const META_NOTE = "metadata: the -C metadata cargo gave each wasm crate on recorded_host, keyed '<package>@<version> <crate>'. Cargo hashes the host triple into it for crates that use a proc macro or a build script, and it seeds the symbol names, so the function order. tools/judge/repro-wrapper sets these values on every host. Recorded with node tools/judge/repro.mjs --record on recorded_host.";

