import test from "node:test";
import assert from "node:assert/strict";
import { NearAI, Attestor, verifyProvenance } from "../src/nearai.js";
import { Writer, band, templateSentence, wordDiff, parseRewriteReply, paragraphsOf, rewriteRequest, validateRewrite, isListOrCompound, WRITER_PROMPT } from "../src/writer.js";
import { corpusEvidence } from "../src/evidence.js";
import { Ledger } from "../src/ledger.js";
import { EventHub } from "../../api/src/events.mjs";
import { RewriteStore } from "../../api/src/rewrites.mjs";
import { startApi } from "../../api/test/helpers.mjs";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";

const M = MOCK_MODELS[2];
const CLAIMS = [
  { id: 0, page: "near-intents", text: "NEAR Intents has processed more than $10 billion in cumulative volume.", price_yes_ppm: 500000 },
  { id: 1, page: "near-intents", text: "NEAR Intents launched in 2024.", price_yes_ppm: 900000 },
  { id: 2, page: "near-intents", text: "NEAR Intents settles on NEAR.", price_yes_ppm: 700000 },
];
const PAGES = { pages: { "near-intents": { paragraphs: [[0, 1], [2]] } } };

function fakeClaims(list = CLAIMS) {
  const claims = list.map((c) => ({ ...c }));
  return { claims, one: async (id) => claims.find((c) => c.id === id) || null, byPage: async (p) => claims.filter((c) => c.page === p) };
}

async function setup({ key = true, ...o } = {}) {
  const mock = await startMockNearAI();
  const client = new NearAI({ apiKey: key ? mock.apiKey : null, baseUrl: mock.url });
  const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier });
  const hub = new EventHub();
  const store = new RewriteStore();
  const ledger = new Ledger({ pricing: (m) => client.model(m) });
  const claims = fakeClaims();
  const writer = new Writer({ client, attestor, model: M, store, hub, claims, pagesDoc: PAGES, ledger, signatureDeadlineMs: 2000, ...o });
  const events = [];
  hub.subscribe((e) => { if (e.event === "rewrite") events.push(e); });
  writer.start();
  return { mock, client, attestor, hub, store, writer, events, claims, ledger };
}

const trade = (claim_id, price_yes_ppm, n = 1) => ({ uid: `t${claim_id}:${price_yes_ppm}:${n}`, event: "trade", data: { claim_id, trader: "alice.testnet", side: "no", price_yes_ppm }, txHash: `tx${n}` });
const waitFor = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timed out"); };

test("bands: assert at 0.85 and above, disputed near 0.5, hedge from 0.4, negate below 0.4", () => {
  assert.equal(band(0.85), "assert");
  assert.equal(band(0.99), "assert");
  assert.equal(band(0.8499), "hedge");
  assert.equal(band(0.56), "hedge");
  assert.equal(band(0.55), "disputed");
  assert.equal(band(0.5), "disputed");
  assert.equal(band(0.45), "disputed");
  assert.equal(band(0.44), "hedge");
  assert.equal(band(0.4), "hedge");
  assert.equal(band(0.399), "negate");
  assert.equal(band(0.01), "negate");
  assert.equal(templateSentence("X is Y.", 0.9), "X is Y.");
  assert.equal(templateSentence("X is Y.", 0.75), "X is Y (likely, 75%).");
  assert.equal(templateSentence("X is Y.", 0.5), "Disputed (50%): X is Y.");
  assert.equal(templateSentence("X is Y.", 0.2), "Traders doubt this line: X is Y.");
});

test("word diff: both sides rebuild from the ops", () => {
  const a = "NEAR Intents has processed more than $10 billion.";
  const b = "NEAR Intents has reportedly processed more than $10 billion, though this is disputed.";
  const d = wordDiff(a, b);
  assert.equal(d.filter((x) => x.op !== "ins").map((x) => x.text).join(""), a);
  assert.equal(d.filter((x) => x.op !== "del").map((x) => x.text).join(""), b);
  assert.ok(d.some((x) => x.op === "ins" && /reportedly/.test(x.text)));
  assert.deepEqual(wordDiff("same", "same"), [{ op: "eq", text: "same" }]);
});

