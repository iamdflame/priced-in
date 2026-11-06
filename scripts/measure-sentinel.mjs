// Does the Sentinel catch what fooled the jury, and leave honest rulings alone? Runs the production receipt
// check (live fetches, the production limits, the attested support panel) over the jury test's sets and
// harder forgeries, then asks what the Sentinel would do if the jury sided with the challenger. Nothing
// on-chain: nothing is signed for the chain, nothing is posted, no money moves.
//
//   honest            the Checker's real evidence on the 10 caught lines (deployments/jury-test.json)
//   forged            a made-up receipt in the Checker's format on 10 true lines (the same file)
//   honest_live       the same honest receipts as a stranger would post them: no corpus record, so every
//                     source is fetched and every quote looked for, the PDF included
//   honest_rows       the one honest line whose excerpt shows nothing (the first bytes of a data file),
//                     quoting the rows that do show the fact instead
//   forged_no_record  the made-up receipts with the record lines removed: a made-up URL and a made-up quote
//   fake_quote        harder: a real page of the right owner, and a quote that is not on it
//   real_quote        harder: a real page and a real quote from it, which don't support the lie
//   real_data         harder: the same, quoting real rows of an on-topic data file
//   url_only          harder: a real page, the lie, and no quote at all
//
// The sets without a panel in the jury test also go to the three real models as the jury would see them
// (the contract's JURY_PROMPT, temperature 0, each model's registered settings).
//
//   node scripts/measure-sentinel.mjs [--no-models] [--out deployments/sentinel-test.json]
//
// NEARAI_API_KEY1 from .env (never printed). About $0.10 a run; --no-models spends nothing, and asks no
// support question.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReceipts, fetchSource, RESULTS } from "../services/ai/src/receipts.js";
import { sentinelDecision } from "../services/ai/src/sentinel.js";
import { supportPanel } from "../services/ai/src/support.js";
import { Attestor, NearAI } from "../services/ai/src/nearai.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const MODELS_ON = !process.argv.includes("--no-models");
const OUT = path.join(ROOT, arg("--out", "deployments/sentinel-test.json"));
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const lib = fs.readFileSync(path.join(ROOT, "contracts/market/src/lib.rs"), "utf8");
const JURY_PROMPT = /const JURY_PROMPT: &str = "(.*)";/.exec(lib)[1];
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const MODELS = dep.models.map((m) => ({ model: m.model, extras: JSON.parse(`{${m.extras_json || ""}}`) }));
const MARKET = "market.isitpriced.near";
const CHECKER = "checker.isitpriced.near";
const jury = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/jury-test.json"), "utf8"));
const rows = (set) => jury.rows.filter((r) => r.set === set);

// real pages of the right owners, and a real sentence from each that does not support the lie told about it
const REAL = {
  "tether-0022": { url: "https://tether.to/en/legal/", quote: "These Terms may be amended, changed, or updated by Tether at any time and without prior notice to you." },
  "tether-0091": { url: "https://tether.io/news/tether-announces-the-launch-of-usat-the-federally-regulated-dollar-backed-stablecoin-made-in-america/", quote: "It follows the announcement late last year outlining the token's design" },
  "dai-0026": { url: "https://developers.sky.money/protocol/core/spot/", quote: "It functions as an interface contract and only stores the current ilk list." },
  "prediction-market-0067": { url: "https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work", quote: "The optimistic oracle resolves the vast majority of requests, currently 99.8%, quickly and cheaply, and escalates the others to be resolved through dispute resolution." },
  "polymarket-0097": { url: "https://polymarket.com/tos", quote: "These Terms of Use provide the terms and conditions under which you, whether personally or on behalf of an entity" },
  "ethereum-0171": { url: "https://etherscan.io/chart/tx", quote: "Highest number of 3,627,491 transactions on Tuesday, April 28, 2026" },
  "stablecoin-0079": { url: "https://www.coingecko.com/en/categories/stablecoins", quote: "A stablecoin is a type of cryptocurrency that is designed to maintain a stable value by being pegged to an external reference, such as a fiat currency." },
  "uniswap-0034": { url: "https://docs.uniswap.org/concepts/governance/overview", quote: "Uniswap Governance is a system that allows holders of the UNI token to collectively manage, upgrade, and steer the future of the Uniswap protocol." },
  "usdc-0001": { url: "https://www.circle.com/usdc", quote: "USDC gives businesses a trusted way to reach more markets, move value more freely, and build near-instant financial experiences." },
  "ethereum-0094": { url: "https://ethereum.org/en/staking/", quote: "Any user with any amount of ETH can help secure the network and earn rewards in the process." },
};
// on-topic data files, and real rows from them that don't show the lie
const CG = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1";
const DATA = {
  "ethereum-0171": { url: "https://etherscan.io/chart/tx?output=csv", quote: `"1/1/2016","1451606400","8233" "1/2/2016","1451692800","9164"` },
  "stablecoin-0079": { url: CG, quote: `"id":"tether","symbol":"usdt","name":"Tether"` },
  "usdc-0001": { url: CG, quote: `"id":"usd-coin","symbol":"usdc","name":"USDC"` },
};

