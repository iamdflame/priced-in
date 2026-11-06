// pricedin-mcp against a local services/api (on a mock NEAR RPC): the protocol over stdio and
// streamable HTTP, the four tools, the refusals, and a real x402 client paying through the
// tools with the caller's key against a mock facilitator.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { startApi } from "../../../services/api/test/helpers.mjs";
import { startMockRpc } from "../../../services/api/test/mock-rpc.mjs";
import { McpServer, SERVER_INFO, validate } from "../src/protocol.mjs";
import { settings } from "../src/client.mjs";
import { makeTools } from "../src/tools.mjs";
import { serveHttp } from "../src/transports.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "../bin/pricedin-mcp.mjs");
const MARKET = "market.pricedin.testnet";
const USDC = "tusdc.pricedin.testnet";
const PAY_TO = "truth.pricedin.testnet";

function claimView(id, text, p, b = 3) {
  return {
    id, text, page: "tether", kind: "data", price_yes_ppm: Math.round(p * 1e6),
    cost_up_10_micro: String(Math.floor(b * Math.log((1 - p) / (1 - p - 0.1)) * 1e6)), cost_down_10_micro: String(Math.floor(b * Math.log(p / (p - 0.1)) * 1e6)),
    status: "Open", outcome: null, provisional: null, trades: 3, volume_micro: "3100000", open_interest_micro: "4547388", collected_micro: "3100000",
    payout_left_micro: "0", challenge_id: null, prev: null, next: null, bounty_micro: "0",
  };
}
const CLAIMS = [
  claimView(0, "Tether Holdings Limited is headquartered in El Salvador as of January 2025.", 0.653479),
  claimView(1, "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Liquid Network, Near, Polygon, Solana, Bitcoin Cash's Standard Ledger Protocol, Statemint, Tezos, and Tron.", 0.18997),
];

async function backend(t, env = {}, deps = {}) {
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  mock.st.claims = CLAIMS.map((c) => ({ ...c }));
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: MARKET, USDC_CONTRACT_ID: USDC, ...env }, deps);
  t.after(() => api.close());
  return { mock, api };
}

