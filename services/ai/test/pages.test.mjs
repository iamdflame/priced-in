// The writer on the official pages (OFFICIAL_PAGES=1): what it is asked to write, what it refuses, and
// that without the flag its requests are byte for byte what they were. The sweep, the page and the
// routes are in services/api/test/pages.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { NearAI, Attestor, verifyProvenance } from "../src/nearai.js";
import { PAGE_PROMPT, PAGE_WRITER, WRITER_PROMPT, Writer, band, hedgeWording, pageBand, pageRequest, rewriteRequest, validatePageRewrite, validateRewrite } from "../src/writer.js";
import { corpusEvidence } from "../src/evidence.js";
import { EventHub } from "../../api/src/events.mjs";
import { RewriteStore } from "../../api/src/rewrites.mjs";
import { correctedWording } from "../../../api/_lib/keeper.mjs";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";

const M = MOCK_MODELS[2];
const claim = (id, o = {}) => ({ id, page: "acme", text: `Acme was founded in ${1900 + id}.`, status: "Open", outcome: null, trades: 1, price_yes_ppm: 650000, ...o });
const CTX = { title: "Acme (company)", section: "History", text: "The whole paragraph, as a reader sees it." };
const STALE = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion.";

const official = (paras, extra = {}) => ({ paragraphs: (page) => (page === "acme" ? paras() : null), context: (page, index) => (page === "acme" ? { ...CTX, section: `Section ${index}` } : null), evidence: () => null, ...extra });
const hedged = (t) => t.replace(/ was founded/, " was reportedly founded");
const reply = (body, fn) => { const j = JSON.parse(body.messages[1].content); return JSON.stringify({ sentences: j.sentences.map((s) => ({ claim_id: s.claim_id, text: fn(s) })) }); };

async function setup(claims, o = {}) {
  const mock = await startMockNearAI();
  const client = new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url });
  const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier });
  const list = claims.map((c) => ({ ...c }));
  const fake = { one: async (id) => list.find((c) => c.id === id) || null, byPage: async (p) => list.filter((c) => c.page === p) };
  const writer = new Writer({ client, attestor, model: M, store: new RewriteStore(), hub: new EventHub(), claims: fake, signatureDeadlineMs: 2000, official: official(() => [list]), ...o });
  mock.behave(M, { content: (body) => reply(body, (s) => hedged(s.claim)) });
  return { mock, writer, list };
}
const prices = (list) => new Map(list.map((c) => [c.id, c.price_yes_ppm]));
const sent = (rec) => JSON.parse(Buffer.from(rec.provenance.request_b64, "base64").toString("utf8"));

// ---------- what a sentence calls for ----------