test("the model's reply must keep the sentence-to-claim map", () => {
  assert.deepEqual(parseRewriteReply('```json\n{"sentences":[{"claim_id":3,"text":"a"},{"claim_id":5,"text":" b  c "}]}\n```', [3, 5]), ["a", "b c"]);
  assert.throws(() => parseRewriteReply('{"sentences":[{"claim_id":5,"text":"a"},{"claim_id":3,"text":"b"}]}', [3, 5]), /sentence-to-claim map/);
  assert.throws(() => parseRewriteReply('{"sentences":[{"claim_id":3,"text":"a"}]}', [3, 5]), /expected 2/);
  assert.throws(() => parseRewriteReply("no json", [3]), /no JSON/);
  const paras = paragraphsOf("near-intents", CLAIMS, PAGES);
  assert.deepEqual(paras.map((p) => p.map((c) => c.id)), [[0, 1], [2]]);
  assert.deepEqual(paragraphsOf("near-intents", CLAIMS).map((p) => p.map((c) => c.id)), [[0, 1, 2]], "default: one paragraph in claim order");
});

test("a trade rewrites only its paragraph: template at once, then unsigned, then signed with provenance that verifies", async () => {
  const { mock, writer, events, store, ledger } = await setup();
  try {
    mock.behave(M, { signatureDelayMs: 250 });
    const t0 = Date.now();
    const done = writer.onTrade(trade(0, 300000));
    await waitFor(() => events.some((e) => e.data.status === "template"));
    assert.ok(Date.now() - t0 < 500, "the template is published at once");
    const rec = await done;
    assert.equal(rec.status, "signed");
    assert.deepEqual(events.map((e) => e.data.status), ["template", "unsigned", "signed"]);
    assert.ok(events.every((e) => e.data.page === "near-intents" && e.data.paragraph === 0), "only paragraph 0 (claims 0 and 1) was rewritten");
    assert.deepEqual(rec.sentences.map((s) => s.claim_id), [0, 1], "the sentence-to-claim map is unchanged");
    assert.deepEqual(rec.sentences.map((s) => s.band), ["negate", "assert"]);
    assert.match(rec.sentences[0].text, /unlikely/);
    assert.equal(rec.sentences[1].text, CLAIMS[1].text, "an asserted claim stays as written");
    assert.ok(rec.diff.some((d) => d.op === "ins"));
    const p = rec.provenance;
    assert.equal(p.kind, "model");
    assert.equal(p.model, M);
    assert.equal(p.signature_kind, "provider_tee");
    assert.equal(p.signing_address, mock.signerHex(M));
    for (const k of ["request_hash", "response_hash", "signature", "signing_address", "signed_text", "chat_id"]) assert.ok(p[k], k);
    assert.deepEqual(verifyProvenance(p, { signing_address: mock.signerHex(M) }), { ok: true, reasons: [] });
    assert.equal(events.at(-1).data.provenance.request_b64, undefined, "the SSE event carries hashes, not the bytes");
    assert.equal(store.byPage("near-intents")[0].id, rec.id, "GET /rewrites serves the latest version");
    assert.equal(events[1].data.provenance.verified, false, "the unsigned version never claims to be verified");
    const calls = ledger.data.calls.filter((c) => c.agent === "writer");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].prompt_tokens > 0 && calls[0].cost_usd > 0);
    // a second trade gives version 2 of the same paragraph, diffed against version 1's text
    const rec2 = await writer.onTrade(trade(0, 900000, 2));
    assert.equal(rec2.version, 2);
    assert.equal(rec2.previous_text, rec.text);
    assert.equal(rec2.sentences[0].text, CLAIMS[0].text);
  } finally { writer.stop(); await mock.close(); }
});

test("a late signature: the rewrite is published unsigned and replaced when the signature arrives", async () => {
  const { mock, writer, events, store } = await setup({ signatureDeadlineMs: 300, lateRetriesMs: [700, 700] });
  try {
    mock.behave(M, { signatureDelayMs: 1000 });
    const rec = await writer.onTrade(trade(2, 500000));
    assert.equal(rec.status, "unsigned");
    assert.equal(rec.provenance.verified, false);
    assert.equal(rec.provenance.signature, null);
    const signed = await waitFor(() => events.find((e) => e.data.status === "signed"), 4000);
    assert.equal(signed.data.id, rec.id, "the same version is replaced, not a new one");
    assert.equal(store.byPage("near-intents").find((r) => r.paragraph === 1).status, "signed");
    assert.equal(verifyProvenance(store.get(rec.id).provenance).ok, true);
  } finally { writer.stop(); await mock.close(); }
});

