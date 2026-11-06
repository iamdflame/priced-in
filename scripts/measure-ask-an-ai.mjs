// "Can't I just ask an AI?" Measures it, with no web access. Each sentence is put to the models the way a
// person would ask it, three times per model: the 10 caught sentences in corpus/ERRORS.json (true answer: no)
// and 6 sentences the corpus verified as current (true answer: yes), so a model can't score by doubting
// everything. "Yes" on a caught sentence repeats the stale or wrong claim.
//
//   node scripts/measure-ask-an-ai.mjs [--out deployments/ask-an-ai.json]
//
// NEAR AI Cloud models, with the key NEARAI_API_KEY1 from .env (never printed). About $0.03 a run.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(ROOT, arg("--out", "deployments/ask-an-ai.json"));
const MODELS = ["deepseek-ai/DeepSeek-V4.1-Flash-1017", "Qwen/Qwen3.8-27B", "z-ai/glm-5.3-flash"];
// the same settings the planner uses: reasoning off, so the budget goes to the answer
const SETTINGS = { "deepseek-ai/DeepSeek-V4.1-Flash-1017": { chat_template_kwargs: { thinking: false } }, "Qwen/Qwen3.8-27B": { chat_template_kwargs: { enable_thinking: false } }, "z-ai/glm-5.3-flash": { reasoning_effort: "low" } };
const RUNS = 3;
const TODAY = "6 November 2026";
const CONTROLS = ["tether-0022", "tether-0091", "dai-0026", "prediction-market-0067", "polymarket-0097", "ethereum-0171"];
const NO_VIEW = /can.?t (verify|confirm)|cannot (verify|confirm)|unable to (verify|confirm)|don.?t have (reliable|enough)|unconfirmed/i;

const pageOf = (slug) => JSON.parse(fs.readFileSync(path.join(ROOT, `corpus/pages/${slug}.json`), "utf8"));
const lookup = (id) => { const p = pageOf(id.replace(/-\d+$/, "")); return { title: p.title, text: p.sentences.find((s) => s.id === id).text }; };
const errors = JSON.parse(fs.readFileSync(path.join(ROOT, "corpus/ERRORS.json"), "utf8")).items;
const items = [
  ...errors.map((e) => ({ id: e.id, kind: "caught", truth: "no", title: lookup(e.id).title, text: e.sentence })),
  ...CONTROLS.map((id) => ({ id, kind: "control", truth: "yes", ...lookup(id) })),
];

async function ask(model, question) {
  const r = await fetch("https://cloud-api.near.ai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.NEARAI_API_KEY1}`, "content-type": "application/json" },
    body: JSON.stringify({ model, ...SETTINGS[model], stream: false, max_tokens: 700, messages: [
      { role: "system", content: `Today is ${TODAY}. Answer the question from what you know. Reply with one word first, Yes or No, then one short sentence.` },
      { role: "user", content: question },
    ] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  const text = String(j.choices?.[0]?.message?.content || "").trim();
  const m = /^\W*(yes|no)\b/i.exec(text);
  return { answer: m ? m[1].toLowerCase() : "unclear", text: text.slice(0, 220) };
}

const rows = [];
await Promise.all(MODELS.map(async (model) => {
  for (const it of items) {
    const question = `From the Wikipedia article "${it.title}": "${it.text}" Is this true today?`;
    const answers = [];
    for (let i = 0; i < RUNS; i++) answers.push(await ask(model, question).catch((x) => ({ answer: "error", text: x.message })));
    rows.push({ id: it.id, kind: it.kind, truth: it.truth, question, model, answers });
  }
}));

const pick = (kind) => rows.filter((r) => r.kind === kind).flatMap((r) => r.answers);
const count = (list, a) => list.filter((x) => x.answer === a).length;
const caught = pick("caught");
const control = pick("control");
const perFact = items.map((it) => {
  const mine = rows.filter((r) => r.id === it.id).flatMap((r) => r.answers);
  return { id: it.id, kind: it.kind, truth: it.truth, yes: count(mine, "yes"), no: count(mine, "no"), other: mine.length - count(mine, "yes") - count(mine, "no") };
});
const summary = {
  at: new Date().toISOString(),
  method: `Each sentence as "From the Wikipedia article ...: ... Is this true today?", told today's date, no sources, no web, reasoning off, ${RUNS} runs per model.`,
  models: MODELS,
  caught: { sentences: errors.length, answers: caught.length, repeated_the_error: count(caught, "yes"), said_no: count(caught, "no"), said_no_only_because_it_could_not_verify: caught.filter((x) => x.answer === "no" && NO_VIEW.test(x.text)).length, other: caught.length - count(caught, "yes") - count(caught, "no") },
  control: { sentences: CONTROLS.length, answers: control.length, right: count(control, "yes"), wrongly_doubted: count(control, "no"), other: control.length - count(control, "yes") - count(control, "no") },
};
fs.writeFileSync(OUT, JSON.stringify({ summary, perFact, rows }, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
for (const f of perFact) console.log(`${f.kind.padEnd(8)} ${f.id.padEnd(24)} yes ${f.yes} no ${f.no} other ${f.other}`);
