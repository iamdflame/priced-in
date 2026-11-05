// Opens the curated page's checkable lines on the MAINNET market at the planner model's own
// opening estimates.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/seed.mjs --plan     ask the planner, print, open nothing
//   CONFIRM_MAINNET=yes node scripts/mainnet/seed.mjs            open them
//   options: --page <slug, default tether> --b <USD of liquidity per line, default 1.5>
//
// The lines are the corpus page's `data` sentences (corpus/pages/<slug>.json, Wikipedia revision
// pinned), minus any that name a person: pages are about protocols, never people. The planner
// (DeepSeek V4.1 Flash on NEAR AI Cloud, reasoning off, the same model and prompt as the live
// paste flow in services/api/src/planner.mjs) labels each line and gives p, its probability that
// the line is true, clamped to 20-80%. A line it labels unfalsifiable or about a person is not
// opened. The owner opens each line with open_claim at that p and liquidity b; the market
// reserves the worst case, b ln(1/min(p, 1-p)), from the treasury, and the reserve cap set by
// fund.mjs bounds the total. Uses NEARAI_API_KEY1 (the testing credits): one call, about $0.002.
// Idempotent: a line already open on the page is skipped. Records everything in
// deployments/mainnet.json, including the planner's labels and estimates.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { labelSentences, PRICEABLE } from "../../services/api/src/planner.mjs";

if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
if (dep.network !== "mainnet") throw new Error("deployments/mainnet.json is not a mainnet deployment");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PLAN = process.argv.includes("--plan");
const PAGE = arg("--page", "tether");
const B = BigInt(Math.round(Number(arg("--b", "1.5")) * 1e6));
const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;

const RPCS = (env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.near.org").split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const owner = new Account(dep.root, provider, new KeyPairSigner(KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY)));
const M = dep.accounts.market;
const TGAS = 10n ** 12n;
const view = (method, args = {}, finality = "final") => provider.callFunction({ contractId: M, method, args, blockQuery: { finality } });

// ---------- the lines ----------
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, `corpus/pages/${PAGE}.json`), "utf8"));
const PEOPLE = /\b(Ardoino|Devasini|Pierce|Collins|Willett|Potter|Hoegner|Lutnick|Polosukhin|Skidanov)\b/;
const lines = corpus.sentences.filter((s) => s.class === "data" && !PEOPLE.test(s.text) && Buffer.byteLength(s.text) <= 600);
const open = new Map();
for (let from = 0; ; from += 100) {
  const page = await view("get_claims", { from, limit: 100 });
  for (const c of page) if (c.page === PAGE) open.set(c.text, c.id);
  if (page.length < 100) break;
}
console.log(`${lines.length} checkable lines on ${PAGE} (Wikipedia revision ${corpus.revid}); ${open.size} already open`);

// ---------- the planner's opening estimates ----------
const prev = dep.seed?.page === PAGE ? dep.seed : null;
let labels = prev?.planner?.labels || null;
if (!labels || labels.length !== lines.length) {
  if (!env.NEARAI_API_KEY1) throw new Error("NEARAI_API_KEY1 is not in .env");
  const t0 = Date.now();
  labels = await labelSentences({ apiKey: env.NEARAI_API_KEY1, baseUrl: "https://cloud-api.near.ai/v1", model: MODEL, timeoutMs: 90_000 }, lines.map((s) => s.text));
  console.log(`planner ${MODEL} labelled ${lines.length} lines in ${Date.now() - t0} ms`);
}
const plan = lines.map((s, i) => {
  const l = labels[i];
  const p = l && l.p0_ppm ? l.p0_ppm / 1e6 : null;
  const reserve = p ? Math.round(Number(B) * Math.log(1 / Math.min(p, 1 - p))) : 0;
  return { corpus_id: s.id, text: s.text, kind: l?.label || null, p0_ppm: l?.p0_ppm ?? null, reserve_micro: reserve, priceable: !!(l && PRICEABLE.has(l.label) && l.p0_ppm) };
});
for (const r of plan) console.log(`${r.priceable ? "open" : "skip"}  ${r.corpus_id}  ${r.kind ?? "-"}  ${r.p0_ppm ? (r.p0_ppm / 1e4).toFixed(0) + "%" : "  -"}  reserve ${fmt(r.reserve_micro)}  ${r.text.slice(0, 70)}`);
const stats = await view("stats");
const need = plan.filter((r) => r.priceable && !open.has(r.text)).reduce((a, r) => a + r.reserve_micro, 0);
console.log(`reserves needed ${fmt(need)}; treasury ${fmt(stats.treasury_micro)}, reserved ${fmt(stats.reserved_micro)}`);
dep.seed = {
  page: PAGE,
  source: `corpus/pages/${PAGE}.json, ${corpus.url || ""} revision ${corpus.revid}`,
  opening: `each line opened at the planner's own estimate (${MODEL}, reasoning off, the live paste prompt), clamped to 20-80%, with b = ${fmt(B)}`,
  planner: { model: MODEL, at: prev?.planner?.at || new Date().toISOString(), labels },
  claims: prev?.claims || [],
};
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
if (PLAN) process.exit(0);

// ---------- open ----------
const txs = [];
for (const r of plan) {
  if (!r.priceable || open.has(r.text)) continue;
  const s = await view("stats", {}, "optimistic");
  if (BigInt(s.treasury_micro) < BigInt(r.reserve_micro)) { console.log(`stop: the treasury (${fmt(s.treasury_micro)}) can't reserve ${fmt(r.reserve_micro)} for ${r.corpus_id}`); break; }
  try {
    const res = await owner.callFunctionRaw({ contractId: M, methodName: "open_claim", args: { text: r.text, page: PAGE, kind: r.kind, p0_ppm: r.p0_ppm, b_micro: String(B) }, gas: 60n * TGAS, deposit: 0n });
    const tx = res.transaction_outcome?.id;
    const failed = res.status && typeof res.status === "object" && "Failure" in res.status;
    if (failed) { console.log(`FAILED ${r.corpus_id}: ${JSON.stringify(res.status.Failure).slice(0, 200)}`); break; }
    const id = JSON.parse(Buffer.from(res.status.SuccessValue, "base64").toString());
    open.set(r.text, id);
    dep.seed.claims.push({ claim_id: id, corpus_id: r.corpus_id, kind: r.kind, p0_ppm: r.p0_ppm, b_micro: String(B), tx });
    txs.push({ tag: `open ${r.corpus_id}`, method: "open_claim", tx, link: `https://nearblocks.io/txns/${tx}` });
    console.log(`ok  claim ${id} ${r.corpus_id} at ${(r.p0_ppm / 1e4).toFixed(0)}%: tx ${tx}`);
  } catch (e) {
    console.log(`FAILED ${r.corpus_id}: ${String(e.message || e).slice(0, 200)}`);
    break;
  }
}
dep.transactions = [...(dep.transactions || []), ...txs];
const s4 = await view("stats", {}, "optimistic");
dep.seed.stats = { claims: s4.claims, treasury_micro: s4.treasury_micro, reserved_micro: s4.reserved_micro, at: new Date().toISOString() };
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
console.log(`${s4.claims} claims open; treasury ${fmt(s4.treasury_micro)}, reserved ${fmt(s4.reserved_micro)}; recorded in deployments/mainnet.json`);
