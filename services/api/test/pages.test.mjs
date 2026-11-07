// The official pages on the hosted runtime, offline: the switch, the layout, the sweep's choice and its
// caps, what each kind of sentence says, the record and the routes. The writer's side is in
// services/ai/test/pages.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OPENED_SECTION, PER_PARAGRAPH, claimsOf, evidenceFrom, latestRecords, layoutOf, livePages, officialWriter, pageState, pageSummary, pagesConfig, paragraphsOfArticle, readArticle, receiptEvidence, recordOf, recordsByClaim, ruledFalseSentence, sweepPlan, sweepRound } from "../../../api/_lib/pages.mjs";
import { SWEEP_DOC, cronSweep, isPagesRoute, pagesRoute } from "../../../api/_lib/pages-routes.mjs";
import { PAGE_WRITER } from "../../ai/src/writer.js";
import { startMockRpc } from "./mock-rpc.mjs";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const H = 3600_000;
const STALE = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion.";
const line = (i) => `Sentence number ${i} is here.`;
const SENTENCES = [...Array.from({ length: 6 }, (_, i) => ({ section: "(lead)", text: line(i), opinion: false })), { section: "History", text: line(6), opinion: true }, { section: "History", text: line(7), opinion: false }, { section: "History", text: line(8), opinion: false }];
const ARTICLE = { slug: "acme", title: "Acme (company)", url: "https://en.wikipedia.org/w/index.php?oldid=1", attribution: "Acme, English Wikipedia, CC BY-SA 4.0.", licence: "CC BY-SA 4.0", revisedAt: "2026-10-30T00:00:00Z", sentences: SENTENCES };
const claim = (id, text, o = {}) => ({ id, text, page: "acme", status: "Open", outcome: null, provisional: null, challenge_id: null, trades: 1, price_yes_ppm: 650000, ...o });
const rec = (id, sentences, o = {}) => {
  const [page, paragraph, v] = id.split(":");
  return { id, page, paragraph: Number(paragraph), version: Number(v.slice(1)), status: "signed", page_writer: PAGE_WRITER, createdAt: NOW - H, updatedAt: NOW - H, sentences: sentences.map(([claim_id, b, text, probability = 0.65]) => ({ claim_id, claim: `claim ${claim_id}`, band: b, text, probability })), prices_canonical: "{}", prices_hash: "ab".repeat(32), provenance: { kind: "model", status: "signed", verified: true, model: "z-ai/glm-5.3-flash", signing_address: "cd".repeat(32), request_hash: "01".repeat(32), response_hash: "02".repeat(32) }, anchor: { status: "anchored", tx_hash: "AnchorTx1" }, trigger: { kind: "sweep" }, ...o };
};
const pages = (claims, links = []) => [{ slug: "acme", paragraphs: layoutOf(ARTICLE, claims, links) }];
const plan = (claims, records = [], o = {}) => sweepPlan({ pages: pages(claims, o.links), records, nowMs: NOW, evidenceOf: o.evidenceOf ?? (() => null), retryAfterMs: H });
const settled = (r) => ({ status: "settled", outcome: "FALSE", escalated: false, settled_at: NOW - 2 * H, settle_tx: "SettleTx", challenge_id: 3, ...r });

// ---------- the switch ----------

test("off unless OFFICIAL_PAGES=1, with the defaults the brief sets and nothing out of range", () => {
  assert.deepEqual(pagesConfig({}), { enabled: false, perRun: 3, share: 0.6 });
  assert.equal(pagesConfig({ OFFICIAL_PAGES: "true" }).enabled, false, "only exactly 1 turns it on");
  assert.deepEqual(pagesConfig({ OFFICIAL_PAGES: "1", WRITER_SWEEP_PER_RUN: "5", WRITER_SWEEP_SHARE: "40" }), { enabled: true, perRun: 5, share: 0.4 });
  assert.deepEqual(pagesConfig({ WRITER_SWEEP_PER_RUN: "500", WRITER_SWEEP_SHARE: "0" }), { enabled: false, perRun: 3, share: 0.6 });
});