test("a tampered response is marked unverified, never signed; a missing signature stays unsigned", async () => {
  const { mock, writer, events } = await setup({ lateRetriesMs: [] });
  try {
    mock.behave(M, { tamper: true });
    const rec = await writer.onTrade(trade(0, 600000));
    assert.equal(rec.status, "unverified");
    assert.equal(rec.provenance.verified, false);
    assert.match(rec.provenance.reason, /does not match/);
    assert.ok(!events.some((e) => e.data.status === "signed"));
    mock.behave(M, { tamper: false, noSignature: true });
    const rec2 = await (async () => { const w = writer; w.signatureDeadlineMs = 400; return w.onTrade(trade(2, 600000, 2)); })();
    assert.equal(rec2.status, "unsigned");
    assert.match(rec2.provenance.reason, /signature unavailable/);
  } finally { writer.stop(); await mock.close(); }
});

test("without NEARAI_API_KEY: template rewrites only, honestly labelled", async () => {
  const { mock, writer, store } = await setup({ key: false });
  try {
    const rec = await writer.onTrade(trade(0, 200000));
    assert.equal(rec.status, "template");
    assert.equal(rec.provenance.kind, "template");
    assert.equal(rec.provenance.verified, false);
    assert.equal(rec.provenance.model, null);
    assert.match(rec.provenance.reason, /NEARAI_API_KEY/);
    assert.equal(store.status.writer, "template_only");
    assert.ok(!mock.calls.some((c) => c.path === "/v1/chat/completions"), "no model was called");
  } finally { writer.stop(); await mock.close(); }
});

test("a reply that breaks the sentence map falls back to the template and says why", async () => {
  const { mock, writer } = await setup();
  try {
    mock.behave(M, { content: '{"sentences":[{"claim_id":1,"text":"swapped"},{"claim_id":0,"text":"order"}]}' });
    const rec = await writer.onTrade(trade(0, 300000));
    assert.equal(rec.status, "template");
    assert.match(rec.provenance.reason, /sentence-to-claim map/);
    mock.behave(M, { content: undefined, down: true });
    const rec2 = await writer.onTrade(trade(0, 320000, 2));
    assert.equal(rec2.status, "template");
    assert.match(rec2.provenance.reason, /did not answer/);
  } finally { writer.stop(); await mock.close(); }
});

test("a reply that merges sentences gets one corrective retry, and the retry's exact bytes are what is signed", async () => {
  const { mock, writer } = await setup();
  try {
    // like the real GLM once on testnet: one sentence for a paragraph of two
    mock.behave(M, { content: (body) => (body.messages.length > 2 ? null : '{"sentences":[{"claim_id":0,"text":"both claims in one"}]}') });
    const rec = await writer.onTrade(trade(0, 300000));
    assert.equal(rec.status, "signed");
    assert.equal(rec.sentences.length, 2);
    const req = JSON.parse(Buffer.from(rec.provenance.request_b64, "base64").toString("utf8"));
    assert.equal(req.messages.length, 4, "the retry carries the bad reply and the correction");
    assert.match(req.messages[3].content, /exactly 2 sentences/);
    assert.ok(verifyProvenance(rec.provenance).ok);
  } finally { writer.stop(); await mock.close(); }
});

test("trades that arrive during a rewrite coalesce: the newest prices win", async () => {
  const { mock, writer, store } = await setup();
  try {
    mock.behave(M, { latencyMs: 300 });
    const first = writer.onTrade(trade(0, 300000, 1));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await writer.onTrade(trade(0, 310000, 2)), null);
    assert.equal(await writer.onTrade(trade(0, 950000, 3)), null);
    await first;
    const latest = await waitFor(() => { const r = store.byPage("near-intents")[0]; return r.version === 2 && r.status === "signed" ? r : null; }, 5000);
    assert.equal(latest.sentences[0].band, "assert", "the queued rewrite used the newest price");
  } finally { writer.stop(); await mock.close(); }
});