test("a page's band: a decided line is not written, unless a source gives the wording; a line nobody bet on keeps its words", () => {
  const ev = { value_today: "x" };
  assert.equal(pageBand({ status: "Settled", outcome: true, trades: 5 }, 0.9), null, "ruled true: stated from the chain");
  assert.equal(pageBand({ status: "Settled", outcome: true, trades: 5 }, 0.9, ev), null);
  assert.equal(pageBand({ status: "Settled", outcome: false, trades: 5 }, 0.1), null, "ruled false with no wording: stated from the chain");
  assert.equal(pageBand({ status: "Settled", outcome: false, trades: 5 }, 0.1, ev), "correct");
  assert.equal(pageBand({ status: "Open", trades: 0 }, 0.5), null, "50% with no bets is an opening estimate, not a dispute");
  assert.equal(pageBand({ status: "Open", trades: 0 }, 0.5, ev), "correct", "evidence doesn't wait for a bet");
  assert.equal(pageBand({ status: "Open", trades: 2 }, 0.5), "disputed");
  assert.equal(pageBand({ status: "Challenged", trades: 2 }, 0.2), "negate", "a live ruling hasn't decided anything");
  assert.equal(pageBand({ status: "Open", trades: 1 }, 0.9, ev), "assert", "above assert the evidence stays out, as in the writer");
  assert.equal(pageBand({ status: "Open", trades: 1 }, NaN), null);
  const own = { status: "Open", trades: 2, text: "Tether claims its tokens are backed 100% by reserve assets." };
  assert.equal(pageBand(own, 0.62), null, "it says who says so already: a second hedge would be another claim");
  assert.equal(pageBand(own, 0.72), "assert", "from 0.70 a line is stated in its own words");
  assert.equal(pageBand({ ...own, text: "Each token purports to represent an ounce." }, 0.63), null);
  assert.equal(pageBand({ ...own, text: "The court dismissed the claims against it." }, 0.63), "hedge", "a noun, not a hedge");
  assert.equal(pageBand(own, 0.5), "disputed", "disputed and doubted lines are still written");
  assert.equal(pageBand(own, 0.2), "negate");
  assert.equal(pageBand(own, 0.95), "assert");
  assert.equal(pageBand({ status: "Open", trades: 2, text: "A line.", corrects: 6 }, 0.6), null, "a correction names its source: the hedge is already there");
  assert.equal(pageBand({ status: "Open", trades: 2, text: "A line.", corrects: 6 }, 0.2), "negate");
  assert.equal(pageBand({ status: "Open", trades: 3, text: "A line.", corrects: 18 }, 0.47), null, "a thin new market near 50% doesn't make a corrected line 'disputed': evidence decides");
  assert.equal(pageBand({ status: "Open", trades: 3, text: "A line.", corrects: 18 }, 0.9), null, "and a confident one keeps its words too");
  for (const p of [0.9, 0.7, 0.5, 0.42, 0.2]) assert.equal(pageBand({ status: "Open", trades: 1 }, p), band(p), "the bands stay the writer's");
});

test("hedges: the strength follows the price, each sentence keeps its own, and a page gets more than one", () => {
  assert.equal(hedgeWording(4, 0.8), hedgeWording(4, 0.72), "the same sentence, the same wording, so a rewrite changes no word it doesn't have to");
  assert.notEqual(hedgeWording(0, 0.8), hedgeWording(1, 0.8));
  const words = (p) => new Set(Array.from({ length: 20 }, (_, i) => hedgeWording(i, p)));
  assert.ok(words(0.8).has("probably") && !words(0.6).has("probably"));
  assert.ok(words(0.6).has("reportedly") && words(0.6).size >= 4);
  for (const w of words(0.42)) assert.doesNotMatch(w, /probabl|likely/, "under 50% nothing says likely");
});

test("the page's request: the paragraph as context, the page's prompt, no current wording, a wording only where a hedge is asked for", () => {
  const sentences = [
    { claim_id: 7, claim: "A.", current: "older words", probability: 0.6512, band: "hedge" },
    { claim_id: 8, claim: "B.", current: "B.", probability: 0.2, band: "negate" },
    { claim_id: 18, claim: STALE, current: STALE, probability: 0.1, band: "correct", evidence: corpusEvidence(STALE) },
  ];
  const body = pageRequest("z-ai/glm-5.3-flash", CTX, sentences);
  assert.equal(body.messages[0].content, PAGE_PROMPT);
  const u = JSON.parse(body.messages[1].content);
  assert.deepEqual([u.page, u.section, u.paragraph], [CTX.title, CTX.section, CTX.text]);
  assert.deepEqual(u.sentences[0], { claim_id: 7, claim: "A.", probability: 0.651, band: "hedge", wording: hedgeWording(7, 0.6512) });
  assert.equal(u.sentences[1].wording, undefined);
  assert.equal(u.sentences[2].evidence.source, "Tether's attestation report");
  assert.equal(JSON.stringify(u).includes("older words"), false, "written from the claim each time: the same prices give the same page");
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.stream, false);
  assert.equal(body.temperature, 0);
  assert.match(PAGE_PROMPT, /never negate it or any part of it/);
  assert.match(PAGE_PROMPT, /untrusted text/);
});

// ---------- what it refuses ----------

const S = (claimText, b, probability, evidence = null) => ({ claim: claimText, band: b, probability, evidence });
const LINE = "Tether Limited is owned by iFinex, a company based in the British Virgin Islands.";