test("with the flag off the routes aren't read, the sweep does nothing and the writer gets no layout", async () => {
  const read = (f) => fs.readFileSync(new URL(`../../../api/${f}`, import.meta.url), "utf8");
  assert.match(read("index.mjs"), /: pagesConfig\(\)\.enabled && isPagesRoute\(route\) \? \(\) => pagesRoute\(route, p\)\n/);
  assert.match(read("_lib/runtime.mjs"), /const writer = pagesConfig\(p\.env\)\.enabled \? \{ official: officialWriter\(/);
  assert.equal(await cronSweep({ p: { env: {} }, app: null, layer: null, deadline: 0 }), undefined, "the cron's record doesn't change either");
  assert.deepEqual(await sweepRound({ cfg: pagesConfig({}) }), { off: true });
  for (const r of ["/pages", "/pages/tether", "/record", "/v1/pages", "/v1/pages/tether", "/v1/record"]) assert.ok(isPagesRoute(r), r);
  for (const r of ["/pages/a/b", "/claims", "/v1", "/page", "/records"]) assert.equal(isPagesRoute(r), false, r);
});

test("the API's copy of the articles is the corpus's, and every real page lays out with the site's cut", () => {
  const a = readArticle("tether");
  assert.equal(a.sentences.length, JSON.parse(fs.readFileSync(new URL("../../../corpus/pages/tether.json", import.meta.url), "utf8")).sentences.length);
  assert.equal(a.licence, "CC BY-SA 4.0");
  assert.match(fs.readFileSync(new URL("../../../site/lib/server/encyclopedia.ts", import.meta.url), "utf8"), new RegExp(`const PER_PARAGRAPH = ${PER_PARAGRAPH};`), "the same paragraphs as the page the site shows");
  assert.equal(readArticle("news-2026-11-07"), null);
  assert.equal(readArticle("../secrets"), null);
  assert.equal(readArticle("no-such-page"), null);
  assert.ok(JSON.parse(fs.readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")).functions["api/cron.mjs"].includeFiles.includes("api/_data/**"));
});

// ---------- the layout ----------

test("the layout: a section's sentences four at a time, each joined to its market by its exact text", () => {
  const ps = paragraphsOfArticle(ARTICLE);
  assert.deepEqual(ps.map((p) => [p.section, p.lines.length]), [["", 4], ["", 2], ["History", 3]]);
  const l = layoutOf(ARTICLE, [claim(1, line(1)), claim(2, line(7)), claim(3, line(1), { page: "other" })]);
  assert.deepEqual(l.map((p) => claimsOf(p).map((c) => c.id)), [[1], [], [2]]);
  assert.equal(l[0].slots[0].claim, null);
  assert.equal(l[2].slots[0].opinion, true);
});

test("the layout: a correction takes the place of the line it corrected, down the chain, so a page never says both", () => {
  const links = [{ old_claim_id: 1, new_claim_id: 8 }, { old_claim_id: 8, new_claim_id: 9 }];
  const claims = [claim(1, line(1), { status: "Settled", outcome: false }), claim(8, "A correction.", { status: "Settled", outcome: false }), claim(9, "A later correction.")];
  const [p] = layoutOf(ARTICLE, claims, links);
  assert.equal(p.slots[1].claim.id, 9);
  assert.deepEqual(p.slots[1].ruled.map((c) => c.id), [1, 8]);
  assert.equal(p.slots[1].text, line(1), "the slot keeps Wikipedia's sentence");
  assert.deepEqual([p.slots[1].claim.corrects, p.slots[1].claim.replaces], [8, line(1)]);
  assert.equal(layoutOf(ARTICLE, claims, links).length, 3, "nothing left over: every line is placed");
});

test("the layout: a line the revision doesn't hold gets a last paragraph, so no index above it moves", () => {
  const l = layoutOf(ARTICLE, [claim(1, line(1)), claim(5, "Opened later.")]);
  assert.equal(l.length, 4);
  assert.deepEqual([l[3].index, l[3].section, l[3].added, claimsOf(l[3])[0].id], [3, OPENED_SECTION, true, 5]);
});

test("the writer's side of the layout: claims by paragraph index, a paragraph's own words as context, null for a page with no article", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-pages-"));
  fs.writeFileSync(path.join(dir, "acme.json"), JSON.stringify(ARTICLE));
  const o = officialWriter({ links: () => [], dir });
  const paras = o.paragraphs("acme", [claim(2, line(7))]);
  assert.deepEqual(paras.map((p) => p.map((c) => c.id)), [[], [], [2]], "paras[i] is paragraph i, the shape the cron's loops use");
  assert.equal(o.paragraphs("paste-abc", []), null);
  assert.deepEqual(o.context("acme", 2), { title: ARTICLE.title, section: "History", text: `${line(6)} ${line(7)} ${line(8)}` });
  assert.equal(o.context("acme", 0).section, "Lead");
  assert.equal(o.context("acme", 2, [{ id: 9, text: "The correction.", replaces: line(7) }]).text, `${line(6)} The correction. ${line(8)}`, "the model never sees the line a correction replaced");
  assert.equal(o.context("acme", 3).section, OPENED_SECTION);
  assert.equal(o.context("paste-abc", 0), null);
  assert.equal(o.evidence(claim(1, "x")), null);
  o.useRulings([settled({ claim_id: 1, evidence: 'Source: https://docs.example.com/a\nReceipt excerpt: "the fee is 2% since March"', receipt_check: { result: "verified", checked_at: "2026-11-07T00:00:00Z" } })]);
  assert.equal(o.evidence(claim(1, "x")).value_today, "the fee is 2% since March");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- the evidence ----------

test("a ruling's receipts give the wording only when the receipt check found it at the source, and only for a line ruled false", () => {
  const r = settled({ claim_id: 1, evidence: `A reader's report, checked by Priced In's Checker before this challenge: the line is FALSE.\nSource: https://www.docs.example.com/fees\nReceipt excerpt: "the fee is 2% since March"`, receipt_check: { result: "verified", checked_at: "2026-11-07T10:00:00Z" } });
  assert.deepEqual(receiptEvidence(r), { source_name: "docs.example.com", source_url: "https://www.docs.example.com/fees", value_today: "the fee is 2% since March", value_on_page: null, checked_on: "2026-11-07" });
  assert.equal(receiptEvidence({ ...r, receipt_check: { result: "unfetchable" } }), null);
  assert.equal(receiptEvidence({ ...r, outcome: "TRUE" }), null);
  assert.equal(receiptEvidence({ ...r, evidence: "No quote, no source." }), null);
  assert.equal(receiptEvidence(null), null);
  const of = evidenceFrom([r]);
  assert.equal(of(claim(2, "Another line.")), null);
  assert.equal(of(claim(1, "Line.")).source_name, "docs.example.com");
  assert.equal(of(claim(9, STALE)).corpus_id, "tether-0161", "our own measurement comes first");
});

// ---------- the sweep's choice ----------

test("the sweep's choice: paragraphs with no rewrite yet, stalest first, and nothing for lines with no bets", () => {
  const claims = [claim(1, line(1)), claim(2, line(2), { trades: 0, price_yes_ppm: 500000 }), claim(5, line(5)), claim(7, line(7), { price_yes_ppm: 200000 })];
  const p = plan(claims);
  assert.deepEqual(p.map((x) => [x.index, x.why, x.at]), [[0, "new", 0], [1, "new", 0], [2, "new", 0]]);
  assert.equal(p[0].claim_id, 1);
  assert.deepEqual(p[0].claims.map((c) => c.id), [1, 2], "the rewrite gets the whole paragraph and decides what to send");
  assert.deepEqual(plan([claim(2, line(2), { trades: 0 })]), [], "nobody bet: no model call");
  const records = [rec("acme:1:v1", [[5, "hedge", "w"]], { createdAt: NOW - 9 * H }), rec("acme:0:v1", [[1, "hedge", "w"]], { createdAt: NOW - H })];
  assert.deepEqual(plan(claims, records).map((x) => [x.index, x.why]), [[2, "new"]], "a current rewrite is left alone");
});

test("the sweep's choice: a sentence that moved band is due, the oldest first; the same band is not", () => {
  const claims = [claim(1, line(1), { price_yes_ppm: 300000 }), claim(5, line(5), { price_yes_ppm: 500000 }), claim(7, line(7), { price_yes_ppm: 900000 })];
  const records = [rec("acme:0:v1", [[1, "hedge", "w"]], { createdAt: NOW - H }), rec("acme:1:v1", [[5, "hedge", "w"]], { createdAt: NOW - 5 * H }), rec("acme:2:v1", [[7, "assert", "w"]], { createdAt: NOW - 9 * H })];
  assert.deepEqual(plan(claims, records).map((x) => [x.index, x.why]), [[1, "band"], [0, "band"]]);
});

test("the sweep's choice: a line ruled false with a source and no correction is due; a decided line that needs no model is not", () => {
  const ev = { value_today: "x" };
  const claims = [claim(1, line(1), { status: "Settled", outcome: false }), claim(5, line(5), { status: "Settled", outcome: false }), claim(7, line(7), { status: "Settled", outcome: true })];
  const p = plan(claims, [], { evidenceOf: (c) => (c.id === 1 ? ev : null) });
  assert.deepEqual(p.map((x) => [x.index, x.why]), [[0, "decided"]]);
  assert.deepEqual(plan(claims, [rec("acme:0:v1", [[1, "correct", "w"]])], { evidenceOf: (c) => (c.id === 1 ? ev : null) }), []);
});

test("the sweep's choice: a corrected line isn't written; its correction is, once the money doubts it", () => {
  const links = [{ old_claim_id: 1, new_claim_id: 9 }];
  const ruled = claim(1, line(1), { status: "Settled", outcome: false });
  assert.deepEqual(plan([ruled, claim(9, "A correction.", { trades: 0 })], [], { links }), []);
  assert.deepEqual(plan([ruled, claim(9, "A correction.", { trades: 2 })], [], { links }), [], "in the hedge band its sourced words stand");
  assert.deepEqual(plan([ruled, claim(9, "A correction.", { trades: 2, price_yes_ppm: 200000 })], [], { links }).map((x) => [x.index, x.claim_id]), [[0, 9]]);
});

test("the sweep's choice: a try that came to nothing waits an hour, a template never counts as written, older prompts don't count", () => {
  const claims = [claim(1, line(1))];
  const failed = (at) => rec("acme:0:v1", [[1, "hedge", "t"]], { status: "template", createdAt: at, provenance: { kind: "template" } });
  assert.deepEqual(plan(claims, [failed(NOW - 10 * 60_000)]), [], "not again within the hour");
  assert.deepEqual(plan(claims, [failed(NOW - 2 * H)]).map((x) => x.why), ["new"]);
  const late = (at) => rec("acme:0:v1", [[1, "hedge", "w"]], { status: "unsigned", createdAt: at });
  assert.deepEqual(plan(claims, [late(NOW - 60_000)]), [], "a late signature may still land");
  assert.deepEqual(plan(claims, [late(NOW - 2 * H)]).map((x) => x.why), ["unsigned"]);
  assert.deepEqual(plan(claims, [rec("acme:0:v1", [[1, "hedge", "w"]], { status: "unverified", createdAt: NOW - 2 * H })]).map((x) => x.why), ["new"]);
  assert.deepEqual(plan(claims, [rec("acme:0:v1", [[1, "hedge", "w"]], { page_writer: undefined })]).map((x) => x.why), ["new"], "a rewrite from before the official pages is written again");
  assert.deepEqual(plan([claim(1, line(1), { price_yes_ppm: 200000 })], [failed(NOW - 60_000)]).map((x) => x.why), ["new"], "a new band doesn't wait for a try at the old one");
});

test("the sweep's order: never written first, the page with the most facts first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-pages-"));
  for (const slug of ["big", "small"]) fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ ...ARTICLE, slug }));
  const claims = [claim(1, line(1), { page: "small" }), claim(2, line(1), { page: "big" }), claim(3, line(7), { page: "big" }), claim(4, "x", { page: "news-2026-11-07" }), claim(5, "x", { page: "paste-abc" })];
  const live = livePages(claims, [], dir);
  assert.deepEqual(live.map((l) => [l.slug, l.facts]), [["big", 2], ["small", 1]], "news and pasted pages aren't pages");
  assert.deepEqual(sweepPlan({ pages: live, records: [], evidenceOf: () => null, nowMs: NOW }).map((x) => `${x.page}#${x.index}`), ["big#0", "big#2", "small#0"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- the sweep's caps ----------

const round = (claims, d = {}) => {
  const calls = [];
  return { calls, go: () => sweepRound({
    cfg: { enabled: true, perRun: 3, share: 0.6, ...d.cfg }, pages: pages(claims), records: d.records ?? [], evidenceOf: () => null, now: () => NOW,
    spend: d.spend ?? (async () => ({ spent_usd: 0, cap_usd: 1, open: true })), left: d.left ?? (() => 100_000),
    rewrite: d.rewrite ?? (async (page, index, cs, prices, trigger) => { calls.push({ page, index, cs, prices, trigger }); return { id: `${page}:${index}:v1`, status: "signed" }; }),
  }) };
};
const three = [claim(1, line(1)), claim(5, line(5)), claim(7, line(7))];

test("the sweep: one rewrite a paragraph, at today's prices, with its reason on the record", async () => {
  const r = round(three);
  const out = await r.go();
  assert.deepEqual(out.rewritten, [{ id: "acme:0:v1", why: "new", status: "signed" }, { id: "acme:1:v1", why: "new", status: "signed" }, { id: "acme:2:v1", why: "new", status: "signed" }]);
  assert.deepEqual([out.due, out.per_run, out.stopped], [3, 3, null]);
  assert.deepEqual(r.calls[0].trigger, { kind: "sweep", why: "new", claim_id: 1, txHash: null, trader: null, price_yes_ppm: 650000, seq: null });
  assert.equal(r.calls[0].prices.get(1), 650000);
});

test("the sweep stops at WRITER_SWEEP_PER_RUN and leaves the rest for the next run", async () => {
  const r = round(three, { cfg: { perRun: 2 } });
  const out = await r.go();
  assert.equal(r.calls.length, 2);
  assert.equal(out.due, 3);
  const none = round(three, { cfg: { perRun: 0 } });
  assert.deepEqual((await none.go()).rewritten, []);
});

test("the sweep stops at its share of the daily cap and says so, even mid-run", async () => {
  const atShare = round(three, { spend: async () => ({ spent_usd: 0.6, cap_usd: 1, open: true }) });
  const out = await atShare.go();
  assert.equal(atShare.calls.length, 0);
  assert.equal(out.stopped, "the sweep stops at 60% of the daily model cap so the jury and the Sentinel keep the rest: $0.60 of $1.00 is spent");
  let spent = 0.5;
  const mid = round(three, { spend: async () => ({ spent_usd: (spent += 0.05), cap_usd: 1, open: true }) });
  const o2 = await mid.go();
  assert.equal(mid.calls.length, 1, "0.55 goes, 0.60 stops");
  assert.match(o2.stopped, /60% of the daily model cap/);
  const shut = round(three, { spend: async () => ({ spent_usd: 0.1, cap_usd: 1, open: false }) });
  assert.match((await shut.go()).stopped, /daily model cap/);
  assert.equal(shut.calls.length, 0, "a closed meter stops it whatever the share");
});

test("the sweep leaves time for the anchor, and one paragraph's failure doesn't stop the others", async () => {
  const late = round(three, { left: () => 10_000 });
  assert.match((await late.go()).stopped, /out of time/);
  assert.equal(late.calls.length, 0);
  let n = 0;
  const bad = round(three, { rewrite: async (page, index) => { if (n++ === 0) throw new Error("boom"); return { id: `${page}:${index}:v1`, status: "template" }; } });
  assert.deepEqual((await bad.go()).rewritten.map((x) => x.status), ["failed", "template", "template"]);
});

// ---------- the page ----------

const state = (claims, records = [], o = {}) => pageState({ article: ARTICLE, claims, records, nowMs: NOW, ...o });
const sentence = (s, i, j) => s.paragraphs[i].sentences[j];

test("the page: a sentence with no market keeps Wikipedia's words and says it has no market", () => {
  const s = state([claim(1, line(1))], [rec("acme:0:v1", [[1, "hedge", "Sentence number 1 is reportedly here."]])]);
  assert.deepEqual(sentence(s, 0, 0), { text: line(0), written_by: "wikipedia", claim: null });
  assert.equal(sentence(s, 2, 0).opinion, true);
  assert.equal(s.paragraphs[2].written_by, "wikipedia");
  assert.equal(s.paragraphs[2].market, s.paragraphs[2].wikipedia);
  assert.equal(s.paragraphs[2].diff, null);
  assert.equal(s.paragraphs[2].changed, false);
});

test("the page: a priced sentence in the model's words, with the claim, the price, the proof and a diff that rebuilds both sides", () => {
  const words = "Sentence number 1 is reportedly here.";
  const s = state([claim(1, line(1), { price_yes_ppm: 620000 })], [rec("acme:0:v2", [[1, "hedge", words, 0.65]], { createdAt: NOW - 5 * H, updatedAt: NOW - 4 * H })], { network: "mainnet" });
  const p = s.paragraphs[0];
  assert.deepEqual(sentence(s, 0, 1), {
    text: words, wikipedia: line(1), written_by: "ai", ruled: [],
    claim: { id: 1, text: line(1), price_yes: 0.62, band: "hedge", trades: 1, status: "open", outcome: null, url: "/c/1" },
    written: { rewrite_id: "acme:0:v2", band: "hedge", price_yes: 0.65, current: true },
  });
  assert.equal(p.market, `${line(0)} ${words} ${line(2)} ${line(3)}`);
  assert.equal(p.written_by, "ai");
  assert.equal(p.changed, true);
  assert.equal(p.diff.filter((d) => d.op !== "ins").map((d) => d.text).join(""), p.wikipedia);
  assert.equal(p.diff.filter((d) => d.op !== "del").map((d) => d.text).join(""), p.market);
  assert.ok(p.diff.some((d) => d.op === "ins" && /reportedly/.test(d.text)));
  assert.deepEqual(p.rewrites, [{
    id: "acme:0:v2", version: 2, written_at: NOW - 5 * H, updated_at: NOW - 4 * H, trigger: "sweep", page_writer: PAGE_WRITER,
    prices: [{ claim_id: 1, price_yes: 0.65, band: "hedge" }], prices_canonical: "{}", prices_hash: "ab".repeat(32),
    signature: { status: "signed", verified: true, model: "z-ai/glm-5.3-flash", signing_address: "cd".repeat(32), request_hash: "01".repeat(32), response_hash: "02".repeat(32), reason: null },
    anchor: { status: "anchored", tx: "AnchorTx1", explorer: "https://nearblocks.io/txns/AnchorTx1" },
  }]);
});

test("the page: a sentence that moved band keeps its last words until the sweep comes, and says they're behind", () => {
  const s = state([claim(1, line(1), { price_yes_ppm: 200000 })], [rec("acme:0:v1", [[1, "hedge", "Sentence number 1 is reportedly here."]])]);
  assert.equal(sentence(s, 0, 1).written.current, false);
  assert.equal(sentence(s, 0, 1).claim.band, "negate");
});

test("the page: nobody has bet, so the line keeps its words and shows its market; nothing here claims a view", () => {
  const s = state([claim(1, line(1), { trades: 0, price_yes_ppm: 500000 })]);
  const x = sentence(s, 0, 1);
  assert.deepEqual([x.text, x.written_by, x.claim.trades, x.claim.band], [line(1), "wikipedia", 0, "disputed"]);
  assert.equal(s.paragraphs[0].written_by, "wikipedia");
  assert.equal(s.totals.facts_no_bets, 1);
  assert.equal(s.totals.written_by_ai, 0);
});

test("the page: a template, an unverified signature and an older prompt are never the market's words", () => {
  const claims = [claim(1, line(1))];
  for (const r of [rec("acme:0:v1", [[1, "hedge", "Sentence number 1 is here (uncertain, 65%)."]], { status: "template", provenance: { kind: "template" } }), rec("acme:0:v1", [[1, "hedge", "bad"]], { status: "unverified" }), rec("acme:0:v1", [[1, "hedge", "old"]], { page_writer: undefined })]) {
    assert.equal(sentence(state(claims, [r]), 0, 1).text, line(1));
  }
  assert.equal(sentence(state(claims, [rec("acme:0:v1", [[1, "hedge", "Words."]], { status: "unsigned" })]), 0, 1).text, "Words.", "shown, and the proof says unsigned");
  assert.equal(state(claims, [rec("acme:0:v1", [[1, "hedge", "Words."]], { status: "unsigned", provenance: { kind: "model", reason: "signature not fetched yet" } })]).paragraphs[0].rewrites[0].signature.reason, "signature not fetched yet");
});

test("the page: the newest words win, whatever paragraph index they were written under", () => {
  const s = state([claim(1, line(1))], [rec("acme:0:v1", [[1, "hedge", "Old."]], { createdAt: NOW - 3 * H }), rec("acme:0:v2", [[1, "hedge", "New."]], { createdAt: NOW - H }), rec("acme:9:v1", [[1, "hedge", "Older."]], { createdAt: NOW - 9 * H })]);
  assert.equal(sentence(s, 0, 1).text, "New.");
  assert.equal(latestRecords([{ id: "a", n: 1 }, { id: "b" }, { id: "a", n: 2 }]).find((r) => r.id === "a").n, 2);
  assert.equal(recordsByClaim([rec("acme:0:v1", [[1, "hedge", "A."]], { status: "template", provenance: { kind: "template" } })]).words.size, 0);
});

test("the page: a sentence ruled true is stated plainly, at once, whatever was written before", () => {
  const c = claim(1, line(1), { status: "Settled", outcome: true, challenge_id: 3 });
  const s = state([c], [rec("acme:0:v1", [[1, "hedge", "Sentence number 1 is reportedly here."]])], { rulings: [settled({ claim_id: 1, outcome: "TRUE" })] });
  const x = sentence(s, 0, 1);
  assert.deepEqual([x.text, x.written_by, x.claim.status, x.claim.outcome], [line(1), "ruling", "decided", "true"]);
  assert.deepEqual(x.decided, { claim_id: 1, text: line(1), outcome: "true", by: "three AI judges", challenge_id: 3, decided_at: NOW - 2 * H, tx: "SettleTx", explorer: "https://nearblocks.io/txns/SettleTx", url: "/c/1" });
  assert.equal(s.totals.facts_decided, 1);
  assert.equal(s.totals.last_changed, NOW - 2 * H);
});

test("the page: a sentence ruled false says so and who ruled, when no source gives the wording", () => {
  const c = claim(1, line(1), { status: "Settled", outcome: false, challenge_id: 3 });
  const jury = state([c], [], { rulings: [settled({ claim_id: 1 })] });
  assert.equal(sentence(jury, 0, 1).text, `Three AI judges ruled this false: ${line(1)}`);
  assert.equal(sentence(jury, 0, 1).written_by, "ruling");
  assert.equal(jury.paragraphs[0].written_by, "market");
  const council = state([c], [], { rulings: [settled({ claim_id: 1, escalated: true })] });
  assert.equal(sentence(council, 0, 1).text, `The council ruled this false: ${line(1)}`);
  assert.equal(sentence(council, 0, 1).decided.by, "the council");
  assert.equal(ruledFalseSentence(" A line. ", null), "Three AI judges ruled this false: A line.");
});

test("the page: a sentence ruled false with a source is corrected by the model, signed, and the page shows that", () => {
  const c = claim(1, STALE, { status: "Settled", outcome: false });
  const article = { ...ARTICLE, sentences: [{ section: "(lead)", text: STALE, opinion: false }] };
  const fixed = "The majority of Tether's reserves are U.S. T-Bills, which Tether's attestation report puts at $122.84 billion.";
  const s = pageState({ article, claims: [c], records: [rec("acme:0:v1", [[1, "correct", fixed]])], rulings: [settled({ claim_id: 1 })], nowMs: NOW });
  assert.deepEqual([sentence(s, 0, 0).text, sentence(s, 0, 0).written_by], [fixed, "ai"]);
  assert.equal(s.totals.written_by_ai, 1);
});

test("the page: a corrected line reads as its correction, once, with the ruling and the signed rewrite that wrote it", () => {
  const links = [{ old_claim_id: 1, new_claim_id: 9, rewrite_id: "acme:2:v3" }];
  const claims = [claim(1, line(1), { status: "Settled", outcome: false, challenge_id: 3 }), claim(9, "The corrected sentence.", { trades: 0, price_yes_ppm: 600000 })];
  const old = rec("acme:2:v3", [[1, "correct", "The corrected sentence."]], { page_writer: undefined, createdAt: NOW - 8 * H, trigger: { kind: "ruling" } });
  const s = state(claims, [old], { links, rulings: [settled({ claim_id: 1 })] });
  const x = sentence(s, 0, 1);
  assert.deepEqual([x.text, x.wikipedia, x.written_by, x.claim.id, x.ruled[0].claim_id, x.ruled[0].outcome], ["The corrected sentence.", line(1), "correction", 9, 1, "false"]);
  assert.equal(s.paragraphs[0].market.includes(line(1)), false, "the page never says both");
  assert.equal(s.paragraphs[0].sentences.filter((y) => y.claim).length, 1);
  assert.equal(s.paragraphs[0].written_by, "ai");
  assert.deepEqual([s.paragraphs[0].rewrites[0].id, s.paragraphs[0].rewrites[0].trigger, s.paragraphs[0].rewrites[0].anchor.status], ["acme:2:v3", "ruling", "anchored"]);
  // once the money doubts the correction it is written like any other line
  const bet = [claims[0], { ...claims[1], trades: 1, price_yes_ppm: 200000 }];
  const s2 = state(bet, [old, rec("acme:0:v4", [[9, "negate", "Traders doubt the corrected sentence."]])], { links, rulings: [settled({ claim_id: 1 })] });
  assert.deepEqual([sentence(s2, 0, 1).text, sentence(s2, 0, 1).written_by], ["Traders doubt the corrected sentence.", "ai"]);
});

test("the page: lines opened since the revision close the page, in the market's words, with nothing to diff against", () => {
  const s = state([claim(5, "Opened later.", { trades: 0 })]);
  const p = s.paragraphs.at(-1);
  assert.deepEqual([p.section, p.wikipedia, p.diff, p.written_by, p.market], [OPENED_SECTION, null, null, "market", "Opened later."]);
});

test("the totals: what the page says at the top, and the source and licence on every answer", () => {
  const claims = [claim(1, line(1)), claim(5, line(5), { status: "Settled", outcome: true }), claim(7, line(7), { trades: 0 })];
  const s = state(claims, [rec("acme:0:v1", [[1, "hedge", "Words."]], { createdAt: NOW - 3 * H })], { rulings: [settled({ claim_id: 5, outcome: "TRUE", settled_at: NOW - 5 * H })] });
  assert.deepEqual(s.totals, { paragraphs: 3, written_by_ai: 1, sentences: 9, facts_priced: 3, facts_decided: 1, facts_no_bets: 1, rewrites: 1, signed: 1, anchored: 1, last_changed: NOW - 3 * H, models: ["z-ai/glm-5.3-flash"] });
  assert.deepEqual(s.source, { url: ARTICLE.url, attribution: ARTICLE.attribution, licence: "CC BY-SA 4.0", revised_at: ARTICLE.revisedAt });
  assert.deepEqual(pageSummary(s), { slug: "acme", title: ARTICLE.title, ...s.totals, url: "/p/acme" });
  assert.deepEqual(Object.keys(s), ["slug", "title", "source", "totals", "paragraphs", "asOf"]);
});

// ---------- the record ----------

const meta = (id, o = {}) => ({ claim_id: id, question: `Question ${id}?`, claim: `Line ${id}.`, topic: "Tech", why: "It matters", source: { headline: `Headline ${id}`, url: `https://news.example/${id}`, outlet: "Outlet", published_at: NOW }, settles: { by: "2026-11-13", source: "X's newsroom", source_url: "https://x.example/news" }, first_estimate: 0.4, opened_at: NOW, coverage: ["https://cover.example/1", `https://news.example/${id}`], ...o });

test("the record: each decided news line, as ruled, with its sources and links, newest first; open lines stay out", () => {
  const claims = [claim(1, "Line 1.", { page: "news-2026-11-07", status: "Settled", outcome: true }), claim(2, "Line 2.", { page: "news-2026-11-07", status: "Settled", outcome: false }), claim(3, "Line 3.", { page: "news-2026-11-07" })];
  const rulings = [settled({ claim_id: 1, outcome: "TRUE", settled_at: NOW - 5 * H, challenge_id: 7 }), settled({ claim_id: 2, settled_at: NOW - H, challenge_id: 8, receipt_check: { sources: [{ url: "https://x.example/news" }, { url: "https://x.example/receipt", final_url: "https://x.example/receipt-final" }] } })];
  const r = recordOf({ doc: { lines: { 1: meta(1), 2: meta(2), 3: meta(3) } }, claims, rulings });
  assert.deepEqual(r.lines.map((l) => [l.claim_id, l.outcome]), [[2, "false"], [1, "true"]]);
  assert.equal(r.count, 2);
  const l = r.lines[0];
  assert.deepEqual([l.claim, l.question, l.text, l.by, l.decided_at, l.market_url], ["Line 2.", "Question 2?", "Three AI judges ruled this false: Line 2.", "three AI judges", NOW - H, "/c/2"]);
  assert.deepEqual(l.ruling, { challenge_id: 8, url: "/c/2#ruling", tx: "SettleTx", explorer: "https://nearblocks.io/txns/SettleTx" });
  assert.deepEqual(l.sources.map((s) => [s.kind, s.url]), [["settled_by", "https://x.example/news"], ["headline", "https://news.example/2"], ["receipt", "https://x.example/receipt-final"], ["coverage", "https://cover.example/1"]]);
  assert.equal(r.lines[1].text, "Line 1.", "ruled true: the claim, plainly");
});

test("the record with no news: empty and harmless", () => {
  assert.deepEqual(recordOf({ doc: null, claims: [] }), { lines: [], count: 0 });
  assert.deepEqual(recordOf({ doc: { lines: { 9: meta(9) } }, claims: [claim(1, "x")] }), { lines: [], count: 0 });
});

// ---------- the routes ----------

function world(mock, { claims = [], files = {}, docs = {}, env = {}, events = [] } = {}) {
  return {
    env, api: { network: "mainnet", rpcUrls: [mock.url], marketId: "m.testnet" },
    journals: { readCached: (f) => (f === "events.jsonl" ? events : files[f] || []), read: (f) => files[f] || [] },
    claims: { decorated: async () => ({ claims, at: 5000 }) },
    state: { getDoc: async (n) => (docs[n] ? { value: docs[n] } : null), updateDoc: async (n, fn) => { docs[n] = fn(docs[n]); } },
  };
}
const TETHER = readArticle("tether").sentences[1].text;

test("GET /pages/<slug>: the page's shape, cached by the CDN, and a plain 404", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    const claims = [claim(0, TETHER, { page: "tether" })];
    const files = { "rewrites.jsonl": [rec("tether:0:v1", [[0, "hedge", "Written."]], { status: "unsigned" }), rec("tether:0:v1", [[0, "hedge", "Written."]])] };
    const p = world(mock, { claims, files });
    const r = await pagesRoute("/pages/tether", p);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), ["slug", "title", "source", "totals", "paragraphs", "asOf"]);
    assert.equal(r.body.asOf, 5000);
    assert.equal(r.body.totals.signed, 1, "the journal's latest record of a rewrite");
    assert.equal(r.body.paragraphs[0].sentences[1].text, "Written.");
    assert.match(r.headers["cache-control"], /s-maxage=10/);
    assert.equal((await pagesRoute("/v1/pages/tether", p)).body.slug, "tether", "the same answer for agents");
    const no = await pagesRoute("/pages/nope", p);
    assert.equal(no.status, 404);
    assert.equal(no.body.error.code, "no_such_page");
    assert.equal((await pagesRoute("/pages/..%2Fsecrets", p)).status, 404);
  } finally { await mock.close(); }
});

test("GET /pages: every live page and how much the AI wrote; GET /record: empty with news off", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    const claims = [claim(0, TETHER, { page: "tether" }), claim(1, "x", { page: "news-2026-11-07", status: "Settled", outcome: true })];
    const docs = { [SWEEP_DOC]: { at: "t", due: 2, rewritten: [], stopped: null } };
    const p = world(mock, { claims, docs, files: { "rewrites.jsonl": [rec("tether:0:v1", [[0, "hedge", "Written."]])] } });
    const r = await pagesRoute("/pages", p, { articles: [{}, {}] });
    assert.deepEqual(Object.keys(r.body), ["pages", "count", "encyclopedia", "record", "sweep", "asOf"]);
    assert.deepEqual([r.body.count, r.body.encyclopedia, r.body.pages[0].slug, r.body.pages[0].written_by_ai, r.body.pages[0].facts_priced, r.body.pages[0].url], [1, 2, "tether", 1, 1, "/p/tether"]);
    assert.deepEqual(r.body.record, { count: 0 });
    assert.equal(r.body.sweep.due, 2);
    const rec2 = await pagesRoute("/record", p);
    assert.deepEqual([rec2.status, rec2.body.lines, rec2.body.count], [200, [], 0]);
  } finally { await mock.close(); }
});

test("GET /record with news on: from the lines document", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    const claims = [claim(1, "Line 1.", { page: "news-2026-11-07", status: "Settled", outcome: true })];
    const docs = { "news/lines.json": { lines: { 1: meta(1) } } };
    const { forgetCachedLines } = await import("../../../api/_lib/news.mjs");
    forgetCachedLines();
    const r = await pagesRoute("/v1/record", world(mock, { claims, docs, env: { NEWS_ENABLED: "1" } }));
    forgetCachedLines();
    assert.deepEqual([r.body.count, r.body.lines[0].claim, r.body.lines[0].outcome], [1, "Line 1.", "true"]);
  } finally { await mock.close(); }
});

test("the cron's sweep: rewrites what is due, keeps its record, and says why when the writer has no model", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    const claims = [claim(0, TETHER, { page: "tether" })];
    const docs = {};
    const p = world(mock, { claims, docs, env: { OFFICIAL_PAGES: "1" } });
    p.spend = { settle: async () => {}, status: () => ({ spent_usd: 0, cap_usd: 1, open: true }) };
    const written = [];
    const rulings = [];
    const layer = { writer: { official: { useRulings: (r) => rulings.push(r) }, modelReason: null, rewrite: async (page, index) => { written.push(`${page}#${index}`); return { id: `${page}:${index}:v1`, status: "signed" }; } } };
    const out = await cronSweep({ p, app: { claims: { all: async () => claims } }, layer, deadline: Date.now() + 90_000 });
    assert.deepEqual(written, ["tether#0"]);
    assert.equal(rulings.length, 1, "the writer knows the rulings' receipts before it writes");
    assert.deepEqual(docs[SWEEP_DOC], out);
    assert.deepEqual(await cronSweep({ p, app: {}, layer: { writer: { official: {}, modelReason: "NEARAI_API_KEY is not set" } }, deadline: 0 }), { off: true, why: "NEARAI_API_KEY is not set" });
    assert.deepEqual(await cronSweep({ p, app: {}, layer: { writer: null }, deadline: 0 }), { off: true, why: "no writer" });
  } finally { await mock.close(); }
});