test("the API serves GET /rewrites?page= and says when no writer is attached", async () => {
  const api = await startApi({});
  try {
    let r = await api.req("GET", "/rewrites?page=near-intents");
    assert.equal(r.status, 200);
    assert.equal(r.json.writer.writer, "off");
    assert.deepEqual(r.json.rewrites, []);
    api.app.rewrites.put({ id: "near-intents:0:v1", page: "near-intents", paragraph: 0, version: 1, status: "template", sentences: [], text: "x", updatedAt: 1 });
    r = await api.req("GET", "/rewrites?page=near-intents");
    assert.equal(r.json.rewrites[0].id, "near-intents:0:v1");
    assert.equal((await api.req("GET", "/rewrites?page=Bad Page")).status, 400);
    api.app.addRoute("GET", "/hello", async () => ({ body: { hi: true } }));
    assert.deepEqual((await api.req("GET", "/hello")).json, { hi: true });
  } finally { await api.close(); }
});

test("evidence: a sentence our measurement found stale is corrected to the source's value, below assert only", () => {
  const claim = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion.";
  const ev = corpusEvidence(claim.replace("'", "\u2019"));
  assert.ok(ev, "the corpus has evidence for the T-Bills line, curly apostrophe or not");
  assert.equal(ev.corpus_id, "tether-0161");
  assert.match(ev.value_today, /122\.84 billion/);
  assert.equal(ev.source_name, "Tether's attestation report");
  assert.equal(corpusEvidence("Tether is a stablecoin."), null);
  assert.equal(templateSentence(claim, 0.9, ev), claim, "assert ignores the evidence");
  assert.equal(templateSentence(claim, 0.2, ev), "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion; Tether's attestation report gives $122.84 billion at 30 September 2026 (checked 2026-11-05).");
  const body = rewriteRequest("z-ai/glm-5.3-flash", "tether", [{ claim_id: 18, claim, current: claim, probability: 0.2, band: "negate", evidence: ev }, { claim_id: 19, claim: "X is Y.", current: "X is Y.", probability: 0.6, band: "hedge" }]);
  const sent = JSON.parse(body.messages[1].content).sentences;
  assert.deepEqual(sent[0].evidence, { source: "Tether's attestation report", value_today: ev.value_today, value_on_page: ev.value_on_page, checked_on: "2026-11-05" });
  assert.equal(sent[1].evidence, undefined, "no evidence, no field");
  assert.match(body.messages[0].content, /Use only the evidence given/);
});

// ---------- the check on a model's sentence ----------

const LIST = "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Near, Polygon and Solana.";
const COMPOUND = "Kalshi is a U.S. CFTC-regulated betting market and available only for U.S. residents.";
const STALE = "The majority of Tether's reserves are U.S. T-Bills, accounting for $72.6 billion.";
const EV_STALE = { source_name: "Tether's attestation report", value_today: "$122.84 billion at 30 September 2026", value_on_page: "$72.6 billion in U.S. T-Bills, stated without a date", checked_on: "2026-11-05" };
const EV_LIST = { source_name: "Tether", value_today: "No longer issuing on Kusama, Bitcoin Cash SLP, Omni, EOS and Algorand", value_on_page: "Tether issues on 13 chains, including Algorand, EOS and Bitcoin Cash SLP", checked_on: "2026-11-05" };

test("without evidence the doubt is attributed and the claim is intact, in the template and the prompt", () => {
  for (const p of [0.39, 0.2, 0.01]) assert.equal(templateSentence(LIST, p), `Traders doubt this line: ${LIST}`);
  assert.doesNotMatch(templateSentence(LIST, 0.2), /not true|false/i);
  assert.match(WRITER_PROMPT, /Traders doubt this line/);
  assert.match(WRITER_PROMPT, /never negate it or any part of it/);
  assert.doesNotMatch(WRITER_PROMPT, /say the claim is probably not true/i);
});

test("the check: a list or a compound sentence negated with no evidence is refused", () => {
  assert.equal(isListOrCompound(LIST), true);
  assert.equal(isListOrCompound(COMPOUND), true);
  assert.equal(isListOrCompound("NEAR Intents launched in 2024."), false);
  assert.match(validateRewrite({ claim: LIST, band: "negate" }, "Tether probably does not issue tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Near, Polygon and Solana."), /negates the line/);
  assert.match(validateRewrite({ claim: COMPOUND, band: "negate" }, "Kalshi is not a U.S. CFTC-regulated betting market and is not available only for U.S. residents."), /negates the line/);
  assert.match(validateRewrite({ claim: "X launched in 2024.", band: "negate" }, "X never launched in 2024."), /negates the line/);
  assert.match(validateRewrite({ claim: LIST, band: "negate" }, `It is false that ${LIST}`), /negates the line/);
});

