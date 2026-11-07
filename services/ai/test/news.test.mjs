// Today's claims, offline: the scout's feeds and answers, the gate's checks, the settler's receipts,
// and the signer's own caps for news lines and readers' reports. No network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRss, parseFeeds, readFeeds, claimText, dateWords, daysFrom, endOfDay, parseCandidates, scoutRequest, jsonIn, SCOUT_PROMPT, TOPICS, DEFAULT_FEEDS } from "../src/scout.js";
import { policyCheck, shapeProblems, parseReviews, parseStatus, parseSearchOutput, searchResults, duplicateOf, similarity, reserveMicro, p0Of, headroomMicro, reserveFromState, runGate, reviewRequest, REVIEW_MODEL, CHECKS } from "../src/gate.js";
import { settleTiming, parseDecision, newsEvidence, findReceipts, decideRequest } from "../src/settle.js";
import { parseEvidence, normForMatch } from "../src/receipts.js";
import { SignerClient, OPERATOR_METHODS, DAILY_NEWS_OPENS, DAILY_NEWS_CHALLENGES, DAILY_REPORT_CHALLENGES, DAILY_OPENS, NEWS_PAGE } from "../src/signer.js";
import { operatorKey } from "../src/keystore.js";
import { loadAiConfig } from "../src/config.js";
import { startMockRpc } from "../../api/test/mock-rpc.mjs";

const NOW = Date.parse("2026-11-07T10:00:00Z");
const HEADLINES = [
  { n: 1, feed: "business", title: "Tesla Is Ending Production of Its Cybertruck - The New York Times", link: "https://news.google.com/rss/articles/a1", outlet: "The New York Times", published_at: NOW - 3600_000 },
  { n: 2, feed: "tech", title: "Microsoft Is Winding Down Oracle Deal to Rent AI Cloud Capacity - Bloomberg.com", link: "https://news.google.com/rss/articles/a2", outlet: "Bloomberg.com", published_at: NOW - 7200_000 },
  { n: 3, feed: "sports", title: "Patriots star hospitalized after medical emergency - ESPN", link: "https://news.google.com/rss/articles/a3", outlet: "ESPN", published_at: NOW },
];
const cand = (o = {}) => ({
  id: o.id || Math.random().toString(16).slice(2, 18), claim: o.claim ?? "By 13 November 2026, Microsoft confirms that it is winding down its deal to rent AI cloud capacity from Oracle.",
  statement: o.statement ?? "Microsoft confirms that it is winding down its deal to rent AI cloud capacity from Oracle.",
  question: o.question ?? "Is Microsoft ending its Oracle AI cloud deal?", topic: o.topic ?? "Tech", why: "Signals where AI money goes",
  source: { headline: o.headline ?? HEADLINES[1].title, url: o.url ?? HEADLINES[1].link, outlet: "Bloomberg.com", feed: "tech", published_at: NOW },
  settles: { by: o.by ?? "2026-11-13", by_words: dateWords(o.by ?? "2026-11-13"), source: "Microsoft's newsroom or an SEC filing", source_url: "https://news.microsoft.com", event: "Microsoft confirms or denies" },
  estimate: o.estimate ?? 0.5, problems: o.problems ?? [],
});

// ---------- the scout ----------

test("feeds: RSS items with their outlet and time; CDATA and entities decoded; malformed items skipped", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Ravens Finalize Trade for Jacoby Brissett &amp; More - Baltimore Ravens]]></title><link>https://news.google.com/rss/articles/x</link><pubDate>Fri, 06 Nov 2026 20:00:00 GMT</pubDate><source url="https://www.baltimoreravens.com">Baltimore Ravens</source></item>
    <item><title>Arsenal &#8216;close&#8217; to deal</title><link>https://www.bbc.co.uk/sport/football/1</link><pubDate>Fri, 06 Nov 2026 21:00:00 GMT</pubDate></item>
    <item><title>No link here</title></item>
  </channel></rss>`;
  const items = parseRss(xml, "sports");
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].outlet, items[0].feed], ["Ravens Finalize Trade for Jacoby Brissett & More - Baltimore Ravens", "Baltimore Ravens", "sports"]);
  assert.equal(items[0].published_at, Date.parse("2026-11-06T20:00:00Z"));
  assert.equal(items[1].title, "Arsenal ‘close’ to deal");
});

test("feeds: every default feed says why it is read, extra feeds need a reason, and a failed feed is noted, not fatal", async () => {
  assert.ok(DEFAULT_FEEDS.every((f) => f.why && /^https:\/\//.test(f.url)));
  assert.ok(DEFAULT_FEEDS.some((f) => f.id === "crypto" && /^added:/.test(f.why)), "the crypto search is an added feed with its reason");
  const { feeds, errors } = parseFeeds("extra|https://example.org/rss|transfer rumours;nowhy|https://example.org/x|;bad id|https://example.org/y|why");
  assert.deepEqual(feeds.map((f) => f.id), ["extra"]);
  assert.equal(errors.length, 2);
  const fetchImpl = async (url) => (url.includes("down") ? { ok: false, status: 503 } : { ok: true, text: async () => `<item><title>Same story</title><link>https://a.example/1</link><pubDate>${new Date(NOW).toUTCString()}</pubDate></item><item><title>Old story</title><link>https://a.example/2</link><pubDate>${new Date(NOW - 5 * 86_400_000).toUTCString()}</pubDate></item>` });
  const r = await readFeeds({ feeds: [{ id: "a", url: "https://up/1" }, { id: "b", url: "https://up/2" }, { id: "c", url: "https://down/3" }], fetchImpl, nowMs: NOW });
  assert.deepEqual(r.headlines.map((h) => [h.n, h.title]), [[1, "Same story"]], "numbered once each, and only from the last 36 hours");
  assert.deepEqual(r.feeds.map((f) => [f.feed, f.ok]), [["a", true], ["b", true], ["c", false]]);
});

