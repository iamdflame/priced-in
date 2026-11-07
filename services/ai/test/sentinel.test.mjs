// The Sentinel: every decision, its evidence in plain words, and whole rounds against a fake chain.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disputeEvidence, fundingOf, isDisputeHold, sentinelDecision, sentinelRound, SENTINEL } from "../src/sentinel.js";
import { DAILY_DISPUTE_MICRO, MAX_DISPUTE_BOND_MICRO } from "../src/signer.js";

const NOW = Date.UTC(2026, 10, 6, 15, 0, 0);
const CHECKER = "checker.isitpriced.near";
const SENTRY = "sentinel.isitpriced.near";
const accounts = { sentinel: SENTRY, checker: CHECKER };
const challengeOf = (o = {}) => ({ claim_id: 7, challenger: "liar.near", claimed_outcome: false, evidence: "forged", bond_micro: "1000000", disputes: 0, resolved: false, verdicts: [], ...o });
const claimOf = (o = {}) => ({ id: 7, text: "USDC is issued by Circle.", status: "Challenged", provisional: false, challenge_id: 3, ...o });
const check = (result, o = {}) => ({ result, reason: `the reason for ${result}`, checked_at: new Date(NOW - 5000).toISOString(), via: "source", record: null, quotes: [], sources: [], ...o });
const decide = (o = {}) => sentinelDecision({ id: 3, ch: challengeOf(o.ch), claim: claimOf(o.claim), check: "check" in o ? o.check : check("quote_not_found"), windowEndMs: o.windowEndMs === undefined ? NOW + 300_000 : o.windowEndMs, nowMs: NOW, accounts, disputed: o.disputed });

test("the Sentinel disputes when the outcome sides with a challenger whose receipts failed, at twice the bond", () => {
  for (const r of ["quote_not_found", "unfetchable", "record_mismatch"]) {
    const d = decide({ check: check(r) });
    assert.deepEqual([d.act, d.round, d.bond_micro], ["dispute", 1, "2000000"], r);
    assert.match(d.note, /the Sentinel disputes \(round 1, a \$2\.00 bond\)/);
  }
  const claimedTrue = decide({ ch: { claimed_outcome: true }, claim: { provisional: true } });
  assert.equal(claimedTrue.act, "dispute", "a forgery that a false line is TRUE gets the same answer");
});

