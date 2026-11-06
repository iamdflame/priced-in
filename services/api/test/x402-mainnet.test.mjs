// The mainnet payment setup, with no network: scripts/mainnet/x402.mjs on a fake chain, the
// variables scripts/vercel/secrets.mjs sets, and the refusals of the two mainnet commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runX402, toYocto } from "../../../scripts/mainnet/x402.mjs";
import { x402Env } from "../../../scripts/vercel/env.mjs";
import { loadConfig } from "../src/config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SECRET = "ed25519:the-private-half-never-printed";
const RELAYER = "x402.isitpriced.near";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

function world({ relayer = null, registered = true, ownerNear = 1.9, key = null, keyOnChain = true } = {}) {
  const calls = [];
  const accounts = new Map([["isitpriced.near", { amount: toYocto(ownerNear), storage: 671n }]]);
  if (relayer !== null) accounts.set(RELAYER, { amount: toYocto(relayer), storage: 182n });
  const keysOn = new Set(key && keyOnChain ? [key.publicKey] : []);
  const chain = {
    account: async (id) => accounts.get(id) ?? null,
    registered: async () => registered,
    keyOn: async (_, pk) => keysOn.has(pk),
    create: async (pk, yocto) => { calls.push(["create", pk, yocto]); accounts.set(RELAYER, { amount: yocto, storage: 182n }); keysOn.add(pk); return "CreateTx"; },
    topUp: async (id, yocto) => { calls.push(["topUp", id, yocto]); accounts.get(id).amount += yocto; return "TopUpTx"; },
  };
  let held = key;
  const keys = {
    where: ".apex-test/mainnet/x402-relayer-key.json",
    read: () => held,
    write: (rec) => { calls.push(["write", rec.publicKey]); held = rec; },
    make: (accountId) => ({ accountId, publicKey: "ed25519:NewPublicHalf", privateKey: SECRET }),
  };
  const dep = { network: "mainnet", root: "isitpriced.near", accounts: { usdc: USDC, market: "market.isitpriced.near" }, keys: { owner: "isitpriced.near" }, transactions: [{ tag: "earlier" }] };
  const lines = [];
  const go = (apply, target = "0.1") => runX402({ dep, chain, keys, target: toYocto(target), priceMicro: 10000, apply, log: (m) => lines.push(m) });
  return { calls, dep, lines, go };
}

test("x402 script: --plan changes nothing and says what it would do", async () => {
  const w = world();
  const r = await w.go(false);
  assert.deepEqual(r, { ok: true, changed: false });
  assert.deepEqual(w.calls, []);
  assert.equal(w.dep.x402, undefined);
  const out = w.lines.join("\n");
  assert.match(out, /pay-to isitpriced\.near: registered on USDC/);
  assert.match(out, /relayer x402\.isitpriced\.near: to create; target 0\.100 NEAR, send 0\.100 NEAR/);
  assert.match(out, /about 333 settlements/);
  assert.match(out, /plan only: nothing changed/);
});

test("x402 script: the real run writes the key first, creates the relayer, records public values only", async () => {
  const w = world();
  const r = await w.go(true);
  assert.deepEqual(r, { ok: true, changed: true });
  assert.deepEqual(w.calls.map((c) => c[0]), ["write", "create"], "the key is on disk before its public half is used");
  assert.equal(w.calls[1][2], toYocto("0.1"));
  assert.equal(w.dep.x402.pay_to, "isitpriced.near");
  assert.equal(w.dep.x402.relayer, RELAYER);
  assert.equal(w.dep.x402.price_micro, 10000);
  assert.equal(w.dep.keys.x402_relayer_public_key, "ed25519:NewPublicHalf");
  assert.equal(w.dep.keys.owner, "isitpriced.near", "earlier keys stay");
  assert.deepEqual(w.dep.transactions.map((t) => t.tag), ["earlier", `create ${RELAYER}`]);
  assert.ok(!JSON.stringify(w.dep).includes(SECRET), "no private key in the record");
  assert.ok(!w.lines.join("\n").includes(SECRET), "no private key in the output");
});

