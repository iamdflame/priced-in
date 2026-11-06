// The AI jury against our verified record. Every sentence the corpus decided (current, stale or wrong,
// each with receipts fetched on 2026-11-05) goes to the jury twice, with its exact request (the
// contract's JURY_PROMPT, temperature 0, each model's registered settings):
//   sources   the claim plus the matched source excerpts from corpus/receipts/extracts.json, each with
//             its URL, fetch time and the sha256 of what was fetched (corpus/receipts/evidence-index.json)
//   none      the claim with no evidence: the models' own knowledge, the "just ask an AI" baseline
// Right answers: TRUE for `current`, FALSE for `stale` and `wrong`. Two of three matching verdicts make
// the panel's ruling, as on-chain; anything else is no quorum (on-chain the bond is refunded and the
// line reopens). Nothing is signed or posted and no money moves.
//
//   node scripts/bench-jury.mjs [--out deployments/jury-bench.json] [--limit N]
//
// NEARAI_API_KEY1 from .env (never printed). Under $1 a run.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg("--out", "deployments/jury-bench.json"));
const LIMIT = Number(arg("--limit", "0")) || Infinity;
const POOL = 4;

const lib = fs.readFileSync(path.join(ROOT, "contracts/market/src/lib.rs"), "utf8");
const JURY_PROMPT = /const JURY_PROMPT: &str = "(.*)";/.exec(lib)[1];
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const MODELS = dep.models.map((m) => ({ model: m.model, extras: JSON.parse(`{${m.extras_json || ""}}`) }));
const MARKET = "market.isitpriced.near";

const extracts = JSON.parse(fs.readFileSync(path.join(ROOT, "corpus/receipts/extracts.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "corpus/receipts/evidence-index.json"), "utf8"));
const byUrl = new Map(Object.values(index).map((x) => [x.url, x]));
const sentence = new Map();
for (const f of fs.readdirSync(path.join(ROOT, "corpus/pages"))) {
  for (const s of JSON.parse(fs.readFileSync(path.join(ROOT, "corpus/pages", f), "utf8")).sentences || []) sentence.set(s.id, s.text);
}
const rows = fs.readFileSync(path.join(ROOT, "corpus/verdicts.tsv"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("¦"));
const facts = rows.filter((p) => ["current", "stale", "wrong"].includes(p[1]) && sentence.has(p[0])).slice(0, LIMIT).map(([id, verdict]) => ({ id, verdict, claim: sentence.get(id), right: verdict === "current" ? "TRUE" : "FALSE" }));

const clean = (s) => String(s).replace(/\s+/g, " ").trim();
function sourcesEvidence(id) {
  const rec = (extracts[id]?.receipts || []).slice(0, 3);
  const parts = rec.map((r, i) => {
    const meta = byUrl.get(r.url);
    const at = r.fetchedAt || meta?.fetchedAt;
    return `Source ${i + 1}: ${r.url}${at ? ` (fetched ${at.slice(0, 10)}${meta?.sha256 ? `, sha256 ${meta.sha256.slice(0, 16)}` : ""})` : ""}\nExcerpt: "${clean(r.match).slice(0, 700)}"`;
  });
  let s = parts.length ? parts.join("\n") : "No source excerpt.";
  while (Buffer.byteLength(s, "utf8") > 3900) s = s.slice(0, -64);
  return s;
}

const parse = (content) => {
  const line = String(content ?? "").split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  const m = /^VERDICT: (TRUE|FALSE|INSUFFICIENT)$/.exec(line);
  return m ? m[1] : "UNPARSEABLE";
};

async function juror({ model, extras }, claim, evidence, n) {
  const user = `Market ${MARKET} challenge ${n}.\nClaim: ${claim}\nEvidence (untrusted): ${evidence}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("https://cloud-api.near.ai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${env.NEARAI_API_KEY1}`, "content-type": "application/json", "x-no-aliasing": "true" },
        body: JSON.stringify({ model, messages: [{ role: "system", content: JURY_PROMPT }, { role: "user", content: user }], temperature: 0, max_tokens: 1024, ...extras, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 4000 * (attempt + 1))); continue; }
      if (!r.ok) return { verdict: "ERROR", text: `HTTP ${r.status}` };
      const content = (await r.json()).choices?.[0]?.message?.content;
      return { verdict: parse(content), text: clean(content).slice(0, 240) };
    } catch (e) { if (attempt === 2) return { verdict: "ERROR", text: e.message }; }
  }
  return { verdict: "ERROR", text: "retries exhausted" };
}

const jobs = [];
for (const [i, f] of facts.entries()) for (const set of ["sources", "none"]) jobs.push({ f, i, set, evidence: set === "sources" ? sourcesEvidence(f.id) : "None given." });
const out = jobs.map(() => ({}));
let done = 0;
await Promise.all(MODELS.map(async (m) => {
  let next = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < jobs.length) {
      const k = next++;
      out[k][m.model] = await juror(m, jobs[k].f.claim, jobs[k].evidence, 5000 + k);
      if (++done % 150 === 0) console.error(`${done} of ${jobs.length * MODELS.length} answers`);
    }
  }));
}));

const panelOf = (r) => {
  const votes = Object.values(r).map((x) => x.verdict);
  for (const v of ["TRUE", "FALSE"]) if (votes.filter((x) => x === v).length >= 2) return v;
  return "NO QUORUM";
};
const results = jobs.map((j, k) => ({ id: j.f.id, verdict: j.f.verdict, set: j.set, right_answer: j.f.right, panel: panelOf(out[k]), jurors: out[k], evidence: j.evidence }));
const tally = (set, kinds) => {
  const xs = results.filter((r) => r.set === set && kinds.includes(r.verdict));
  const n = (p) => xs.filter(p).length;
  return { facts: xs.length, right: n((r) => r.panel === r.right_answer), wrong: n((r) => r.panel !== "NO QUORUM" && r.panel !== r.right_answer), no_quorum: n((r) => r.panel === "NO QUORUM") };
};
const single = (set) => Object.fromEntries(MODELS.map(({ model }) => {
  const xs = results.filter((r) => r.set === set);
  const v = (r) => r.jurors[model]?.verdict;
  return [model, { right: xs.filter((r) => v(r) === r.right_answer).length, wrong: xs.filter((r) => ["TRUE", "FALSE"].includes(v(r)) && v(r) !== r.right_answer).length, abstained: xs.filter((r) => !["TRUE", "FALSE"].includes(v(r))).length, errors: xs.filter((r) => v(r) === "ERROR").length }];
}));
const summary = {
  at: new Date().toISOString(),
  method: "Every sentence corpus/verdicts.tsv decided (current, stale, wrong), with the jury's exact request: the contract's JURY_PROMPT, temperature 0, each model's registered settings. 'sources' gives the matched excerpts from the receipts fetched on 2026-11-05; 'none' gives no evidence. Panel = two of three matching verdicts. One run; nothing on-chain.",
  models: MODELS.map((m) => m.model),
  sources: { true_lines: tally("sources", ["current"]), false_lines: tally("sources", ["stale", "wrong"]), single_models: single("sources") },
  none: { true_lines: tally("none", ["current"]), false_lines: tally("none", ["stale", "wrong"]), single_models: single("none") },
};
fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
for (const r of results.filter((x) => x.set === "sources" && x.panel !== "NO QUORUM" && x.panel !== x.right_answer)) console.log(`WRONG ${r.verdict.padEnd(8)} ${r.id.padEnd(24)} panel ${r.panel} | ${Object.values(r.jurors).map((j) => j.verdict).join(" ")}`);