test("dates: the words in the claim, whole days away, and the end of a settle-by day in UTC", () => {
  assert.equal(dateWords("2026-11-13"), "13 November 2026");
  assert.equal(dateWords("2026-02-30"), null);
  assert.equal(daysFrom(NOW, "2026-11-13"), 6);
  assert.equal(daysFrom(NOW, "2026-11-07"), 0);
  assert.ok(Number.isNaN(daysFrom(NOW, "13/11/2026")));
  assert.equal(endOfDay("2026-11-13"), Date.parse("2026-11-14T00:00:00Z"));
});

test("the claim text: the deadline first, so the rule is inside what the jury reads", () => {
  assert.equal(claimText("Tesla or a Tesla filing confirms that it is ending Cybertruck production", "2026-11-13"), "By 13 November 2026, Tesla or a Tesla filing confirms that it is ending Cybertruck production. Reports citing unnamed sources don't count.");
  assert.equal(claimText("By 12 Nov 2026, The club confirms it.", "2026-11-13"), "By 13 November 2026, the club confirms it. Reports citing unnamed sources don't count.", "a date the model wrote is replaced by the settle-by date");
  assert.equal(claimText("By November 12, 2026, Netflix announces it. Reports citing unnamed sources don't count.", "2026-11-13"), "By 13 November 2026, Netflix announces it. Reports citing unnamed sources don't count.", "the rule is said once");
  assert.equal(claimText("", "2026-11-13"), null);
  assert.equal(claimText("Something.", "soon"), null);
});

test("the scout's answer: each candidate keeps its headline and link, and what is missing is noted for the gate", () => {
  const content = "```json\n" + JSON.stringify({ claims: [
    { h: 2, statement: "Microsoft confirms that it is winding down its Oracle deal", question: "is Microsoft ending its Oracle AI cloud deal?", topic: "tech", why: "one two three four five six seven eight nine ten eleven twelve thirteen", source: "Microsoft's newsroom", source_url: "https://news.microsoft.com", event: "Microsoft confirms", settle_by: "2026-11-13", chance: 60 },
    { h: 99, statement: "", question: "", topic: "Gossip", source: "", settle_by: "whenever", chance: "x" },
  ] }) + "\n```";
  const [a, b] = parseCandidates(content, HEADLINES, { nowMs: NOW, model: "m" });
  assert.equal(a.claim, "By 13 November 2026, Microsoft confirms that it is winding down its Oracle deal. Reports citing unnamed sources don't count.");
  assert.deepEqual([a.question, a.topic, a.estimate, a.source.url, a.source.outlet], ["Is Microsoft ending its Oracle AI cloud deal?", "Tech", 0.6, HEADLINES[1].link, "Bloomberg.com"]);
  assert.equal(a.why.split(" ").length, 12, "why is cut to 12 words");
  assert.deepEqual(a.problems, []);
  assert.ok(b.problems.length >= 5, b.problems.join("; "));
  assert.equal(b.source, null);
  const req = scoutRequest("deepseek-ai/DeepSeek-V4.1-Flash-1017", HEADLINES, NOW);
  assert.deepEqual(req.chat_template_kwargs, { thinking: false }, "reasoning off, so the JSON fits");
  assert.match(req.messages[1].content, /^Today is 7 November 2026 \(2026-11-07\)\./);
  assert.match(req.messages[1].content, /\[2\] \(tech, Bloomberg\.com, 2026-11-07\) Microsoft Is Winding Down/);
  assert.match(SCOUT_PROMPT, /untrusted/);
  assert.deepEqual(jsonIn("no json here"), null);
});

// ---------- the gate ----------

