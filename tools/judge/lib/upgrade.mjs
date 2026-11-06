// Upgrades a market in place to the reproducible build of this checkout, only if the contract's
// state layout is unchanged, and proves the result. tools/judge/upgrade-testnet.mjs and
// upgrade-mainnet.mjs run this one path, so what the rehearsal proves on testnet is what mainnet
// runs. Reads first, signs last; it prints no key.
//
// Read only (all that --dry-run does, which needs no key):
//  1. Layout, twice: `pub struct PricedIn` in contracts/market/src/lib.rs must be LAYOUT below
//     field for field, and the live STATE must decode under LAYOUT with every byte used and the
//     totals equal to the live `stats`. Every stored value type is unchanged since --from-rev.
//     Either fails: no upgrade (write a migration instead).
//  2. Every stored claim decodes from raw storage, every byte used, and matches its view.
//  3. The reproducible build (tools/judge/lib/repro.mjs). The live code must be the code the
//     deployment file records, and the new wasm may import only host functions the live code
//     already imports, so it can't link one the network's protocol doesn't have yet.
//  4. The account can pay for the bigger code.
// Then, signing:
//  5. Pauses the market (--no-pause skips this), so nothing moves while it is compared: a trade
//     landing mid-upgrade would otherwise fail "unchanged" for no fault of the upgrade. A pause
//     also holds every way out of the contract, so a failure below leaves the money still.
//  6. Deploys the new wasm to the same account: no init, no migration, same state.
//  7. Verifies: the code hash on chain is the build; the STATE bytes and `get_resolution` are
//     exactly what they were; every field `stats` and each claim view had is unchanged; the new
//     claim fields equal the stored claims, and the browser's port prices every claim to the ppm
//     and quotes as quote_buy does.
//  8. --set-fee-bps <n>: the owner sets the fee. The STATE bytes must not move: the fee lives
//     outside the state struct.
//  9. Unpauses, if it paused, and records the upgrade in the deployment file (unless --no-record).
// A step that fails after the pause leaves the market paused, on purpose, and says so.
// --finish completes steps 8 and 9 after a run that was cut off once the code was deployed.
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { reproBuild, REPO } from "./repro.mjs";
import { RotatingProvider, TESTNET } from "./provider.mjs";
import { MAINNET_RPCS } from "./near.mjs";

const TGAS = 10n ** 12n;
const BYTE_COST = 10n ** 19n; // yoctoNEAR per byte of storage
// The deploy's gas, which the market account pays: the runtime sets it aside at a pessimistic gas
// price before it checks storage. Measured on testnet for a 435 KB market: 0.0256 NEAR, which a
// 0.01 NEAR margin missed (the deploy failed "lacks balance for state"). 0.06 NEAR covers it twice.
const GAS_MARGIN = 6n * 10n ** 22n;
const MAX_FEE_BPS = 300;

// The market's state struct, in borsh order, as v2 deployed it (contracts/market/src/lib.rs).
const LAYOUT = [
  ["owner", "AccountId"], ["pending_owner", "Option<AccountId>"], ["usdc", "AccountId"], ["lane", "AccountId"],
  ["swarm", "Option<AccountId>"], ["paused", "bool"], ["operators", "LookupMap<AccountId, bool>"],
  ["house_agents", "LookupMap<AccountId, bool>"], ["planner_key", "Vec<u8>"], ["claims", "LookupMap<u64, Claim>"],
  ["next_claim", "u64"], ["receipts", "LookupMap<Vec<u8>, u64>"], ["balances", "LookupMap<String, u128>"],
  ["positions", "LookupMap<String, Position>"], ["credited", "LookupMap<String, u128>"], ["treasury_micro", "u128"],
  ["reserved_micro", "u128"], ["reserve_cap_micro", "u128"], ["lane_budget_micro", "u128"], ["lane_credit_micro", "u128"],
  ["models", "LookupMap<String, Model>"], ["challenges", "LookupMap<u64, Challenge>"], ["next_challenge", "u64"],
  ["challenge_bond_micro", "u128"], ["jury_deadline_secs", "u64"], ["dispute_tiers", "Vec<(u128, u64)>"],
  ["dispute_top_secs", "u64"], ["bounty_ttl_secs", "u64"], ["bounties", "LookupMap<String, Bounty>"],
  ["rewrites_anchored", "u64"], ["held_micro", "u128"], ["balances_micro", "u128"], ["collected_micro", "i128"],
  ["payouts_micro", "u128"], ["bonds_micro", "u128"], ["bounties_micro", "u128"],
];
// Every type a stored value has. A change to any of these (or to Status) changes stored values
// even when the struct above keeps its bytes, so their source text is pinned too.
const VALUE_TYPES = ["Claim", "Position", "Challenge", "Verdict", "Stake", "Model", "Bounty", "Status"];
const STATUS = ["Open", "Challenged", "Escalated", "Settled"];
// What v3 added to the views. Anything else new, or anything missing, is a failure.
const NEW_STATS = ["fee_bps", "fees_micro"];
const NEW_CLAIM = ["b_micro", "d0", "q_yes_micro", "q_no_micro", "fee_bps"];

