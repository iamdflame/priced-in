// Opens chosen corpus lines as markets on the MAINNET market, at the planner model's own estimates.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/open-lines.mjs --ids ethereum-0172,uniswap-0035 --plan
//   CONFIRM_MAINNET=yes node scripts/mainnet/open-lines.mjs --ids ethereum-0172,uniswap-0035 [--b 1.45]
//
// Each id is a corpus sentence (corpus/pages/<slug>.json). The planner (DeepSeek V4.1 Flash on NEAR
// AI Cloud, reasoning off, the live paste prompt, NEARAI_API_KEY1) labels each line and gives p, clamped
// to 20-80%. A line it labels unfalsifiable or about a person is skipped and said so. The owner opens
// each with open_claim; the market reserves b ln(1/min(p, 1-p)) from the treasury, within the reserve
// cap. Idempotent: a line already open is skipped. Records in deployments/mainnet.json (lines_opened).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { labelSentences, PRICEABLE } from "../../services/api/src/planner.mjs";

if (process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const depFile = path.join(ROOT, "deployments/mainnet.json");
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PLAN = process.argv.includes("--plan");
const ids = String(arg("--ids", "")).split(",").map((s) => s.trim()).filter(Boolean);
if (!ids.length) { console.error("give --ids <corpus ids>"); process.exit(1); }
const B = BigInt(Math.round(Number(arg("--b", "1.45")) * 1e6));
const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;

const RPCS = "https://near.drpc.org,https://rpc.fastnear.com,https://free.rpc.fastnear.com".split(",");
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const owner = new Account(dep.root, provider, new KeyPairSigner(KeyPair.fromString(env.NEAR_DEPLOYER_PRIVATE_KEY)));
const M = dep.accounts.market;
const TGAS = 10n ** 12n;
const view = (method, args = {}, finality = "final") => provider.callFunction({ contractId: M, method, args, blockQuery: { finality } });

const lines = ids.map((id) => {
  const slug = id.replace(/-\d+$/, "");
  const page = JSON.parse(fs.readFileSync(path.join(ROOT, `corpus/pages/${slug}.json`), "utf8"));
  const s = page.sentences.find((x) => x.id === id);
  if (!s) throw new Error(`no sentence ${id}`);
  return { id, page: slug, text: s.text };
});
const open = new Set();
for (let from = 0; ; from += 100) {
  const page = await view("get_claims", { from, limit: 100 });
  for (const c of page) open.add(c.text);
  if (page.length < 100) break;
}
const labels = await labelSentences({ apiKey: env.NEARAI_API_KEY1, baseUrl: "https://cloud-api.near.ai/v1", model: MODEL, timeoutMs: 90_000 }, lines.map((l) => l.text));
const plan = lines.map((l, i) => {
  const lab = labels[i];
  const p = lab?.p0_ppm ? lab.p0_ppm / 1e6 : null;
  return { ...l, kind: lab?.label || null, p0_ppm: lab?.p0_ppm ?? null, priceable: !!(lab && PRICEABLE.has(lab.label) && lab.p0_ppm), already: open.has(l.text), reserve_micro: p ? Math.round(Number(B) * Math.log(1 / Math.min(p, 1 - p))) : 0 };
});
for (const r of plan) console.log(`${r.already ? "open already" : r.priceable ? "open" : "skip"}  ${r.id}  ${r.kind ?? "-"}  ${r.p0_ppm ? (r.p0_ppm / 1e4).toFixed(0) + "%" : "-"}  reserve ${fmt(r.reserve_micro)}  ${r.text.slice(0, 70)}`);
const need = plan.filter((r) => r.priceable && !r.already).reduce((a, r) => a + r.reserve_micro, 0);
const s0 = await view("stats");
console.log(`reserves needed ${fmt(need)}; treasury ${fmt(s0.treasury_micro)}, reserved ${fmt(s0.reserved_micro)}`);
if (PLAN) process.exit(0);

const opened = [];
for (const r of plan) {
  if (!r.priceable || r.already) continue;
  const res = await owner.callFunctionRaw({ contractId: M, methodName: "open_claim", args: { text: r.text, page: r.page, kind: r.kind, p0_ppm: r.p0_ppm, b_micro: String(B) }, gas: 60n * TGAS, deposit: 0n });
  const tx = res.transaction_outcome?.id;
  if (res.status && typeof res.status === "object" && "Failure" in res.status) { console.log(`FAILED ${r.id}: ${JSON.stringify(res.status.Failure).slice(0, 200)}`); break; }
  const id = JSON.parse(Buffer.from(res.status.SuccessValue, "base64").toString());
  opened.push({ claim_id: id, corpus_id: r.id, page: r.page, kind: r.kind, p0_ppm: r.p0_ppm, b_micro: String(B), tx, model: MODEL });
  console.log(`ok  claim ${id} ${r.id} at ${(r.p0_ppm / 1e4).toFixed(0)}%: tx ${tx}`);
}
dep.lines_opened = [...(dep.lines_opened || []), ...opened];
fs.writeFileSync(depFile, JSON.stringify(dep, null, 1) + "\n");
const s1 = await view("stats", {}, "optimistic");
console.log(`${s1.claims} claims open; treasury ${fmt(s1.treasury_micro)}, reserved ${fmt(s1.reserved_micro)}; recorded in deployments/mainnet.json`);
