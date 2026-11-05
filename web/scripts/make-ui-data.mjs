// Builds the UI's small data files from the repo's own records (run: node web/scripts/make-ui-data.mjs).
//   src/ui/data/corpus.json   page titles and revisions, the audit headline, and the out-of-date
//                             sentences with what their source says today (corpus/ERRORS.json)
//   src/ui/data/recorded.json the testnet deployment as recorded (deployments/testnet.json): the
//                             Tether page's 20 claims, the seed trades replayed with the exact LMSR,
//                             and the signed, anchored rewrite (tools/judge/evidence/rewrite.json).
// Nothing is invented: every price comes from replaying the recorded trades through web/src/core/lmsr.ts,
// and the replay must land on the prices the deployment recorded, or this script fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../src/core/lmsr.ts";
import { HOUSE_PERSONAS } from "../../services/ai/src/personas.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const out = path.join(here, "..", "src", "ui", "data");
const read = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), "utf8"));
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; } };

// ---------- corpus ----------
const manifest = read("corpus/MANIFEST.json");
const errors = read("corpus/ERRORS.json");
const pages = {};
for (const a of manifest.articles) pages[a.slug] = { title: a.title, url: a.url, revid: a.revid, attribution: a.attribution };
const textOf = new Map();
for (const slug of Object.keys(pages)) {
  const p = read(`corpus/pages/${slug}.json`);
  for (const s of p.sentences) textOf.set(s.id, { text: s.text, section: s.section, page: slug });
}
const today = errors.items.map((i) => {
  const r = (i.receipts || []).find((x) => /^https?:/.test(x.url));
  return { id: i.id, page: textOf.get(i.id)?.page ?? null, article: i.article, text: i.sentence, verdict: i.verdict, onPage: i.valueOnPage, today: i.valueToday, checkedOn: i.checkedOn, revision: i.revision, source: r ? r.url : null, sourceHost: r ? host(r.url) : null };
});
const corpus = {
  checkedOn: manifest.checkedOn,
  headline: { numerator: manifest.headline.numerator, denominator: manifest.headline.denominator, pages: manifest.articles.length },
  licence: { source: manifest.source, url: manifest.licenceUrl },
  pages,
  today,
  // the seeded page's paragraphs follow the corpus's sections (tools/judge/seed.mjs does the same)
  sections: { tether: Object.fromEntries(read("deployments/testnet.json").seed.claims.map((c) => [textOf.get(c.corpus_id).text, textOf.get(c.corpus_id).section])) },
  house: HOUSE_PERSONAS.map((h) => ({ name: h.persona.name.toLowerCase(), model: h.model, instructions: h.persona.instructions, maxBetUsd: h.persona.limits.maxBetUsd })),
};

// ---------- the recorded testnet deployment ----------
const dep = read("deployments/testnet.json");
const ev = read("tools/judge/evidence/rewrite.json");
const tether = read("corpus/pages/tether.json");
const byId = new Map(tether.sentences.map((s) => [s.id, s]));
const M = 1_000_000n;
const shortAcct = (a) => a.replace(/\.pimw3dxfzp\.basalt-lane-mw2skhdc\.testnet$/, "");
const verdictOf = new Map(dep.seed.claims.map((c) => [c.corpus_id, c.corpus_verdict]));
const claims = dep.seed.claims.map((c) => {
  const s = byId.get(c.corpus_id);
  return { id: c.claim_id, corpus_id: c.corpus_id, text: s.text, section: s.section, m: L.openMarket(3n * M * M, 500000n * M), trades: 0, volume: 0n, movers: [] };
});
const byCorpus = new Map(claims.map((c) => [c.corpus_id, c]));
const seedTx = new Map(dep.seed.trades.map((t) => [t.what, t]));
let t0 = Date.parse(dep.recorded_at) - 3600_000;
let seq = 0;
const events = [];
function trade(c, trader, side, amountMicro, tx) {
  const before = L.priceYes(c.m);
  const r = L.contractBuy(c.m, side, amountMicro);
  c.m = r.after;
  c.trades++;
  c.volume += amountMicro;
  const after = Number(L.priceYes(c.m) / M);
  const at = (t0 += 7000);
  const e = { seq: ++seq, uid: `rec-${seq}`, event: "trade", data: { claim_id: c.id, trader, side, shares_micro: String(r.sharesMicro), amount_micro: String(amountMicro), price_yes_ppm: after, balance_micro: "0" }, txHash: tx || undefined, blockTimestampMs: at };
  events.push(e);
  c.movers.unshift({ trader: shortAcct(trader), side, amountUsd: Number(amountMicro) / 1e6, priceBefore: Number(before / M) / 1e6, priceAfter: after / 1e6, txHash: tx || null, at });
}
// the order tools/judge/seed.mjs ran them in
for (const c of claims) trade(c, dep.seed.traders[0], "yes", 100000n, null);
for (const c of claims.filter((c) => verdictOf.get(c.corpus_id) === "stale")) trade(c, dep.seed.traders[1], "no", 2000000n, seedTx.get(`NO on a line the corpus found stale (${c.corpus_id})`)?.tx);
for (const c of claims.filter((c) => verdictOf.get(c.corpus_id) === "current").slice(0, 3)) trade(c, dep.seed.traders[2], "yes", 1000000n, seedTx.get(`YES on a line the corpus found current (${c.corpus_id})`)?.tx);
const lane = byCorpus.get("tether-0030");
trade(lane, dep.seed.traders[3], "no", 1000000n, seedTx.get("a no-wallet $1 lane bet, NO (tether-0030)")?.tx);
for (const c of dep.seed.claims) {
  const got = Number(L.priceYes(byCorpus.get(c.corpus_id).m) / M);
  if (got !== c.price_yes_ppm) throw new Error(`replay of claim ${c.claim_id} lands on ${got}, the deployment recorded ${c.price_yes_ppm}`);
}
const recorded = {
  note: "Recorded from the persistent NEAR testnet deployment. Prices are the recorded trades replayed with the contract's own LMSR; the rewrite is the signed, anchored record.",
  network: dep.network,
  recordedAt: dep.recorded_at,
  marketId: dep.accounts.market,
  rpc: dep.rpc,
  explorer: dep.explorer,
  page: "tether",
  title: tether.title,
  revision: tether.url,
  attribution: tether.attribution,
  claims: claims.map((c) => {
    const p = Number(L.priceYes(c.m) / M);
    return {
      id: c.id, text: c.text, section: c.section, page: "tether", kind: "data", price_yes_ppm: p,
      cost_up_10_micro: String(L.costToMoveMicro(c.m, true)), cost_down_10_micro: String(L.costToMoveMicro(c.m, false)),
      status: "Open", outcome: null, provisional: null, trades: c.trades, volume_micro: String(c.volume), price_yes: p / 1e6,
      volume_usd: Number(c.volume) / 1e6, b_micro: "3000000", movers: c.movers,
    };
  }),
  events,
  rewrite: { ...ev.record, provenance: { ...ev.record.provenance, anchor: { tx_hash: dep.rewrite.anchor_tx, sender_id: dep.root } } },
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "corpus.json"), JSON.stringify(corpus));
fs.writeFileSync(path.join(out, "recorded.json"), JSON.stringify(recorded));
console.log(`corpus.json ${fs.statSync(path.join(out, "corpus.json")).size} B, recorded.json ${fs.statSync(path.join(out, "recorded.json")).size} B; replay matches all ${claims.length} recorded prices`);
