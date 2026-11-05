// End-to-end on NEAR testnet: the judge's no-wallet bet through the real API.
//
// 1. Funds throwaway sub-accounts from FUNDER_ID/FUNDER_KEY (or the local spike account) and
//    deploys the market and test USDC, as contracts/market/test/lifecycle.mjs does.
// 2. Starts the API as its own process, pointed at that market and lane account.
// 3. Requests a lane key over HTTP (must take < 3 s), signs a $1 bet in-process with that key,
//    and asserts the SSE stream delivers the trade event (must be < 5 s after sending).
// 4. Opens a second sentence with open_and_buy using a receipt signed by the API's planner
//    code, checks the per-IP limit, /claims, /paste's honest degraded mode, and /health: 200
//    while scanning, 503 when the RPC is unreachable.
// 5. Deletes every account it created, sending the balance back to the funder.
//
// Testnet only. It refuses to run with NEAR_NETWORK=mainnet. With no funder it prints SKIP.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, createTransaction, baseDecode, baseEncode } from "near-api-js";
import nacl from "tweetnacl";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Rpc } from "../src/rpc.mjs";
import { signReceipt } from "../src/planner.mjs";
import { sse } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVER = path.join(ROOT, "services/api/src/server.mjs");
const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const RPC_URLS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];

if ((process.env.NEAR_NETWORK || "testnet") !== "testnet") {
  console.error("lane-e2e runs on testnet only; unset NEAR_NETWORK or set it to testnet.");
  process.exit(1);
}

const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
const rpc = new Rpc(RPC_URLS, { timeoutMs: 8000 });
const results = [];
const timings = {};
let failures = 0;
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`);
  if (!ok) failures++;
  console.log(results.at(-1));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- funder ----------
let funder = null;
const spikeFile = path.join(ROOT, ".apex/spikes/s3-lane/testnet-accounts.json");
if (process.env.FUNDER_ID && process.env.FUNDER_KEY) {
  funder = new Account(process.env.FUNDER_ID, provider, new KeyPairSigner(KeyPair.fromString(process.env.FUNDER_KEY)));
} else if (fs.existsSync(spikeFile)) {
  const f = JSON.parse(fs.readFileSync(spikeFile, "utf8")).lane;
  funder = new Account(f.id, provider, new KeyPairSigner(KeyPair.fromString(f.sk)));
}
if (!funder) {
  console.log("SKIP lane-e2e: no testnet funder. Set FUNDER_ID and FUNDER_KEY (a funded testnet account) to run it.");
  process.exit(0);
}
if (funder.accountId.endsWith(".near")) {
  console.error("FUNDER_ID is a mainnet account; lane-e2e runs on testnet only.");
  process.exit(1);
}

const NEED = { market: 4.5, token: 2.0, lane: 0.5 };
const funderState = await funder.getState();
const available = Number(BigInt(funderState.balance.available) / 10n ** 21n) / 1000;
const need = NEED.market + NEED.token + NEED.lane + 0.15;
if (available < need) {
  console.error(`FAIL funder ${funder.accountId} has ${available} NEAR available; lane-e2e needs ${need}. Top it up at https://near-faucet.io and rerun.`);
  process.exit(1);
}
console.log(`funder ${funder.accountId}: ${available} NEAR available`);

const created = [];
const children = [];
const recordFile = path.join(ROOT, ".apex-test/api-e2e-accounts.json");
async function sub(prefix, nearAmount) {
  const kp = KeyPair.fromRandom("ed25519");
  const name = `${prefix}${Date.now().toString(36)}`;
  await funder.createSubAccount({ accountOrPrefix: name, publicKey: kp.getPublicKey(), nearToTransfer: BigInt(Math.round(nearAmount * 100)) * NEAR / 100n });
  const id = `${name}.${funder.accountId}`;
  created.push({ id, sk: kp.toString() });
  // the keys of throwaway accounts are kept locally (git-ignored) so a crashed run can be reclaimed
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  fs.writeFileSync(recordFile, JSON.stringify(created, null, 1));
  return { account: new Account(id, provider, new KeyPairSigner(kp)), kp };
}

