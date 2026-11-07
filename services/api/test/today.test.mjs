// Today's claims on the hosted runtime, offline: the config and its off switch, the scout's and the
// settler's rounds with fakes, /api/today and /v1/today, signed picks, nicknames, readers' reports,
// the leaderboard against the house AIs, the money path, and the sitting kept as it was.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nacl from "tweetnacl";
import { baseEncode } from "near-api-js";
import { FsState } from "../../../api/_lib/store.mjs";
import { newsConfig, scoutSlot, nextScoutAt, linesStore, scoutRound, settleRound, openPassed, postNewsChallenges, reportsRound, mergeNews, newsField, todayOf, v1TodayOf, isNewsPage } from "../../../api/_lib/news.mjs";
import { pickMessage, profileMessage, reportMessage, parsePick, pickableOrWhy, firstPicks, cleanNickname, parseProfile, nicknames, nicknameTaken, parseReport, reportEvidence, reportsOf, reportView, refusalWords, aiTraders, aiPicks, pointsFor, leaderboard, picksOf, picksOnLine, pickCounts, challengeCall, takeLimits, Refusal, MAX_SKEW_MS, trustedSource, reportVerdict, REPORT_TTL_MS } from "../../../api/_lib/picks.mjs";
import { isNewsRoute } from "../../../api/_lib/today-routes.mjs";
import { checkerQueue, ofSitting } from "../../../api/_lib/keeper.mjs";
import { parseEvidence } from "../../ai/src/receipts.js";
import { ClaimIndex } from "../src/match.mjs";

const NOW = Date.parse("2026-11-07T10:00:00Z");
const H = 3600_000, DAY = 24 * H;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-today-"));
const browser = () => { const kp = nacl.sign.keyPair(); return { key: `ed25519:${baseEncode(kp.publicKey)}`, sign: (m) => Buffer.from(nacl.sign.detached(Buffer.from(m, "utf8"), kp.secretKey)).toString("hex") }; };
const claim = (id, o = {}) => ({ id, text: `Line ${id}.`, page: "tether", kind: "document", status: "Open", outcome: null, provisional: null, price_yes_ppm: 500_000, challenge_id: null, trades: 0, volume_micro: "0", open_interest_micro: "0", cost_up_10_micro: "300000", cost_down_10_micro: "300000", bounty_micro: "0", ...o });
const meta = (id, o = {}) => ({
  claim_id: id, kind: "news", page: "news-2026-11-07", chain_kind: "document", question: `Question ${id}?`, claim: `By 13 November 2026, X confirms ${id}.`, topic: "Tech", why: "It matters",
  source: { headline: `Headline ${id} - Outlet`, url: `https://news.google.com/rss/articles/${id}`, outlet: "Outlet", feed: "tech", published_at: NOW - H },
  settles: { by: "2026-11-13", by_words: "13 November 2026", source: "X's newsroom", source_url: "https://x.example/news", event: "X says so" },
  first_estimate: 0.4, p0_ppm: 400_000, b_micro: "1450000", reserve_micro: "1328000", opened_at: NOW - 2 * H, open_tx: `tx${id}`, settle: null, ...o,
});
let uid = 0;
const ev = (event, data, t) => ({ uid: `u${++uid}:0:0`, event, data, txHash: `t${uid}`, blockHeight: t, blockTimestampMs: t });

// ---------- off unless NEWS_ENABLED=1 ----------