test("policy in code: the spike's misses are refused, and so are the other topics we never price", () => {
  const no = (claim, topic = "Sports", headline = "") => policyCheck({ claim, topic, source: { headline } });
  assert.equal(no("By 10 November 2026, the Patriots confirm TreVeyon Henderson was hospitalized.").category, "health");
  assert.equal(no("By 10 November 2026, the club confirms James is out for a minimum of five games.", "Football").category, "health");
  assert.equal(no("By 12 November 2026, a court confirms Russell Brand was convicted of rape.", "Entertainment").category, "crime");
  assert.equal(no("By 12 November 2026, the ministry confirms the missile strike.", "Officials").category, "violence");
  assert.equal(no("By 12 November 2026, the club confirms it signed a 16-year-old.", "Football").category, "minors");
  assert.equal(no("By 12 November 2026, the singer confirms her divorce.", "Entertainment").category, "private_person");
  assert.equal(no("By 12 November 2026, officials confirm the recount.", "Officials").category, "election");
  assert.equal(no("By 12 November 2026, Arsenal beat Spurs.", "Football").category, "game_result");
  assert.equal(no("By 12 November 2026, CoinGecko shows Bitcoin above $120,000.", "Crypto").category, "forecast");
  assert.equal(no("By 12 November 2026, the Fed confirms it will cut rates.", "Money").category, "forecast");
  assert.equal(no("By 12 November 2026, the club confirms a new contract.", "Football", "Arsenal beat Spurs as Rice nears deal").category, "game_result", "the headline counts too");
});

test("policy in code: public business passes, words inside other words don't trip it, and Star Wars is not a war", () => {
  const yes = (claim, topic = "Tech") => policyCheck({ claim, topic, source: { headline: "" } }).ok;
  assert.ok(yes("By 13 November 2026, Tesla or a Tesla filing confirms that it is ending Cybertruck production."));
  assert.ok(yes("By 13 November 2026, the Ravens confirm a trade for Jacoby Brissett.", "Football"));
  assert.ok(yes("By 13 November 2026, Disney confirms a new Star Wars film.", "Entertainment"));
  assert.ok(yes("By 13 November 2026, Apple confirms it will drop the Action Button.", "Tech"), "\"will drop\" a feature is not a price forecast");
  assert.ok(yes("By 13 November 2026, Anthropic confirms a round at a valuation above $1 trillion.", "Money"), "a reported number is a claim, not a price forecast");
  assert.ok(yes("By 13 November 2026, Essex County confirms the skills programme.", "Officials"));
});

test("shape: a claim settles 1 to 7 days out, fits the market, and the scout's problems refuse it", () => {
  assert.deepEqual(shapeProblems(cand(), NOW), []);
  assert.match(shapeProblems(cand({ by: "2026-11-20" }), NOW).join(), /in 13 days/);
  assert.match(shapeProblems(cand({ by: "2026-11-07" }), NOW).join(), /today or earlier/);
  assert.match(shapeProblems(cand({ claim: "x".repeat(700) }), NOW).join(), /600 bytes/);
  assert.match(shapeProblems(cand({ problems: ["it has no question"] }), NOW).join(), /no question/);
});

