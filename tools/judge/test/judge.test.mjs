// The judge's own tests: the books reading, block pinning and rate limits, verdict verification,
// and check 11 end to end on fixture data. No network: npm run judge:test.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { booksAt, sumBalances } from "../lib/books.mjs";
import { Rpc, crashAsSkip, at } from "../lib/near.mjs";
import { verifyVerdict, submitVerdictArgs, expectedOutcome, ed25519Ok, sha256hex, pool } from "../lib/verdicts.mjs";
import { checkMainnet } from "../checks/mainnet.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MARKET = "market.example.near", USDC = "usdc.example.near";

// ---------- fixtures ----------
const balKey = (name) => { const n = Buffer.from(name); const k = Buffer.alloc(5 + n.length); k[0] = 0x62; k.writeUInt32LE(n.length, 1); n.copy(k, 5); return k.toString("base64"); };
const balVal = (micro) => { const v = Buffer.alloc(16); v.writeBigUInt64LE(BigInt(micro) & 0xffffffffffffffffn, 0); v.writeBigUInt64LE(BigInt(micro) >> 64n, 8); return v.toString("base64"); };
// the books as they stood at one moment on mainnet: 81.607427 = 13.107001 + 50.364225 + 9.124009 + 6.222911 + 2.789281
const STATS = { claims: 3, challenges: 0, treasury_micro: "13107001", reserved_micro: "50364225", balances_micro: "9124009", collected_micro: "6222911", payouts_micro: "2789281", bonds_micro: "0", bounties_micro: "0", held_micro: "81607427", paused: false };
const CLAIMS = [
  { id: 0, status: "Open", collected_micro: "4000000", payout_left_micro: "0", bounty_micro: "0" },
  { id: 1, status: "Challenged", collected_micro: "2222911", payout_left_micro: "0", bounty_micro: "0" },
  { id: 2, status: "Settled", collected_micro: "999999", payout_left_micro: "2789281", bounty_micro: "0" },
];
const STATE = { values: [{ key: balKey("a.near"), value: balVal(9000000) }, { key: balKey("b.near"), value: balVal(124009) }, { key: Buffer.from("x").toString("base64"), value: balVal(5) }] };
function fakeView({ stats = STATS, claims = CLAIMS, held = "81607427", extra = {} } = {}) {
  const calls = [];
  const view = async (c, m, a = {}) => {
    calls.push([c, m, a]);
    if (m === "stats") return stats;
    if (m === "ft_balance_of") return held;
    if (m === "get_claims") return claims.slice(a.from, a.from + a.limit);
    if (m === "get_balance") return { "a.near": "9000000", "b.near": "124009" }[a.trader] ?? "0";
    if (extra[m]) return extra[m](a, c);
    throw new Error(`unexpected view ${m}`);
  };
  return { view, calls };
}

test("sumBalances reads the borsh String -> u128 map and skips other keys", () => {
  assert.deepEqual(sumBalances(STATE.values), { total: 9124009n, holders: 2 });
  assert.equal(sumBalances([{ key: balKey("big"), value: balVal((1n << 64n) + 7n) }]).total, (1n << 64n) + 7n);
});

test("booksAt: the reference moment closes to the micro-USDC", async () => {
  const { view } = fakeView();
  const k = await booksAt(view, MARKET, USDC, { state: async () => STATE });
  assert.equal(k.ok, true, k.failed.join("; "));
  assert.equal(k.held, 81607427n);
  assert.equal(k.claims, 3);
  assert.match(k.dollars, /^81\.607427 held = treasury 13\.107001 \+ reserved 50\.364225 \+ balances 9\.124009 \+ collected 6\.222911 \+ payouts 2\.789281$/);
  assert.ok(k.rows.every((r) => r[1] === true));
});

