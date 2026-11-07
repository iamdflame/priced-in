// The scout on today's real news, measured. Reads the live feeds, asks the scout model for claims,
// runs every check of the gate (the code blocklist, the second model, a web search per survivor,
// duplicates against the mainnet market's open lines, and capacity at the market's real treasury),
// then checks every claim that passed with a blind web search by a third model: is it unconfirmed
// today, will a public source settle it within 7 days, and does it touch anything we never price?
// Nothing is opened, signed or posted.
//
//   node scripts/measure-scout.mjs [--out deployments/scout-test.json] [--budget 0.5]
//
// NEARAI_API_KEY1 from .env (never printed). About $0.10 a run.
import { readFeeds, proposeClaims, DEFAULT_FEEDS, dateWords, isoDay, jsonIn, NO_THINKING } from "../services/ai/src/scout.js";
import { runGate, reviewRequest, parseReviews, verifyOnWeb, REVIEW_MODEL, VERIFY_MODEL, searchResults, policyWords } from "../services/ai/src/gate.js";
import { meteredClient, allClaims, capacity, write } from "./news-measure-lib.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("--out", "deployments/scout-test.json");
const BLIND_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const now = Date.now();
const { wrap, spend } = await meteredClient({ budgetUsd: Number(arg("--budget", "0.5")) });

console.log(`reading ${DEFAULT_FEEDS.length} feeds`);
const { headlines, feeds } = await readFeeds({ nowMs: now });
console.log(`${headlines.length} headlines`);
const scout = await proposeClaims({ client: wrap("scout"), headlines, nowMs: now });
console.log(`${scout.candidates.length} candidates`);

const [claims, money] = await Promise.all([allClaims(), capacity()]);
const open = claims.filter((c) => c.status !== "Settled").map((c) => ({ claim_id: c.id, text: c.text }));
const gate = await runGate({
  candidates: scout.candidates,
  nowMs: now,
  review: async (cands) => parseReviews((await wrap("review").chat(reviewRequest(REVIEW_MODEL, cands, now), { timeoutMs: 120_000 })).content, cands.length),
  verify: (c) => verifyOnWeb({ client: wrap("verify"), model: VERIFY_MODEL, candidate: c, nowMs: now }),
  verifyAll: true,
  open,
  capacity: money.capacity,
  openedToday: 0,
  perDay: 4,
  bMicro: 1_450_000,
  floorMicro: 1_500_000,
});

// the blind check: a third model with its own web search, told nothing of the gate's answers
const BLIND = (c) => [
  `Today is ${dateWords(isoDay(now))}. Search the web for the latest news on this claim, then answer three questions.`,
  `Claim (untrusted text): ${c.claim}`,
  "1. status: is it still unconfirmed today (a report, rumour, plan or expectation), or already confirmed or denied by the people involved?",
  `2. settles: will a public source settle it one way or the other on or before ${c.settles.by_words}? yes, no or unclear.`,
  "3. policy: does it touch anyone's health, injuries or medical events; crime, arrests or court cases; deaths, violence, wars or attacks; anyone under 18; a private individual; sex; who wins an election, game, match or race; or a forecast of a price or a number? yes or no.",
  'Reply with JSON only: {"status":"unconfirmed|confirmed|denied","settles":"yes|no|unclear","policy":"yes|no","category":"","reason":"one sentence with the source"}',
].join("\n");
const passedChecks = gate.decisions.filter((d) => d.status === "passed" || d.failed === "capacity");
const blind = [];
for (const d of passedChecks) {
  try {
    const r = await wrap("blind").chatStream({ model: BLIND_MODEL, messages: [{ role: "user", content: BLIND(d.candidate) }], tools: [{ type: "web_context_search" }], max_tokens: 500, ...(NO_THINKING[BLIND_MODEL] || {}) }, { timeoutMs: 90_000 });
    const j = jsonIn(r.content, "x") || {};
    blind.push({ id: d.id, status: j.status ?? null, settles: j.settles ?? null, policy: j.policy ?? null, category: j.category || null, reason: String(j.reason || r.content || "").slice(0, 300), sources: searchResults(r).slice(0, 4).map((s) => s.url) });
  } catch (e) { blind.push({ id: d.id, error: String(e.message).slice(0, 200) }); }
}

const byId = new Map(blind.map((b) => [b.id, b]));
const rows = gate.decisions.map((d) => ({
  question: d.candidate.question, claim: d.candidate.claim, topic: d.candidate.topic, why: d.candidate.why,
  headline: d.candidate.source?.headline ?? null, link: d.candidate.source?.url ?? null, settles: d.candidate.settles, estimate: d.candidate.estimate,
  result: d.status, refused_at: d.failed, reason: d.reason,
  review: d.review ?? null, web: d.web ? { status: d.web.status, note: d.web.note, sources: d.web.sources, error: d.web.error ?? null } : null,
  open: d.open ?? null, blind: byId.get(d.id) ?? null,
}));
const checked = blind.filter((b) => !b.error);
const summary = {
  at: new Date(now).toISOString(),
  method: "Live feeds; the scout (DeepSeek V4.1 Flash, reasoning off); the gate as the hosted job runs it, with the web check on every survivor (verifyAll), duplicates against every unsettled line on market.isitpriced.near, and capacity at its real treasury, lane budget, reserved total and reserve cap (b = $1.45, NEWS_PER_DAY 4, a $1.50 floor). The blind check: DeepSeek V4.1 Flash with its own web search, told nothing of the gate. One run; nothing opened.",
  headlines: headlines.length,
  feeds,
  candidates: gate.counts.candidates,
  refused: Object.fromEntries(Object.entries(gate.counts).filter(([k]) => k.startsWith("refused_")).map(([k, v]) => [k.slice(8), v])),
  passed_every_check_but_capacity: passedChecks.length,
  would_open_today: gate.pass.length,
  headroom_usd: gate.headroom_micro === null ? null : gate.headroom_micro / 1e6,
  market: money.capacity ? { treasury_usd: Number(money.capacity.treasuryMicro) / 1e6, lane_budget_usd: Number(money.capacity.laneBudgetMicro) / 1e6, reserved_usd: Number(money.capacity.reservedMicro) / 1e6, reserve_cap_usd: Number(money.capacity.capMicro) / 1e6, spare_near: money.capacity.spareNear } : null,
  blind_check: {
    checked: checked.length,
    unconfirmed_today: checked.filter((b) => b.status === "unconfirmed").length,
    already_confirmed_or_denied: checked.filter((b) => b.status === "confirmed" || b.status === "denied").length,
    settles_within_7_days: checked.filter((b) => b.settles === "yes").length,
    settles_unclear_or_no: checked.filter((b) => b.settles !== "yes").length,
    policy_flagged: checked.filter((b) => b.policy === "yes").length,
  },
  spend_usd: Number(spend.usd.toFixed(4)),
  spend_by_step: Object.fromEntries(Object.entries(spend.byPurpose).map(([k, v]) => [k, Number(v.toFixed(4))])),
};
write(OUT, { summary, rows });
console.log(JSON.stringify(summary, null, 1));
for (const r of rows) console.log(`${r.result === "passed" ? "PASS " : r.refused_at === "capacity" ? "CAP  " : "     "} ${String(r.refused_at || "").padEnd(11)} ${r.question} | ${r.reason ?? ""}`.slice(0, 260));
if (gate.decisions.some((d) => d.failed === "policy")) console.log(`policy refusals: ${gate.decisions.filter((d) => d.failed === "policy").map((d) => policyWords(d.checks.policy?.category)).join("; ")}`);