test("the check: attributed doubt and a negation the claim already has both pass", () => {
  assert.equal(validateRewrite({ claim: LIST, band: "negate" }, `Traders doubt this line: ${LIST}`), null);
  assert.equal(validateRewrite({ claim: "Tether has not published an audit.", band: "hedge" }, "Tether reportedly has not published an audit."), null);
  assert.equal(validateRewrite({ claim: "X is Y.", band: "disputed" }, "It is disputed whether X is Y."), null);
});

test("the check: a figure found in neither the claim nor the evidence is refused", () => {
  assert.match(validateRewrite({ claim: "Reserves are about $72.6 billion.", band: "hedge" }, "Reserves are likely about $80 billion."), /adds a figure/);
  assert.match(validateRewrite({ claim: "Reserves are large.", band: "hedge" }, "Reserves are likely large (72%)."), /adds a figure/);
  assert.match(validateRewrite({ claim: STALE, band: "correct", evidence: EV_STALE }, "The majority of Tether's reserves are U.S. T-Bills, which the report puts at $130 billion."), /adds a figure/);
  assert.equal(validateRewrite({ claim: "It has 1,000 users.", band: "hedge" }, "It reportedly has 1000 users."), null);
});

test("the check: the live correction passes, figures, date and all", () => {
  const live = "The majority of Tether's reserves are U.S. T-Bills, which Tether's attestation report, checked on 5 November 2026, puts at $122.84 billion at 30 September 2026.";
  assert.equal(validateRewrite({ claim: STALE, band: "correct", evidence: EV_STALE }, live), null);
});

test("the check: with evidence, its own negation may stand, but not over parts of a list it does not mention", () => {
  const good = "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Near, Polygon and Solana; Tether says it is no longer issuing on Kusama, Bitcoin Cash SLP, Omni, EOS and Algorand.";
  assert.equal(validateRewrite({ claim: LIST, band: "correct", evidence: EV_LIST }, good), null);
  const whole = "Tether is no longer issuing tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Near, Polygon and Solana.";
  assert.match(validateRewrite({ claim: LIST, band: "correct", evidence: EV_LIST }, whole), /negates part of a list/);
  assert.match(validateRewrite({ claim: LIST, band: "correct", evidence: EV_LIST }, "Tether does not issue tokens on Avalanche."), /negates the line/);
});

test("a reply that negates a true list gets one corrective retry and then falls back to the template", async () => {
  const claims = [{ id: 0, page: "near-intents", text: LIST, price_yes_ppm: 200000 }];
  const { mock, writer } = await setup({ claims: fakeClaims(claims), pagesDoc: null, evidence: null });
  try {
    const bad = JSON.stringify({ sentences: [{ claim_id: 0, text: "Tether probably does not issue tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Near, Polygon and Solana." }] });
    let calls = 0;
    mock.behave(M, { content: () => { calls++; return bad; } });
    const rec = await writer.onTrade(trade(0, 200000));
    assert.equal(calls, 2, "one corrective retry, no more");
    assert.equal(rec.status, "template");
    assert.equal(rec.sentences[0].text, `Traders doubt this line: ${LIST}`);
    assert.match(rec.provenance.reason, /negates the line/);
  } finally { writer.stop(); await mock.close(); }
});

test("a reply that adds a figure is corrected by the retry, and the retry's bytes are what is signed", async () => {
  const text = "NEAR Intents has reportedly processed more than $10 billion in cumulative volume.";
  const claims = [{ id: 0, page: "near-intents", text: CLAIMS[0].text, price_yes_ppm: 600000 }];
  const { mock, writer } = await setup({ claims: fakeClaims(claims), pagesDoc: null, evidence: null });
  try {
    mock.behave(M, { content: (body) => JSON.stringify({ sentences: [{ claim_id: 0, text: body.messages.length > 2 ? text : "NEAR Intents has reportedly processed more than $14 billion in cumulative volume." }] }) });
    const rec = await writer.onTrade(trade(0, 600000));
    assert.equal(rec.status, "signed");
    assert.equal(rec.sentences[0].text, text);
    const req = JSON.parse(Buffer.from(rec.provenance.request_b64, "base64").toString("utf8"));
    assert.match(req.messages[3].content, /adds a figure/);
    assert.ok(verifyProvenance(rec.provenance).ok);
  } finally { writer.stop(); await mock.close(); }
});
