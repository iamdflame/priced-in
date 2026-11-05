import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { loadConfig, describeConfig, nearToYocto } from "../src/config.mjs";
import { parsePublicKey } from "../src/lane.mjs";
import { startApi } from "./helpers.mjs";
import { startMockRpc } from "./mock-rpc.mjs";

test("config: testnet by default, mainnet only when set explicitly", () => {
  assert.equal(loadConfig({}).config.network, "testnet");
  assert.match(loadConfig({}).config.rpcUrls[0], /test/);
  const m = loadConfig({ NEAR_NETWORK: "mainnet" });
  assert.equal(m.config.network, "mainnet");
  assert.deepEqual(m.errors, []);
  assert.ok(loadConfig({ NEAR_NETWORK: "Mainnet" }).errors.length, "no fuzzy matching");
});

test("config: refuses accounts and RPCs from the other network", () => {
  assert.match(loadConfig({ MARKET_CONTRACT_ID: "market.pricedin.near" }).errors.join(), /mainnet account/);
  assert.match(loadConfig({ NEAR_NETWORK: "mainnet", LANE_ACCOUNT_ID: "lane.testnet" }).errors.join(), /testnet account/);
  assert.match(loadConfig({ RPC_URLS: "https://rpc.mainnet.near.org" }).errors.join(), /looks like mainnet/);
  assert.match(loadConfig({ RPC_URLS: "https://free.rpc.fastnear.com" }).errors.join(), /looks like mainnet/);
  assert.match(loadConfig({ NEAR_NETWORK: "mainnet", RPC_URLS: "https://test.rpc.fastnear.com" }).errors.join(), /looks like testnet/);
  assert.match(loadConfig({ MARKET_CONTRACT_ID: "Bad Account" }).errors.join(), /not a valid NEAR account/);
  assert.match(loadConfig({ RPC_URLS: "ftp://x" }).errors.join(), /http/);
  assert.match(loadConfig({ PLANNER_B_MICRO: "50" }).errors.join(), /PLANNER_B_MICRO/);
  assert.match(loadConfig({ LANE_ALLOWANCE_NEAR: "5" }).errors.join(), /above 1 NEAR/);
});

test("config: the printable summary never contains secrets", () => {
  const sk = KeyPair.fromRandom("ed25519").toString();
  const { config } = loadConfig({ LANE_ACCOUNT_ID: "lane.testnet", LANE_PRIVATE_KEY: sk, PLANNER_PRIVATE_KEY: sk, NEARAI_API_KEY: "sk-secret" });
  const s = JSON.stringify(describeConfig(config));
  assert.ok(!s.includes(sk.slice(8)) && !s.includes("sk-secret"));
  assert.match(s, /"privateKey":"set"/);
});

test("NEAR amounts parse exactly", () => {
  assert.equal(nearToYocto("0.25"), 250000000000000000000000n);
  assert.equal(nearToYocto("1"), 10n ** 24n);
  assert.throws(() => nearToYocto("-1"));
  assert.throws(() => nearToYocto("1e3"));
});

test("public keys: only ed25519 with 32 bytes, normalised", () => {
  const pk = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  assert.equal(parsePublicKey(pk), pk);
  assert.equal(parsePublicKey(`  ${pk} `), pk);
  for (const bad of [undefined, 42, "", "ed25519:", "secp256k1:abc", "ed25519:0OIl", "ed25519:3yZe7d", pk.replace("ed25519:", ""), "ed25519:" + "1".repeat(120)]) {
    assert.throws(() => parsePublicKey(bad), (e) => e.status === 400 && e.code === "invalid_public_key", String(bad));
  }
});

test("HTTP: clear JSON errors for bad input", async (t) => {
  const mock = await startMockRpc();
  t.after(() => mock.close());
  const lane = KeyPair.fromRandom("ed25519");
  mock.addAdminKey("lane.testnet", lane.getPublicKey().toString());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", LANE_ACCOUNT_ID: "lane.testnet", LANE_PRIVATE_KEY: lane.toString() });
  t.after(() => api.close());

  let r = await api.req("POST", "/lane/key", "{nope");
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "invalid_json");
  r = await api.req("POST", "/lane/key", "");
  assert.equal(r.status, 400);
  r = await api.req("POST", "/lane/key", { publicKey: "hello" });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "invalid_public_key");
  assert.match(r.json.error.message, /ed25519/);
  r = await api.req("POST", "/lane/key", { publicKey: "x".repeat(5000) });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, "body_too_large");
  r = await api.req("GET", "/lane/key");
  assert.equal(r.status, 405);
  r = await api.req("POST", "/paste", { text: "   " });
  assert.equal(r.json.error.code, "empty_text");
  r = await api.req("POST", "/paste", { nope: 1 });
  assert.equal(r.status, 400);
  r = await api.req("POST", "/paste", { text: "A sentence.", page: "Bad:Page" });
  assert.equal(r.json.error.code, "invalid_page");
  r = await api.req("POST", "/paste", { text: "x".repeat(20001) });
  assert.equal(r.status, 413);
  r = await api.req("GET", "/claims/abc");
  assert.equal(r.json.error.code, "invalid_claim_id");
  r = await api.req("GET", "/claims?page=No:Good");
  assert.equal(r.status, 400);
  r = await api.req("GET", "/claims/7");
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, "no_such_claim");
  r = await api.req("GET", "/nowhere");
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, "not_found");
  r = await api.req("OPTIONS", "/lane/key");
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("HTTP: without a market the endpoints that need one say so", async (t) => {
  const mock = await startMockRpc();
  t.after(() => mock.close());
  const api = await startApi({ RPC_URLS: mock.url });
  t.after(() => api.close());
  for (const p of ["/claims", "/claims/1", "/events"]) {
    const r = await api.req("GET", p);
    assert.equal(r.status, 503, p);
    assert.equal(r.json.error.code, "market_not_configured");
  }
  const r = await api.req("POST", "/lane/key", { publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, "lane_unavailable");
});