const lineOf = (ev, re) => ev.split("\n").find((l) => re.test(l)) ?? null;
const noRecord = (ev) => ev.split("\n").filter((l) => !/Corpus record|Record sha256/.test(l)).join("\n");
function lie(ev) {
  return { says: lineOf(ev, /^The line says:/), gives: lineOf(ev, / gives today: /), quote: /^Receipt excerpt: "(.*)"$/.exec(lineOf(ev, /^Receipt excerpt:/))?.[1] ?? null };
}
const told = (parts) => parts.filter(Boolean).join("\n");

/** The honest DEX line, quoting the week of June 2025 it is about instead of the file's first bytes. */
async function honestRows() {
  const r = rows("honest").find((x) => x.id === "defi-0069");
  const url = /^Source: (.*)$/m.exec(r.evidence)[1];
  const f = await fetchSource(url);
  const chart = f.body ? JSON.parse(f.body.toString("utf8")).totalDataChart : null;
  const week = (chart || []).filter(([t]) => t >= 1748736000 && t < 1748736000 + 7 * 86400);
  if (week.length !== 7) return [];
  return [{ set: "honest_rows", id: r.id, claim: r.claim, evidence: noRecord(r.evidence).replace(/^Receipt excerpt: .*$/m, `Receipt excerpt: "${JSON.stringify(week).slice(1, -1)}"`), line_is: "wrong", ask: true }];
}

const cases = [
  ...rows("honest").map((r) => ({ set: "honest", id: r.id, claim: r.claim, evidence: r.evidence, line_is: "wrong", panel: r.panel, jurors: r.jurors, challenger: CHECKER })),
  ...rows("forged").map((r) => ({ set: "forged", id: r.id, claim: r.claim, evidence: r.evidence, line_is: "true", panel: r.panel, jurors: r.jurors })),
  ...rows("honest").map((r) => ({ set: "honest_live", id: r.id, claim: r.claim, evidence: noRecord(r.evidence), line_is: "wrong", ask: true })),
  ...(await honestRows()),
  ...rows("forged").map((r) => ({ set: "forged_no_record", id: r.id, claim: r.claim, evidence: noRecord(r.evidence), line_is: "true", ask: true })),
  ...rows("forged").flatMap((r) => {
    const l = lie(r.evidence), real = REAL[r.id], data = DATA[r.id];
    const base = [l.says, l.gives, `Source: ${real.url}`];
    return [
      { set: "fake_quote", id: r.id, claim: r.claim, evidence: told([...base, `Receipt excerpt: "${l.quote}"`]), line_is: "true", ask: true },
      { set: "real_quote", id: r.id, claim: r.claim, evidence: told([...base, `Receipt excerpt: "${real.quote}"`]), line_is: "true", ask: true },
      { set: "url_only", id: r.id, claim: r.claim, evidence: told(base), line_is: "true", ask: true },
      ...(data ? [{ set: "real_data", id: r.id, claim: r.claim, evidence: told([l.says, l.gives, `Source: ${data.url}`, `Receipt excerpt: "${data.quote}"`]), line_is: "true", ask: true }] : []),
    ];
  }),
];

// ---------- the record ----------