async function cleanup() {
  for (const c of children) { try { c.kill(); } catch { /* gone */ } }
  for (const c of created.reverse()) {
    const a = new Account(c.id, provider, new KeyPairSigner(KeyPair.fromString(c.sk)));
    try {
      await a.deleteAccount(funder.accountId);
      console.log(`cleanup: deleted ${c.id} -> ${funder.accountId}`);
    } catch (e) {
      try {
        const st = await a.getState();
        const amt = BigInt(st.balance.available) - 20_000_000_000_000_000_000_000n;
        if (amt > 0n) await a.transfer({ receiverId: funder.accountId, amount: amt });
        console.log(`cleanup: could not delete ${c.id}; sent its free balance back`);
      } catch { console.log(`cleanup: could not reclaim ${c.id}; its key is in .apex-test/api-e2e-accounts.json`); }
    }
  }
  if (created.length) fs.writeFileSync(recordFile, "[]");
}

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function startApi(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NEAR_NETWORK: "testnet", HOST: "127.0.0.1", PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const tag = env.TAG || "api";
  child.stdout.on("data", (d) => process.stdout.write(String(d).split("\n").filter(Boolean).map((l) => `  [${tag}] ${l}\n`).join("")));
  child.stderr.on("data", (d) => process.stdout.write(String(d).split("\n").filter(Boolean).map((l) => `  [${tag}!] ${l}\n`).join("")));
  return { base: `http://127.0.0.1:${port}`, child };
}