test("the second model's reviews: tolerant JSON, one per claim, missing ones stay null", () => {
  const r = parseReviews('Sure! {"reviews":[{"i":1,"refuse":"true","category":"Game result","status":"UNCONFIRMED","settles_in_time":true,"definite":false,"reason":"r"},{"i":0,"refuse":false,"status":"confirmed"},{"i":7}]}', 3);
  assert.deepEqual(r[1], { refuse: true, category: "game_result", status: "unconfirmed", settles_in_time: true, definite: false, reason: "r" });
  assert.equal(r[0].status, "confirmed");
  assert.equal(r[2], null);
  const req = reviewRequest(REVIEW_MODEL, [cand()], NOW);
  assert.deepEqual(req.chat_template_kwargs, { enable_thinking: false });
  assert.match(req.messages[0].content, /different|refuse/);
  assert.match(req.messages[0].content, /news outlet's report that cites sources/, "a report from sources is not a confirmation");
});

test("the web: a status line, and the numbered results NEAR AI web search returns", () => {
  assert.equal(parseStatus("STATUS: UNCONFIRMED\nOnly a report."), "unconfirmed");
  assert.equal(parseStatus("**STATUS: CONFIRMED**"), "confirmed");
  assert.equal(parseStatus("I think so."), null);
  const out = "[1] Tesla set to wind down Cybertruck\nhttps://www.cnn.com/2026/11/06/business/tesla\n# Tesla set to wind down\nElon Musk said Friday...\n\n[2] Musk says Tesla will end Cybertruck production\nhttps://www.cbsnews.com/news/tesla/\nText two.\n[3] No url\nnot a url\n";
  const list = parseSearchOutput(out);
  assert.deepEqual(list.map((x) => [x.n, x.url]), [[1, "https://www.cnn.com/2026/11/06/business/tesla"], [2, "https://www.cbsnews.com/news/tesla/"]]);
  assert.match(list[0].text, /Elon Musk said Friday/);
  assert.equal(searchResults({ toolResults: [{ output: out }, { output: out }] }).length, 2, "each URL once");
});

test("duplicates: the same story by its link, the same claim by its words; another story is not one", () => {
  const open = [{ claim_id: 40, text: "By 12 November 2026, Microsoft confirms that it is winding down its Oracle AI cloud deal.", question: "Is Microsoft ending its Oracle deal?" }];
  assert.equal(duplicateOf(cand(), open)?.claim_id, 40);
  assert.equal(duplicateOf(cand({ url: "https://x.example/same" }), [{ candidate_id: "c1", text: "Unrelated", source_url: "https://x.example/same" }])?.why, "the same story");
  assert.equal(duplicateOf(cand({ question: "Is Netflix ordering a Stranger Things spinoff?", statement: "Netflix confirms it ordered a Stranger Things spinoff series.", claim: "By 13 November 2026, Netflix confirms it ordered a Stranger Things spinoff series." }), open), null);
  assert.ok(similarity({ question: "Is Tesla ending Cybertruck production?" }, { question: "Is Tesla ending production of the Cybertruck?" }) >= 0.5);
});

test("money: the opening price, the reserve the contract takes, and what the treasury can carry", () => {
  assert.deepEqual([p0Of(0.45), p0Of(0.05), p0Of(0.99), p0Of("x")], [450_000, 200_000, 800_000, null]);
  assert.ok(Math.abs(reserveMicro(1_450_000, 500_000) - 1_450_000 * Math.LN2) < 1_500, "b ln 2 at 50%");
  assert.ok(reserveMicro(1_450_000, 300_000) > reserveMicro(1_450_000, 500_000), "an opening away from 50% reserves more");
  assert.equal(reserveMicro(1_450_000, 100_000), reserveMicro(1_450_000, 200_000), "clamped to 20..80% as the contract clamps");
  assert.equal(headroomMicro({ treasuryMicro: "10903809", reservedMicro: "44926047", capMicro: "47157427", floorMicro: 1_500_000 }), 2_231_380, "mainnet on 2026-11-07: the reserve cap binds");
  assert.equal(headroomMicro({ treasuryMicro: "2000000", reservedMicro: "0", capMicro: "50000000", floorMicro: 1_500_000 }), 500_000, "the floor stays in the treasury");
  assert.equal(headroomMicro({ treasuryMicro: "1000000", reservedMicro: "0", capMicro: "50000000", floorMicro: 1_500_000 }), 0);
  assert.equal(headroomMicro({ treasuryMicro: null, reservedMicro: "0", capMicro: "1" }), null, "unknown is not zero: nothing opens");
});

test("the reserve cap comes from the market's raw state: the fields before it are skipped by their lengths", () => {
  const str = (s) => { const b = Buffer.from(s); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
  const u128 = (v) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(v) & ((1n << 64n) - 1n), 0); b.writeBigUInt64LE(BigInt(v) >> 64n, 8); return b; };
  const buf = Buffer.concat([
    str("isitpriced.near"), Buffer.from([0]), str("usdc"), str("lane.isitpriced.near"), Buffer.from([1]), str("swarm.x"), Buffer.from([0]),
    str("o"), str("h"), str("k".repeat(32)), str("c"), Buffer.alloc(8), str("r"), str("b"), str("p"), str("l"),
    u128(10_903_809), u128(44_926_047), u128(47_157_427), Buffer.alloc(40),
  ]);
  assert.deepEqual(reserveFromState(buf), { treasuryMicro: "10903809", reservedMicro: "44926047", capMicro: "47157427" });
  assert.throws(() => reserveFromState(buf.subarray(0, 60)), /ended early/);
});