test("it never disputes a verified receipt, nor our Checker's verified challenge", () => {
  const v = decide({ check: check("verified") });
  assert.deepEqual([v.act, v.status], ["none", "no_dispute"]);
  assert.match(v.note, /never disputes a verified receipt/);
  const c = decide({ ch: { challenger: CHECKER }, check: check("verified", { via: "corpus" }) });
  assert.deepEqual([c.act, c.status], ["none", "no_dispute"]);
  assert.match(c.note, /Our Checker's receipt verified/);
});

test("a Checker's challenge that fails the check is treated like anyone's: a stolen key buys no exemption", () => {
  assert.equal(decide({ ch: { challenger: CHECKER }, check: check("record_mismatch") }).act, "dispute");
});

test("a bare accusation is recorded and not disputed", () => {
  const d = decide({ check: check("no_receipt", { via: null }) });
  assert.deepEqual([d.act, d.status], ["none", "no_dispute"]);
  assert.match(d.note, /bare accusation/);
});

test("nothing to dispute: the jury is still out, or the outcome stands against the challenger", () => {
  const jury = decide({ claim: { provisional: null }, windowEndMs: null });
  assert.deepEqual([jury.act, jury.status], ["none", "watching"]);
  assert.match(jury.note, /has not ruled for anyone yet/);
  const against = decide({ claim: { provisional: true } });
  assert.deepEqual([against.act, against.status], ["none", "watching"]);
  assert.match(against.note, /already stands against the challenger \(TRUE\)/);
});

test("the attacker disputes back: the Sentinel answers once more, and the third dispute is the council's", () => {
  // round 1 was the Sentinel's: the outcome stands against the challenger until they post $4
  const after = decide({ ch: { disputes: 1, bond_micro: "2000000" }, claim: { provisional: true }, disputed: [1] });
  assert.deepEqual([after.act, after.status], ["none", "disputed"]);
  assert.match(after.note, /If they dispute back, it disputes again/);
  const back = decide({ ch: { disputes: 2, bond_micro: "4000000" }, claim: { provisional: false }, disputed: [1] });
  assert.deepEqual([back.act, back.round, back.bond_micro], ["dispute", 3, "8000000"]);
  const council = decide({ ch: { disputes: 3, bond_micro: "8000000" }, claim: { status: "Escalated", provisional: true }, disputed: [1, 3] });
  assert.deepEqual([council.act, council.status], ["none", "disputed"]);
  assert.match(council.note, /council/);
  assert.equal(decide({ ch: { disputes: 3, bond_micro: "8000000" }, claim: { status: "Escalated", provisional: true } }).status, "watching", "escalated by others: it watches");
});

test("too late to land a dispute: it says so instead of spending gas on a refusal", () => {
  const d = decide({ windowEndMs: NOW + SENTINEL.marginMs - 1 });
  assert.deepEqual([d.act, d.status], ["none", "blocked"]);
  assert.match(d.note, /too late to land a dispute/);
  assert.equal(decide({ windowEndMs: NOW + SENTINEL.marginMs + 1 }).act, "dispute");
});

test("no check yet asks for one; a challenge no longer live and its own account need nothing", () => {
  assert.equal(decide({ check: null }).act, "check");
  assert.equal(decide({ ch: { resolved: true } }).act, "none");
  assert.equal(decide({ claim: { status: "Settled" } }).act, "none");
  assert.equal(decide({ claim: { challenge_id: 99 } }).act, "none");
  assert.equal(decide({ ch: { challenger: SENTRY }, check: check("quote_not_found") }).act, "none");
});

// ---------- its evidence ----------

const QUOTE = "Tether Holdings Limited is headquartered in Zug, Switzerland";
const SOURCE = { url: "https://tether.to/en/legal/", via: "source", status: 200, bytes: 147739, sha256: "c".repeat(64), fetched_at: "2026-11-06T14:59:55.123Z", error: null };

test("the evidence is plain words: what was fetched, when, the status, the page's hash, the missing quote", () => {
  const s = disputeEvidence({ id: 3, round: 1, claimed: false, check: check("quote_not_found", { quotes: [{ text: QUOTE, found: false }], sources: [SOURCE] }) });
  assert.match(s, /Priced In's Sentinel disputes challenge 3 \(round 1\)/);
  assert.match(s, /We fetched https:\/\/tether\.to\/en\/legal\/ at 2026-11-06T14:59:55Z: HTTP 200, 147,739 bytes, sha256 c{64}\./);
  assert.ok(s.includes(`The quoted words "${QUOTE}" are not in it`));
  assert.match(s, /ignoring case, spacing, quote marks, dashes and number formatting/);
});

test("the evidence for a dead source, for a source with nothing quoted, and for a made-up record", () => {
  const dead = disputeEvidence({ id: 3, round: 1, claimed: false, check: check("unfetchable", { quotes: [{ text: QUOTE, found: false }], sources: [{ ...SOURCE, status: null, sha256: null, bytes: 0, error: "no such host" }] }) });
  assert.match(dead, /We tried https:\/\/tether\.to\/en\/legal\/ at 2026-11-06T14:59:55Z: no such host\./);
  assert.match(dead, /A receipt nobody can read is not a receipt/);
  const missing = disputeEvidence({ id: 3, round: 1, claimed: false, check: check("unfetchable", { quotes: [], sources: [{ ...SOURCE, status: 404, error: "HTTP 404" }] }) });
  assert.match(missing, /HTTP 404/);
  const bare = disputeEvidence({ id: 3, round: 1, claimed: false, check: check("quote_not_found", { sources: [SOURCE] }) });
  assert.match(bare, /quotes nothing from it/);
  const record = disputeEvidence({ id: 3, round: 3, claimed: false, check: check("record_mismatch", { via: "corpus", reason: "There is no record tether-0022 in corpus/ERRORS.json.", record: { id: "tether-0022", found: false, sha256_claimed: "d".repeat(64), sha256_committed: null } }) });
  assert.match(record, /There is no record tether-0022/);
  assert.match(record, /with sha256 d{64}/);
  assert.match(record, /has no such record/);
  assert.match(record, /\(round 3\)/);
});

test("the evidence fits the market's 4,000 bytes, whatever the check holds", () => {
  const long = "\u20AC".repeat(1200);
  const s = disputeEvidence({ id: 3, round: 1, claimed: false, check: check("quote_not_found", { reason: long, quotes: Array.from({ length: 5 }, () => ({ text: long, found: false })), sources: Array.from({ length: 6 }, (_, i) => ({ ...SOURCE, url: `https://example.org/${"p".repeat(900)}${i}` })) }) });
  assert.ok(Buffer.byteLength(s, "utf8") <= 4000);
  assert.match(s, /^Priced In's Sentinel disputes/);
});

test("a hold is a cap or the money, said plainly; a real failure is not one", () => {
  assert.equal(isDisputeHold("dispute: 3 disputes already sent today"), true);
  assert.equal(isDisputeHold("dispute: a 8000000 micro-USDC bond would pass today's dispute limit of 10000000"), true);
  assert.equal(isDisputeHold("dispute: sentinel.near holds $1.00 in the market and the bond is $2.00"), true);
  assert.equal(isDisputeHold("dispute: an earlier dispute on this challenge is still in flight"), true);
  assert.equal(isDisputeHold("Smart contract panicked: the dispute window has closed"), false);
});

// ---------- whole rounds ----------

function world(o = {}) {
  const st = {
    bonds: "bonds" in o ? o.bonds : "1000000",
    claims: o.claims ?? [claimOf()],
    challenges: o.challenges ?? { 3: challengeOf() },
    ends: o.ends ?? { 3: String(BigInt(NOW + 300_000) * 1_000_000n) },
    views: [], ledger: { checks: o.checks ?? {}, sentinel: o.sentinel ?? {} }, writes: 0, checks: [], disputes: [],
  };
  const view = async (method, args = {}) => {
    st.views.push(method);
    if (method === "stats") return { bonds_micro: st.bonds };
    if (method === "get_claims") return st.claims.slice(args.from, args.from + args.limit);
    if (method === "get_challenge") return st.challenges[args.challenge_id] ?? null;
    if (method === "dispute_ends_ns") return st.ends[args.challenge_id] ?? null;
    throw new Error(`unexpected view ${method}`);
  };
  const ledger = {
    read: async () => structuredClone(st.ledger),
    putCheck: async (id, c) => { st.writes++; st.ledger.checks[id] = c; },
    putSentinel: async (id, e) => { st.writes++; st.ledger.sentinel[id] = e; },
  };
  const result = o.result ?? "quote_not_found";
  const run = async (a) => { st.checks.push(a); return check(typeof result === "function" ? result(st.checks.length) : result, { checked_at: new Date(NOW).toISOString() }); };
  const dispute = o.dispute === null ? null : async (intent, d) => {
    st.disputes.push({ intent, ...d });
    if (o.refuse) return { ok: false, error: o.refuse };
    return { ok: true, txHash: `tx${st.disputes.length}` };
  };
  return { st, d: { view, ledger, check: run, dispute, accounts, now: () => NOW } };
}

test("nothing live costs one view call and no store access", async () => {
  const { st, d } = world({ bonds: "0" });
  const r = await sentinelRound(d);
  assert.equal(r.idle, true);
  assert.deepEqual(st.views, ["stats"]);
  assert.equal(st.writes, 0);
  assert.deepEqual(st.checks, []);
});

test("a forged challenge in its window: checked, disputed once, and the record says so", async () => {
  const { st, d } = world();
  const r = await sentinelRound(d);
  assert.deepEqual(st.checks.map((c) => [c.claim, c.evidence, c.claimed]), [["USDC is issued by Circle.", "forged", false]]);
  assert.equal(st.disputes.length, 1);
  assert.deepEqual([st.disputes[0].challenge_id, st.disputes[0].round], [3, 1]);
  assert.match(st.disputes[0].intent, /^sentinel:dispute:3:r1:\d+$/);
  assert.match(st.disputes[0].evidence, /Priced In's Sentinel disputes challenge 3/);
  assert.deepEqual(r.disputed.map((x) => [x.challenge_id, x.round, x.bond_usd, x.tx]), [[3, 1, 2, "tx1"]]);
  const e = st.ledger.sentinel[3];
  assert.equal(e.status, "disputed");
  assert.deepEqual(e.disputes.map((x) => [x.round, x.bond_usd, x.tx, x.result]), [[1, 2, "tx1", "quote_not_found"]]);
  assert.equal(st.ledger.checks[3].result, "quote_not_found");
  assert.deepEqual(r.errors, []);
});

test("the next minute, the same chain: the dispute landed, so nothing more is sent or written", async () => {
  const { st, d } = world();
  await sentinelRound(d);
  st.claims = [claimOf({ provisional: true })];
  st.challenges[3] = challengeOf({ disputes: 1, bond_micro: "2000000" });
  await sentinelRound(d);
  const writes = st.writes;
  await sentinelRound(d);
  assert.equal(st.disputes.length, 1, "once per round");
  assert.equal(st.writes, writes, "a quiet minute writes nothing");
  assert.equal(st.ledger.sentinel[3].status, "disputed");
  assert.match(st.ledger.sentinel[3].note, /If they dispute back/);
});

test("the attacker disputes back: round 3, $8, and the record holds both", async () => {
  const { st, d } = world();
  await sentinelRound(d);
  st.claims = [claimOf({ provisional: false })];
  st.challenges[3] = challengeOf({ disputes: 2, bond_micro: "4000000" });
  const r = await sentinelRound(d);
  assert.deepEqual(r.disputed.map((x) => [x.round, x.bond_usd]), [[3, 8]]);
  assert.deepEqual(st.ledger.sentinel[3].disputes.map((x) => x.round), [1, 3]);
  st.claims = [claimOf({ provisional: true, status: "Escalated" })];
  st.challenges[3] = challengeOf({ disputes: 3, bond_micro: "8000000" });
  await sentinelRound(d);
  assert.equal(st.disputes.length, 2, "the council has it now");
  assert.match(st.ledger.sentinel[3].note, /council/);
});

test("verified, bare, and our Checker's: nothing is disputed, and the record says why", async () => {
  for (const [result, status] of [["verified", "no_dispute"], ["no_receipt", "no_dispute"]]) {
    const { st, d } = world({ result });
    const r = await sentinelRound(d);
    assert.deepEqual(st.disputes, [], result);
    assert.equal(st.ledger.sentinel[3].status, status);
    assert.equal(r.live[0].receipt, result);
  }
  const { st, d } = world({ challenges: { 3: challengeOf({ challenger: CHECKER }) }, checks: { 3: check("verified", { via: "corpus" }) } });
  await sentinelRound(d);
  assert.deepEqual(st.checks, [], "the stored check stands: no fetch");
  assert.deepEqual(st.disputes, []);
  assert.match(st.ledger.sentinel[3].note, /Our Checker's receipt/);
});

test("while the jury sits the receipts are already checked, and nothing is disputed", async () => {
  const { st, d } = world({ claims: [claimOf({ provisional: null })] });
  const r = await sentinelRound(d);
  assert.equal(st.checks.length, 1);
  assert.deepEqual(st.disputes, []);
  assert.equal(r.live[0].stage, "jury");
  assert.equal(st.ledger.sentinel[3].status, "watching");
  assert.ok(!st.views.includes("dispute_ends_ns"), "no window to read yet");
});

test("an old failure is checked again before acting: a source that came back is not disputed", async () => {
  const stale = check("unfetchable", { checked_at: new Date(NOW - SENTINEL.freshMs - 1000).toISOString() });
  const { st, d } = world({ checks: { 3: stale }, result: "verified" });
  await sentinelRound(d);
  assert.equal(st.checks.length, 1);
  assert.deepEqual(st.disputes, []);
  assert.equal(st.ledger.checks[3].result, "verified");
  assert.equal(st.ledger.sentinel[3].status, "no_dispute");
  const fresh = world({ checks: { 3: check("unfetchable") } });
  await sentinelRound(fresh.d);
  assert.deepEqual(fresh.st.checks, [], "a failure from this minute is not fetched twice");
  assert.equal(fresh.st.disputes.length, 1);
});

test("held by a cap or the money: it says so, and tries again next minute", async () => {
  const { st, d } = world({ refuse: "dispute: 3 disputes already sent today" });
  const r = await sentinelRound(d);
  assert.deepEqual(r.disputed, []);
  assert.deepEqual(r.errors, [], "a cap is a state, not a failure");
  assert.equal(r.blocked.length, 1);
  assert.equal(st.ledger.sentinel[3].status, "blocked");
  assert.match(st.ledger.sentinel[3].note, /it is held: dispute: 3 disputes already sent today/);
  assert.equal(st.ledger.sentinel[3].attempts.length, 1);
  await sentinelRound(d);
  assert.equal(st.disputes.length, 2);
});

test("a real failure is reported; a round the chain moved past is not", async () => {
  const bad = world({ refuse: "Smart contract panicked: the dispute window has closed" });
  const r = await sentinelRound(bad.d);
  assert.equal(r.errors.length, 1);
  assert.match(bad.st.ledger.sentinel[3].note, /did not go through/);
  const moved = world({ refuse: "dispute: the challenge is at round 2, not 1" });
  assert.deepEqual((await sentinelRound(moved.d)).errors, []);
});

test("no Sentinel key: it says so instead of pretending to watch", async () => {
  const { st, d } = world({ dispute: null });
  const r = await sentinelRound(d);
  assert.equal(r.blocked.length, 1);
  assert.match(st.ledger.sentinel[3].note, /no Sentinel key/);
});

test("a window closing in seconds, a store that fails, a chain that fails: the round stands", async () => {
  const late = world({ ends: { 3: String(BigInt(NOW + 1000) * 1_000_000n) } });
  await sentinelRound(late.d);
  assert.deepEqual(late.st.disputes, []);
  assert.equal(late.st.ledger.sentinel[3].status, "blocked");
  const store = world();
  store.d.ledger.read = async () => { throw new Error("store down"); };
  const r = await sentinelRound(store.d);
  assert.equal(store.st.disputes.length, 1, "money at stake doesn't wait for the record");
  assert.match(r.errors[0], /ledger: store down/);
  const broken = world();
  const inner = broken.d.view;
  broken.d.view = async (m, a) => { if (m === "get_challenge") throw new Error("rpc down"); return inner(m, a); };
  assert.match((await sentinelRound(broken.d)).errors[0], /challenge 3: rpc down/);
});

test("two live challenges are each looked at, and out of time it stops and says so", async () => {
  const claims = [claimOf(), claimOf({ id: 8, challenge_id: 4 })];
  const two = world({ claims, challenges: { 3: challengeOf(), 4: challengeOf({ claim_id: 8 }) }, ends: { 3: String(BigInt(NOW + 300_000) * 1_000_000n), 4: String(BigInt(NOW + 300_000) * 1_000_000n) } });
  const r = await sentinelRound(two.d);
  assert.deepEqual(two.st.disputes.map((x) => x.challenge_id), [3, 4]);
  assert.equal(r.live.length, 2);
  const hurried = world({ claims, challenges: two.st.challenges });
  const h = await sentinelRound({ ...hurried.d, left: () => 1000 });
  assert.deepEqual(hurried.st.disputes, []);
  assert.match(h.errors[0], /out of time/);
});

test("stats can be handed in, so the idle check is not made twice", async () => {
  const { st, d } = world();
  await sentinelRound({ ...d, stats: { bonds_micro: "1000000" } });
  assert.equal(st.views.filter((v) => v === "stats").length, 0);
});

test("what it takes: $2 for a first dispute, $10 for a full escalation, and the default caps carry exactly that", () => {
  const f = fundingOf("1000000");
  assert.deepEqual(f, { first_dispute_micro: "2000000", attacker_back_micro: "4000000", third_dispute_micro: "8000000", full_escalation_micro: "10000000" });
  assert.equal(BigInt(f.third_dispute_micro), MAX_DISPUTE_BOND_MICRO);
  assert.equal(BigInt(f.full_escalation_micro), DAILY_DISPUTE_MICRO);
  assert.equal(fundingOf(2_000_000).full_escalation_micro, "20000000");
});

test("the founder's script refuses without CONFIRM_MAINNET=yes, before any network or key, and needs a word", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const run = (...a) => spawnSync(process.execPath, ["scripts/mainnet/sentinel.mjs", ...a], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  const refused = run("apply");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to touch mainnet: set CONFIRM_MAINNET=yes/);
  const none = run();
  assert.equal(none.status, 1);
  assert.match(none.stderr, /usage: node scripts\/mainnet\/sentinel\.mjs plan/);
});

test("a refusal made in code says so on the chain: it never claims that models read a source", () => {
  const reason = "This line runs until 2026-11-14T00:00:00.000Z: until then nobody can show that it did not happen.";
  const e = disputeEvidence({ id: 9, round: 1, claimed: false, check: { result: "unsupported", reason, checked_at: "2026-11-07T10:00:00.000Z", sources: [], quotes: [], support: { verdict: "unsupported", unanimous: true, answers: [] } } });
  assert.ok(e.includes(reason));
  assert.doesNotMatch(e, /Attested models read/);
  assert.doesNotMatch(e, /quoted words are there/);
});