async function http(base, method, p, body) {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function waitHealthy(base, ms = 40000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try { last = await http(base, "GET", "/health"); if (last.status === 200) return last; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`API not healthy within ${ms} ms: ${JSON.stringify(last?.json?.failures)}`);
}

/** Sign and send a lane call with the visitor's key, using the nonce and block hash the API gave. */
async function laneCall(issued, visitor, methodName, args, nonceOffset = 1n) {
  const tx = createTransaction(issued.laneAccountId, visitor.getPublicKey(), issued.contractId, BigInt(issued.nonce) + nonceOffset,
    [actions.functionCall(methodName, args, 20n * TGAS, 0n)], baseDecode(issued.blockHash));
  const { txHash, signedTransaction } = await new KeyPairSigner(visitor).signTransaction(tx);
  const t0 = Date.now();
  const outcome = await rpc.sendTxRace(Buffer.from(signedTransaction.encode()).toString("base64"), baseEncode(txHash), issued.laneAccountId, { deadlineMs: 20000 });
  return { outcome, sentAt: t0, executedMs: Date.now() - t0, txHash: baseEncode(txHash) };
}

const decodeReturn = (o) => JSON.parse(Buffer.from(o.status.SuccessValue, "base64").toString());

process.on("unhandledRejection", async (e) => { console.log("FATAL", e?.message || String(e)); await cleanup(); process.exit(2); });

let stream;
try {
  // ---------- 1. contracts ----------
  const market = await sub("am", NEED.market);
  const token = await sub("at", NEED.token);
  const lane = await sub("al", NEED.lane);
  const M = market.account.accountId, T = token.account.accountId, L = lane.account.accountId;
  console.log("accounts:", M, T, L);
  const call = (acct, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) => acct.callFunction({ contractId, methodName, args, gas, deposit });
  await token.account.deployContract(new Uint8Array(fs.readFileSync(path.join(ROOT, "target/wasm32-unknown-unknown/release/pricedin_tusdc.wasm"))));
  await call(token.account, T, "new", {});
  await market.account.deployContract(new Uint8Array(fs.readFileSync(path.join(ROOT, "target/wasm32-unknown-unknown/release/pricedin_market.wasm"))));
  await call(market.account, M, "new", { owner: M, usdc: T, lane: L });
  await call(market.account, T, "register", { account_id: M });
  const plannerSeed = Buffer.from(nacl.randomBytes(32));
  const planner = nacl.sign.keyPair.fromSeed(plannerSeed);
  await call(market.account, M, "set_planner_key", { key_hex: Buffer.from(planner.publicKey).toString("hex") });
  await call(market.account, M, "set_limits", { reserve_cap_micro: "50000000", lane_budget_micro: "10000000", lane_credit_micro: "1000000", challenge_bond_micro: "1000000" });
  await call(token.account, T, "faucet", {});
  await call(token.account, T, "ft_transfer_call", { receiver_id: M, amount: "10000000", msg: "{\"treasury\":true}" }, 1n);
  const claimId = await call(market.account, M, "open_claim", { text: "NEAR Intents has processed more than $10 billion in cumulative volume.", page: "near-intents", kind: "data", p0_ppm: 500000, b_micro: "3000000" });
  check("market and test USDC deployed, treasury funded, claim opened", claimId === 0);

  // ---------- 2. the API ----------
  const env = {
    TAG: "api", RPC_URLS: RPC_URLS.join(","), MARKET_CONTRACT_ID: M, USDC_CONTRACT_ID: T,
    LANE_ACCOUNT_ID: L, LANE_PRIVATE_KEY: lane.kp.toString(), LANE_KEYS_PER_IP_PER_DAY: "4",
    PLANNER_PRIVATE_KEY: plannerSeed.toString("hex"),
  };
  const api = await startApi(env);
  const h0 = await waitHealthy(api.base);
  check("/health is 200 while scanning", h0.status === 200, `last block ${h0.json.checks.scanner.lastBlockHeight}, scanned ${h0.json.checks.scanner.lastScanAgeS?.toFixed(2)} s ago, ${h0.json.checks.rpc.reachable}/${RPC_URLS.length} RPCs reachable`);

  stream = await sse(`${api.base}/events`);
  await stream.next((e) => e.event === "hello", 5000);

  // ---------- 3. the judge's first bet ----------
  const visitor = KeyPair.fromRandom("ed25519");
  const pk = visitor.getPublicKey().toString();
  let t0 = Date.now();
  const issued = await http(api.base, "POST", "/lane/key", { publicKey: pk });
  timings.laneKeyMs = Date.now() - t0;
  check("lane key issued over HTTP in under 3 s", issued.status === 200 && timings.laneKeyMs < 3000, `${timings.laneKeyMs} ms, status ${issued.status}${issued.status !== 200 ? " " + JSON.stringify(issued.json) : ""}`);
  check("the answer carries laneAccountId, contractId, nonce, blockHash, rpc", issued.json?.laneAccountId === L && issued.json?.contractId === M && /^\d+$/.test(issued.json?.nonce) && issued.json?.blockHash?.length >= 43 && issued.json?.rpc === RPC_URLS[0]);

  const bet = await laneCall(issued.json, visitor, "buy", { claim_id: 0, side: "no", amount_micro: "1000000", min_shares_micro: "0" });
  timings.betToOptimisticMs = bet.executedMs;
  const trade = bet.outcome.status?.SuccessValue !== undefined ? decodeReturn(bet.outcome) : null;
  check("the $1 bet signed in-process with the lane key succeeds", trade?.trader === `lane:${pk}`, trade ? `${trade.price_yes_ppm_before / 1e4}% -> ${trade.price_yes_ppm_after / 1e4}% in ${bet.executedMs} ms (tx ${bet.txHash})` : JSON.stringify(bet.outcome.status).slice(0, 300));

  try {
    const ev = await stream.next((e) => e.data?.event === "trade" && e.data?.data?.trader === `lane:${pk}`, Math.max(100, 5000 - (Date.now() - bet.sentAt)));
    timings.sendToSseMs = Date.now() - bet.sentAt;
    timings.optimisticToSseMs = Math.max(0, timings.sendToSseMs - bet.executedMs);
    timings.blockToSseMs = ev.data.seenAtMs - ev.data.blockTimestampMs;
    check("the SSE stream delivers the trade event within 5 s of sending", timings.sendToSseMs < 5000, `${timings.sendToSseMs} ms after send, ${timings.optimisticToSseMs} ms after the optimistic result; price now ${ev.data.data.price_yes_ppm / 1e4}%`);
  } catch (e) {
    check("the SSE stream delivers the trade event within 5 s of sending", false, e.message);
  }

  // ---------- 4. a pasted sentence opens with its first bet, from a receipt the API's planner code signed ----------
  const visitor2 = KeyPair.fromRandom("ed25519");
  t0 = Date.now();
  const issued2 = await http(api.base, "POST", "/lane/key", { publicKey: visitor2.getPublicKey().toString() });
  timings.laneKey2Ms = Date.now() - t0;
  check("a second visitor's key is issued", issued2.status === 200, `${timings.laneKey2Ms} ms`);
  const text = "Bananas are botanically berries.";
  const receipt = signReceipt(planner, { page: "paste-e2e", text, kind: "document", p0_ppm: 600000, b_micro: 1000000 });
  const opened = await laneCall(issued2.json, visitor2, "open_and_buy", { ...receipt.args, side: "yes", amount_micro: "500000" });
  const openTrade = opened.outcome.status?.SuccessValue !== undefined ? decodeReturn(opened.outcome) : null;
  check("the contract accepts the API's planner receipt (open_and_buy)", openTrade?.claim_id === 1, openTrade ? `${openTrade.price_yes_ppm_before / 1e4}% -> ${openTrade.price_yes_ppm_after / 1e4}%` : JSON.stringify(opened.outcome.status).slice(0, 300));
  try {
    await stream.next((e) => e.data?.event === "open" && e.data?.data?.claim_id === 1, 6000);
    check("the SSE stream delivers the open event", true);
  } catch (e) { check("the SSE stream delivers the open event", false, e.message); }

  // two more keys for a timing sample, then the per-IP limit (4 a day in this run)
  timings.laneKeySamplesMs = [timings.laneKeyMs, timings.laneKey2Ms];
  for (let i = 0; i < 2; i++) {
    t0 = Date.now();
    const r = await http(api.base, "POST", "/lane/key", { publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
    if (r.status === 200) timings.laneKeySamplesMs.push(Date.now() - t0);
  }
  check("every lane key in the run was issued in under 3 s", timings.laneKeySamplesMs.length === 4 && Math.max(...timings.laneKeySamplesMs) < 3000, `${timings.laneKeySamplesMs.join(", ")} ms`);
  const fifth = await http(api.base, "POST", "/lane/key", { publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
  check("a fifth key from the same address today is refused (limit 4)", fifth.status === 429 && fifth.json?.error?.code === "rate_limited", `${fifth.status} ${fifth.json?.error?.message}`);

  await sleep(1100);
  const page = await http(api.base, "GET", "/claims?page=near-intents");
  const c0 = page.json?.claims?.[0];
  check("/claims?page= returns the claim with its new price and cost-to-move figures", c0?.id === 0 && c0.trades === 1 && c0.price_yes_ppm < 500000 && c0.cost_to_move.up_10_points_usd > 0, c0 ? `${c0.price_yes_ppm / 1e4}%, +10 pts costs $${c0.cost_to_move.up_10_points_usd}, -10 pts $${c0.cost_to_move.down_10_points_usd}` : JSON.stringify(page.json).slice(0, 200));
  const one = await http(api.base, "GET", "/claims/1");
  check("/claims/:id reads the pasted sentence's market", one.json?.claim?.text === text && one.json.claim.page === "paste-e2e");

  const pasted = await http(api.base, "POST", "/paste", { text: "NEAR Intents passed $10B. Dr. Smith said 3.5% was fine. I love it!" });
  check("/paste without NEARAI_API_KEY: the split, planner unavailable, no receipts", pasted.json?.planner === "unavailable" && pasted.json.sentences.length === 3 && pasted.json.sentences.every((s) => !s.receipt), pasted.json?.sentences?.map((s) => s.text).join(" | "));

  const recent = await http(api.base, "GET", "/events/recent");
  check("/events/recent lists the events", recent.json?.events?.filter((e) => e.event === "trade").length >= 2, recent.json?.events?.map((e) => e.event).join(","));

  const h1 = await http(api.base, "GET", "/health");
  check("/health is still 200 after the run", h1.status === 200, `lane credits left ${h1.json?.checks?.lane?.creditsLeft}, last event ${h1.json?.checks?.events?.lastEventAgeS?.toFixed(1)} s ago`);

  // ---------- 5. RPC unreachable: health must say so ----------
  const dead = await startApi({ ...env, TAG: "dead-rpc", RPC_URLS: "http://127.0.0.1:9,http://127.0.0.1:10", RPC_TIMEOUT_MS: "1000" });
  let hd;
  for (let i = 0; i < 20; i++) { try { hd = await http(dead.base, "GET", "/health"); break; } catch { await sleep(300); } }
  check("/health is 503 with the reason when the RPC is unreachable", hd?.status === 503 && hd.json.failures.some((f) => /no RPC reachable/.test(f)), hd?.json?.failures?.join(" | "));
  dead.child.kill();
} catch (e) {
  check("run completed", false, e.message);
} finally {
  stream?.close();
  await cleanup();
}

console.log(`\ntimings: ${JSON.stringify(timings)}`);
console.log(`${results.length - failures}/${results.length} checks passed`);
fs.mkdirSync(path.join(ROOT, ".apex-test"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".apex-test/api-e2e-result.txt"), results.join("\n") + `\ntimings: ${JSON.stringify(timings)}\n`);
process.exit(failures ? 1 : 0);