test("the page's check refuses everything validateRewrite refuses", () => {
  assert.match(validatePageRewrite(S("Reserves are large.", "hedge", 0.6), "Reserves are reportedly large (72%)."), /adds a figure/);
  assert.match(validatePageRewrite(S(LINE, "negate", 0.2), "Tether Limited is not owned by iFinex, a company based in the British Virgin Islands."), /negates the line/);
  assert.equal(validateRewrite(S(LINE, "hedge", 0.6), "Tether Limited is reportedly owned by iFinex, a company based in the British Virgin Islands."), null);
});

test("the page's check: no name nobody gave it, no market talk, nothing that calls a doubted line false", () => {
  assert.match(validatePageRewrite(S(LINE, "hedge", 0.6), "According to Reuters, Tether Limited is owned by iFinex, a company based in the British Virgin Islands."), /adds a name.*reuters/);
  assert.match(validatePageRewrite(S(LINE, "hedge", 0.6), "The market thinks Tether Limited is owned by iFinex, a company based in the British Virgin Islands."), /mentions market/);
  assert.match(validatePageRewrite(S(LINE, "hedge", 0.6), "Traders think Tether Limited is owned by iFinex, a company based in the British Virgin Islands."), /mentions traders/);
  assert.equal(validatePageRewrite(S("Kalshi is a betting market.", "hedge", 0.6), "Kalshi is reportedly a betting market."), null, "the claim's own word isn't market talk");
  assert.match(validatePageRewrite(S(LINE, "negate", 0.2), `It is unlikely that ${LINE}`), /unlikely/);
});

test("the page's check: the band must show in the words, and under 50% nothing says likely", () => {
  assert.match(validatePageRewrite(S(LINE, "hedge", 0.6), LINE), /repeats the claim unchanged/);
  assert.match(validatePageRewrite(S(LINE, "disputed", 0.5), LINE), /repeats the claim unchanged/);
  assert.match(validatePageRewrite(S(LINE, "disputed", 0.5), "Tether Limited is reportedly owned by iFinex, a company based in the British Virgin Islands."), /does not say the claim is disputed/);
  assert.match(validatePageRewrite(S(LINE, "negate", 0.2), "Some doubt that Tether Limited is owned by iFinex, a company based in the British Virgin Islands."), /attribute the doubt to traders/);
  assert.match(validatePageRewrite(S(LINE, "hedge", 0.42), "Tether Limited is likely owned by iFinex, a company based in the British Virgin Islands."), /under 50%/);
  assert.equal(validatePageRewrite(S(LINE, "hedge", 0.75), "Tether Limited is probably owned by iFinex, a company based in the British Virgin Islands."), null);
});

test("the page's check: an edit, not a new sentence; a correction says whose value it is", () => {
  assert.match(validatePageRewrite(S(LINE, "hedge", 0.6), "Reportedly iFinex is its owner."), /keeps only/);
  const ev = corpusEvidence(STALE);
  assert.match(validatePageRewrite(S(STALE, "correct", 0.1, ev), "The majority of reserves are U.S. T-Bills at $122.84 billion at 30 September 2026."), /whose value/);
  assert.equal(validatePageRewrite(S(STALE, "correct", 0.1, ev), "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, which Tether's attestation report puts at $122.84 billion at 30 September 2026."), null);
  const host = { source_name: "api.llama.fi", value_today: "About $78 billion a week in June 2025 on DefiLlama" };
  assert.equal(validatePageRewrite(S("Weekly volume averaged around $18.6 billion.", "correct", 0.2, host), "Weekly volume averaged about $78 billion a week in June 2025, according to DefiLlama."), null, "a host name isn't the name to insist on");
});

