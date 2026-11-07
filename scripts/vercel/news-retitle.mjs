// Corrects the question a news line shows when it asks more or less than the claim the market settles on.
// The claim on the chain never changes: only the screen's question does, and the old one is kept beside it
// (question_was, retitled_at). Made after the first live run (7 Nov 2026): three of its four questions asked
// something other than their claims, for example "Are the Colts trading Daniel Jones?" over "confirms trade
// discussions". The scout and the gate now refuse such lines; this mends the ones already open.
//
// The founder runs this. The store's token is read from .env, or else from the API project's settings on
// Vercel (with VERCEL_TOKEN), and is never printed.
//
//   node scripts/vercel/news-retitle.mjs <claim id> "<question>" [<claim id> "<question>" ...]   says what it would do
//   node scripts/vercel/news-retitle.mjs ... --apply                                             does it
import fs from "node:fs";
import path from "node:path";
import { ROOT, dotEnv, projectId, vercelApi } from "./env.mjs";
import { BlobState } from "../../api/_lib/store.mjs";
import { linesStore } from "../../api/_lib/news.mjs";

const APPLY = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => a !== "--apply");
if (!args.length || args.length % 2) { console.error('Give pairs: <claim id> "<question>"'); process.exit(1); }
const fixes = [];
for (let i = 0; i < args.length; i += 2) {
  const id = Number(args[i]), q = String(args[i + 1]).replace(/\s+/g, " ").trim();
  if (!Number.isSafeInteger(id) || id < 0) { console.error(`not a claim id: ${args[i]}`); process.exit(1); }
  const words = q.split(" ").length;
  if (!q.endsWith("?") || q.length > 140 || words > 14 || /[\p{Cc}\p{Cf}]/u.test(q)) { console.error(`#${id}: a question ends with "?", has at most 14 words and 140 characters, and no hidden characters`); process.exit(1); }
  fixes.push({ id, question: q });
}

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const env = dotEnv();
async function blobToken() {
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  const v = vercelApi(env);
  const pid = await projectId(v);
  const e = ((await v.call("GET", `/v10/projects/${pid}/env?decrypt=false`)).envs || []).find((x) => x.key === "BLOB_READ_WRITE_TOKEN" && (x.target || []).includes("production"));
  if (!e) throw new Error("BLOB_READ_WRITE_TOKEN is on neither .env nor the API project");
  return (await v.call("GET", `/v1/projects/${pid}/env/${e.id}`)).value;
}
const token = await blobToken().catch((e) => { console.error(e.message); process.exit(1); });
const store = linesStore(new BlobState({ prefix: `state/${dep.network}/${dep.accounts.market}`, token }));

const doc = await store.read();
for (const f of fixes) {
  const l = doc.lines?.[f.id];
  if (!l) { console.error(`#${f.id} is not a news line`); process.exit(1); }
  console.log(`#${f.id} claim: ${l.claim}\n    now: ${l.question}\n    new: ${f.question}${l.question_was ? `\n    (first: ${l.question_was})` : ""}`);
}
if (!APPLY) { console.log("plan only: nothing was changed. Add --apply to do it."); process.exit(0); }

const at = new Date().toISOString();
const r = await store.update((cur) => {
  const next = { ...cur, lines: { ...cur.lines } };
  for (const f of fixes) {
    const l = next.lines[f.id];
    if (!l || l.question === f.question) continue;
    next.lines[f.id] = { ...l, question: f.question, question_was: l.question_was ?? l.question, retitled_at: at };
  }
  return next;
});
const after = (await store.read()).lines;
for (const f of fixes) console.log(`${after[f.id]?.question === f.question ? "ok " : "NOT"} #${f.id}: ${after[f.id]?.question}`);
console.log(r.changed ? "saved. The site shows it within 5 minutes." : "nothing to change.");
