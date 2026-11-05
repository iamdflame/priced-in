// api/_data/pages.json: the paragraph structure the writer rewrites by (PAGES_FILE), for the
// curated pages on the market. A paragraph is a section of the pinned corpus article, as
// tools/judge/seed.mjs opened it; the claim ids come from the market's own get_claims.
//   node scripts/vercel/pages.mjs
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
const RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com", "https://testnet-rpc.intea.rs", "https://rpc.testnet.near.org"];

async function view(contractId, method, args) {
  let last;
  for (let i = 0; i < 12; i++) {
    const url = RPCS[i % RPCS.length];
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
      return JSON.parse(Buffer.from(j.result.result).toString("utf8"));
    } catch (e) { last = e; await new Promise((s) => setTimeout(s, 400 * (i + 1))); }
  }
  throw last;
}

const all = [];
for (let from = 0; ; from += 100) {
  const page = await view(dep.accounts.market, "get_claims", { from, limit: 100 });
  all.push(...page.map((c) => ({ ...c, id: c.claim_id ?? c.id })));
  if (page.length < 100) break;
}
const pages = {};
for (const slug of [...new Set(all.map((c) => c.page))]) {
  const f = path.join(ROOT, "corpus/pages", `${slug}.json`);
  if (!fs.existsSync(f)) continue;
  const corpus = JSON.parse(fs.readFileSync(f, "utf8"));
  const sectionOf = new Map(corpus.sentences.map((s) => [s.text, s.section]));
  const pc = all.filter((c) => c.page === slug).sort((a, b) => a.id - b.id);
  const sections = [...new Set(pc.map((c) => sectionOf.get(c.text)))];
  pages[slug] = { source: `corpus/pages/${slug}.json`, paragraphs: sections.map((sec) => pc.filter((c) => sectionOf.get(c.text) === sec).map((c) => c.id)) };
}
const out = path.join(ROOT, "api/_data/pages.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ note: "Paragraphs by corpus section, for the writer (PAGES_FILE). Made by scripts/vercel/pages.mjs from the market's get_claims.", market: dep.accounts.market, pages }, null, 1) + "\n");
console.log(`${out}: ${Object.entries(pages).map(([k, v]) => `${k} ${v.paragraphs.length} paragraphs`).join(", ")}`);