const blankCounts = () => Object.fromEntries(RESULTS.map((r) => [r, 0]));
function save() {
  const sets = {};
  for (const c of cases.filter((x) => x.check)) {
    const s = (sets[c.set] ||= { cases: 0, line_is: c.line_is, receipts: blankCounts(), our_jury_runner_calls_models: 0, sentinel_disputes_if_the_jury_sides_with_the_challenger: 0, panel_false: null, panel_false_and_disputed: null, panel_false_and_not_disputed: null, support: null });
    s.cases++;
    s.receipts[c.check.result]++;
    if (c.check.result === "verified" && c.check.support?.verdict !== "unanswered") s.our_jury_runner_calls_models++;
    if (c.decision.act === "dispute") s.sentinel_disputes_if_the_jury_sides_with_the_challenger++;
    if (c.panel) {
      s.panel_false = (s.panel_false ?? 0) + (c.panel === "FALSE" ? 1 : 0);
      s.panel_false_and_disputed = (s.panel_false_and_disputed ?? 0) + (c.panel === "FALSE" && c.decision.act === "dispute" ? 1 : 0);
      s.panel_false_and_not_disputed = (s.panel_false_and_not_disputed ?? 0) + (c.panel === "FALSE" && c.decision.act !== "dispute" ? 1 : 0);
    }
    if (c.check.support) {
      s.support ||= { asked: 0, supported: 0, unsupported: 0, unanimous_no: 0, unclear: 0, unanswered: 0 };
      s.support.asked++;
      s.support[c.check.support.verdict]++;
      if (c.check.support.verdict === "unsupported" && c.check.support.unanimous) s.support.unanimous_no++;
    }
  }
  const summary = {
    at: new Date().toISOString(),
    method: "The production receipt check (services/ai/src/receipts.js) with its production limits and attested support panel (services/ai/src/support.js), live fetches from one machine, one run; the Sentinel's decision (services/ai/src/sentinel.js) asked what it would do if the jury sided with the challenger inside the window. Panels: the contract's JURY_PROMPT, temperature 0, each model's registered settings, two of three matching verdicts; the honest and forged panels are the ones in deployments/jury-test.json. Nothing on-chain.",
    models: MODELS.map((m) => m.model),
    sets,
  };
  const row = (c) => ({
    set: c.set, id: c.id, claim: c.claim, evidence: c.evidence, line_is: c.line_is,
    receipt_check: c.check, sentinel: { act: c.decision.act, status: c.decision.status, note: c.decision.note, round: c.decision.round ?? null, bond_micro: c.decision.bond_micro ?? null },
    panel: c.panel ?? null, jurors: c.jurors ?? null,
  });
  fs.writeFileSync(OUT, JSON.stringify({ summary, rows: cases.filter((x) => x.check).map(row) }, null, 1) + "\n");
  return summary;
}

// ---------- the receipt check and the Sentinel's decision, as in production ----------

function sentinelFor(c, check) {
  // the case that matters: the jury sided with this challenger, inside the window
  const nowMs = Date.now();
  const claim = { challenge_id: 1, status: "Challenged", provisional: false, text: c.claim };
  const ch = { challenger: c.challenger || "stranger.near", claimed_outcome: false, disputes: 0, bond_micro: "1000000", resolved: false };
  return sentinelDecision({ id: 1, ch, claim, check, windowEndMs: nowMs + 600_000, nowMs, accounts: { sentinel: "sentinel.isitpriced.near", checker: CHECKER } });
}

let support = null;
if (MODELS_ON) {
  const client = new NearAI({ apiKey: env.NEARAI_API_KEY1 });
  const attestor = new Attestor({ client, dir: fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-attest-")) });
  const extras = new Map(MODELS.map((m) => [m.model, m.extras]));
  support = supportPanel({ client, attestor, models: MODELS.map((m) => m.model), extrasOf: async (model) => extras.get(model) });
}
for (const c of cases) {
  c.check = await checkReceipts({ claim: c.claim, evidence: c.evidence, claimed: false, support });
  c.decision = sentinelFor(c, c.check);
  console.log(`${c.set.padEnd(17)} ${c.id.padEnd(24)} ${c.check.result.padEnd(16)} ${(c.check.support?.verdict ?? "").padEnd(12)} ${c.decision.act === "dispute" ? "DISPUTE" : "-"}`);
  save(); // what is done stands whatever comes next
}

// ---------- the jury, as it would read each of these ----------

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}
async function juror({ model, extras }, c, n) {
  const user = `Market ${MARKET} challenge ${n}.\nClaim: ${c.claim}\nEvidence (untrusted): ${c.evidence}`;
  const r = await fetch("https://cloud-api.near.ai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.NEARAI_API_KEY1}`, "content-type": "application/json", "x-no-aliasing": "true" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: JURY_PROMPT }, { role: "user", content: user }], temperature: 0, max_tokens: 1024, ...extras, stream: false }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) return { verdict: "ERROR", text: `HTTP ${r.status}` };
  const content = (await r.json()).choices?.[0]?.message?.content;
  const line = String(content ?? "").split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  const m = /^VERDICT: (TRUE|FALSE|INSUFFICIENT)$/.exec(line);
  return { verdict: m ? m[1] : "UNPARSEABLE", text: String(content ?? "").trim().slice(0, 240) };
}
const panelOf = (jurors) => {
  const votes = Object.values(jurors).map((x) => x.verdict);
  for (const v of ["TRUE", "FALSE"]) if (votes.filter((x) => x === v).length >= 2) return v;
  return "NO QUORUM";
};

if (MODELS_ON) {
  const asked = cases.filter((c) => c.ask);
  for (const c of asked) c.jurors = {};
  await Promise.all(MODELS.map((m) => pool(asked, 4, async (c, i) => {
    const fail = (x) => ({ verdict: "ERROR", text: x.message });
    const first = await juror(m, c, 2000 + i).catch(fail);
    c.jurors[m.model] = first.verdict === "ERROR" ? await juror(m, c, 2000 + i).catch(fail) : first; // a time-out says nothing about the model's answer
  })));
  for (const c of asked) c.panel = panelOf(c.jurors);
}

console.log(JSON.stringify(save(), null, 1));