test("booksAt: a bucket off by one micro-USDC fails, naming the row", async () => {
  const { view } = fakeView({ held: "81607428" });
  const k = await booksAt(view, MARKET, USDC, { state: async () => STATE });
  assert.equal(k.ok, false);
  assert.deepEqual(k.failed, ["USDC the market holds = held_micro", "held = treasury + reserved + balances + collected + payouts + bonds + bounties"]);
  const v2 = fakeView({ claims: CLAIMS.map((c) => (c.id === 2 ? { ...c, payout_left_micro: "1" } : c)) });
  assert.deepEqual((await booksAt(v2.view, MARKET, USDC, { state: async () => STATE })).failed, ["sum of payouts left = payouts_micro"]);
});

test("booksAt: an RPC that refuses view_state makes that row 'not listed', not a failure", async () => {
  const { view } = fakeView();
  const k = await booksAt(view, MARKET, USDC, { state: async () => { throw new Error("State of contract is too large to be viewed"); } });
  assert.equal(k.ok, true);
  const row = k.rows.find((r) => r[0].startsWith("sum of balances"));
  assert.equal(row[1], null);
  assert.match(row[0], /not listed/);
  assert.match(k.how, /would not list storage/);
  // testnet's seed traders still stand in when given
  const t = await booksAt(view, MARKET, USDC, { state: async () => { throw new Error("too large"); }, traders: ["a.near", "b.near"] });
  assert.equal(t.rows.find((r) => r[0] === "sum of balances = balances_micro")[1], true);
});

test("booksAt: a paused market or no claims is not ok", async () => {
  assert.equal((await booksAt(fakeView({ stats: { ...STATS, paused: true } }).view, MARKET, USDC, { state: async () => STATE })).ok, false);
  assert.equal((await booksAt(fakeView({ claims: [], stats: { ...STATS, collected_micro: "0", payouts_micro: "0" } }).view, MARKET, USDC, { state: async () => STATE })).ok, false);
});

// ---------- block pinning and rate limits ----------
function fakeFetch(handler) {
  const seen = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, body });
    const out = await handler(url, body, seen.length);
    if (typeof out === "number") return { ok: out < 400, status: out, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => out };
  };
  return { f, seen };
}
const viewResult = (v) => ({ jsonrpc: "2.0", result: { result: [...Buffer.from(JSON.stringify(v))] } });

test("at(): a block id pins the read; no block id reads the latest final block", () => {
  assert.deepEqual(at(123), { block_id: 123 });
  assert.deepEqual(at(undefined), { finality: "final" });
});

test("Rpc.view with { blockId } sends block_id and no finality; pinned() binds every view and state read", async () => {
  const { f, seen } = fakeFetch((url, body) => {
    if (body.method === "block") return { result: { header: { height: 4242 } } };
    if (body.params.request_type === "view_state") return { result: { values: [] } };
    return viewResult({ ok: true });
  });
  const rpc = new Rpc(["https://a.example"], 1000, [], { fetchImpl: f, backoffMs: [0, 0, 0] });
  assert.deepEqual(await rpc.view("m.near", "stats", {}, { blockId: 77 }), { ok: true });
  assert.equal(seen[0].body.params.block_id, 77);
  assert.equal("finality" in seen[0].body.params, false);
  await rpc.view("m.near", "stats");
  assert.equal(seen[1].body.params.finality, "final");
  const h = await rpc.finalHeight();
  assert.equal(h, 4242);
  const r = rpc.pinned(h);
  await r.view("m.near", "get_claims", { from: 0, limit: 100 });
  await r.state("m.near", "b");
  assert.equal(seen.at(-2).body.params.block_id, 4242);
  assert.equal(seen.at(-1).body.params.block_id, 4242);
  assert.equal(seen.at(-1).body.params.request_type, "view_state");
  assert.equal(Buffer.from(seen.at(-1).body.params.prefix_base64, "base64").toString(), "b");
});