test("the page's check passes what the real model wrote", () => {
  const good = [
    ["It is represented by its currency codes USD₮ and USDT.", "hedge", 0.812, "It is probably represented by its currency codes USD₮ and USDT."],
    ["As of July 2024, Tether has more than 350 million users worldwide.", "disputed", 0.459, "It is disputed whether, as of July 2024, Tether had more than 350 million users worldwide."],
    ["0.1% of accounts net 67% of the profits on Polymarket, while more than 70% of users are losing money.", "negate", 0.369, "Traders doubt that 0.1% of accounts net 67% of the profits on Polymarket, while more than 70% of users are losing money."],
    ["As of September 2024, the Tether-initiated T3 Financial Crime Unit had frozen about $12 million in USDT linked to scams and fraud, and had identified eleven victims.", "hedge", 0.424, "As of September 2024, it is uncertain whether the Tether-initiated T3 Financial Crime Unit had frozen about $12 million in USDT linked to scams and fraud, and had identified eleven victims."],
    ["Cantor Fitzgerald serves as its reserve custodian and preferred primary dealer.", "disputed", 0.524, "It is disputed whether Cantor Fitzgerald serves as its reserve custodian and preferred primary dealer."],
  ];
  for (const [c, b, p, t] of good) assert.equal(validatePageRewrite(S(c, b, p), t), null, t);
});

// ---------- the writer ----------

test("without the flag nothing changes: the old prompt, the old request, no page_writer", async () => {
  const { mock, writer, list } = await setup([claim(0), claim(1)], { official: null });
  try {
    mock.behave(M, { content: undefined });
    const rec = await writer.rewrite("acme", 0, list, prices(list), { claim_id: 0, txHash: "t", trader: "a", price_yes_ppm: 650000, seq: null });
    assert.equal(rec.page_writer, undefined);
    const body = sent(rec);
    assert.equal(body.messages[0].content, WRITER_PROMPT);
    assert.deepEqual(body, JSON.parse(JSON.stringify(rewriteRequest(M, "acme", rec.sentences.map((s) => ({ ...s, current: s.claim }))))));
  } finally { writer.stop(); await mock.close(); }
});

test("a paragraph on an official page: only the lines with bets go to the model, and the record holds exactly what it signed", async () => {
  const { mock, writer, list } = await setup([claim(0), claim(1, { trades: 0, price_yes_ppm: 500000 }), claim(2, { status: "Settled", outcome: true, price_yes_ppm: 900000 }), claim(3)]);
  try {
    const rec = await writer.rewrite("acme", 4, list, prices(list), { kind: "sweep", claim_id: 0, txHash: null, trader: null, price_yes_ppm: 650000, seq: null });
    assert.equal(rec.status, "signed");
    assert.equal(rec.page_writer, PAGE_WRITER);
    assert.deepEqual(rec.sentences.map((s) => s.claim_id), [0, 3]);
    assert.equal(sent(rec).messages[0].content, PAGE_PROMPT);
    const u = JSON.parse(sent(rec).messages[1].content);
    assert.deepEqual(u.sentences.map((s) => s.claim_id), [0, 3]);
    assert.deepEqual([u.page, u.section, u.paragraph], [CTX.title, "Section 4", CTX.text]);
    assert.equal(rec.id, "acme:4:v1");
    assert.equal(rec.previous_text, `${list[0].text} ${list[3].text}`);
    assert.deepEqual(JSON.parse(rec.prices_canonical).prices, [[0, 650000], [3, 650000]]);
    const signed = JSON.parse(JSON.parse(Buffer.from(rec.provenance.response_b64, "base64").toString("utf8")).choices[0].message.content).sentences.map((s) => s.text);
    assert.deepEqual(rec.sentences.map((s) => s.text), signed, "the check on /c: the words shown are the words signed");
    assert.ok(verifyProvenance(rec.provenance).ok);
  } finally { writer.stop(); await mock.close(); }
});

test("nothing for a model to write: no call, no version", async () => {
  const { mock, writer, list } = await setup([claim(0, { trades: 0 }), claim(1, { status: "Settled", outcome: false })]);
  try {
    assert.equal(await writer.rewrite("acme", 0, list, prices(list), { kind: "sweep", claim_id: 0 }), null);
    assert.equal(mock.calls.filter((c) => c.path === "/v1/chat/completions").length, 0);
    assert.equal(writer.paragraphs.get("acme#0").version, 0);
    assert.equal(writer.paragraphs.get("acme#0").busy, false);
  } finally { writer.stop(); await mock.close(); }
});