test("the gate: every candidate gets one result, refusals say which check and why, and only what fits opens", async () => {
  const c = [
    cand({ id: "ok1", question: "Is Microsoft ending its Oracle AI cloud deal?" }),
    cand({ id: "code", claim: "By 13 November 2026, the club confirms the striker's injury.", statement: "the club confirms the striker's injury.", question: "Is the striker injured?", topic: "Football", url: "u2" }),
    cand({ id: "model", question: "Will the senator resign?", statement: "The senator confirms she will resign.", claim: "By 13 November 2026, the senator confirms she will resign.", url: "u3" }),
    cand({ id: "conf", question: "Is Tesla ending Cybertruck production?", statement: "Tesla confirms it is ending Cybertruck production.", claim: "By 13 November 2026, Tesla confirms it is ending Cybertruck production.", url: "u4" }),
    cand({ id: "late", question: "Will Apple drop the Action Button?", statement: "Apple confirms it will drop the Action Button.", claim: "By 13 November 2026, Apple confirms it will drop the Action Button.", url: "u5" }),
    cand({ id: "dup", question: "Is Microsoft ending the Oracle AI cloud deal?", url: "u6" }),
    cand({ id: "webconf", question: "Is Netflix ordering a Stranger Things spinoff?", statement: "Netflix confirms it ordered a Stranger Things spinoff.", claim: "By 13 November 2026, Netflix confirms it ordered a Stranger Things spinoff.", url: "u7" }),
    cand({ id: "ok2", question: "Is WWE calling Crown Jewel from Stamford?", statement: "WWE confirms its team calls Crown Jewel from Stamford.", claim: "By 13 November 2026, WWE confirms its team calls Crown Jewel from Stamford.", url: "u8", estimate: 0.3 }),
    cand({ id: "ok3", question: "Is Roku selling its ads unit to Fox?", statement: "Roku confirms it is selling its ads unit to Fox.", claim: "By 13 November 2026, Roku confirms it is selling its ads unit to Fox.", url: "u9" }),
  ];
  const reviews = { model: { refuse: true, category: "private_person", status: "unconfirmed", settles_in_time: true }, conf: { refuse: false, status: "confirmed", settles_in_time: true }, late: { refuse: false, status: "unconfirmed", settles_in_time: false } };
  let reviewed = null;
  const verified = [];
  const g = await runGate({
    candidates: c, nowMs: NOW,
    review: async (list) => { reviewed = list.map((x) => x.id); return list.map((x) => reviews[x.id] || { refuse: false, category: null, status: "unconfirmed", settles_in_time: true, definite: false, reason: "" }); },
    verify: async (x) => { verified.push(x.id); return x.id === "webconf" ? { status: "confirmed", sources: [{ url: "https://about.netflix.com/x" }], note: "Netflix announced it." } : { status: "unconfirmed", sources: [], note: null }; },
    open: [], capacity: { treasuryMicro: "4000000", reservedMicro: "0", capMicro: "100000000" }, floorMicro: 1_500_000, perDay: 2, spare: 1, bMicro: 1_450_000,
  });
  const by = Object.fromEntries(g.decisions.map((d) => [d.id, [d.status, d.failed]]));
  assert.deepEqual(by, {
    ok1: ["passed", null], code: ["refused", "policy"], model: ["refused", "policy"], conf: ["refused", "unconfirmed"], late: ["refused", "settles"],
    dup: ["refused", "duplicate"], webconf: ["refused", "unconfirmed"], ok2: ["refused", "capacity"], ok3: ["refused", "capacity"],
  });
  assert.equal(reviewed.includes("code"), false, "the code blocklist refuses before any model call");
  assert.deepEqual(verified, ["ok1", "webconf", "ok2"], "the web check runs on as many as could open, and one spare");
  assert.match(g.decisions.find((d) => d.id === "ok2").reason, /The treasury can carry \$1\.\d\d more/, "money, in plain words");
  assert.match(g.decisions.find((d) => d.id === "ok3").reason, /not checked on the web/);
  assert.deepEqual(g.pass.map((d) => d.id), ["ok1"]);
  assert.deepEqual(g.pass[0].open, { p0_ppm: 500_000, b_micro: "1450000", reserve_micro: String(reserveMicro(1_450_000, 500_000)) });
  assert.equal(g.counts.candidates, 9);
  assert.equal(CHECKS.reduce((n, k) => n + g.counts[`refused_${k}`], 0) + g.counts.passed, 9, "every candidate is counted once");
  const none = await runGate({ candidates: [cand({ id: "x" })], nowMs: NOW, review: async () => [{ refuse: false, status: "unconfirmed", settles_in_time: true }], verify: null, capacity: null });
  assert.match(none.decisions[0].reason, /could not be read/, "unknown money opens nothing");
  const broke = await runGate({ candidates: [cand({ id: "y" })], nowMs: NOW, review: async () => { throw new Error("spend cap"); }, verify: null, capacity: { treasuryMicro: "9000000", reservedMicro: "0", capMicro: "9000000" } });
  assert.deepEqual([broke.decisions[0].failed, /spend cap/.test(broke.decisions[0].reason)], ["policy", true], "no review, no line");
  const definite = await runGate({ candidates: [cand({ id: "z" })], nowMs: NOW, requireDefinite: true, review: async () => [{ refuse: false, status: "unconfirmed", settles_in_time: true, definite: false }], verify: null, capacity: { treasuryMicro: "9000000", reservedMicro: "0", capMicro: "9000000" } });
  assert.equal(definite.decisions[0].failed, "settles", "NEWS_REQUIRE_DEFINITE asks for an event that settles it either way");
});

// ---------- settling ----------

const LINE = { claim: "By 13 November 2026, Tesla or a Tesla filing confirms that it is ending Cybertruck production.", question: "Is Tesla ending Cybertruck production?", settles: { by: "2026-11-13", by_words: "13 November 2026", source: "Tesla's newsroom or an SEC filing", source_url: "https://ir.tesla.com/press" } };