function borsh(buf) {
  let o = 0;
  const need = (n) => { if (o + n > buf.length) throw new Error(`ends at byte ${buf.length}, needed ${o + n}`); };
  const u32 = () => { need(4); const v = buf.readUInt32LE(o); o += 4; return v; };
  const bytes = () => { const n = u32(); need(n); const v = buf.subarray(o, o + n); o += n; return v; };
  const str = () => bytes().toString("utf8");
  const u8 = () => { need(1); return buf[o++]; };
  const u64 = () => { need(8); const v = buf.readBigUInt64LE(o); o += 8; return v; };
  const u128 = () => { const lo = u64(), hi = u64(); return (hi << 64n) | lo; };
  const i128 = () => { const v = u128(); return v >= 1n << 127n ? v - (1n << 128n) : v; };
  const bool = () => { const b = u8(); if (b > 1) throw new Error(`bad bool at ${o - 1}`); return b === 1; };
  const opt = (f) => { const t = u8(); if (t > 1) throw new Error(`bad option tag at ${o - 1}`); return t ? f() : null; };
  return { u32, bytes, str, u8, u64, u128, i128, bool, opt, used: () => o };
}

function decodeState(buf) {
  const r = borsh(buf);
  const read = {
    "AccountId": r.str, "Option<AccountId>": () => r.opt(r.str), "bool": r.bool, "Vec<u8>": () => r.bytes().toString("hex"), "u64": r.u64, "u128": r.u128, "i128": r.i128,
    "Vec<(u128, u64)>": () => { const n = r.u32(); return Array.from({ length: n }, () => [r.u128(), r.u64()]); },
  };
  const out = {};
  for (const [name, type] of LAYOUT) out[name] = type.startsWith("LookupMap<") ? r.bytes().toString("latin1") : read[type]();
  return { value: out, used: r.used() };
}

/** A stored Claim, field by field (`pub struct Claim` in contracts/market/src/lib.rs). */
function decodeClaim(buf) {
  const r = borsh(buf);
  const c = {
    text: r.str(), page: r.str(), kind: r.str(), b: r.i128(), d0: r.i128(), q_yes: r.i128(), q_no: r.i128(),
    status: STATUS[r.u8()], outcome: r.opt(r.bool), provisional: r.opt(r.bool), reserve_micro: r.u128(),
    collected_micro: r.i128(), payout_left_micro: r.u128(), trades: r.u32(), volume_micro: r.u128(), created_ns: r.u64(),
    challenge: r.opt(r.u64), prev: r.opt(r.u64), next: r.opt(r.u64), bounty_micro: r.u128(), bounty_epoch: r.u32(),
  };
  if (r.used() !== buf.length) throw new Error(`a claim used ${r.used()} of ${buf.length} bytes`);
  return c;
}