test("Rpc: HTTP 429 backs off and asks the same node again before moving on", async () => {
  const { f, seen } = fakeFetch((url, body, n) => (n <= 2 ? 429 : viewResult(5)));
  const rpc = new Rpc(["https://a.example", "https://b.example"], 1000, [], { fetchImpl: f, backoffMs: [0, 0, 0] });
  assert.equal(await rpc.view("m.near", "x"), 5);
  assert.deepEqual(seen.map((s) => s.url), ["https://a.example", "https://a.example", "https://a.example"]);
});

test("Rpc: a node that keeps answering 429 is left for the next one; a JSON 'too many requests' backs off too", async () => {
  const a = fakeFetch((url) => (url.includes("a.") ? 429 : viewResult(9)));
  const rpc = new Rpc(["https://a.example", "https://b.example"], 1000, [], { fetchImpl: a.f, backoffMs: [0, 0, 0] });
  assert.equal(await rpc.view("m.near", "x"), 9);
  assert.equal(a.seen.filter((s) => s.url.includes("a.")).length, 5); // 2 tries + 3 backoffs
  const b = fakeFetch((url, body, n) => (n === 1 ? { error: { message: "too many requests" } } : viewResult(1)));
  assert.equal(await new Rpc(["https://a.example"], 1000, [], { fetchImpl: b.f, backoffMs: [0, 0, 0] }).view("m.near", "x"), 1);
});

test("Rpc: a node behind the pinned block (UNKNOWN_BLOCK) passes the read to the next node; a contract panic does not", async () => {
  const a = fakeFetch((url) => (url.includes("a.") ? { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK" }, data: "DB Not Found Error" } } : viewResult(3)));
  assert.equal(await new Rpc(["https://a.example", "https://b.example"], 1000, [], { fetchImpl: a.f, backoffMs: [0] }).view("m.near", "x", {}, { blockId: 1 }), 3);
  const b = fakeFetch(() => ({ error: { name: "HANDLER_ERROR", cause: { name: "CONTRACT_EXECUTION_ERROR" }, data: "wasm execution failed: panicked: no such claim" } }));
  await assert.rejects(new Rpc(["https://a.example", "https://b.example"], 1000, [], { fetchImpl: b.f }).view("m.near", "x"), /no such claim/);
  assert.equal(b.seen.length, 1);
});

test("crashAsSkip: rate limits, unknown transactions and unavailable nodes are SKIPs with the reason; a bug is not", () => {
  for (const msg of ["https://rpc.fastnear.com: HTTP 429", "\"too many requests\"", "{\"name\":\"UNKNOWN_TRANSACTION\"}", "\"UNAVAILABLE\"", "fetch failed"]) {
    const r = crashAsSkip(new Error(msg));
    assert.equal(r?.status, "SKIP", msg);
    assert.ok(r.detail.length > 10);
  }
  assert.match(crashAsSkip(new Error("HTTP 429")).detail, /rate-limited/);
  assert.equal(crashAsSkip(new TypeError("Cannot read properties of undefined (reading 'x')")), null);
});

// ---------- verdicts ----------
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
const MODEL = "acme/juror-1";
const completion = (verdict, model = MODEL) => Buffer.from(JSON.stringify({ id: "c1", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: `VERDICT: ${verdict}\nBecause the source says so.` } }] }));
function signed(canonical, response, model = MODEL, key = privateKey) {
  const text = `${model}:${sha256hex(Buffer.from(canonical))}:${sha256hex(response)}`;
  return sign(null, Buffer.from(text), key).toString("hex");
}

test("verifyVerdict: canonical request, response bytes, signature and verdict all check", () => {
  const canonical = `{"model":"${MODEL}","messages":[],"temperature":0,"stream":false}`;
  const response = completion("FALSE");
  const sig = signed(canonical, response);
  const stored = { model: MODEL, outcome: "FALSE", request_hash: sha256hex(Buffer.from(canonical)), response_hash: sha256hex(response) };
  const r = verifyVerdict({ model: MODEL, stored, canonical, request: Buffer.from(canonical), response, signatureHex: sig, key: PUB });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.equal(r.outcome, "FALSE");
  // offline: the recorded request bytes stand in for canonical_request
  assert.equal(verifyVerdict({ model: MODEL, request: Buffer.from(canonical), response, signatureHex: sig, key: PUB }).ok, true);
});

