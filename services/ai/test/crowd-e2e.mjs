// npm run ai:crowd-e2e: the crowd on NEAR testnet, with the mock NEAR AI server (no key needed).
// The chain is real, the models are not.
//
//  1. Deploys test USDC, the market and the swarm on throwaway sub-accounts of the funder.
//  2. house-agents: the operator's function-call keys and three house agents spawned through the
//     swarm; run twice to show it is idempotent.
//  3. A stranger asks the API for a runner key, spawns its own agent with it; a second stranger
//     spawns one with a key we don't hold, which the runner must leave alone.
//  4. The stranger doubts a claim with $1. At least two agents answer within 45 s, with sources.
//     A signed rewrite is anchored. Inference bills go on-chain (escrow sweeps, and one agent
//     charged from its bankroll). The stranger's agent, on an expensive model, goes broke and
//     sleeps.
//  5. Restart in the middle: rewrites, rationales, the signer's spend and each agent's last action
//     come back from DATA_DIR.
//  6. A whale pushes the price past two agents' credences: they sell. The broke agent stays quiet,
//     then a top-up wakes it.
//  7. A challenge: the jury runs on a function-call key limited to submit_verdict.
//  8. npm run pnl rebuilds every agent's P&L from chain events and matches the runner's ledger.
//  9. Every agent is closed and deleted to its owner, every account deleted back to the funder.
//
// Testnet only. It refuses NEAR_NETWORK=mainnet and prints SKIP with no funder.
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../api/src/app.mjs";
import { Rpc } from "../../api/src/rpc.mjs";
import { sse } from "../../api/test/helpers.mjs";
import { loadAiConfig } from "../src/config.js";
import { mountAi } from "../src/mount.js";
import { NearAI, Attestor } from "../src/nearai.js";
import { setupOperator, ensureHouseAgents } from "../src/house.js";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const near = (x) => BigInt(Math.round(x * 1000)) * NEAR / 1000n;
// rpc.testnet.near.org is deprecated and answers 429 to everything, and the free plans of the others are rate-limited; override with E2E_RPC_URLS
const RPC_URLS = (process.env.E2E_RPC_URLS || "https://test.rpc.fastnear.com,https://near-testnet.drpc.org,https://rpc.testnet.fastnear.com,https://archival-rpc.testnet.fastnear.com").split(",");
const WASM = path.join(ROOT, "target/wasm32-unknown-unknown/release");
const RATE = 400_000_000_000_000_000n; // yoctoNEAR per micro-USD: $1 = 0.4 NEAR
const EXPENSIVE = "mock/expensive-1";
if ((process.env.NEAR_NETWORK || "testnet") !== "testnet") { console.error("crowd-e2e runs on testnet only."); process.exit(1); }

