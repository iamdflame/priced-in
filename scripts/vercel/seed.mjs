// Seeds the hosted store (a private Vercel Blob store) with what already happened on the
// persistent testnet market, so the hosted site starts with its history:
//   rewrites.jsonl   the live run's NEAR AI Cloud rewrites (.apex-test/live/s1), then the judge's
//                    evidence record (tether:2:v4, anchored) last, so it is the latest of its id
//   ledger.jsonl     the writer's and the house agents' model calls and money intents (s1, s2)
//   rationales.jsonl the house agents' answers (s2)
//   signer.jsonl     the signer's journal for the same agents (s2): their intents are never re-sent
//   events.jsonl     the market events of every market transaction recorded so far, read from the chain
// Refuses when the store already holds journals, unless --force.
//   BLOB_READ_WRITE_TOKEN=... node scripts/vercel/seed.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { BlobState, JournalDir } from "../../api/_lib/store.mjs";
import { Rpc } from "../../services/api/src/rpc.mjs";
import { extractMarketEvents } from "../../services/api/src/events.mjs";

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
if (dep.network !== "testnet") throw new Error("testnet only");
const market = dep.accounts.market;
const live = path.join(ROOT, ".apex-test/live");
const state = new BlobState({ prefix: `state/testnet/${market}`, log: console.log });
const existing = await state.getDoc("journals/index.json");
if (existing && Object.keys(existing.value.files || {}).length && !process.argv.includes("--force")) {
  console.log(`the store already holds ${Object.keys(existing.value.files).join(", ")}: nothing seeded (--force to add anyway)`);
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-seed-"));
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()) : []);
const write = (name, ls) => fs.writeFileSync(path.join(dir, name), ls.map((l) => (typeof l === "string" ? l : JSON.stringify(l)) + "\n").join(""));

const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/judge/evidence/rewrite.json"), "utf8"));
if (evidence.market !== market) throw new Error("the evidence record is for another market");
write("rewrites.jsonl", [...lines(path.join(live, "s1/rewrites.jsonl")), { ...evidence.record, updatedAt: Math.max(evidence.record.updatedAt || 0, ...lines(path.join(live, "s1/rewrites.jsonl")).map((l) => JSON.parse(l).updatedAt || 0)) + 1 }]);
write("ledger.jsonl", [...lines(path.join(live, "s1/ledger.jsonl")), ...lines(path.join(live, "s2/ledger.jsonl"))]);
write("rationales.jsonl", lines(path.join(live, "s2/rationales.jsonl")));
write("signer.jsonl", lines(path.join(live, "s2/signer.jsonl")));

// market events, from the chain
const rpc = new Rpc(["https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com", "https://testnet-rpc.intea.rs", "https://rpc.testnet.near.org"], { timeoutMs: 10_000 });
const txs = new Map();
for (const l of lines(path.join(ROOT, ".apex/spikes/live/txs.jsonl"))) { const t = JSON.parse(l); if (t.ok && t.receiver === market) txs.set(t.tx, { sender: t.signer, height: t.block, ts: t.block_ts_ms }); }
for (const t of dep.seed?.trades || []) if (t.tx && !txs.has(t.tx)) txs.set(t.tx, { sender: t.signer || null, height: t.block });
for (const l of lines(path.join(live, "s2/rationales.jsonl"))) { const r = JSON.parse(l); if (r.tx_hash && !txs.has(r.tx_hash)) txs.set(r.tx_hash, { sender: r.account_id }); }
if (evidence.record.anchor?.tx_hash) txs.set(evidence.record.anchor.tx_hash, { sender: dep.root });
const events = [];
let n = 0;
for (const [hash, t] of txs) {
  const sender = t.sender || dep.root;
  for (let i = 0; i < 5; i++) {
    try {
      const tx = await rpc.txStatus(hash, sender, "FINAL", { timeoutMs: 10_000 });
      let height = t.height ?? null, ts = t.ts ?? null;
      if (!ts) { const b = await rpc.call("block", { block_id: tx.transaction_outcome.block_hash }); height = b.header.height; ts = Math.floor(Number(b.header.timestamp_nanosec) / 1e6); }
      for (const e of extractMarketEvents(tx, market)) events.push({ uid: e.uid, event: e.event, version: e.version, data: e.data, txHash: hash, receiptId: e.receiptId, signerId: tx.transaction.signer_id, blockHeight: height, blockTimestampMs: ts, seenAtMs: ts });
      break;
    } catch (e) { if (i === 4) console.log(`skip ${hash}: ${e.message.slice(0, 120)}`); else await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  if (++n % 25 === 0) console.log(`${n}/${txs.size} transactions read`);
}
events.sort((a, b) => (a.blockHeight ?? 0) - (b.blockHeight ?? 0));
write("events.jsonl", events);
const jd = new JournalDir(state, dir, { log: console.log });
const added = await jd.flushNow();
const counts = Object.fromEntries(fs.readdirSync(dir).map((f) => [f, lines(path.join(dir, f)).length]));
console.log(`seeded ${added} journals: ${JSON.stringify(counts)}; ${events.filter((e) => e.event === "trade").length} trade events`);
fs.rmSync(dir, { recursive: true, force: true });