test("verifyVerdict: each tampering is caught by its own step", () => {
  const canonical = "{\"req\":1}";
  const response = completion("TRUE");
  const sig = signed(canonical, response);
  const stored = { model: MODEL, outcome: "TRUE", request_hash: sha256hex(Buffer.from(canonical)), response_hash: sha256hex(response) };
  const fails = (o) => verifyVerdict({ model: MODEL, stored, canonical, response, signatureHex: sig, key: PUB, ...o }).steps.filter((s) => !s[1]).map((s) => s[0]);
  assert.deepEqual(fails({}), []);
  assert.match(fails({ canonical: "{\"req\":2}" }).join(), /canonical_request/);
  assert.match(fails({ response: completion("FALSE") }).join(), /response_hash/);
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  assert.match(fails({ key: other }).join(), /ed25519/);
  assert.match(fails({ signatureHex: "00".repeat(64) }).join(), /ed25519/);
  assert.match(fails({ stored: { ...stored, outcome: "FALSE" } }).join(), /the market recorded FALSE/);
  assert.match(fails({ request: Buffer.from("{\"req\":3}") }).join(), /recorded request bytes/);
  // a response naming another model is refused by the rules, as the contract refuses it
  const resp2 = completion("TRUE", "acme/other");
  assert.match(verifyVerdict({ model: MODEL, canonical, response: resp2, signatureHex: signed(canonical, resp2), key: PUB }).steps.filter((s) => !s[1]).map((s) => s[0]).join(), /different model/);
});

test("ed25519Ok refuses malformed keys and signatures instead of throwing", () => {
  assert.equal(ed25519Ok("x", "zz", PUB), false);
  assert.equal(ed25519Ok("x", "00".repeat(64), "abcd"), false);
});

test("verifyVerdict: a real mainnet verdict from the committed evidence verifies against the recorded key", () => {
  const ev = JSON.parse(fs.readFileSync(path.join(REPO, "tools/judge/evidence/mainnet-rulings.json"), "utf8"));
  const keys = new Map(JSON.parse(fs.readFileSync(path.join(REPO, "deployments/mainnet.json"), "utf8")).models.map((m) => [m.model, m.signing_address_hex]));
  assert.ok(ev.verdicts.length >= 24);
  for (const v of ev.verdicts) {
    const r = verifyVerdict({ model: v.model, request: Buffer.from(v.request_b64, "base64"), response: Buffer.from(v.response_b64, "base64"), signatureHex: v.signature_hex, key: keys.get(v.model) });
    assert.equal(r.ok, true, `challenge ${v.challenge_id} ${v.model}: ${JSON.stringify(r.steps.filter((s) => !s[1]))}`);
  }
  // and only bytes and pointers are kept
  for (const v of ev.verdicts) assert.deepEqual(Object.keys(v).sort(), ["challenge_id", "model", "request_b64", "response_b64", "sender_id", "signature_hex", "tx_hash"]);
});

test("submitVerdictArgs reads the call's arguments and whether the market's receipt succeeded", () => {
  const args = { challenge_id: 3, model: MODEL, response: completion("TRUE").toString("base64"), signature_hex: "ab" };
  const tx = (status) => ({ status, transaction: { signer_id: "jury.near", receiver_id: MARKET, actions: [{ FunctionCall: { method_name: "submit_verdict", args: Buffer.from(JSON.stringify(args)).toString("base64") } }] }, receipts_outcome: [{ outcome: { executor_id: MARKET, status } }] });
  const a = submitVerdictArgs(tx({ SuccessValue: "" }), MARKET);
  assert.equal(a.challenge_id, 3);
  assert.equal(a.model, MODEL);
  assert.equal(a.signer, "jury.near");
  assert.equal(a.ok, true);
  assert.equal(a.response.toString(), completion("TRUE").toString());
  assert.equal(submitVerdictArgs(tx({ Failure: { x: 1 } }), MARKET).ok, false);
  assert.equal(submitVerdictArgs(tx({ SuccessValue: "" }), "other.near"), null);
});