test("x402 script: run twice, the second run does nothing; a spent relayer is topped up", async () => {
  const w = world();
  await w.go(true);
  w.calls.length = 0;
  await w.go(true);
  assert.deepEqual(w.calls, [], "nothing on chain, no second key");
  assert.equal(w.dep.transactions.length, 2);

  const key = { accountId: RELAYER, publicKey: "ed25519:Held", privateKey: SECRET };
  const low = world({ relayer: 0.03, key });
  await low.go(true);
  assert.deepEqual(low.calls, [["topUp", RELAYER, toYocto("0.07")]]);
  assert.ok(!low.lines.join("\n").includes(SECRET));
});

test("x402 script: refuses what would strand money or a key", async () => {
  const unregistered = world({ registered: false });
  assert.deepEqual(await unregistered.go(true), { ok: false, changed: false });
  assert.deepEqual(unregistered.calls, []);
  assert.match(unregistered.lines.at(-1), /can't receive USDC/);

  const lostKey = world({ relayer: 0.1 });
  assert.equal((await lostKey.go(true)).ok, false);
  assert.match(lostKey.lines.at(-1), /x402-relayer-key\.json is missing/);

  const key = { accountId: RELAYER, publicKey: "ed25519:Other", privateKey: SECRET };
  const wrongKey = world({ relayer: 0.1, key, keyOnChain: false });
  assert.equal((await wrongKey.go(true)).ok, false);
  assert.match(wrongKey.lines.at(-1), /is not on x402\.isitpriced\.near/);

  const poor = world({ ownerNear: 0.1 });
  assert.equal((await poor.go(true)).ok, false);
  assert.match(poor.lines.at(-1), /owner would keep less/);
  assert.deepEqual(poor.calls, []);

  await assert.rejects(world({ key: { accountId: "other.near", publicKey: "x" } }).go(false), /is for other\.near/);
});

test("secrets: the mainnet X402 values come from the record and the key file, and pass the API's own config", async () => {
  const w = world();
  await w.go(true);
  const rec = { accountId: RELAYER, publicKey: "ed25519:NewPublicHalf", privateKey: "ed25519:5Jg" };
  const { plain, secret } = x402Env(w.dep, rec);
  assert.deepEqual(plain, { X402_PAY_TO: "isitpriced.near", X402_RELAYER_ACCOUNT_ID: RELAYER, X402_PRICE_MICRO: "10000", X402_RPC_URL: "https://rpc.fastnear.com", X402_FACILITATOR_ROUTES: "0" });
  assert.deepEqual(Object.keys(secret), ["X402_RELAYER_PRIVATE_KEY"]);
  const { config, errors, warnings } = loadConfig({ NEAR_NETWORK: "mainnet", USDC_CONTRACT_ID: USDC, MARKET_CONTRACT_ID: "market.isitpriced.near", ...plain, ...secret });
  assert.deepEqual(errors, []);
  assert.ok(!(warnings || []).some((m) => /X402/.test(m)), String(warnings));
  assert.equal(config.x402.asset, USDC);
  assert.equal(config.x402.payTo, "isitpriced.near");
  assert.equal(config.x402.priceMicro, 10000);
  assert.equal(config.x402.facilitatorRoutes, false);
  assert.equal(config.x402.network, "mainnet");

  assert.deepEqual(x402Env({}, rec), { plain: {}, secret: {} }, "nothing until the script has run");
  assert.deepEqual(x402Env(w.dep, null), { plain: {}, secret: {} });
  assert.throws(() => x402Env(w.dep, { ...rec, accountId: "other.near" }), /is for other\.near/);
});

const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });

test("the real commands refuse without CONFIRM_MAINNET=yes, before any network or key", () => {
  const script = run(["scripts/mainnet/x402.mjs"]);
  assert.equal(script.status, 1);
  assert.match(script.stderr, /Refusing to touch mainnet/);
  const smoke = run(["services/api/test/truth-smoke.mjs", "--network", "mainnet"]);
  assert.equal(smoke.status, 1);
  assert.match(smoke.stderr, /Refusing to spend on mainnet/);
});