test("a trade on a line the cached count still calls unbet: the bet counts at once", async () => {
  const { mock, writer } = await setup([claim(0, { trades: 0, price_yes_ppm: 500000 }), claim(1, { trades: 0, price_yes_ppm: 500000 })]);
  try {
    const rec = await writer.onTrade({ uid: "t", event: "trade", data: { claim_id: 0, trader: "alice.testnet", side: "yes", price_yes_ppm: 640000 }, txHash: "tx" });
    assert.deepEqual(rec.sentences.map((s) => [s.claim_id, s.band, s.probability]), [[0, "hedge", 0.64]]);
    assert.equal(rec.page_writer, PAGE_WRITER);
  } finally { writer.stop(); await mock.close(); }
});

test("a page with no article keeps the old path: a pasted page's trade is written as it always was", async () => {
  const { mock, writer } = await setup([claim(0, { page: "paste-abc" })]);
  try {
    mock.behave(M, { content: undefined });
    const rec = await writer.onTrade({ uid: "t", event: "trade", data: { claim_id: 0, trader: "alice.testnet", side: "yes", price_yes_ppm: 640000 }, txHash: "tx" });
    assert.equal(rec.page_writer, undefined);
    assert.equal(sent(rec).messages[0].content, WRITER_PROMPT);
  } finally { writer.stop(); await mock.close(); }
});

test("a line ruled false with a source: the model corrects it, in the band the keeper reads to open the correction", async () => {
  const c = claim(0, { text: STALE, status: "Settled", outcome: false, price_yes_ppm: 100000 });
  const { mock, writer, list } = await setup([c]);
  try {
    const fixed = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, which Tether's attestation report puts at $122.84 billion at 30 September 2026.";
    mock.behave(M, { content: (body) => reply(body, () => fixed) });
    const rec = await writer.rewrite("acme", 0, list, new Map([[0, 0]]), { kind: "ruling", claim_id: 0, txHash: null, trader: null, price_yes_ppm: 0, seq: null });
    assert.equal(rec.status, "signed");
    assert.equal(rec.sentences[0].band, "correct");
    assert.equal(correctedWording([rec], 0, c.text).text, fixed);
  } finally { writer.stop(); await mock.close(); }
});

test("a ruling's receipts stand in for the corpus: official.evidence reaches the model and the check", async () => {
  const ev = { source_name: "docs.example.com", value_today: "the fee is 2% since March", value_on_page: null, checked_on: "2026-11-07", source_url: "https://docs.example.com/fees" };
  const c = claim(0, { text: "The fee is 1%.", status: "Settled", outcome: false, price_yes_ppm: 100000 });
  const { mock, writer, list } = await setup([c], { official: official(() => [[c]], { evidence: () => ev }) });
  try {
    mock.behave(M, { content: (body) => reply(body, () => "According to docs.example.com, the fee is 2% since March.") });
    const rec = await writer.rewrite("acme", 0, list, prices(list), { kind: "sweep", claim_id: 0 });
    assert.equal(rec.status, "signed");
    assert.equal(JSON.parse(sent(rec).messages[1].content).sentences[0].evidence.value_today, ev.value_today);
  } finally { writer.stop(); await mock.close(); }
});

test("a reply the page's check refuses gets one corrective retry, then the template stands, marked as such", async () => {
  const { mock, writer, list } = await setup([claim(0)]);
  try {
    let calls = 0;
    mock.behave(M, { content: (body) => { calls++; return reply(body, (s) => s.claim); } }); // unchanged: the hedge doesn't show
    const rec = await writer.rewrite("acme", 0, list, prices(list), { kind: "sweep", claim_id: 0 });
    assert.equal(calls, 2);
    assert.equal(rec.status, "template");
    assert.equal(rec.page_writer, PAGE_WRITER);
    assert.equal(rec.provenance.kind, "template");
    assert.match(rec.provenance.reason, /repeats the claim unchanged/);
  } finally { writer.stop(); await mock.close(); }
});