test("expectedOutcome: two matching verdicts decide, later ones don't move it, each dispute flips it, three go to the council", () => {
  const V = (...o) => o.map((outcome) => ({ outcome }));
  assert.equal(expectedOutcome(V("FALSE", "FALSE", "TRUE")), false);
  assert.equal(expectedOutcome(V("TRUE", "INSUFFICIENT", "TRUE")), true);
  assert.equal(expectedOutcome(V("TRUE", "FALSE", "FALSE")), false);
  assert.equal(expectedOutcome(V("TRUE", "FALSE", "INSUFFICIENT")), null);
  assert.equal(expectedOutcome(V("FALSE", "FALSE"), 1), true);
  assert.equal(expectedOutcome(V("FALSE", "FALSE"), 2), false);
  assert.equal(expectedOutcome(V("FALSE", "FALSE"), 3), null);
});

test("pool keeps order and caps concurrency", async () => {
  let live = 0, max = 0;
  const out = await pool([1, 2, 3, 4, 5, 6], 2, async (x) => { live++; max = Math.max(max, live); await new Promise((r) => setTimeout(r, 2)); live--; return x * 10; });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.equal(max, 2);
});

// ---------- check 11 end to end, on a fake chain ----------
function fakeMainnet({ outcome = false, tamper = false, disputes = 0 } = {}) {
  const evidence = JSON.parse(fs.readFileSync(path.join(REPO, "tools/judge/evidence/mainnet-rulings.json"), "utf8"));
  const dep = JSON.parse(fs.readFileSync(path.join(REPO, "deployments/mainnet.json"), "utf8"));
  const M = dep.accounts.market;
  const byCh = new Map();
  for (const v of evidence.verdicts) { if (!byCh.has(v.challenge_id)) byCh.set(v.challenge_id, []); byCh.get(v.challenge_id).push(v); }
  const ids = [...byCh.keys()].sort((a, b) => a - b);
  const stored = (v) => {
    const resp = Buffer.from(v.response_b64, "base64");
    return { model: v.model, outcome: "FALSE", request_hash: sha256hex(Buffer.from(v.request_b64, "base64")), response_hash: sha256hex(tamper && v === evidence.verdicts[0] ? Buffer.from("x") : resp) };
  };
  const stats = { ...STATS, challenges: ids.length };
  const claims = ids.map((id) => ({ id, status: "Settled", collected_micro: "0", payout_left_micro: "0", bounty_micro: "0" }));
  claims.push({ id: 99, status: "Open", collected_micro: "6222911", payout_left_micro: "2789281", bounty_micro: "0" });
  const pinnedAt = [];
  const { view } = fakeView({
    stats, claims,
    extra: {
      ft_metadata: () => ({ symbol: "USDC", decimals: 6 }),
      get_challenge: ({ challenge_id }) => ({ claim_id: challenge_id, claimed_outcome: false, verdicts: byCh.get(challenge_id).map(stored), disputes, resolved: true, stakes: [{ account: "checker.near", side: false, amount_micro: "1000000", evidence: "" }, ...(disputes ? [{ account: "x.near", side: true, amount_micro: "2000000", evidence: "no" }] : [])] }),
      get_claim: ({ claim_id }) => ({ id: claim_id, status: "Settled", outcome, challenge_id: claim_id }),
      canonical_request: ({ challenge_id, model }) => Buffer.from(byCh.get(challenge_id).find((v) => v.model === model).request_b64, "base64").toString("utf8"),
      get_model: ({ model }) => ({ signing_address_hex: dep.models.find((m) => m.model === model).signing_address_hex }),
    },
  });
  const rpc = {
    finalHeight: async () => 1000,
    pinned: (h) => ({ blockId: h, view: (c, m, a) => { pinnedAt.push(h); return view(c, m, a); }, state: async () => STATE }),
    view: (c, m, a, o) => { pinnedAt.push(o?.blockId); return view(c, m, a); },
    tx: async (hash) => {
      if (!evidence.verdicts.some((v) => v.tx_hash === hash)) {
        // the rewrite's anchor: the market's "rewrite" event with the recorded hashes and signature
        const p = JSON.parse(fs.readFileSync(path.join(REPO, "tools/judge/evidence/rewrite-mainnet.json"), "utf8")).record.provenance;
        const ev = { standard: "pricedin", event: "rewrite", data: [{ request_hash: p.request_hash, response_hash: p.response_hash, signature: p.signature, model: p.model }] };
        return { transaction: { signer_id: M, receiver_id: M, actions: [] }, receipts_outcome: [{ outcome: { executor_id: M, status: { SuccessValue: "" }, logs: [`EVENT_JSON:${JSON.stringify(ev)}`] } }] };
      }
      const v = evidence.verdicts.find((x) => x.tx_hash === hash);
      const args = { challenge_id: v.challenge_id, model: v.model, response: v.response_b64, signature_hex: v.signature_hex };
      return { status: { SuccessValue: "" }, transaction: { signer_id: v.sender_id, receiver_id: M, actions: [{ FunctionCall: { method_name: "submit_verdict", args: Buffer.from(JSON.stringify(args)).toString("base64") } }] }, receipts_outcome: [{ outcome: { executor_id: M, status: { SuccessValue: "" }, logs: [] } }] };
    },
  };
  return { mainnet: { dep, rpc }, pinnedAt, n: ids.length, verdicts: evidence.verdicts.length };
}