test("when to look: after the settle-by day and its grace at once, then every 12 hours; before it, an early look once a day", () => {
  const end = Date.parse("2026-11-14T00:00:00Z");
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: end + 7 * 3600_000, lastLookAt: 0 })), [true, true]);
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: end + 7 * 3600_000, lastLookAt: end + 6.5 * 3600_000 })), [false, true], "a line that can't settle yet costs little");
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: end + 19 * 3600_000, lastLookAt: end + 6.5 * 3600_000 })), [true, true], "every 12 hours once due");
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: end + 7 * 3600_000, lastLookAt: end + 5 * 3600_000 })), [true, true], "the first look after the grace is at once");
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: end + 3600_000, lastLookAt: 0 })), [true, false], "inside the grace it is still an early look");
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: NOW, lastLookAt: NOW - 3600_000 })), [false, false]);
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: NOW, lastLookAt: NOW - 13 * 3600_000 })), [false, false]);
  assert.deepEqual(pick(settleTiming({ by: "2026-11-13", nowMs: NOW, lastLookAt: NOW - 25 * 3600_000 })), [true, false], "an early look once a day");
});
const pick = (t) => [t.look, t.due];

test("the decision: only quotes really in their source count, and before the date only TRUE can settle it", () => {
  const sources = [{ url: "https://www.cnn.com/a", text: "Elon Musk said Friday that Tesla will wind down production of the vehicle at its factory in Austin, Texas." }, { url: "https://ir.tesla.com/press", text: "Tesla Releases Third Quarter 2026 Financial Results. Tesla Q3 2026 Vehicle Production & Deliveries." }];
  const d = parseDecision(JSON.stringify({ outcome: "TRUE", basis: "confirmed", when: "2026-11-06", receipts: [{ s: 1, quote: "Elon Musk said Friday that Tesla will wind down production of the vehicle" }, { s: 2, quote: "Tesla confirms the end of the Cybertruck today" }, { s: 9, quote: "nowhere at all to be found here" }] }), sources, { past: false });
  assert.equal(d.outcome, "TRUE");
  assert.deepEqual(d.receipts, [{ url: "https://www.cnn.com/a", quote: "Elon Musk said Friday that Tesla will wind down production of the vehicle" }]);
  assert.equal(d.dropped.length, 2, "a made-up quote and a missing source are dropped, and said so");
  assert.equal(parseDecision('{"outcome":"FALSE","basis":"not_confirmed","receipts":[]}', sources, { past: false }).outcome, "UNKNOWN", "the source may still speak");
  assert.equal(parseDecision('{"outcome":"maybe"}', sources, { past: true }).outcome, "UNKNOWN");
  const req = decideRequest("deepseek-ai/DeepSeek-V4.1-Flash-1017", LINE, sources, Date.parse("2026-11-14T08:00:00Z"));
  assert.match(req.messages[1].content, /has passed/);
  assert.match(req.messages[1].content, /\(the settling source's own page\)/);
});

test("the evidence: the receipt check reads every source and every quote from it, and it fits in 4,000 bytes", () => {
  const ev = newsEvidence({ line: LINE, outcome: "TRUE", basis: "confirmed", when: "2026-11-06", receipts: [{ url: "https://www.cnn.com/a", quote: "Elon Musk said Friday that Tesla will wind down production" }, { url: "https://www.cbsnews.com/b", quote: 'Musk "announced" on X Friday that it would wind down' }], nowMs: NOW });
  const p = parseEvidence(ev);
  assert.deepEqual(p.urls, ["https://www.cnn.com/a", "https://www.cbsnews.com/b"]);
  assert.deepEqual(p.quotes, ["Elon Musk said Friday that Tesla will wind down production", "Musk 'announced' on X Friday that it would wind down"]);
  assert.match(ev, /^Priced In's Checker, settling a news line\. The claim needed Tesla's newsroom or an SEC filing to confirm it by 13 November 2026\.\nIt was confirmed on or before 13 November 2026 \(on 6 November 2026\)\./);
  const no = newsEvidence({ line: LINE, outcome: "FALSE", basis: "not_confirmed", when: null, receipts: [{ url: "https://ir.tesla.com/press", quote: "Tesla Releases Third Quarter 2026 Financial Results" }], nowMs: NOW });
  assert.match(no, /By the end of 13 November 2026 it had not been confirmed/);
  const big = newsEvidence({ line: LINE, outcome: "TRUE", basis: "confirmed", when: null, receipts: [1, 2, 3].map((i) => ({ url: `https://x.example/${i}`, quote: "word ".repeat(300).trim() })), nowMs: NOW });
  assert.ok(Buffer.byteLength(big, "utf8") <= 4000);
});

test("finding receipts: one search, sources the receipt check can read, one decision; a confirmation after the date is a FALSE", async () => {
  const pages = {
    "https://ir.tesla.com/press": "<html><body><h2>Tesla Releases Third Quarter 2026 Financial Results</h2></body></html>",
    "https://www.cnn.com/a": "<html><body><p>Elon Musk said Friday that Tesla will wind down production of the vehicle at its factory in Austin, Texas.</p></body></html>",
    "https://blocked.example/b": null,
  };
  const fetch = async (url) => (pages[url] ? { url, final_url: url, status: 200, content_type: "text/html", body: Buffer.from(pages[url]), error: null } : { url, status: 403, error: "HTTP 403", body: null });
  const search = async () => ({ results: [{ url: "https://www.cnn.com/a", title: "t", text: "" }, { url: "https://blocked.example/b", title: "t", text: "" }], error: null });
  let asked = null;
  const client = { chat: async (body) => { asked = body; return { content: JSON.stringify({ outcome: "TRUE", basis: "confirmed", when: "2026-11-06", receipts: [{ s: 2, quote: "Elon Musk said Friday that Tesla will wind down production of the vehicle" }], reason: "Musk said so." }) }; } };
  const r = await findReceipts({ client, line: LINE, nowMs: NOW, fetch, search });
  assert.equal(r.outcome, "TRUE");
  assert.deepEqual(r.sources.map((s) => [s.url, s.error]), [["https://ir.tesla.com/press", null], ["https://www.cnn.com/a", null], ["https://blocked.example/b", "HTTP 403"]]);
  assert.ok(!asked.messages[1].content.includes("blocked.example"), "a page the check can't read is never cited");
  assert.match(r.evidence, /Receipt excerpt: "Elon Musk said Friday/);
  const late = await findReceipts({ client: { chat: async () => ({ content: JSON.stringify({ outcome: "TRUE", basis: "confirmed", when: "2026-11-15", receipts: [{ s: 2, quote: "Elon Musk said Friday that Tesla will wind down production of the vehicle" }] }) }) }, line: LINE, nowMs: Date.parse("2026-11-16T00:00:00Z"), fetch, search });
  assert.deepEqual([late.outcome, late.basis], ["FALSE", "late"]);
  assert.match(late.evidence, /the confirmation came on 15 November 2026, after that date/);
  const none = await findReceipts({ client, line: LINE, nowMs: NOW, fetch: async (url) => ({ url, status: 500, error: "HTTP 500", body: null }), search });
  assert.deepEqual([none.outcome, none.evidence], ["UNKNOWN", null]);
  const made = await findReceipts({ client: { chat: async () => ({ content: '{"outcome":"TRUE","receipts":[{"s":1,"quote":"Tesla confirms the end of Cybertruck production today"}]}' }) }, line: LINE, nowMs: NOW, fetch, search });
  assert.equal(made.outcome, "UNKNOWN", "no quote in its source word for word: no receipt, no challenge");
});

// ---------- the signer's caps for news lines and reports ----------

async function chain() {
  const rpc = await startMockRpc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-news-signer-"));
  const ks = path.join(dir, "keystore");
  const market = "market.testnet", ops = "house.testnet", checker = "checker.house.testnet";
  const fc = (receiver_id, method_names) => ({ nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id, method_names } } });
  const kk = operatorKey(ks, "keeper", { accountId: ops, receiverId: market, methods: OPERATOR_METHODS.keeper }).rec;
  const ck = operatorKey(ks, "checker", { accountId: checker, receiverId: market, methods: OPERATOR_METHODS.checker }).rec;
  rpc.st.keys.set(`${ops}|${kk.publicKey}`, fc(market, OPERATOR_METHODS.keeper));
  rpc.st.keys.set(`${checker}|${ck.publicKey}`, fc(market, OPERATOR_METHODS.checker));
  rpc.st.claims = [];
  for (const c of [{ id: 50, page: "news-2026-11-07", status: "Open" }, { id: 51, page: "news-2026-11-07", status: "Challenged" }, { id: 7, page: "tether", status: "Open" }, { id: 8, page: "tether", status: "Open" }]) rpc.st.claims[c.id] = c;
  const sent = [];
  let next = 100;
  rpc.st.onCall = (c) => { sent.push(c); return { value: c.method === "open_claim" ? next++ : c.method === "challenge" ? 9 : null }; };
  const client = (o = {}) => new SignerClient({ marketId: market, swarmId: null, rpcUrls: [rpc.url], keystoreDir: ks, journalFile: path.join(dir, "signer.jsonl"), ...o });
  return { rpc, dir, sent, client, ops, checker };
}

test("the signer: news lines open only on a news page, under their own cap, and never take a corrected line's", async () => {
  const c = await chain();
  const signer = c.client({ dailyOpens: 1, dailyNewsOpens: 2 });
  try {
    await signer.start();
    await signer.listAgents({ force: true });
    const news = { text: "By 13 November 2026, WWE confirms the team calls Crown Jewel from Stamford.", page: "news-2026-11-07", kind: "document", p0_ppm: 550_000, b_micro: "1450000" };
    const a = await signer.openNews("news-open:2026-11-07T06:aa", news);
    assert.equal(a.ok, true, a.error);
    assert.deepEqual([c.sent.at(-1).method, c.sent.at(-1).signer, c.sent.at(-1).args], ["open_claim", c.ops, news], "the keeper's open_claim key");
    assert.match((await signer.openNews("news-open:x:bb", { ...news, page: "tether" })).error, /only on a news page/);
    assert.match((await signer.openNews("news-open:x:cc", { ...news, kind: "news" })).error, /kind must be data, document or judgment/, "the contract's kinds: the API keeps kind news");
    assert.match((await signer.openNews("news-open:x:dd", { ...news, b_micro: "6000000" })).error, /b_micro must be/);
    assert.equal((await signer.openNews("news-open:2026-11-07T06:ee", news)).ok, true);
    assert.match((await signer.openNews("news-open:2026-11-07T06:ff", news)).error, /2 news lines already opened today/);
    assert.equal((await signer.openNews("news-open:2026-11-07T06:aa", news)).replayed, true, "the same intent never opens twice");
    const corrected = await signer.openClaim("open:18:700000:1", { text: "A corrected line.", page: "tether", kind: "document", p0_ppm: 700_000, b_micro: "1450000" });
    assert.equal(corrected.ok, true, "news lines never use up the corrected lines' cap");
    const caps = await signer.caps();
    assert.deepEqual([caps.opens, caps.news_opens], [{ used: 1, cap: 1 }, { used: 2, cap: 2 }]);
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("the signer: a news challenge only on an open news line, a report's on any open line, each under its own cap", async () => {
  const c = await chain();
  const signer = c.client({ dailyChallenges: 1, dailyNewsChallenges: 1, dailyReportChallenges: 1 });
  const ev = "Source: https://www.cnn.com/a\nReceipt excerpt: \"Elon Musk said Friday that Tesla will wind down\"";
  try {
    await signer.start();
    await signer.listAgents({ force: true });
    assert.match((await signer.challengeNews("news-settle:7:TRUE:d", { claim_id: 7, claimed_outcome: true, evidence: ev })).error, /not a news line/);
    assert.match((await signer.challengeNews("news-settle:51:TRUE:d", { claim_id: 51, claimed_outcome: true, evidence: ev })).error, /is Challenged, not open/);
    const n = await signer.challengeNews("news-settle:50:TRUE:d", { claim_id: 50, claimed_outcome: true, evidence: ev });
    assert.equal(n.ok, true, n.error);
    assert.deepEqual([c.sent.at(-1).method, c.sent.at(-1).signer], ["challenge", c.checker]);
    assert.match((await signer.challengeNews("news-settle:50:TRUE:e", { claim_id: 50, claimed_outcome: true, evidence: ev })).error, /1 news challenges already posted today/);
    const r = await signer.challengeReport("report:abc", { claim_id: 7, claimed_outcome: false, evidence: ev });
    assert.equal(r.ok, true, r.error);
    assert.match((await signer.challengeReport("report:def", { claim_id: 8, claimed_outcome: false, evidence: ev })).error, /1 report challenges already posted today/);
    const s = await signer.challenge("checker:8:0:d", { claim_id: 8, claimed_outcome: false, evidence: ev });
    assert.equal(s.ok, true, "the daily sitting keeps its own challenge");
    const caps = await signer.caps();
    assert.deepEqual([caps.challenges, caps.news_challenges, caps.report_challenges], [{ used: 1, cap: 1 }, { used: 1, cap: 1 }, { used: 1, cap: 1 }]);
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("the news caps: env settings reach the signer, the defaults leave the corrected lines' cap alone, and news pages are dated", () => {
  const base = { NEAR_NETWORK: "testnet", MARKET_CONTRACT_ID: "m.testnet" };
  const set = loadAiConfig({ ...base, SIGNER_DAILY_NEWS_OPENS: "3", SIGNER_DAILY_NEWS_CHALLENGES: "5", SIGNER_DAILY_REPORT_CHALLENGES: "1" }).ai.agents;
  assert.deepEqual([set.dailyNewsOpens, set.dailyNewsChallenges, set.dailyReportChallenges], [3, 5, 1]);
  assert.deepEqual([DAILY_NEWS_OPENS, DAILY_NEWS_CHALLENGES, DAILY_REPORT_CHALLENGES, DAILY_OPENS], [6, 8, 2, 12]);
  assert.ok(NEWS_PAGE.test("news-2026-11-07"));
  assert.ok(!NEWS_PAGE.test("news") && !NEWS_PAGE.test("tether"));
  assert.ok(TOPICS.includes("Officials") && TOPICS.includes("Crypto"));
  assert.equal(normForMatch("A  B"), "ab");
});

test("the writer leaves news pages alone: a day of news lines is not a paragraph", async () => {
  const { Writer } = await import("../src/writer.js");
  const { RewriteStore } = await import("../../api/src/rewrites.mjs");
  const claims = { one: async () => ({ id: 5, page: "news-2026-11-07", text: "x" }), byPage: async () => { throw new Error("it must not read the page"); } };
  const w = new Writer({ client: { hasKey: false }, model: null, store: new RewriteStore(), hub: { publish() {} }, claims, journal: { read: () => [], append() {}, rewrite() {} } });
  assert.equal(await w.onTrade({ data: { claim_id: 5 } }), null);
});