/** The host functions a wasm module imports, as "module.name". */
export function wasmImports(bytes) {
  const buf = Buffer.from(bytes);
  let o = 8;
  const u = () => { let v = 0, s = 0, b; do { b = buf[o++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; };
  const name = () => { const n = u(), v = buf.subarray(o, o + n).toString("utf8"); o += n; return v; };
  const out = [];
  while (o < buf.length) {
    const id = buf[o++], size = u(), end = o + size;
    if (id === 2) {
      for (let n = u(); n > 0; n--) {
        const f = `${name()}.${name()}`;
        const kind = buf[o++];
        if (kind === 0) u();
        else if (kind === 1) { o++; const fl = u(); u(); if (fl & 1) u(); }
        else if (kind === 2) { const fl = u(); u(); if (fl & 1) u(); }
        else if (kind === 3) o += 2;
        out.push(f);
      }
    }
    o = end;
  }
  return out;
}

function deployerKey() {
  const env = {};
  for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim();
  }
  if (!env.NEAR_DEPLOYER_PRIVATE_KEY) throw new Error("NEAR_DEPLOYER_PRIVATE_KEY is not in .env");
  return env.NEAR_DEPLOYER_PRIVATE_KEY;
}

export async function upgradeMarket(network) {
  const argv = process.argv;
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i > 0 ? argv[i + 1] : dflt; };
  const DRY = argv.includes("--dry-run"), RECORD = !argv.includes("--no-record"), PAUSE = !argv.includes("--no-pause"), FINISH = argv.includes("--finish");
  const MAINNET = network === "mainnet";
  // before anything else: this is what stops a stray run from signing on mainnet
  if (MAINNET && !DRY && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it, or add --dry-run to read only."); process.exit(1); }
  const feeArg = arg("--set-fee-bps", null);
  const FEE = feeArg === null ? null : Number(feeArg);
  if (FEE !== null && !(Number.isInteger(FEE) && FEE >= 0 && FEE <= MAX_FEE_BPS)) { console.error(`--set-fee-bps must be a whole number from 0 to ${MAX_FEE_BPS}`); process.exit(1); }

  const depFile = path.resolve(REPO, arg("--deployment", `deployments/${network}.json`));
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const M = dep.accounts.market;
  if (dep.network !== network || !M.endsWith(MAINNET ? ".near" : ".testnet")) { console.error(`${path.relative(REPO, depFile)} is not a ${network} deployment`); process.exit(1); }
  // testnet's key is the test root's, in a git-ignored file; mainnet's is read only after every
  // read-only check has passed and CONFIRM_MAINNET=yes
  let st = null;
  if (!MAINNET) {
    const stateFile = path.resolve(REPO, arg("--state", ".apex-test/judge-testnet.json"));
    st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (M !== `market.${st.root}`) { console.error(`${path.relative(REPO, stateFile)} is for ${st.root}, not ${M}`); process.exit(1); }
  }
  const provider = new RotatingProvider(MAINNET ? process.env.NEAR_MAINNET_RPC || MAINNET_RPCS : process.env.NEAR_TESTNET_RPC || TESTNET);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flaky = (e) => /fetch failed|ECONNRESET|ETIMEDOUT|socket|network|503|502|429|Rate limits|timeout/i.test(String(e?.message || e));
  async function retry(fn) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 5 || !flaky(e)) throw e; await sleep(2000 * (i + 1)); } } }
  const q = (params) => retry(() => provider.query({ finality: "final", ...params }));
  const view = (method, args = {}) => retry(() => provider.callFunction({ contractId: M, method, args, blockQuery: { finality: "final" } }));
  const liveHash = async (id) => (await q({ request_type: "view_account", account_id: id })).code_hash;
  // Everything compared is read at one final block: two reads at "final" a second apart can see
  // two blocks, and a trade between them looks like state that doesn't match its own stats.
  const qAt = (h, params) => retry(() => provider.query({ ...params, block_id: h }));
  const viewAt = (h, method, args = {}) => retry(() => provider.callFunction({ contractId: M, method, args, blockQuery: { blockId: h } }));
  const rawAt = async (h, prefix) => (await qAt(h, { request_type: "view_state", account_id: M, prefix_base64: Buffer.from(prefix).toString("base64") })).values || [];
  async function snapshot() {
    for (let i = 0; ; i++) {
      try {
        const h = (await retry(() => provider.viewBlock({ finality: "final" }))).header.height;
        const state = (await rawAt(h, "STATE")).find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
        if (!state) throw new Error("no STATE key on the market");
        const stats = await viewAt(h, "stats"), resolution = await viewAt(h, "get_resolution");
        const claims = [];
        for (let from = 0; from < stats.claims; from += 100) claims.push(...(await viewAt(h, "get_claims", { from, limit: 100 })));
        const stored = new Map();
        for (const { key, value } of await rawAt(h, "c")) {
          const k = Buffer.from(key, "base64");
          if (k.length === 9) stored.set(Number(k.readBigUInt64LE(1)), decodeClaim(Buffer.from(value, "base64")));
        }
        return { h, bytes: Buffer.from(state.value, "base64"), stats, resolution, claims, stored };
      } catch (e) {
        // a node behind the others may not have the block yet: take a newer one
        if (i >= 3 || /no STATE key|claim used/.test(String(e.message))) throw e;
        await sleep(2000);
      }
    }
  }
  const stateBytes = async () => (await snapshot()).bytes;
  let bad = 0;
  const ok = (name, pass, detail = "") => { console.log(`${pass ? "ok  " : "BAD "} ${name}${detail ? " · " + detail : ""}`); if (!pass) bad++; return pass; };

  // ---------- 1. the source keeps the layout ----------
  const src = fs.readFileSync(path.join(REPO, "contracts/market/src/lib.rs"), "utf8");
  const body = src.match(/pub struct PricedIn \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const fields = body.split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter(Boolean).map((l) => l.match(/^(\w+):\s*(.+?),?$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/\s+/g, " ")]);
  const same = fields.length === LAYOUT.length && fields.every(([n, t], i) => n === LAYOUT[i][0] && t === LAYOUT[i][1]);
  ok("the source's PricedIn struct is the deployed layout, field for field", same, same ? `${fields.length} fields` : `differs at ${fields.findIndex(([n, t], i) => !LAYOUT[i] || n !== LAYOUT[i][0] || t !== LAYOUT[i][1])}`);
  const typeText = (text, name) => text.match(new RegExp(`pub (?:struct|enum) ${name} \\{[\\s\\S]*?\\n\\}`))?.[0]?.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ") ?? null;

  // the live state decodes under the layout
  let before = await snapshot();
  let decoded;
  try { decoded = decodeState(before.bytes); } catch (e) { decoded = { error: e.message }; }
  ok("the live STATE decodes under the layout with every byte used", !decoded.error && decoded.used === before.bytes.length, decoded.error || `${before.bytes.length} bytes at block ${before.h}`);
  const totals = ["treasury_micro", "reserved_micro", "lane_budget_micro", "lane_credit_micro", "held_micro", "balances_micro", "collected_micro", "payouts_micro", "bonds_micro", "bounties_micro"];
  const d = decoded.value || {};
  ok("the decoded totals equal the live stats view", !decoded.error && totals.every((k) => String(d[k]) === String(before.stats[k])) && String(d.next_claim) === String(before.stats.claims) && String(d.next_challenge) === String(before.stats.challenges) && d.paused === before.stats.paused && String(d.rewrites_anchored) === String(before.stats.rewrites_anchored), `${before.stats.claims} claims, held ${before.stats.held_micro}`);
  const prefixes = LAYOUT.filter(([, t]) => t.startsWith("LookupMap<")).map(([n]) => `${n}=${JSON.stringify(d[n])}`).join(" ");
  console.log(`     owner ${d.owner}, lane ${d.lane}, swarm ${d.swarm}, map prefixes ${prefixes}`);

  // value types: pinned against the source of the deployed build, when git has it
  const from = arg("--from-rev", dep.code.market.source_rev);
  if (from) {
    const old = spawnSync("git", ["show", `${from}:contracts/market/src/lib.rs`], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });
    if (old.status === 0) {
      const changed = VALUE_TYPES.filter((t) => typeText(old.stdout, t) !== typeText(src, t));
      ok(`every stored value type is unchanged since ${from}`, changed.length === 0, changed.length ? `changed: ${changed.join(", ")}` : VALUE_TYPES.join(", "));
    } else ok(`the deployed source ${from} is in git`, false, old.stderr.trim().slice(0, 120));
  } else console.log("     (no code.market.source_rev in the deployment file: stored value types not compared)");

  // ---------- 2. every stored claim decodes, and is what its view says ----------
  const matches = (v, c) => v.text === c.text && v.page === c.page && v.kind === c.kind && v.status === c.status && v.outcome === c.outcome && v.provisional === c.provisional && v.trades === c.trades
    && v.volume_micro === String(c.volume_micro) && v.collected_micro === String(c.collected_micro) && v.payout_left_micro === String(c.payout_left_micro) && v.bounty_micro === String(c.bounty_micro)
    && String(v.challenge_id) === String(c.challenge) && String(v.prev) === String(c.prev) && String(v.next) === String(c.next);
  let stored = before.stored, liveClaims = before.claims;
  ok("every stored claim decodes from raw storage, every byte used, and matches its view", stored.size === before.stats.claims && liveClaims.length === stored.size && liveClaims.every((v) => stored.has(v.id) && matches(v, stored.get(v.id))), `${stored.size} claims`);
  if (bad) { console.error("not upgrading: the layout check failed. Write a migration instead."); process.exit(1); }

  // ---------- 3. the reproducible build ----------
  console.log("building market and swarm reproducibly (tools/judge/lib/repro.mjs)");
  const built = await reproBuild({});
  if (!built.ok) { console.error(`build failed: ${built.reason}`); process.exit(1); }
  const wasm = built.wasm.market;
  console.log(`     market ${wasm.hash} (sha256 ${wasm.sha256}, ${wasm.size} bytes), ${built.toolchain}`);
  const live = await liveHash(M);
  const signer = (key) => new KeyPairSigner(KeyPair.fromString(key));
  const finishing = live === wasm.hash;
  if (finishing && !FINISH) {
    const now = await view("stats");
    console.log(`the market already runs ${wasm.hash}: nothing to do${now.paused ? ". IT IS PAUSED: run again with --finish, or unpause it, once the upgrade has been verified" : ""}`);
    process.exit(0);
  }
  let oldCode = null;
  if (!finishing) {
    ok("the live market runs the code the deployment file records", live === dep.code.market.code_hash, `live ${live}, recorded ${dep.code.market.code_hash}`);
    oldCode = Buffer.from((await q({ request_type: "view_code", account_id: M })).code_base64, "base64");
    const have = new Set(wasmImports(oldCode)), want = wasmImports(wasm.bytes);
    const added = want.filter((f) => !have.has(f));
    ok("the new wasm imports only host functions the live code already imports", added.length === 0 && want.length > 0, added.length ? `new: ${added.join(", ")}` : `${want.length} imports, ${have.size} live`);
    // ---------- 4. the account can pay for the bigger code ----------
    const acct = await q({ request_type: "view_account", account_id: M });
    const after = BigInt(acct.storage_usage) + BigInt(wasm.size) - BigInt(oldCode.length) + 1000n;
    const need = after * BYTE_COST + GAS_MARGIN;
    const near = (y) => (Number(y) / 1e24).toFixed(4);
    const short = need - BigInt(acct.amount);
    ok("the market account can pay for the new code's storage and the deploy's gas", short <= 0n, `holds ${near(acct.amount)} NEAR, needs ${near(need)} (code ${oldCode.length} -> ${wasm.size} bytes)${short > 0n ? `: send ${M} at least ${near(short)} NEAR first` : ""}`);
    if (dep.accounts.swarm) {
      const swarmLive = await liveHash(dep.accounts.swarm);
      console.log(`     swarm: build ${built.wasm.swarm.hash}, live ${swarmLive}${built.wasm.swarm.hash === swarmLive ? " (same, not touched)" : " (DIFFERENT: this script does not upgrade the swarm)"}`);
    }
    if (bad) process.exit(1);
  }
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  // what builds the market's wasm; a test or a doc beside it doesn't
  const SOURCE = ["contracts/market/src", "contracts/market/Cargo.toml", "crates/lmsr/src", "crates/lmsr/Cargo.toml", "crates/rules/src", "crates/rules/Cargo.toml", "Cargo.lock", "Cargo.toml"];
  const dirty = spawnSync("git", ["status", "--porcelain", "--", ...SOURCE], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  if (DRY) {
    console.log(`dry run: would ${finishing ? "finish the upgrade of" : `deploy ${wasm.hash} to`} ${M} (${liveClaims.length} claims read)${FEE === null ? "" : `, then set the fee to ${FEE} bps`}${dirty ? `; the source isn't committed (${dirty.split("\n").length} files), so a real run would refuse` : ""}`);
    process.exit(0);
  }
  if (RECORD && dirty) { console.error(`not upgrading: the contract source has uncommitted changes, so ${head} wouldn't be what built this code:\n${dirty}`); process.exit(1); }

  // ---------- signing starts here ----------
  const key = MAINNET ? deployerKey() : st.key;
  const pk = KeyPair.fromString(key).getPublicKey().toString();
  const full = async (id) => ((await q({ request_type: "view_access_key_list", account_id: id })).keys || []).some((k) => k.public_key === pk && k.access_key.permission === "FullAccess");
  ok(`the key ${pk} is a full-access key on the market and on its owner ${d.owner}`, (await full(M)) && (await full(d.owner)));
  if (bad) process.exit(1);
  const market = new Account(M, provider, signer(key));
  const owner = new Account(d.owner, provider, signer(key));
  // pause and set_fee_bps are idempotent, so an answer lost on the way back can simply be asked again
  const asOwner = (methodName, args) => retry(() => owner.callFunction({ contractId: M, methodName, args, gas: 30n * TGAS }));
  const untilFinal = async (test) => { for (let i = 0; i < 30; i++) { if (await test()) return true; await sleep(1500); } return false; };
  const stuck = (why) => { console.error(`${why}${paused ? `\nTHE MARKET IS STILL PAUSED, on purpose: no USDC can leave it. Fix the cause, then run again with --finish, or call pause {"paused":false} as ${d.owner}.` : ""}`); process.exit(1); };
  let paused = false, txHash = null;
  const L = await import(pathToFileURL(path.join(REPO, "web/src/core/lmsr.ts")).href);
  // what the new views say, against raw storage and against the browser's port: run after a
  // deploy, and again by --finish, which has no snapshot from before it
  const checkViews = async (claims, raw) => {
    const exact = claims.filter((v) => {
      const c = raw.get(v.id);
      return c && BigInt(v.b_micro) * L.MICRO === c.b && BigInt(v.d0) === c.d0 && BigInt(v.q_yes_micro) * L.MICRO === c.q_yes && BigInt(v.q_no_micro) * L.MICRO === c.q_no;
    });
    ok("b, d0 and both quantities in every view are the stored values, exact in whole micros", exact.length === claims.length, `${exact.length} of ${claims.length}`);
    const priced = claims.filter((v) => Number(L.priceYes(L.marketFromClaim(v)) / L.MICRO) === v.price_yes_ppm);
    ok("the browser's port prices every live claim from its view, to the ppm", priced.length === claims.length, `${priced.length} of ${claims.length}`);
    const open = claims.find((v) => v.status !== "Settled");
    if (open) {
      const f = L.fillBuy(L.marketFromClaim(open), "yes", 1_000_000n, L.feeBpsOf(open));
      const cq = await view("quote_buy", { claim_id: open.id, side: "yes", amount_micro: "1000000" });
      ok("the new code answers quote_buy, and the browser's port quotes the same fill", cq.shares_micro === String(f.sharesMicro) && cq.amount_micro === String(f.paidMicro) && cq.fee_micro === String(f.feeMicro), `claim ${open.id}: $1 buys ${cq.shares_micro} micro-shares, fee ${cq.fee_micro}`);
    }
  };

  if (!finishing) {
    // ---------- 5. pause, then the snapshot everything is compared against ----------
    if (PAUSE && !before.stats.paused) {
      console.log(`pausing ${M}: nothing moves while it is compared`);
      await asOwner("pause", { paused: true });
      paused = true;
      if (!(await untilFinal(async () => (await view("stats")).paused === true))) stuck("the pause never reached finality");
    }
    before = await snapshot();
    stored = before.stored;
    console.log(`     the snapshot everything is compared against: block ${before.h}, ${before.claims.length} claims, held ${before.stats.held_micro}`);

    // ---------- 6. deploy, same account, same state ----------
    console.log(`deploying ${wasm.hash} to ${M}`);
    let tx = null;
    try { tx = await market.deployContract(new Uint8Array(wasm.bytes)); }
    catch (e) { if (!flaky(e)) stuck(`deploy failed: ${String(e.message || e).slice(0, 300)}`); console.log(`     the answer was lost (${String(e.message || e).slice(0, 80)}): reading the chain instead`); }
    txHash = tx?.transaction?.hash || tx?.transaction_outcome?.id || null;
    const failure = tx?.status?.Failure || tx?.receipts_outcome?.find((r) => r.outcome.status?.Failure)?.outcome.status.Failure;
    if (failure) stuck(`deploy failed: ${JSON.stringify(failure).slice(0, 300)}`);
    console.log(`     tx ${txHash}`);
    if (!(await untilFinal(async () => (await liveHash(M)) === wasm.hash))) stuck(`${wasm.hash} never reached finality on ${M}`);

    // ---------- 7. verify ----------
    const after = { hash: await liveHash(M), ...(await snapshot()) };
    ok("the code hash on chain is the reproducible build", after.hash === wasm.hash, `${after.hash}, read at block ${after.h}`);
    ok("the STATE bytes are unchanged", after.bytes.equals(before.bytes));
    const moved = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const added = (a, b) => Object.keys(b).filter((k) => !(k in a));
    const first = !("fee_bps" in before.stats); // the upgrade that brought the fee in
    ok("every field of stats is unchanged", moved(before.stats, after.stats).length === 0, moved(before.stats, after.stats).join(", "));
    ok("stats add only the fee fields", first ? added(before.stats, after.stats).join() === NEW_STATS.join() : added(before.stats, after.stats).length === 0, added(before.stats, after.stats).join(", "));
    if (first) ok("the fee starts at its default with nothing taken", after.stats.fee_bps === 100 && after.stats.fees_micro === "0", `${after.stats.fee_bps} bps, ${after.stats.fees_micro} taken`);
    ok("the resolution settings are unchanged", JSON.stringify(after.resolution) === JSON.stringify(before.resolution));
    const claimMoved = before.claims.flatMap((c, i) => moved(c, after.claims[i] || {}).map((k) => `${c.id}.${k}`));
    ok("every field of every claim view is unchanged", after.claims.length === before.claims.length && claimMoved.length === 0, claimMoved.slice(0, 6).join(", ") || `${after.claims.length} claims`);
    ok("claim views add only the market fields", after.claims.every((c, i) => (first ? added(before.claims[i], c).join() === NEW_CLAIM.join() : added(before.claims[i], c).length === 0)), after.claims[0] ? added(before.claims[0], after.claims[0]).join(", ") : "no claims");
    await checkViews(after.claims, stored);
    if (bad) stuck(`not finished: ${bad} check${bad === 1 ? "" : "s"} failed above`);
  } else {
    // --finish: steps 1 and 2 above have just re-proved the state and the stored claims
    paused = before.stats.paused;
    await checkViews(liveClaims, stored);
    if (bad) stuck(`not finished: ${bad} check${bad === 1 ? "" : "s"} failed above`);
  }

  // ---------- 8. the fee ----------
  // paused, nothing else can move the state, so it must stay byte for byte; unpaused, a trade may
  // rightly move it, and only the layout is checked
  const frozen = paused || (await view("stats")).paused;
  if (FEE !== null) {
    const was = await stateBytes();
    await asOwner("set_fee_bps", { fee_bps: FEE });
    if (!(await untilFinal(async () => (await view("stats")).fee_bps === FEE))) stuck("set_fee_bps never reached finality");
    const now = await stateBytes();
    if (frozen) ok(`the fee is ${FEE} bps, and the STATE bytes didn't move: it lives outside the state struct`, now.equals(was));
    else ok(`the fee is ${FEE} bps, and the STATE still decodes under the layout`, decodeState(now).used === now.length);
    if (bad) stuck("not finished: the fee changed the state");
  }

  // ---------- 9. the books, unpause, record ----------
  // the books are read before the unpause: from then on a trade may rightly move them
  const end = await view("stats");
  if (frozen) {
    ok("the books are as they were", totals.every((k) => end[k] === before.stats[k]), `held ${end.held_micro}, treasury ${end.treasury_micro}, fee ${end.fee_bps} bps`);
    if (bad) stuck("not finished: the books moved");
  } else console.log(`     (not paused: the books may have moved with trades, so they aren't compared) held ${end.held_micro}, fee ${end.fee_bps} bps`);
  if (paused) {
    console.log(`unpausing ${M}`);
    await asOwner("pause", { paused: false });
    if (!(await untilFinal(async () => (await view("stats")).paused === false))) { console.error("the unpause never reached finality"); process.exit(1); }
    ok("the market is live again", true);
  }
  if (RECORD && !bad && dep.code.market.code_hash !== wasm.hash) {
    dep.upgrades = [...(dep.upgrades || []), { account: M, from: dep.code.market.code_hash, to: wasm.hash, tx: txHash, at: new Date().toISOString(), source_rev: head, ...(FEE === null ? {} : { fee_bps: FEE }), note: `same state layout: code replaced in place, no migration (tools/judge/upgrade-${network}.mjs)` }];
    dep.code.market = { ...dep.code.market, code_hash: wasm.hash, sha256: wasm.sha256, ...(dep.code.market.size ? { size: wasm.size } : {}), source_rev: head };
    if (dep.verified_at) dep.verified_at = new Date().toISOString();
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
    console.log(`recorded in ${path.relative(REPO, depFile)}`);
  }
  process.exit(bad ? 1 : 0);
}