test("check 11 on a fake chain: settled rulings and verdicts verify, every view at the pinned block", async () => {
  const f = fakeMainnet();
  const r = await checkMainnet(REPO, f.mainnet, { offline: false, fetchImpl: async () => { throw new Error("no site in tests"); } });
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, new RegExp(`${f.n} of ${f.n} challenges settled`));
  assert.match(r.detail, new RegExp(`${f.verdicts} verdicts by 3 models`));
  assert.match(r.detail, /no disputes/);
  assert.ok(f.pinnedAt.length >= 8 * 2 + f.verdicts && f.pinnedAt.every((h) => h === 1000), `every view pinned to block 1000: ${f.pinnedAt.length} reads`);
});

test("check 11 on a fake chain: a wrong outcome or a tampered response hash fails, naming the challenge", async () => {
  const wrong = await checkMainnet(REPO, fakeMainnet({ outcome: true }).mainnet, { offline: false, fetchImpl: async () => { throw new Error("no site"); } });
  assert.equal(wrong.status, "FAIL");
  assert.match(wrong.detail, /challenge 0: claim 0 settled TRUE, the verdicts and 0 disputes give FALSE/);
  const tampered = await checkMainnet(REPO, fakeMainnet({ tamper: true }).mainnet, { offline: false, fetchImpl: async () => { throw new Error("no site"); } });
  assert.equal(tampered.status, "FAIL");
  assert.match(tampered.detail, /sha256\(response\) = the response_hash the market stored/);
});

test("check 11 on a fake chain: dispute stakes are reported, and one dispute flips the outcome", async () => {
  const r = await checkMainnet(REPO, fakeMainnet({ outcome: true, disputes: 1 }).mainnet, { offline: false, fetchImpl: async () => { throw new Error("no site"); } });
  assert.match(r.detail, /dispute stakes: challenge 0: 2 USDC on TRUE by x\.near/);
  assert.equal(r.status, "PASS", r.detail);
});

test("check 11 --offline verifies the committed evidence with no network", async () => {
  const dep = JSON.parse(fs.readFileSync(path.join(REPO, "deployments/mainnet.json"), "utf8"));
  const r = await checkMainnet(REPO, { dep, rpc: null }, { offline: true });
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, /not read \(chain not read: --offline\)/);
});