/** A stdio MCP session with the real binary. */
function stdioSession(env) {
  const child = spawn(process.execPath, [BIN], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  const waiting = new Map();
  const transcript = [];
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      transcript.push(`<- ${line}`);
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
    }
  });
  let id = 0;
  return {
    transcript,
    request(method, params) {
      const mid = ++id;
      const line = JSON.stringify({ jsonrpc: "2.0", id: mid, method, params });
      transcript.push(`-> ${line}`);
      child.stdin.write(line + "\n");
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no answer to ${method}`)), 15000);
        waiting.set(mid, (m) => { clearTimeout(t); resolve(m); });
      });
    },
    notify(method) { const line = JSON.stringify({ jsonrpc: "2.0", method }); transcript.push(`-> ${line}`); child.stdin.write(line + "\n"); },
    close() { child.stdin.end(); child.kill(); },
  };
}

test("protocol: initialize negotiates the version; unknown methods and tools are errors; arguments are validated", async () => {
  const s = new McpServer({ tools: makeTools({ env: {} }).tools });
  const init = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal(init.result.serverInfo.name, "pricedin-mcp");
  assert.ok(init.result.capabilities.tools);
  assert.equal((await s.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).result.protocolVersion, "2025-11-25");
  assert.equal(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const list = await s.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.deepEqual(list.result.tools.map((t) => t.name), ["ask", "get_claim", "quote", "bet"]);
  assert.equal(list.result.tools[0].annotations.readOnlyHint, true);
  assert.equal((await s.handle({ jsonrpc: "2.0", id: 4, method: "nope" })).error.code, -32601);
  assert.equal((await s.handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } })).error.code, -32602);
  const bad = await s.handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "quote", arguments: { claim_id: 1, side: "maybe", amount_usd: 1 } } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /side: must be one of yes, no/);
  assert.equal(validate({ type: "object", properties: { a: { type: "integer" } }, required: ["a"], additionalProperties: false }, { a: 1, b: 2 }), "unknown argument b");
});

test("settings: with nothing set, the hosted API on mainnet; an API of your own stays on testnet", () => {
  const hosted = settings({});
  assert.equal(hosted.apiUrl, "https://isitpriced.com");
  assert.equal(hosted.network, "mainnet");
  assert.equal(hosted.caip2, "near:mainnet");
  assert.equal(hosted.maxBetUsd, 1, "real money starts with a small cap");
  assert.equal(hosted.maxPayUsd, 0.05);
  assert.deepEqual(hosted.errors, []);
  const own = settings({ PRICEDIN_API_URL: "http://127.0.0.1:8787/" });
  assert.equal(own.apiUrl, "http://127.0.0.1:8787");
  assert.equal(own.network, "testnet");
  assert.equal(own.maxBetUsd, 5);
  assert.equal(settings({ NEAR_NETWORK: "testnet" }).network, "testnet");
  assert.match(settings({ NEAR_ACCOUNT_ID: "me.testnet" }).errors[0], /me\.testnet is a testnet account but NEAR_NETWORK=mainnet/);
});

test("the package: the version the server reports is the one published, and it ships its README and LICENSE", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(SERVER_INFO.version, pkg.version);
  assert.equal(SERVER_INFO.name, pkg.name);
  for (const f of ["README.md", "LICENSE", "bin/pricedin-mcp.mjs"]) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), f);
  assert.match(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8"), /claude mcp add pricedin -- npx -y pricedin-mcp/);
});

test("stdio: the real binary answers ask about a seeded claim from a local API", async (t) => {
  const { api } = await backend(t);
  api.app.hub.publish({ uid: "r", event: "agent_rationale", source: "ai", data: { agent: "skeptic", model: "deepseek", claim_id: 1, side: "no", credence: 0.12, rationale: "NEAR was dropped from Tether's supported chains.", source_url: "https://tether.to/en/supported-protocols", at: 5 } });
  const s = stdioSession({ PRICEDIN_API_URL: api.base });
  t.after(() => s.close());
  const init = await s.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result.serverInfo.name, "pricedin-mcp");
  s.notify("notifications/initialized");
  const r = await s.request("tools/call", { name: "ask", arguments: { question: "Does Tether issue USDT on NEAR?" } });
  assert.equal(r.result.isError, false, r.result.content[0].text);
  const text = r.result.content[0].text;
  assert.match(text, /The closest claim: "Tether issues tokens on Algorand/);
  assert.match(text, /Credence: 19% true · \$4\.55 open interest/);
  assert.match(text, /skeptic \(deepseek\), NO at 12%: NEAR was dropped.*Source: https:\/\/tether\.to/);
  assert.match(text, /Provenance: market\.pricedin\.testnet on testnet, claim 1/);
  assert.match(text, /Free calls left today from this address: 19 of 20/);
  assert.equal(r.result.structuredContent.claims[0].claim_id, 1);
  const none = await s.request("tools/call", { name: "ask", arguments: { question: "Is the moon made of cheese?" } });
  assert.match(none.result.content[0].text, /No claim on Priced In matches that/);
  const q = await s.request("tools/call", { name: "quote", arguments: { claim_id: 1, side: "no", amount_usd: 1 } });
  assert.match(q.result.content[0].text, /^\$1\.00 on NO of claim 1 .* buys \d+\.\d{4} shares/);
  const g = await s.request("tools/call", { name: "get_claim", arguments: { claim_id: 0 } });
  assert.match(g.result.content[0].text, /^Claim 0 \(page tether\): "Tether Holdings Limited/);
  const b = await s.request("tools/call", { name: "bet", arguments: { claim_id: 1, side: "no", amount_usd: 1 } });
  assert.equal(b.result.isError, true);
  assert.match(b.result.content[0].text, /^Refused: bet signs with your own NEAR key, and none is set/);
  assert.ok(s.transcript.length >= 12);
});

test("refusals: mainnet only when set explicitly, no mixing networks, bet caps", async (t) => {
  const { api } = await backend(t);
  const mixed = makeTools({ env: { PRICEDIN_API_URL: api.base, NEAR_ACCOUNT_ID: "me.near", NEAR_PRIVATE_KEY: "ed25519:x" } });
  const r = await mixed.tools[0].handler({ question: "x y" });
  assert.equal(r.isError, true);
  assert.match(r.text, /me\.near is a mainnet account but NEAR_NETWORK=testnet/);
  // a mainnet-configured MCP refuses a testnet API
  const main = makeTools({ env: { PRICEDIN_API_URL: api.base, NEAR_NETWORK: "mainnet", NEAR_ACCOUNT_ID: "me.near", NEAR_PRIVATE_KEY: KeyPair.fromRandom("ed25519").toString() } });
  await assert.rejects(main.tools[3].handler({ claim_id: 1, side: "no", amount_usd: 1 }), /runs on testnet, but NEAR_NETWORK=mainnet here/);
  const capped = makeTools({ env: { PRICEDIN_API_URL: api.base, NEAR_ACCOUNT_ID: "me.testnet", NEAR_PRIVATE_KEY: "ed25519:x", PRICEDIN_MAX_BET_USD: "2" } });
  assert.match((await capped.tools[3].handler({ claim_id: 1, side: "no", amount_usd: 3 })).text, /above PRICEDIN_MAX_BET_USD=2/);
  const shared = makeTools({ env: { PRICEDIN_API_URL: api.base, NEAR_ACCOUNT_ID: "me.testnet", NEAR_PRIVATE_KEY: "ed25519:x" }, allowBet: false });
  assert.match((await shared.tools[3].handler({ claim_id: 1, side: "no", amount_usd: 1 })).text, /places no bets/);
});

test("bet: quotes, then signs with the caller's key through the market's buy, with a slippage floor", async (t) => {
  const { api } = await backend(t);
  const calls = [];
  const kp = KeyPair.fromRandom("ed25519");
  const tools = makeTools({
    env: { PRICEDIN_API_URL: api.base, NEAR_ACCOUNT_ID: "me.testnet", NEAR_PRIVATE_KEY: kp.toString() },
    betImpl: async (s, b) => { calls.push({ s, b }); return { trade: { amount_micro: "1000000", shares_micro: "1225000", price_yes_ppm_before: 189970, price_yes_ppm_after: 120000 }, tx: "BetTx", explorer: "https://testnet.nearblocks.io/txns/BetTx", steps: [] }; },
  });
  const r = await tools.tools[3].handler({ claim_id: 1, side: "no", amount_usd: 1 });
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /^Bet placed by me\.testnet: \$1\.00 on NO of claim 1, 1\.2250 shares; YES 19% -> 12%\. https:\/\/testnet\.nearblocks\.io\/txns\/BetTx/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].s.accountId, "me.testnet");
  assert.equal(calls[0].b.market, MARKET);
  assert.equal(calls[0].b.usdc, USDC);
  assert.equal(calls[0].b.amountMicro, 1_000_000n);
  assert.ok(calls[0].b.minSharesMicro > 1_000_000n && calls[0].b.minSharesMicro < 1_300_000n);
  assert.equal(calls[0].b.faucet, true);
});

test("x402 through the tools: free tier used, no key: says how to pay; with the caller's key: a real x402 client pays", async (t) => {
  const seen = [];
  const facilitator = {
    kind: "mock",
    async verify(p, r) { seen.push(["verify", p]); return { isValid: true, payer: p.payload?.signedDelegateAction ? "payer.testnet" : null }; },
    async settle(p, r) { seen.push(["settle", p]); return { success: true, transaction: "PaidTx1", network: r.network, payer: "payer.testnet" }; },
  };
  const { api, mock } = await backend(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0", X402_PAY_TO: PAY_TO }, { facilitator });
  const noKey = makeTools({ env: { PRICEDIN_API_URL: api.base } });
  const r = await noKey.tools[0].handler({ question: "Does Tether issue USDT on NEAR?" });
  assert.equal(r.isError, true);
  assert.match(r.text, /free tier is used up; each call costs \$0\.01 in USDC by x402\. Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY/);
  // get_claim falls back to the bare on-chain view
  const g = await noKey.tools[1].handler({ claim_id: 1 });
  assert.match(g.text, /^Claim 1: "Tether issues tokens.*is at 19% true \(Open\)/);

  // the caller's own key: @fastnear/x402's client signs a NEP-366 delegate ft_transfer
  const kp = KeyPair.fromRandom("ed25519");
  mock.addAdminKey("payer.testnet", kp.getPublicKey().toString());
  const paying = makeTools({ env: { PRICEDIN_API_URL: api.base, NEAR_ACCOUNT_ID: "payer.testnet", NEAR_PRIVATE_KEY: kp.toString(), NEAR_RPC_URL: mock.url } });
  const p = await paying.tools[0].handler({ question: "Does Tether issue USDT on NEAR?" });
  assert.equal(p.isError, undefined, p.text);
  assert.match(p.text, /Paid \$0\.01 by x402 on near:testnet: https:\/\/testnet\.nearblocks\.io\/txns\/PaidTx1/);
  assert.deepEqual(seen.map((s) => s[0]), ["verify", "settle"]);
  const payload = seen[0][1];
  assert.equal(payload.x402Version, 2);
  assert.equal(payload.accepted.payTo, PAY_TO);
  assert.equal(payload.accepted.amount, "10000");
  assert.equal(typeof payload.payload.signedDelegateAction, "string");
  // the caps hold: no payment above PRICEDIN_MAX_PAY_USD
  const stingy = makeTools({ env: { PRICEDIN_API_URL: api.base, NEAR_ACCOUNT_ID: "payer.testnet", NEAR_PRIVATE_KEY: kp.toString(), NEAR_RPC_URL: mock.url, PRICEDIN_MAX_PAY_USD: "0.001" } });
  assert.match((await stingy.tools[0].handler({ question: "Does Tether issue USDT on NEAR?" })).text, /above PRICEDIN_MAX_PAY_USD=0\.001/);
  assert.equal(seen.length, 2);
});

test("streamable HTTP: sessions, JSON replies, 202 for notifications, origin guard", async (t) => {
  const { api } = await backend(t);
  const h = await serveHttp(() => new McpServer({ tools: makeTools({ env: { PRICEDIN_API_URL: api.base } }).tools }), { port: 0, log: () => {} });
  t.after(() => h.close());
  const post = (body, headers = {}) => fetch(h.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(init.status, 200);
  const sid = init.headers.get("mcp-session-id");
  assert.ok(sid);
  assert.equal((await init.json()).result.serverInfo.name, "pricedin-mcp");
  assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": sid })).status, 202);
  const ask = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask", arguments: { question: "Is Tether headquartered in El Salvador?" } } }, { "mcp-session-id": sid, "mcp-protocol-version": "2025-06-18" });
  const j = await ask.json();
  assert.match(j.result.content[0].text, /Claim 0 \(page tether\): "Tether Holdings Limited is headquartered in El Salvador/);
  assert.equal((await post({ jsonrpc: "2.0", id: 3, method: "tools/list" })).status, 400, "no session id");
  assert.equal((await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-session-id": "nope" })).status, 404);
  assert.equal((await post({ jsonrpc: "2.0", id: 4, method: "ping" }, { "mcp-session-id": sid, origin: "https://evil.example" })).status, 403);
  assert.equal((await fetch(h.url)).status, 405);
  assert.equal((await fetch(h.url, { method: "DELETE", headers: { "mcp-session-id": sid } })).status, 200);
  assert.equal((await post({ jsonrpc: "2.0", id: 5, method: "ping" }, { "mcp-session-id": sid })).status, 404);
});