// public testnet RPCs rate-limit bursts: retry with backoff, then fail over to the other
// transactions go through the fastnear hosts only: drpc's free plan times out on waits
const provider = new FailoverRpcProvider(RPC_URLS.filter((u) => !/drpc/.test(u)).map((url) => new JsonRpcProvider({ url }, { retries: 8, backoff: 2, wait: 1000 })));
const results = [];
let failures = 0;
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`); if (!ok) failures++; console.log(results.at(-1)); };
const short = (e) => String(e?.message || e).slice(0, 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= 5 || !/fetch failed|ECONNRESET|ETIMEDOUT|socket|network|503|502|429/i.test(short(e))) throw e; await sleep(1500 * (i + 1)); }
  }
}
// reads go through the API's Rpc: it fails over, and backs off when every node rate-limits
const reader = new Rpc(RPC_URLS, { timeoutMs: 12000 });
const view = (contractId, method, args = {}) => retry(() => reader.viewFunction(contractId, method, args));
// the same reads, shaped like a near-api-js provider for house.js
const reads = {
  callFunction: ({ contractId, method, args }) => view(contractId, method, args),
  query: (params) => retry(() => reader.call("query", params)),
};
const until = async (what, fn, ms = 30000, every = 500) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(every); } };

// A 429 means the node refused the request: the transaction was never accepted, so it is safe
// to send again. near-api-js fails over on a 429 but never waits, so a burst exhausts it.
const SAFE_TO_RESEND = /-429|Rate limits exceeded|Exceeded d+ providers/;
const TX_METHODS = new Set(["callFunction", "deployContract", "deleteAccount", "createSubAccount", "transfer", "addFunctionCallAccessKey"]);
function patient(account) {
  return new Proxy(account, {
    get(t, k) {
      const v = Reflect.get(t, k);
      if (!TX_METHODS.has(k) || typeof v !== "function") return v;
      return async (...args) => {
        for (let i = 0; ; i++) {
          try { return await v.apply(t, args); }
          catch (e) { if (i >= 14 || !SAFE_TO_RESEND.test(String(e?.message || e))) throw e; await sleep(Math.min(30000, 4000 * (i + 1))); }
        }
      };
    },
  });
}
const account = (id, kp) => patient(new Account(id, provider, new KeyPairSigner(kp)));

// ---------- the funder and throwaway accounts ----------
let funder = null;
const spikeFile = path.join(ROOT, ".apex/spikes/s3-lane/testnet-accounts.json");
if (process.env.FUNDER_ID && process.env.FUNDER_KEY) funder = account(process.env.FUNDER_ID, KeyPair.fromString(process.env.FUNDER_KEY));
else if (fs.existsSync(spikeFile)) { const f = JSON.parse(fs.readFileSync(spikeFile, "utf8")).lane; funder = account(f.id, KeyPair.fromString(f.sk)); }
if (!funder) { console.log("SKIP crowd-e2e: no testnet funder. Set FUNDER_ID and FUNDER_KEY."); process.exit(0); }
if (funder.accountId.endsWith(".near")) { console.error("FUNDER_ID is a mainnet account; crowd-e2e runs on testnet only."); process.exit(1); }

const NEED = { tusdc: 2.0, market: 4.5, swarm: 2.4, house: 0.8, stranger: 0.7, other: 0.3 };
const need = Object.values(NEED).reduce((a, b) => a + b, 0) + 0.1;
const startBal = BigInt((await funder.getState()).balance.available);
const available = Number(startBal / 10n ** 21n) / 1000;
if (available < need) { console.error(`FAIL funder ${funder.accountId} has ${available} NEAR available; crowd-e2e needs ${need.toFixed(2)}.`); process.exit(1); }
console.log(`funder ${funder.accountId}: ${available} NEAR available`);

const created = [];
const recordFile = path.join(ROOT, ".apex-test/crowd-e2e-accounts.json");
async function sub(prefix, amount) {
  const kp = KeyPair.fromRandom("ed25519");
  const name = `${prefix}${Date.now().toString(36)}`;
  await funder.createSubAccount({ accountOrPrefix: name, publicKey: kp.getPublicKey(), nearToTransfer: near(amount) });
  const id = `${name}.${funder.accountId}`;
  created.push({ id, sk: kp.toString() });
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  fs.writeFileSync(recordFile, JSON.stringify(created, null, 1)); // git-ignored, so a crashed run can be reclaimed
  return { account: account(id, kp), kp, id };
}
const EMPTY_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
async function rpcQuery(params) {
  for (let i = 0; ; i++) {
    const r = await reader.call("query", params).catch(() => null);
    if (r || i >= 6) return r;
    await sleep(1500); // a fresh account or key is not final yet
  }
}
async function sweepAndDelete(a) {
  await a.deployContract(new Uint8Array(fs.readFileSync(path.join(WASM, "pricedin_sweeper.wasm"))));
  for (;;) {
    const st = await rpcQuery({ request_type: "view_state", finality: "final", account_id: a.accountId, prefix_base64: "" });
    const keys = (st?.values || []).map((v) => v.key);
    if (!keys.length) break;
    for (let i = 0; i < keys.length; i += 200) await a.callFunction({ contractId: a.accountId, methodName: "clean", args: { keys: keys.slice(i, i + 200) }, gas: 300n * TGAS });
  }
  await a.deployContract(EMPTY_WASM);
  await a.deleteAccount(funder.accountId);
}
const agentsToDelete = []; // [ownerAccount, agentId]
/** A cleanup step, retried through rate limits. */
async function persist(what, fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(short(e)) && /^delete /.test(what)) return; if (i >= 5 || e.large) throw e; console.log(`cleanup: ${what}: ${short(e).slice(0, 100)}; retrying`); await sleep(5000 * (i + 1)); }
  }
}
async function cleanup() {
  let agentsLeft = 0;
  for (const [owner, agentId] of agentsToDelete) {
    try {
      // each step reads the chain again first, so a retry never repeats a step that went through
      await persist(`close ${agentId}`, async () => { const a = await view(SW, "get_agent", { agent_id: agentId }); if (a && !a.closed) await owner.callFunction({ contractId: SW, methodName: "close_agent", args: { agent_id: agentId }, gas: 100n * TGAS }); });
      await persist(`delete ${agentId}`, async () => { const a = await view(SW, "get_agent", { agent_id: agentId }); if (a && !a.deleted) await owner.callFunction({ contractId: SW, methodName: "delete_agent", args: { agent_id: agentId }, gas: 100n * TGAS }); });
      console.log(`cleanup: closed and deleted ${agentId}, its NEAR and USDC back to ${owner.accountId}`);
    } catch (e) { agentsLeft++; console.log(`cleanup: agent ${agentId}: ${short(e).slice(0, 160)}`); }
  }
  // an agent account can only be deleted by its swarm: while one is left, keep the swarm and the owners
  if (agentsLeft) { console.log(`cleanup: ${agentsLeft} agent(s) left; the swarm and owners are kept so .apex-test/reclaim-crowd.mjs can finish`); return created; }
  const left = [];
  for (const c of [...created].reverse()) {
    const a = account(c.id, KeyPair.fromString(c.sk));
    try { await persist(`delete ${c.id}`, async () => { try { await a.deleteAccount(funder.accountId); } catch (e) { if (/large state/i.test(short(e))) throw Object.assign(new Error("large state"), { large: true }); throw e; } }); console.log(`cleanup: deleted ${c.id}`); }
    catch (e0) {
      try { if (!/large state/i.test(short(e0))) throw e0; await sweepAndDelete(a); console.log(`cleanup: swept and deleted ${c.id}`); }
      catch (e) { left.push(c); console.log(`cleanup: could not delete ${c.id}: ${short(e).slice(0, 160)}; its key is in ${recordFile}`); }
    }
  }
  fs.writeFileSync(recordFile, JSON.stringify(left, null, 1));
  return left;
}
const call = (acct, contractId, methodName, args = {}, deposit = 0n, gas = 100n * TGAS) => acct.callFunction({ contractId, methodName, args, gas, deposit });

let SW = null;
let mock, app, stream, layer;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crowd-e2e-"));
const DATA = path.join(tmp, "data");
const latencies = [];
let pnlOut = "";
try {
  const fromHeight = (await reader.block("final")).header.height;
  const token = await sub("ct", NEED.tusdc);
  const market = await sub("cm", NEED.market);
  const swarm = await sub("cs", NEED.swarm);
  const house = await sub("ch", NEED.house);
  const stranger = await sub("cx", NEED.stranger);
  const other = await sub("cy", NEED.other);
  const T = token.id, M = market.id, H = house.id, X = stranger.id;
  SW = swarm.id;
  console.log("accounts:", T, M, SW, H, X, other.id);
  await token.account.deployContract(new Uint8Array(fs.readFileSync(path.join(WASM, "pricedin_tusdc.wasm"))));
  await call(token.account, T, "new");
  await market.account.deployContract(new Uint8Array(fs.readFileSync(path.join(WASM, "pricedin_market.wasm"))));
  await call(market.account, M, "new", { owner: H, usdc: T, lane: M });
  await swarm.account.deployContract(new Uint8Array(fs.readFileSync(path.join(WASM, "pricedin_swarm.wasm"))));
  await call(swarm.account, SW, "new", { owner: H, market: M, treasury: H });
  await call(house.account, T, "register", { account_id: M });
  await call(house.account, M, "set_swarm", { swarm: SW });
  await call(house.account, SW, "set_limits", { min_spawn_yocto: String(near(0.08)), agent_near_yocto: String(near(0.05)) });
  await call(house.account, M, "set_limits", { reserve_cap_micro: "50000000", lane_budget_micro: "0", lane_credit_micro: "1000000", challenge_bond_micro: "1000000" });
  await call(house.account, T, "faucet");
  await call(house.account, T, "ft_transfer_call", { receiver_id: M, amount: "10000000", msg: "{\"treasury\":true}" }, 1n);
  const claimId = await call(house.account, M, "open_claim", { text: "Bananas are botanically berries.", page: "botany", kind: "document", p0_ppm: 500000, b_micro: "3000000" });
  check("market, swarm and test USDC deployed; the house owns both contracts; a claim is open", claimId === 0 && (await view(M, "get_resolution")).swarm === SW);

  // ---------- 2. the house ----------
  const keystoreDir = path.join(DATA, "keystore");
  fs.mkdirSync(DATA, { recursive: true });
  const op = await setupOperator({ owner: house.account, provider: reads, marketId: M, swarmId: SW, keystoreDir, dataDir: DATA, allowanceYocto: near(1) });
  const rows = await ensureHouseAgents({ owner: house.account, provider: reads, swarmId: SW, marketId: M, usdcId: T, keystoreDir, depositYocto: near(0.08), bankrollMicro: 4_000_000n, faucet: true });
  for (const r of rows) agentsToDelete.push([house.account, r.account]);
  check("house-agents spawns the archivist, the skeptic and the quant through the swarm", rows.length === 3 && rows.every((r) => r.created && !r.error && r.bankroll_micro === "4000000"), rows.map((r) => `${r.key}=${r.account} (${r.model})`).join(", "));
  const again = await ensureHouseAgents({ owner: house.account, provider: reads, swarmId: SW, marketId: M, usdcId: T, keystoreDir, depositYocto: near(0.08), bankrollMicro: 4_000_000n, faucet: true });
  const op2 = await setupOperator({ owner: house.account, provider: reads, marketId: M, swarmId: SW, keystoreDir, dataDir: DATA, allowanceYocto: near(1) });
  check("running it again changes nothing", again.every((r) => !r.created) && again.map((r) => r.account).join() === rows.map((r) => r.account).join() && !op2.market.created && !op2.swarm.created && !op2.jury.created && (await view(SW, "stats")).agents === 3);
  const keys = (await rpcQuery({ request_type: "view_access_key_list", finality: "optimistic", account_id: rows[0].account })).keys;
  check("a house agent's only key is our runner key, limited to buy, sell and redeem", keys.length === 1 && [...keys[0].access_key.permission.FunctionCall.method_names].sort().join() === "buy,redeem,sell");

  // ---------- the mock models, attested and registered ----------
  mock = await startMockNearAI({ models: [...MOCK_MODELS, EXPENSIVE], pricing: { [EXPENSIVE]: { prompt: "0.0001", completion: "0.001" } } });
  const CRED = { [MOCK_MODELS[1]]: 0.93, [MOCK_MODELS[0]]: 0.75, [MOCK_MODELS[2]]: 0.62, [EXPENSIVE]: 0.85 };
  for (const [m, p] of Object.entries(CRED)) mock.behave(m, { content: (body) => (/credence/i.test(body.messages?.[0]?.content || "") ? JSON.stringify({ p, rationale: `The fetched source bears on this; I put it at ${p}.`, source_url: JSON.parse(body.messages[1].content).sources[0].url }) : null) });
  const env = {
    NEAR_NETWORK: "testnet", HOST: "127.0.0.1", PORT: "0", SCAN_INTERVAL_MS: "2000", RPC_URLS: RPC_URLS.join(","), MARKET_CONTRACT_ID: M, USDC_CONTRACT_ID: T,
    NEARAI_API_KEY: mock.apiKey, NEARAI_BASE_URL: mock.url, WRITER_MODEL: MOCK_MODELS[2], SWARM_CONTRACT_ID: SW, HOUSE_OWNER_IDS: H, DATA_DIR: DATA, KEYSTORE_DIR: keystoreDir,
    JURY_KEY_FILE: op.jury.file, JURY_AUTO: "1", JURY_TIMEOUT_MS: "45000", AGENT_WEB_SEARCH: "0", AGENT_SWEEP_MS: "0", AGENT_CYCLE_MS: "4000", AGENT_FRESH_COOLDOWN_MS: "1500",
    AGENT_BILLING: "escrow", AGENT_BILLING_OVERRIDES: "house-quant=balance", INFERENCE_YOCTO_PER_MICRO_USD: String(RATE), SIGNER_SUPERSEDED_AFTER_MS: "20000", ATTESTATIONS_DIR: path.join(tmp, "attestations"),
  };
  const { api, ai, errors } = loadAiConfig(env);
  if (errors.length) throw new Error(errors.join("; "));
  const start = async () => {
    app = createApp(api, { log: () => {} });
    layer = mountAi(app, ai, { quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier, log: (m) => { if (/billing|fell asleep|woke|anchor|jury:|agents|reconcile|ledger:/.test(m)) console.log(`  [ai] ${m}`); }, overrides: { jury: { signatureDeadlineMs: 1500, graceMs: 2500 } } });
    const addr = await app.start();
    const base = `http://127.0.0.1:${addr.port}`;
    stream = await sse(`${base}/events`);
    await stream.next((e) => e.event === "hello", 8000);
    return base;
  };
  const tReg = Date.now();
  {
    const attestor = new Attestor({ client: new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url }), quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier });
    for (const m of MOCK_MODELS) {
      const pre = await attestor.preflight(m);
      if (!pre.ok) throw new Error(`${m}: ${pre.failures.join("; ")}`);
      await call(house.account, M, "register_model", { model: m, signing_address_hex: pre.verifiedSigners[0].signing_address, extras_json: "" });
    }
  }
  check("the mock models' keys are registered from verified attestation reports", true, `${Date.now() - tReg} ms`);
  let base = await start();

  // ---------- 3. strangers ----------
  const persona = { name: "Contrarian", instructions: "Distrust popular framings; weigh the botanical definition, not everyday usage.", limits: { maxBetUsd: 1, dailyLossLimitUsd: 2, kellyFraction: 0.2 } };
  const rk = await fetch(`${base}/agents/runner-key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona }) }).then((r) => r.json());
  check("the API issues a stranger a runner key and a persona hash; the private key stays in the signer", /^ed25519:/.test(rk.runner_public_key || "") && /^[0-9a-f]{64}$/.test(rk.persona_hash || "") && !JSON.stringify(rk).includes("privateKey") && rk.spawn?.contract === SW, rk.runner_public_key);
  await call(stranger.account, SW, "spawn_agent", { model: EXPENSIVE, persona_hash: rk.persona_hash, runner_public_key: rk.runner_public_key }, near(0.08));
  const SA = (await view(SW, "get_agents", { from: 0, limit: 10 })).find((a) => a.runner_public_key === rk.runner_public_key).account;
  agentsToDelete.push([stranger.account, SA]);
  await call(stranger.account, T, "faucet");
  await call(stranger.account, T, "faucet");
  await call(stranger.account, T, "ft_transfer_call", { receiver_id: M, amount: "3000000", msg: JSON.stringify({ for: SA }) }, 1n);
  await call(stranger.account, T, "ft_transfer_call", { receiver_id: M, amount: "12000000", msg: "" }, 1n);
  await call(other.account, SW, "spawn_agent", { model: MOCK_MODELS[0], persona_hash: "ab".repeat(32), runner_public_key: KeyPair.fromRandom("ed25519").getPublicKey().toString() }, near(0.08));
  const OA = (await view(SW, "get_agents", { from: 0, limit: 10 })).find((a) => a.owner === other.id).account;
  agentsToDelete.push([other.account, OA]);
  const roster = await until("the crowd of four", async () => { const r = await fetch(`${base}/agents`).then((x) => x.json()); return r.agents.filter((a) => a.awake).length === 4 && r.unheld === 1 && r; }, 30000);
  const byAcct = Object.fromEntries(roster.agents.map((a) => [a.account_id, a]));
  check("the runner drives the three house agents and the stranger's, and leaves alone the one whose key it doesn't hold", roster.agents.length === 4 && !byAcct[OA] && roster.unheld === 1 && byAcct[SA]?.label === "stranger" && byAcct[SA].persona === "Contrarian" && rows.every((r) => byAcct[r.account]?.label === "house"), roster.agents.map((a) => `${a.name}(${a.label}, ${a.model}, ${a.billing})`).join(", "));

  // ---------- 4. the doubt ----------
  const tBet = Date.now();
  const doubt = await call(stranger.account, M, "buy", { claim_id: 0, side: "no", amount_micro: "1000000", min_shares_micro: "0" });
  check("a stranger's $1 doubt lands", doubt.price_yes_ppm_after < 500000, `50% -> ${doubt.price_yes_ppm_after / 1e4}%`);
  const answers = [];
  const deadline = tBet + 45000;
  while (Date.now() < deadline && answers.length < 4) {
    const e = await stream.next((x) => x.data?.event === "agent_rationale" && !answers.some((a) => a.account_id === x.data.data.account_id), Math.max(1, deadline - Date.now())).catch(() => null);
    if (!e) break;
    answers.push({ ...e.data.data, ms: Date.now() - tBet });
  }
  for (const a of answers) latencies.push(`${a.agent} ${a.ms} ms (${a.text})`);
  const sourced = answers.filter((a) => a.source_url && a.source_checked?.status === 200);
  check("at least two agents answer within 45 s, with sources", sourced.length >= 2, answers.map((a) => `${a.agent}: ${a.text} in ${a.ms} ms, ${a.source_url}`).join(" | "));
  check("their bets are on-chain under their own accounts", (await Promise.all(answers.filter((a) => a.tx_hash).map((a) => view(M, "get_position", { claim_id: 0, trader: a.account_id })))).every((p) => Number(p.yes_micro) > 0), `${answers.filter((a) => a.tx_hash).length} trades`);
  const src = await fetch(sourced[0]?.source_url, { headers: { "user-agent": "PricedInHouseAgent/0.1" } }).catch(() => null);
  check("the cited source answers 200", src?.status === 200, sourced[0]?.source_url);

  // anchoring
  const anchored = await until("an anchored rewrite", async () => { const r = await fetch(`${base}/rewrites?page=botany`).then((x) => x.json()); return r.rewrites.find((w) => w.status === "signed" && w.anchor?.status === "anchored"); }, 40000);
  const stats1 = await view(M, "stats");
  const pricesOk = createHash("sha256").update(anchored.prices_canonical).digest("hex") === anchored.prices_hash;
  check("a signed rewrite is anchored on-chain with anchor_rewrite", stats1.rewrites_anchored >= 1 && pricesOk && Boolean(anchored.anchor.tx_hash), `${anchored.id}, tx ${anchored.anchor.tx_hash}, rewrites_anchored ${stats1.rewrites_anchored}`);

  // inference bills
  const SQ = rows.find((r) => r.key === "house-quant").account;
  const bills = await until("bills for every agent that thought", async () => {
    const b = [...new Set([...rows.map((r) => r.account), SA])].map((a) => layer.ledger.bills(a).filter((x) => x.tx_hash && !x.failed && !x.pending)).flat();
    return b.some((x) => x.route === "escrow" && x.agent !== SA) && b.some((x) => x.route === "balance") && b.some((x) => x.agent === SA) && b;
  }, 300000);
  const quantBill = bills.find((b) => b.route === "balance");
  const sweep = bills.find((b) => b.route === "escrow" && b.agent !== SA);
  check("inference bills go on-chain: escrow swept by sweep_escrow, the quant charged by charge_inference, each with a usage hash", Boolean(quantBill && sweep), `sweep ${sweep?.amount_micro} micro-USD (${sweep?.paid_yocto} yocto) tx ${sweep?.tx_hash}; charge ${quantBill?.amount_micro} micro-USDC tx ${quantBill?.tx_hash}`);
  const usageRaw = await fetch(`${base}/ai/usage/${sweep.usage_hash}`).then((r) => r.text());
  check("anyone can fetch the usage record and check it against the hash on-chain", createHash("sha256").update(usageRaw).digest("hex") === sweep.usage_hash && JSON.parse(usageRaw).calls.length >= 1, `${JSON.parse(usageRaw).calls.length} call(s)`);
  const broke = await until("the stranger's agent asleep", async () => { const a = await view(SW, "get_agent", { agent_id: SA }); return a.sleeping && a.escrow_yocto === "0" && a; }, 60000);
  const tBroke = Date.now();
  const asleep = await until("the roster shows it asleep", async () => { const r = await fetch(`${base}/agents`).then((x) => x.json()); return r.agents.find((a) => a.account_id === SA && !a.awake); }, 10000);
  check("the stranger's agent runs out of escrow and sleeps within one cycle", Boolean(asleep), `charged ${broke.charged_yocto} yocto, owes ${asleep.debt_micro} micro-USD; asleep in the roster ${Date.now() - tBroke} ms after the chain said so: ${asleep.asleep}`);

  // ---------- 5. restart ----------
  await until("no open intents", async () => layer.ledger.pending().length === 0, 180000);
  const before = {
    rewrites: (await fetch(`${base}/rewrites?page=botany&history=1`).then((r) => r.json())).rewrites,
    rationales: (await fetch(`${base}/rationales?page=botany`).then((r) => r.json())).rationales,
    agents: (await fetch(`${base}/agents`).then((r) => r.json())).agents,
    spent: await layer.signer.spent(),
    totals: JSON.stringify(layer.ledger.totals()),
    pnl: JSON.stringify(layer.ledger.pnl(), (k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
  stream.close();
  await app.stop();
  base = await start();
  await until("the restarted roster", async () => (await fetch(`${base}/agents`).then((r) => r.json())).agents.length === 4, 20000);
  const after = {
    rewrites: (await fetch(`${base}/rewrites?page=botany&history=1`).then((r) => r.json())).rewrites,
    rationales: (await fetch(`${base}/rationales?page=botany`).then((r) => r.json())).rationales,
    agents: (await fetch(`${base}/agents`).then((r) => r.json())).agents,
    spent: await layer.signer.spent(),
  };
  const ids = (rw) => JSON.stringify(rw.flatMap((p) => p.versions.map((v) => `${v.id}:${v.status}:${v.anchor?.tx_hash ?? ""}`)));
  const last = (ag) => JSON.stringify(ag.map((a) => [a.account_id, a.last_action?.kind, a.last_action?.at]));
  check("after a restart: every rewrite with its anchor, every rationale, the signer's daily spend, each agent's last action, the ledger",
    ids(after.rewrites) === ids(before.rewrites) && after.rationales.length === before.rationales.length && after.rationales[0]?.tx_hash === before.rationales[0]?.tx_hash
    && JSON.stringify(after.spent.agents) === JSON.stringify(before.spent.agents) && last(after.agents) === last(before.agents)
    && JSON.stringify(layer.ledger.totals()) === before.totals && JSON.stringify(layer.ledger.pnl(), (k, v) => (typeof v === "bigint" ? v.toString() : v)) === before.pnl,
    `${before.rewrites.reduce((n, p) => n + p.versions.length, 0)} rewrite versions, ${after.rationales.length} rationales, spend ${JSON.stringify(after.spent.agents)}`);
  check("the broke agent is still asleep after the restart", after.agents.find((a) => a.account_id === SA)?.awake === false);

  // ---------- 6. the whale and the sale ----------
  const tWhale = Date.now();
  const whale = await call(stranger.account, M, "buy", { claim_id: 0, side: "yes", amount_micro: "5000000", min_shares_micro: "0" });
  const sold = await stream.next((e) => e.data?.event === "agent_rationale" && String(e.data.data.side).startsWith("sell_") && e.data.data.tx_hash, 45000).catch(() => null);
  const sd = sold?.data.data;
  check("a whale pushes YES past two agents' credences and an agent sells", Boolean(sd), sd ? `${sd.agent}: ${sd.text} (credence ${sd.credence}) ${Date.now() - tWhale} ms after the whale at ${whale.price_yes_ppm_after / 1e4}%, tx ${sd.tx_hash}` : "no sale");
  if (sd) latencies.push(`sale: ${sd.agent} ${Date.now() - tWhale} ms`);
  await sleep(4000);
  const afterWhale = stream.events.filter((e) => e.data?.event === "agent_rationale" && e.data.data.at >= tWhale).map((e) => e.data.data);
  check("the broke agent stays quiet", !afterWhale.some((r) => r.account_id === SA), afterWhale.map((r) => `${r.agent}: ${r.text}`).join(" | "));
  await call(stranger.account, SW, "top_up_escrow", { agent_id: SA }, near(0.03));
  const tTop = Date.now();
  await until("the stranger's agent awake", async () => (await fetch(`${base}/agents`).then((r) => r.json())).agents.find((a) => a.account_id === SA)?.awake, 30000);
  check("a top-up wakes it within one cycle", Date.now() - tTop <= 4000 + 4000, `${Date.now() - tTop} ms (cycle 4000 ms, plus the chain read)`);
  await until("its debt collected", async () => layer.ledger.debt(SA) === 0n && layer.ledger.pending().length === 0, 180000).catch(() => null);

  // ---------- 7. the jury on a function-call key ----------
  const jk = await rpcQuery({ request_type: "view_access_key", finality: "optimistic", account_id: H, public_key: op.jury.publicKey });
  const chId = await call(stranger.account, M, "challenge", { claim_id: 0, claimed_outcome: true, evidence: "Botanically a banana is a berry." });
  const jr = await stream.next((e) => e.data?.event === "jury_run" && e.data.data.challenge_id === chId, 60000).catch(() => null);
  await sleep(1500);
  const ch = await view(M, "get_challenge", { challenge_id: chId });
  check("the jury runner submits verdicts with a function-call key limited to submit_verdict", ch.verdicts.length >= 2 && jk?.permission?.FunctionCall?.method_names?.join() === "submit_verdict", `${ch.verdicts.map((v) => `${v.model}=${v.outcome}`).join(", ")}; key ${JSON.stringify(jk?.permission)}; run ${jr?.data.data.status}`);

  // ---------- 8. P&L from chain events ----------
  await until("no open intents", async () => layer.ledger.pending().length === 0, 180000);
  stream.close();
  await app.stop();
  app = null;
  await sleep(4000); // finality
  const r = spawnSync(process.execPath, [path.join(ROOT, "services/ai/scripts/pnl.mjs"), "--from", String(fromHeight)], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", timeout: 600000 });
  pnlOut = r.stdout;
  console.log(r.stdout.split("\n").map((l) => `  | ${l}`).join("\n"));
  if (r.stderr) console.log(r.stderr.split("\n").filter((l) => !/pnl scan: block/.test(l)).slice(0, 10).join("\n"));
  check("npm run pnl rebuilds every agent's P&L from chain events and matches the runner's ledger exactly", r.status === 0 && /OK: 5 agent\(s\)/.test(r.stdout), r.stdout.split("\n").filter((l) => /^(OK|FAIL)/.test(l)).join(" "));
} catch (e) {
  check("run completed", false, short(e));
} finally {
  stream?.close();
  try { await app?.stop(); } catch { /* stopping */ }
  await mock?.close();
}
let left = [];
try { left = await cleanup(); } catch (e) { console.log(`cleanup failed: ${short(e)}`); left = created; }
await sleep(2000);
const endBal = BigInt((await funder.getState()).balance.available);
check("every account deleted back to the funder", left.length === 0, `funder ${Number(startBal) / 1e24} -> ${(Number(endBal) / 1e24).toFixed(4)} NEAR`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nanswer latencies: ${latencies.join("; ")}`);
console.log(`\n${results.length - failures}/${results.length} checks passed`);
fs.mkdirSync(path.join(ROOT, ".apex-test"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".apex-test/crowd-e2e-result.txt"), results.join("\n") + `\n\nanswer latencies: ${latencies.join("; ")}\n\n${pnlOut}`);
process.exit(failures ? 1 : 0);