test("off unless NEWS_ENABLED=1: no scout round, no settle round, no route; the defaults when it is on", async () => {
  const off = newsConfig({});
  assert.equal(off.enabled, false);
  assert.deepEqual(await scoutRound({ cfg: off }), { off: true });
  assert.deepEqual(await settleRound({ cfg: off }), { off: true });
  assert.equal(newsConfig({ NEWS_ENABLED: "true" }).enabled, false, "only exactly 1 turns it on");
  const on = newsConfig({ NEWS_ENABLED: "1" });
  assert.deepEqual([on.perDay, on.bMicro, on.chainKind, on.scoutHoursUtc, on.floorMicro, on.webVerify, on.requireDefinite], [4, 1_450_000, "document", [6, 18], 1_500_000, true, false]);
  const set = newsConfig({ NEWS_ENABLED: "1", NEWS_PER_DAY: "2", NEWS_B_MICRO: "3000000", NEWS_CHAIN_KIND: "news", NEWS_SCOUT_HOURS_UTC: "9,21", NEWS_B_MICRO_X: "1" });
  assert.deepEqual([set.perDay, set.bMicro, set.chainKind, set.scoutHoursUtc], [2, 3_000_000, "document", [9, 21]], "a kind the contract refuses keeps document");
  assert.equal(newsConfig({ NEWS_ENABLED: "1", NEWS_B_MICRO: "9000000" }).bMicro, 1_450_000, "over the signer's $5 keeps the default");
  for (const r of ["/today", "/v1/today", "/picks", "/profile", "/leaderboard", "/reports", "/challenge"]) assert.ok(isNewsRoute(r));
  assert.equal(isNewsRoute("/claims"), false);
  const vercel = JSON.parse(fs.readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/news"), "the hourly cron exists; the function answers off and does nothing without the flag");
  const src = fs.readFileSync(new URL("../../../api/news.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(!cfg\.enabled\) return sendJson\(res, 200, \{ ok: true, off: true/);
});

test("the scout's slots: at its hours only, and the next one", () => {
  assert.equal(scoutSlot(Date.parse("2026-11-07T06:05:00Z"), [6, 18]), "2026-11-07T06");
  assert.equal(scoutSlot(NOW, [6, 18]), null);
  assert.equal(nextScoutAt(NOW, [6, 18]), Date.parse("2026-11-07T18:05:00Z"));
  assert.equal(nextScoutAt(Date.parse("2026-11-07T19:00:00Z"), [6, 18]), Date.parse("2026-11-08T06:05:00Z"));
  assert.ok(isNewsPage("news-2026-11-07") && !isNewsPage("tether"));
});

// ---------- the scout's round ----------

const candidate = (id, o = {}) => ({ id, claim: `By 13 November 2026, Company ${id} confirms deal ${id}.`, statement: `Company ${id} confirms deal ${id}.`, question: `Is company ${id} doing deal ${id}?`, topic: "Money", why: "Money moves", source: { headline: `Company ${id} in talks - Outlet`, url: `https://news.google.com/rss/articles/c${id}`, outlet: "Outlet", feed: "business", published_at: NOW }, settles: { by: "2026-11-13", by_words: "13 November 2026", source: `Company ${id}'s newsroom`, source_url: null, event: "It says so" }, estimate: 0.4, problems: [], ...o });

test("the scout's round: once per slot, every candidate journaled with its result, the lines that passed opened and described", async () => {
  const dir = tmp();
  const store = linesStore(new FsState({ prefix: "state/testnet/m", dir }));
  const journal = [];
  const opened = [];
  const d = {
    cfg: { ...newsConfig({ NEWS_ENABLED: "1" }), perDay: 4 }, now: () => Date.parse("2026-11-07T06:05:00Z"), store, journal: (r) => journal.push(r),
    readFeeds: async () => ({ headlines: [{ n: 1, title: "t" }], feeds: [{ feed: "top", ok: true }, { feed: "x", ok: false, error: "HTTP 503" }] }),
    propose: async () => ({ candidates: [candidate("acme", { question: "Is Acme buying Initech?", statement: "Acme confirms it is buying Initech.", claim: "By 13 November 2026, Acme confirms it is buying Initech." }), candidate("blue", { claim: "By 13 November 2026, the club confirms his injury.", statement: "the club confirms his injury." }), candidate("globex", { question: "Is Globex closing its Ohio plant?", statement: "Globex confirms it is closing its Ohio plant.", claim: "By 13 November 2026, Globex confirms it is closing its Ohio plant." })] }),
    review: async (list) => list.map(() => ({ refuse: false, status: "unconfirmed", settles_in_time: true, definite: true, reason: "" })),
    verify: async () => ({ status: "unconfirmed", sources: [], note: null }),
    claims: async () => [claim(1)],
    capacity: async () => ({ treasuryMicro: "20000000", reservedMicro: "0", capMicro: "50000000", laneBudgetMicro: "9000000" }),
    open: async (pass, ctx) => { opened.push({ ids: pass.map((x) => x.id), ctx }); return { opened: pass.map((x, i) => ({ candidate_id: x.id, claim_id: 40 + i, tx: `open${i}` })), errors: [], failed: [] }; },
  };
  const r = await scoutRound(d);
  assert.deepEqual([r.slot, r.candidates, r.passed, r.opened.length], ["2026-11-07T06", 3, 2, 2]);
  assert.deepEqual(r.refused, { policy: 1 });
  assert.deepEqual(r.feeds_failed, ["x: HTTP 503"]);
  assert.deepEqual(opened[0].ctx, { slot: "2026-11-07T06", page: "news-2026-11-07", nowMs: Date.parse("2026-11-07T06:05:00Z"), chainKind: "document" });
  const doc = await store.read();
  assert.deepEqual(Object.keys(doc.lines), ["40", "41"]);
  assert.deepEqual([doc.lines[40].question, doc.lines[40].first_estimate, doc.lines[40].p0_ppm, doc.lines[40].open_tx, doc.lines[40].kind], ["Is Acme buying Initech?", 0.4, 400_000, "open0", "news"]);
  assert.deepEqual(journal.map((j) => [j.id, j.result, j.refused_at]), [["acme", "opened", null], ["blue", "refused", "policy"], ["globex", "opened", null]]);
  assert.match(journal[1].reason, /anyone's health/);
  assert.equal(journal[0].claim_id, 40);
  assert.deepEqual(await scoutRound(d), { skipped: true, why: "the 2026-11-07T06 slot already ran" }, "a second run in the same hour does nothing");
  assert.match((await scoutRound({ ...d, now: () => NOW })).why, /runs at 06:00 and 18:00 UTC/);
  assert.equal(doc.runs.at(-1).kind, "scout");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("opening: the keeper key under the news cap; today's cap is quiet, the subsidy cap stops, the intent carries the slot", async () => {
  const calls = [];
  const pass = ["a", "b", "c"].map((id) => ({ id, candidate: candidate(id), open: { p0_ppm: 400_000, b_micro: "1450000" } }));
  const signer = (o) => ({ operator: { keeper: { ok: true, accountId: "isitpriced.near" } }, caps: async () => ({ ok: true, news_opens: { used: 0, cap: o.cap } }), openNews: async (intent, args) => { calls.push([intent, args.page, args.kind]); return o.answer(calls.length); } });
  const recorded = [];
  const r = await openPassed(pass, { slot: "2026-11-07T06", page: "news-2026-11-07", chainKind: "document" }, { signer: signer({ cap: 2, answer: (n) => ({ ok: true, value: 40 + n, txHash: `h${n}` }) }), record: async (h) => recorded.push(h) });
  assert.deepEqual(r.opened.map((x) => [x.candidate_id, x.claim_id]), [["a", 41], ["b", 42]]);
  assert.match(r.failed[0].error, /daily cap on news lines/);
  assert.deepEqual(calls[0], ["news-open:2026-11-07T06:a", "news-2026-11-07", "document"]);
  assert.deepEqual(recorded, ["h1", "h2"]);
  calls.length = 0;
  const s = await openPassed(pass, { slot: "s", page: "news-2026-11-07", chainKind: "document" }, { signer: signer({ cap: 9, answer: () => ({ ok: false, error: "Smart contract panicked: subsidy cap reached" }) }), record: async () => {} });
  assert.equal(calls.length, 1, "the subsidy cap stops the round");
  assert.match(s.errors[0], /subsidy cap/);
  const none = await openPassed(pass, { slot: "s", page: "p", chainKind: "document" }, { signer: { operator: {} }, record: async () => {} });
  assert.match(none.errors[0], /no keeper key/);
});

// ---------- the settler's round ----------

test("settling: due lines get receipts; receipts that pass the check are challenged; the rest say why", async () => {
  const dir = tmp();
  const store = linesStore(new FsState({ prefix: "state/testnet/m", dir }));
  const after = Date.parse("2026-11-14T08:00:00Z");
  await store.update((cur) => ({ ...cur, lines: { 40: meta(40), 41: meta(41), 42: meta(42), 43: meta(43, { settles: { ...meta(43).settles, by: "2026-11-20", by_words: "20 November 2026" }, settle: { last_look_at: after - H } }), 44: meta(44) } }));
  const found = { 40: { outcome: "TRUE", basis: "confirmed", evidence: "ev40", receipts: [1] }, 41: { outcome: "FALSE", basis: "not_confirmed", evidence: "ev41", receipts: [1] }, 42: { outcome: "UNKNOWN", basis: "none", evidence: null, reason: "No source could be read." } };
  const plans = [];
  const r = await settleRound({
    cfg: { ...newsConfig({ NEWS_ENABLED: "1" }), settlePerRun: 5 }, now: () => after, store,
    claims: async () => [claim(40), claim(41), claim(42), claim(43), claim(44, { status: "Challenged", challenge_id: 3 })],
    find: async (m) => ({ ...found[m.claim_id], reason: found[m.claim_id].reason ?? "" }),
    check: async ({ evidence }) => (evidence === "ev40" ? { result: "verified", support: { verdict: "supported" } } : { result: "verified", support: { verdict: "unsupported" } }),
    challenge: async (p) => { plans.push(...p); return { posted: p.map((x) => ({ claim_id: x.claim_id, challenge_id: 9, tx: "tx9", outcome: x.outcome })), errors: [] }; },
  });
  assert.deepEqual(r.looked.map((x) => x.claim_id).sort(), [40, 41, 42], "a line not due, and a line already challenged, are left alone");
  assert.deepEqual(plans.map((p) => [p.claim_id, p.claimed_outcome, p.intent]), [[40, true, "news-settle:40:TRUE:0"]], "one intent per look: a crash before the record replays it, never sends it twice");
  const doc = await store.read();
  assert.match(doc.lines[40].settle.note, /challenged it as TRUE \(challenge 9\)/);
  assert.match(doc.lines[41].settle.note, /did not pass the check \(verified, support unsupported\)/);
  assert.match(doc.lines[42].settle.note, /No receipt yet: No source could be read/);
  assert.equal(doc.lines[43].settle.looks, undefined);
  assert.equal(doc.lines[40].settle.challenge_id, 9);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("posting challenges: the Checker's bond must be there, each is recorded and the jury is called at once", async () => {
  const sent = [], triggered = [];
  const s = (balance) => ({
    signer: { operator: { checker: { ok: true, accountId: "checker.isitpriced.near" } }, challengeNews: async (intent, p) => { sent.push([intent, p.claim_id]); return { ok: true, value: 7, txHash: "tx7" }; }, challengeReport: async (intent, p) => { sent.push([intent, p.claim_id, "report"]); return { ok: true, value: 8, txHash: "tx8" }; } },
    view: async (m) => (m === "get_balance" ? balance : { challenge_bond_micro: "1000000" }), record: async () => {}, trigger: async (x) => triggered.push(x.challenge_id),
  });
  const plans = [{ claim_id: 40, claimed_outcome: true, evidence: "e", outcome: "TRUE", intent: "i40" }, { claim_id: 41, claimed_outcome: false, evidence: "e", outcome: "FALSE", intent: "i41" }];
  const r = await postNewsChallenges(plans, s("1500000"));
  assert.deepEqual(r.posted.map((x) => x.claim_id), [40]);
  assert.match(r.errors[0], /holds \$0\.50 and the bond is \$1\.00: it waits for funding/);
  assert.deepEqual(triggered, [7]);
  const rep = await postNewsChallenges([{ ...plans[0], report_id: "r1" }], s("5000000"), { kind: "report" });
  assert.deepEqual([rep.posted[0].report_id, sent.at(-1)[2]], ["r1", "report"]);
});

// ---------- the read models ----------

test("/api/today: today's lines, then the soonest to settle, then the ones just decided; /v1/today for publishers", () => {
  const doc = { lines: { 40: meta(40), 41: meta(41, { opened_at: NOW - 3 * DAY, settles: { ...meta(41).settles, by: "2026-11-09" } }), 42: meta(42, { opened_at: NOW - 3 * DAY }), 43: meta(43, { opened_at: NOW - 6 * DAY }), 44: meta(44, { opened_at: NOW - 20 * DAY }) } };
  const claims = [claim(40), claim(41, { status: "Challenged", challenge_id: 5, provisional: true }), claim(42), claim(43, { status: "Settled", outcome: false, challenge_id: 6 }), claim(44, { status: "Settled", outcome: true }), claim(1)];
  const events = [ev("settle", { claim_id: 43, challenge_id: 6, outcome: false }, NOW - DAY), ev("settle", { claim_id: 44, outcome: true }, NOW - 10 * DAY)];
  const t = todayOf({ claims, doc, events, pickCounts: new Map([[40, { yes: 2, no: 1, total: 3 }]]), nowMs: NOW, cfg: newsConfig({ NEWS_ENABLED: "1" }) });
  assert.deepEqual(t.lines.map((l) => [l.claim_id, l.section, l.status]), [[40, "today", "open"], [41, "settling", "ruling"], [42, "settling", "open"], [43, "decided", "decided"]]);
  assert.deepEqual(t.counts, { today: 1, settling: 2, decided: 1 });
  const l = t.lines[0];
  assert.deepEqual([l.question, l.kind, l.topic, l.price_yes, l.first_estimate, l.picks.total, l.liquidity_b_usd, l.url], ["Question 40?", "news", "Tech", 0.5, 0.4, 3, 1.45, "/c/40"]);
  assert.deepEqual(l.settles, { by: "2026-11-13", by_words: "13 November 2026", due_at: Date.parse("2026-11-14T00:00:00Z"), source: "X's newsroom", source_url: "https://x.example/news", event: "X says so", rule: "By 13 November 2026, X confirms 40." });
  assert.deepEqual(t.lines[1].ruling, { challenge_id: 5, provisional: "true" });
  assert.equal(t.lines[0].overdue, false);
  const late = todayOf({ claims, doc, events, nowMs: Date.parse("2026-11-15T00:00:00Z") });
  assert.equal(late.lines.find((x) => x.claim_id === 42).overdue, true, "past its date and still open on the chain");
  assert.equal(late.lines.find((x) => x.claim_id === 41).overdue, false, "a ruling is running: it is not waiting");
  assert.deepEqual([t.lines[3].outcome, t.lines[3].decided_at], ["false", NOW - DAY]);
  assert.equal(t.next_scout_at, Date.parse("2026-11-07T18:05:00Z"));
  assert.match(t.rules.picks, /win nothing/);
  const v = v1TodayOf(t, { network: "mainnet", marketId: "market.isitpriced.near" });
  assert.deepEqual(v.lines[0].odds, { yes: 0.5, no: 0.5 });
  assert.equal(v.lines[0].url, "https://isitpriced.com/c/40");
  assert.equal(v.lines[0].embed.script, '<script src="https://isitpriced.com/embed.js" data-fact="40" async></script>');
  assert.equal(v.count, 4);
});

test("claims carry their news metadata only when they are news lines; the truth API finds a line by its question", () => {
  const doc = { lines: { 40: meta(40, { question: "Is Tesla ending Cybertruck production?" }) } };
  const merged = mergeNews([claim(40, { text: "By 13 November 2026, Tesla or a Tesla filing confirms that it is ending Cybertruck production.", page: "news-2026-11-07" }), claim(1)], doc);
  assert.equal(merged[1].news, undefined, "every other claim is unchanged");
  assert.deepEqual(merged[0].news, newsField(doc.lines[40]));
  assert.equal(mergeNews([claim(1)], null)[0].news, undefined);
  const ix = new ClaimIndex(merged);
  const hit = ix.search("Is Tesla ending Cybertruck production?").matches[0];
  assert.deepEqual([hit.claim.id, hit.kind], [40, "exact"]);
  assert.equal(ix.search("Tesla Cybertruck production ending").matches[0]?.claim.id, 40);
});

// ---------- picks ----------

test("a pick: the browser's key signs one exact message; a wrong signature, a stale one or a bad side is refused", () => {
  const b = browser();
  const issued_at = NOW - 1000;
  const msg = pickMessage({ network: "mainnet", claim_id: 40, side: "yes", issued_at });
  assert.equal(msg, `pricedin|pick|v1|mainnet|40|yes|${issued_at}`);
  const p = parsePick({ public_key: b.key, claim_id: 40, side: "YES", issued_at, signature: b.sign(msg) }, { network: "mainnet", nowMs: NOW });
  assert.deepEqual([p.key, p.claim_id, p.side, p.message], [b.key, 40, "yes", msg]);
  const b64 = Buffer.from(b.sign(msg), "hex").toString("base64");
  assert.equal(parsePick({ public_key: b.key, claim_id: 40, side: "yes", issued_at, signature: b64 }, { network: "mainnet", nowMs: NOW }).side, "yes", "base64 works too");
  const bad = (o, code) => assert.throws(() => parsePick({ public_key: b.key, claim_id: 40, side: "yes", issued_at, signature: b.sign(msg), ...o }, { network: "mainnet", nowMs: NOW }), (e) => e instanceof Refusal && e.code === code);
  bad({ side: "no" }, "bad_signature");
  bad({ signature: b.sign(pickMessage({ network: "testnet", claim_id: 40, side: "yes", issued_at })) }, "bad_signature");
  bad({ issued_at: NOW - MAX_SKEW_MS - 1, signature: b.sign(pickMessage({ network: "mainnet", claim_id: 40, side: "yes", issued_at: NOW - MAX_SKEW_MS - 1 })) }, "stale_signature");
  bad({ side: "maybe" }, "invalid_side");
  bad({ public_key: "ed25519:short" }, "invalid_public_key");
  bad({ signature: "zz" }, "invalid_signature");
});

test("picks: only on an open line before its date; the first pick on a line is the one that counts", () => {
  assert.throws(() => pickableOrWhy(null, null, NOW), /no line/);
  assert.throws(() => pickableOrWhy(claim(1, { status: "Settled" }), null, NOW), /settled/);
  assert.throws(() => pickableOrWhy(claim(1, { status: "Challenged" }), null, NOW), /ruling/);
  assert.throws(() => pickableOrWhy(claim(1), { settles: { by: "2026-11-06" } }, NOW), /date has passed/);
  pickableOrWhy(claim(1), { settles: { by: "2026-11-07" } }, NOW);
  const recs = [{ t: "pick", key: "k", claim_id: 1, side: "no", at: 2 }, { t: "pick", key: "k", claim_id: 1, side: "yes", at: 1 }, { t: "pick", key: "j", claim_id: 1, side: "no", at: 3 }];
  assert.deepEqual(firstPicks(recs).map((p) => [p.key, p.side]), [["k", "yes"], ["j", "no"]]);
  assert.deepEqual(pickCounts(firstPicks(recs)).get(1), { yes: 1, no: 1, total: 2 });
  const on = picksOnLine(1, firstPicks(recs), new Map([["k", "Ana"]]));
  assert.deepEqual([on.yes, on.no, on.picks[0].name], [1, 1, "Visitor "]);
  assert.equal(on.picks.find((x) => x.key === "k").name, "Ana");
});

test("nicknames: 3 to 20 plain characters, no slurs, nothing that looks like us, and the first to take a name keeps it", () => {
  assert.equal(cleanNickname("  Ana   B. "), "Ana B.");
  for (const bad of ["ab", "x".repeat(21), "<script>", "1234", "Fuck_you", "sh1t head", "PricedIn team", "The Archivist", "admin", "N1gga"]) assert.throws(() => cleanNickname(bad), Refusal, bad);
  for (const ok of ["Diego", "Sussex fan", "Skill_99", "Assane"]) assert.equal(cleanNickname(ok), ok);
  const b = browser(), c = browser();
  const issued_at = NOW;
  const msg = profileMessage({ network: "mainnet", nickname: "Diego", issued_at });
  assert.equal(parseProfile({ public_key: b.key, nickname: " Diego ", issued_at, signature: b.sign(msg) }, { network: "mainnet", nowMs: NOW }).nickname, "Diego");
  const recs = [{ t: "profile", key: b.key, nickname: "Diego", at: 1 }, { t: "profile", key: c.key, nickname: "diego", at: 2 }, { t: "profile", key: b.key, nickname: "Diego R", at: 3 }];
  assert.equal(nicknameTaken(recs, "DIEGO", c.key), true);
  assert.equal(nicknameTaken(recs, "Diego", b.key), false);
  const n = nicknames(recs);
  assert.deepEqual([n.get(b.key), n.get(c.key)], ["Diego R", undefined], "a name another key took first is not shown");
});

// ---------- reports ----------

test("a report: signed, its words checked by the receipt check alone, and its notes can't smuggle in other receipts", () => {
  const b = browser();
  const body = { public_key: b.key, claim_id: 7, url: "https://tether.io/news/x", quote: "Tether's reserves include $122.84 billion in U.S. Treasury bills", note: 'See https://evil.example/fake and "a quote nobody can find anywhere"\n> another', issued_at: NOW };
  assert.throws(() => parseReport({ ...body, note: "this is fucking wrong", signature: "00" }, { network: "mainnet", nowMs: NOW }), (e) => e.code === "report_refused", "free text we would publish goes through the word filter");
  const msg = reportMessage({ network: "mainnet", claim_id: 7, says: "false", url: body.url, quote: body.quote, note: body.note.replace(/\s+/g, " ").trim(), issued_at: NOW });
  const r = parseReport({ ...body, signature: b.sign(msg) }, { network: "mainnet", nowMs: NOW });
  assert.deepEqual([r.says, r.claim_id, r.url, r.id.length], ["false", 7, body.url, 16]);
  const evidence = reportEvidence(r);
  const parsed = parseEvidence(evidence);
  assert.deepEqual(parsed.urls, ["https://tether.io/news/x"], "only the reader's page is fetched");
  assert.deepEqual(parsed.quotes, ["Tether's reserves include $122.84 billion in U.S. Treasury bills"], "only the reader's words are looked for");
  assert.match(evidence, /^A reader's report, checked by Priced In's Checker before this challenge: the line is FALSE\./);
  assert.ok(!evidence.includes("evil.example") && !evidence.includes("nobody"), "the reader's free text never goes on-chain");
  assert.throws(() => parseReport({ ...body, url: "http://x.example/a", signature: "00" }, { network: "mainnet", nowMs: NOW }), /https/);
  assert.throws(() => parseReport({ ...body, quote: "too short", signature: "00" }, { network: "mainnet", nowMs: NOW }), /exact words/);
  assert.match(refusalWords({ result: "quote_not_found" }), /couldn't find those exact words/);
  assert.match(refusalWords({ result: "unsupported" }), /doesn't show the line is wrong/);
});

test("where a report stands: the journal's status, then the chain's word on the challenge it led to", () => {
  const recs = [
    { t: "report", id: "r1", key: "k1", claim_id: 7, says: "false", at: 1 }, { t: "report_status", id: "r1", status: "verified", at: 2 }, { t: "report_status", id: "r1", status: "challenged", challenge_id: 9, tx: "tx9", at: 3 },
    { t: "report", id: "r2", key: "k2", claim_id: 8, says: "false", at: 1 }, { t: "report_status", id: "r2", status: "challenged", challenge_id: 10, at: 3 },
    { t: "report", id: "r3", key: "k3", claim_id: 11, says: "false", at: 1 }, { t: "report_status", id: "r3", status: "challenged", challenge_id: 11, at: 3 },
    { t: "report", id: "r4", key: "k4", claim_id: 12, says: "false", at: 1 }, { t: "report_status", id: "r4", status: "refused", reason: "We couldn't find those exact words at that page.", at: 2 },
    { t: "report", id: "r5", key: "k5", claim_id: 13, says: "false", at: 1 }, { t: "report_status", id: "r5", status: "challenged", challenge_id: 13, at: 3 },
  ];
  const claims = [claim(7, { status: "Settled", outcome: false, challenge_id: 9 }), claim(8, { status: "Settled", outcome: true, challenge_id: 10 }), claim(11, { status: "Open" }), claim(13, { status: "Challenged", challenge_id: 13 })];
  const events = [ev("settle", { claim_id: 7, challenge_id: 9 }, 500), ev("challenge_expired", { challenge_id: 11 }, 600)];
  const m = reportsOf(recs, { claims, events });
  assert.deepEqual([...m.values()].map((x) => [x.id, x.status]), [["r1", "upheld"], ["r2", "rejected"], ["r3", "expired"], ["r4", "refused"], ["r5", "ruling"]]);
  assert.equal(m.get("r1").decided_at, 500);
  assert.match(reportView(m.get("r4")).reason, /exact words/);
});

// ---------- a report can't spend the Checker's bond on the reporter's own page ----------

const lineNews = (o = {}) => ({ settles: { by: "2026-11-13", source_url: "https://ir.acme.example/press", ...o.settles }, coverage: ["https://www.localpaper.example/story", "https://x.com/acme/status/1", ...(o.coverage || [])] });

test("whose page our Checker bonds on: the line's own sources, official sites and established outlets, never the reporter's", () => {
  const news = lineNews();
  for (const ok of ["https://ir.acme.example/press/2026", "https://localpaper.example/other", "https://www.sec.gov/Archives/x", "https://www.gov.uk/a", "https://www.reuters.com/world/a", "https://apnews.com/article/a", "https://sport.bbc.co.uk/a", "https://x.com/acme/status/1/"]) assert.equal(trustedSource(ok, { news }).ok, true, ok);
  for (const bad of ["https://evil.example/acme-confirms", "https://reuters.com.evil.example/a", "https://evilreuters.com/a", "https://reuters.com@evil.example/a", "https://x.com/attacker/status/2", "https://acme.github.io/a", "https://example.gov.evil.example/", "https://xn--reuters-3ve.com/a", "not a url"]) assert.equal(trustedSource(bad, { news }).ok, false, bad);
  assert.equal(trustedSource("https://docs.google.com/document/d/mine", { news: lineNews({ coverage: ["https://docs.google.com/document/d/theirs"] }) }).ok, false, "on a host anyone can post to, only the very page counts");
  assert.equal(trustedSource("https://acme-news.example/a", {}).ok, false, "a line with no sources of its own has only the shared list");
  assert.equal(trustedSource("https://acme-news.example/a", { extra: ["acme-news.example"] }).ok, true, "REPORT_TRUSTED_HOSTS adds to it");
});

test("a report's evidence names one page: no second URL inside the URL or the words", () => {
  const b = browser();
  const body = { public_key: b.key, claim_id: 7, quote: "Tether's reserves include $122.84 billion in U.S. Treasury bills", issued_at: NOW, signature: "00" };
  for (const url of ["https://www.reuters.com/a|https://evil.example/b", "https://www.reuters.com/a{https://evil.example/b", "https://www.reuters.com\\@evil.example/b", "https://www.reuters.com/a“https://evil.example/b", "https://www.reuters.com/a[https://evil.example/b"]) assert.throws(() => parseReport({ ...body, url }, { network: "mainnet", nowMs: NOW }), (e) => e.code === "invalid_url", url);
  assert.throws(() => parseReport({ ...body, url: "https://www.reuters.com/a", quote: "the exact words are also at https://evil.example/b for you" }, { network: "mainnet", nowMs: NOW }), (e) => e.code === "invalid_quote");
});

test("a report passes only when every attested model that answered agrees, and the page it landed on is one we rely on", () => {
  const trusted = (u) => u.includes("reuters");
  const ok = { result: "verified", sources: [{ via: "source", final_url: "https://www.reuters.com/a" }], support: { verdict: "supported", unanimous: true } };
  assert.deepEqual(reportVerdict(ok, { trusted }), { pass: true, retry: false, reason: null });
  assert.equal(reportVerdict({ ...ok, support: { verdict: "supported", unanimous: false } }, { trusted }).pass, false, "two yes and one no: not on our bond");
  assert.equal(reportVerdict({ ...ok, support: { verdict: "unclear", unanimous: false } }, { trusted }).pass, false, "unclear is a pass for a stranger's bond, not ours");
  assert.equal(reportVerdict({ ...ok, support: null }, { trusted }).pass, false, "nobody read the page");
  const moved = reportVerdict({ ...ok, sources: [{ via: "source", final_url: "https://evil.example/landing" }] }, { trusted });
  assert.equal(moved.pass, false);
  assert.match(moved.reason, /evil\.example/, "an open redirect on a trusted site lands somewhere we can see");
  assert.deepEqual([reportVerdict({ result: "unfetchable" }, { trusted }).retry, reportVerdict({ ...ok, support: { verdict: "unanswered" } }, { trusted }).retry, reportVerdict({ result: "quote_not_found" }, { trusted }).retry], [true, true, false]);
});

test("the sitting's bond is never a report's: a report leaves the Checker one bond, a news line needn't", async () => {
  const sent = [];
  const s = (balance) => ({ signer: { operator: { checker: { ok: true, accountId: "c" } }, challengeNews: async (i) => { sent.push(i); return { ok: true, value: 1, txHash: "t" }; }, challengeReport: async (i) => { sent.push(i); return { ok: true, value: 2, txHash: "t" }; } }, view: async (m) => (m === "get_balance" ? balance : { challenge_bond_micro: "1000000" }), record: async () => {} });
  const plan = { claim_id: 40, claimed_outcome: false, evidence: "e", intent: "report:r1", report_id: "r1" };
  const held = await postNewsChallenges([plan], s("1500000"), { kind: "report" });
  assert.deepEqual(held.posted, []);
  assert.match(held.errors[0], /keeps \$1\.00 for its daily sitting/);
  assert.equal((await postNewsChallenges([plan], s("2000000"), { kind: "report" })).posted.length, 1);
  assert.equal((await postNewsChallenges([{ ...plan, intent: "n" }], s("1000000"))).posted.length, 1);
});

const reportRec = (id, claim_id, o = {}) => ({ t: "report", id, key: `k${id}`, claim_id, says: "false", url: "https://www.reuters.com/a", quote: "the exact words", evidence: "e", at: NOW - H, ...o });
const verifiedCheck = { result: "verified", reason: "ok", sources: [{ via: "source", final_url: "https://www.reuters.com/a" }], support: { verdict: "supported", unanimous: true } };
const roundOf = (records, o = {}) => {
  const journal = [...records], asked = [], planned = [];
  return {
    journal, asked, planned,
    d: { now: () => NOW, records: () => journal, claims: async () => [claim(7), claim(8)], lines: async () => ({ lines: {} }), events: () => [], append: (r) => journal.push(r), check: async (a) => { asked.push(a); return verifiedCheck; }, challenge: async (plans) => { planned.push(...plans); return { posted: plans.map((x) => ({ ...x, challenge_id: 5, tx: "t" })), errors: [] }; }, ...o },
  };
};

test("a report that waited two days lapses, so it can't hold the line against the next one", () => {
  const recs = [reportRec("old", 7, { at: NOW - REPORT_TTL_MS - 1 }), reportRec("new", 8)];
  const m = reportsOf(recs, { claims: [claim(7), claim(8)], events: [], nowMs: NOW });
  assert.equal(m.get("old").status, "closed");
  assert.match(m.get("old").reason, /two days/);
  assert.equal(m.get("new").status, "received");
  const verified = reportsOf([reportRec("v", 7, { at: NOW - REPORT_TTL_MS - 1 }), { t: "report_status", id: "v", status: "verified", at: NOW - 2 * H }], { claims: [claim(7)], events: [], nowMs: NOW });
  assert.equal(verified.get("v").status, "closed", "held by the cap or the balance, it lapses too");
});

test("the reports' round: checks what waits, bonds what passes, and refuses what doesn't", async () => {
  const r = roundOf([reportRec("a", 7), reportRec("b", 8, { url: "https://evil.example/mine" })], { check: async (a) => (a.claimed === false && a.evidence === "bad" ? { result: "quote_not_found" } : verifiedCheck) });
  r.journal[1].evidence = "bad";
  const out = await reportsRound(r.d);
  assert.deepEqual(r.planned.map((p) => [p.claim_id, p.intent]), [[7, "report:a"]]);
  assert.deepEqual(r.journal.filter((x) => x.t === "report_status").map((x) => [x.id, x.status]), [["a", "verified"], ["b", "refused"], ["a", "challenged"]]);
  assert.deepEqual(out.challenged.map((x) => x.report_id), ["a"]);
});

test("the reports' round: one at a time, so a burst of reports can't ask the models the same thing many times", async () => {
  const held = roundOf([reportRec("a", 7)], { lock: async () => null });
  assert.deepEqual(await reportsRound(held.d), { busy: true, note: "Another round is checking the reports." });
  assert.equal(held.asked.length, 0);
  let released = 0;
  const free = roundOf([reportRec("a", 7)], { lock: async () => ({ release: async () => { released++; } }) });
  await reportsRound(free.d);
  assert.deepEqual([free.asked.length, released], [1, 1]);
});

test("the reports' round: a day's checks are capped, so reports can't spend the scout's and the settler's model budget", async () => {
  let taken = 0;
  const r = roundOf([reportRec("a", 7), reportRec("b", 8)], { takeCheck: async () => ++taken <= 1 });
  const out = await reportsRound(r.d);
  assert.equal(r.asked.length, 1);
  assert.equal(out.capped, true);
  assert.deepEqual(r.journal.filter((x) => x.id === "b" && x.t === "report_status"), [], "the other one waits for tomorrow");
});

// ---------- the board ----------

test("the AIs' picks: each one's first buy on a line, at the price just before it; sells never count", () => {
  const ai = new Map([["h-quant.isitpriced.near", "Quant"]]);
  const events = [
    ev("open", { claim_id: 1, p0_ppm: 300_000 }, 1), ev("trade", { claim_id: 1, trader: "lane:x", side: "yes", price_yes_ppm: 450_000 }, 2),
    ev("trade", { claim_id: 1, trader: "h-quant.isitpriced.near", side: "no", price_yes_ppm: 400_000 }, 3), ev("trade", { claim_id: 1, trader: "h-quant.isitpriced.near", side: "yes", price_yes_ppm: 420_000 }, 4),
    ev("trade", { claim_id: 2, trader: "h-quant.isitpriced.near", side: "sell_yes", price_yes_ppm: 420_000 }, 5),
  ];
  assert.deepEqual(aiPicks(events, ai).map((p) => [p.claim_id, p.side, p.price_yes_ppm]), [[1, "no", 450_000]]);
  assert.deepEqual([...aiTraders({ marketId: "market.isitpriced.near", env: {} })], [["h-archivist.isitpriced.near", "Archivist"], ["h-skeptic.isitpriced.near", "Skeptic"], ["h-quant.isitpriced.near", "Quant"]]);
  assert.deepEqual([...aiTraders({ marketId: "m", env: { LEADERBOARD_AI: "a.near=Ann" } })], [["a.near", "Ann"]]);
  assert.deepEqual([pointsFor("yes", 900_000), pointsFor("no", 900_000), pointsFor("yes", 1_000_000)], [10, 90, 1]);
});

test("the leaderboard: people and the AIs side by side, ranked by accuracy once they have enough settled picks; streaks, points, catches", () => {
  const ai = new Map([["h-quant.isitpriced.near", "Quant"], ["h-skeptic.isitpriced.near", "Skeptic"]]);
  const claims = [1, 2, 3, 4, 5, 6].map((i) => claim(i, { status: "Settled", outcome: i % 2 === 0 })).concat([claim(7)]);
  const events = [1, 2, 3, 4, 5, 6].map((i) => ev("settle", { claim_id: i, outcome: i % 2 === 0 }, NOW - (7 - i) * H));
  for (const i of [1, 2, 3, 4, 5, 6]) events.push(ev("trade", { claim_id: i, trader: "h-quant.isitpriced.near", side: i % 2 === 0 ? "yes" : "no", price_yes_ppm: 500_000 }, NOW - 30 * H));
  for (const i of [1, 2]) events.push(ev("trade", { claim_id: i, trader: "h-skeptic.isitpriced.near", side: "no", price_yes_ppm: 500_000 }, NOW - 30 * H));
  const pk = (key, claim_id, side, at = NOW - 20 * H) => ({ t: "pick", key, claim_id, side, at, price_yes_ppm: 500_000 });
  const picks = [
    ...[1, 2, 3, 4, 5].map((i) => pk("ed25519:Ann111111111111111111111111111111", i, i % 2 === 0 ? "yes" : "no")), pk("ed25519:Ann111111111111111111111111111111", 6, "no"),
    ...[1, 2].map((i) => pk("ed25519:Bob222222222222222222222222222222", i, "yes")), pk("ed25519:Bob222222222222222222222222222222", 7, "yes", NOW - H),
  ];
  const reports = new Map([["r1", { id: "r1", key: "ed25519:Bob222222222222222222222222222222", status: "upheld", decided_at: NOW - H }]]);
  const nicks = new Map([["ed25519:Ann111111111111111111111111111111", "Ann"]]);
  const b = leaderboard({ picks, claims, events, reports, ai, nicks, period: "week", nowMs: NOW, minSettled: 5 });
  assert.deepEqual(b.board.map((r) => [r.rank, r.kind, r.name, r.accuracy, r.settled]), [[1, "ai", "Quant", 1, 6], [2, "person", "Ann", 0.833, 6]]);
  const ann = b.board[1];
  assert.deepEqual([ann.streak, ann.points, ann.right], [{ current: 0, best: 5 }, 250, 5], "five right in a row, then a miss");
  const bob = b.waiting.find((r) => r.id.startsWith("ed25519:Bob"));
  assert.deepEqual([bob.settled, bob.needs, bob.caught, bob.points, bob.picks_today, bob.open_picks], [2, 3, 1, 150, 1, 1], "a catch the jury upheld adds to caught and points");
  assert.equal(bob.name, "Visitor Bob222");
  assert.deepEqual(b.ai.map((r) => [r.name, r.rank]), [["Quant", 1], ["Skeptic", null]]);
  assert.deepEqual(b.you_vs_ai, { best_ai: { id: "h-quant.isitpriced.near", name: "Quant", accuracy: 1, settled: 6, rank: 1 }, people_ranked: 1, people_ahead_of_best_ai: 0 });
  assert.match(b.rules, /win nothing: no purchase, no prize, no payout/);
  const old = leaderboard({ picks, claims, events, ai, nicks, period: "week", nowMs: NOW + 8 * DAY, minSettled: 5 });
  assert.equal(old.board.length, 0, "a week later the week's board is empty again");
  assert.equal(leaderboard({ picks, claims, events, ai, nicks, period: "all", nowMs: NOW + 8 * DAY, minSettled: 5 }).board.length, 2);
  const me = picksOf("ed25519:Ann111111111111111111111111111111", { picks, claims, events, nicks, nowMs: NOW });
  assert.deepEqual([me.nickname, me.stats.accuracy, me.stats.settled, me.picks.length, me.picks.find((x) => x.claim_id === 6).state, me.picks.find((x) => x.claim_id === 2).state], ["Ann", 0.833, 6, 6, "wrong", "right"]);
});

// ---------- the money path, limits, and the sitting ----------

test("the money path: what a wallet sends to challenge with its own bond, the bounty, and why a line can't be challenged", () => {
  const c = challengeCall(claim(7, { bounty_micro: "1000000" }), { marketId: "market.isitpriced.near", network: "mainnet", bondMicro: "1000000" });
  assert.deepEqual(c.call, { contract: "market.isitpriced.near", method: "challenge", args: { claim_id: 7, claimed_outcome: false, evidence: "<your receipt: see evidence>" }, deposit: "0", gas_tgas: 30 });
  assert.deepEqual([c.open, c.bond.usd, c.bounty.usd, c.evidence.max_bytes], [true, 1, 1, 4000]);
  assert.match(c.bond.from, /lane keys can't challenge/);
  assert.equal(c.bounty.fund.method, "fund_question");
  assert.match(challengeCall(claim(7, { status: "Challenged" }), { marketId: "m", network: "mainnet", bondMicro: "1000000" }).why_not, /already running/);
});

test("limits: per key and per network, and a refusal gives back what it took", async () => {
  const dir = tmp();
  const state = new FsState({ prefix: "state/testnet/m", dir });
  const release = await takeLimits(state, [["picks-key", "k", 1, "key"], ["picks-ip", "1.2.3.4", 5, "ip"]]);
  await assert.rejects(takeLimits(state, [["picks-key", "k", 1, "This key has made its 1 picks for today."], ["picks-ip", "1.2.3.4", 5, "ip"]]), (e) => e.code === "rate_limited" && e.extra.retryAfterS > 0);
  assert.equal((await state.peek("picks-ip", "1.2.3.4", 5)).used, 1, "the network's unit taken before the refusal came back");
  await release();
  assert.equal((await state.peek("picks-key", "k", 1)).used, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the sitting stays as it was: a news line's ruling or a reader's report never takes the day's sitting", () => {
  const acct = "checker.isitpriced.near";
  const day = Date.UTC(2026, 10, 7, 16);
  const rulings = [
    { challenger: acct, claim_id: 50, page: "news-2026-11-07", status: "settled", opened_at: day - H, evidence: "Priced In's Checker, settling a news line." },
    { challenger: acct, claim_id: 51, page: "tether", status: "jury", opened_at: day - H, evidence: "A reader's report, checked by Priced In's Checker before this challenge: the line is FALSE." },
  ];
  assert.deepEqual(rulings.map(ofSitting), [false, false]);
  assert.equal(ofSitting({ page: "tether", evidence: "Priced In's Checker. Corpus record tether-0035" }), true);
  assert.equal(checkerQueue({ claims: [], rulings, account: acct, nowMs: day }).rulingsToday, 0);
});

test("news keeps to its share of the model budget: with it spent, the settler looks at nothing", async () => {
  const dir = tmp();
  const store = linesStore(new FsState({ prefix: "state/testnet/m", dir }));
  await store.update((cur) => ({ ...cur, lines: { 40: meta(40) } }));
  let looked = 0;
  const r = await settleRound({ cfg: newsConfig({ NEWS_ENABLED: "1" }), now: () => Date.parse("2026-11-14T08:00:00Z"), store, claims: async () => [claim(40)], budget: () => false, find: async () => { looked++; return {}; }, check: async () => ({}), challenge: async () => ({ posted: [], errors: [] }) });
  assert.equal(looked, 0);
  assert.match(r.note, /share of today/);
  assert.equal(newsConfig({ NEWS_ENABLED: "1" }).spendShare, 0.5);
  assert.equal(newsConfig({ NEWS_SPEND_SHARE: "20" }).spendShare, 0.2);
  fs.rmSync(dir, { recursive: true, force: true });
});
