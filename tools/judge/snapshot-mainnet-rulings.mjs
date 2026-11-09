#!/usr/bin/env node
// Writes the evidence check 11 needs to verify the mainnet jury offline, and nothing it can re-read:
//   tools/judge/evidence/mainnet-rulings.json  per verdict: challenge id, model, the submit_verdict
//     transaction (hash and signer), and its bytes: the request (canonical_request), the response
//     and the signature, taken from the transaction's own arguments.
//   tools/judge/evidence/rewrite-mainnet.json  the latest anchored rewrite on the mainnet market,
//     with its request and response bytes, as GET /api/rewrites gives it.
// The site gives only pointers (transaction hashes); every byte is read from mainnet. Reads only:
// it holds no key and sends no transaction.
//
//   node tools/judge/snapshot-mainnet-rulings.mjs [--site=https://isitpriced.com]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Rpc, MAINNET_RPCS, marketEvents } from "./lib/near.mjs";
import { submitVerdictArgs, sha256hex, pool } from "./lib/verdicts.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = (process.argv.find((a) => a.startsWith("--site="))?.slice(7) || process.env.SITE_URL || "https://isitpriced.com").replace(/\/$/, "");
const dep = JSON.parse(fs.readFileSync(path.join(REPO, "deployments/mainnet.json"), "utf8"));
const M = dep.accounts.market;
const rpc = new Rpc(MAINNET_RPCS);

const getJson = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

// ---------- the jury ----------
const rulings = (await getJson(`${SITE}/api/rulings`)).rulings || [];
const pointers = [];
for (const r of rulings) for (const v of r.verdicts || []) if (v.tx) pointers.push({ challenge_id: Number(r.challenge_id), model: v.model, tx_hash: v.tx });
pointers.sort((a, b) => a.challenge_id - b.challenge_id || a.model.localeCompare(b.model));
const height = await rpc.finalHeight();
const verdicts = await pool(pointers, 4, async (p) => {
  const tx = await rpc.tx(p.tx_hash, M); // the sender only routes the lookup; the real one is recorded
  const a = submitVerdictArgs(tx, M);
  if (!a) throw new Error(`${p.tx_hash} holds no submit_verdict call to ${M}`);
  if (!a.ok) throw new Error(`${p.tx_hash}: the market's receipt failed`);
  if (a.challenge_id !== p.challenge_id || a.model !== p.model) throw new Error(`${p.tx_hash} is challenge ${a.challenge_id} by ${a.model}, the site says challenge ${p.challenge_id} by ${p.model}`);
  const request = await rpc.view(M, "canonical_request", { challenge_id: p.challenge_id, model: p.model }, { blockId: height });
  return { challenge_id: p.challenge_id, model: p.model, tx_hash: p.tx_hash, sender_id: a.signer, request_b64: Buffer.from(request, "utf8").toString("base64"), response_b64: a.response.toString("base64"), signature_hex: a.signature_hex };
});
const out = {
  note: "Pointers and bytes only, for check 11 (npm run judge). Each verdict: its submit_verdict transaction on mainnet, and the request (the market's canonical_request), response and signature bytes, so --offline can still check the hashes and signatures. Every other fact (the stored hashes, the keys, the outcomes, the books) is read from the chain by the check. Remake with node tools/judge/snapshot-mainnet-rulings.mjs.",
  market: M,
  source: `pointers from GET ${SITE}/api/rulings (verdicts[].tx); bytes from each transaction's arguments on mainnet; requests from canonical_request at block ${height}`,
  made_at: new Date().toISOString(),
  verdicts,
};
fs.writeFileSync(path.join(REPO, "tools/judge/evidence/mainnet-rulings.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`mainnet-rulings.json: ${verdicts.length} verdicts on ${new Set(verdicts.map((v) => v.challenge_id)).size} challenges`);

// ---------- one anchored rewrite ----------
const list = ((await getJson(`${SITE}/api/rewrites`)).rewrites || [])
  .filter((r) => r.status === "signed" && r.provenance?.request_b64 && r.provenance?.response_b64 && (r.anchor?.tx_hash || r.provenance?.anchor?.tx_hash))
  .sort((a, b) => (b.anchor?.at || 0) - (a.anchor?.at || 0));
let wrote = null;
for (const rec of list) {
  const p = rec.provenance, hash = p.anchor?.tx_hash || rec.anchor.tx_hash;
  const tx = await rpc.tx(hash, M).catch(() => null);
  const hit = tx && marketEvents(tx, M).find((d) => d.event === "rewrite" && d.request_hash === sha256hex(Buffer.from(p.request_b64, "base64")) && d.response_hash === sha256hex(Buffer.from(p.response_b64, "base64")));
  if (!hit) continue;
  const record = { ...rec, provenance: { ...p, anchor: { tx_hash: hash, sender_id: tx.transaction.signer_id } } };
  const ev = {
    note: `One rewrite anchored on the mainnet market, produced by services/ai's writer on NEAR AI Cloud and signed by ${p.model}'s TEE key. Recorded from GET ${SITE}/api/rewrites; check 11 verifies its bytes, hashes and signature, the key the market holds and the anchor_rewrite event in ${hash}.`,
    writer_key: "nearai",
    model: p.model,
    signer: p.signing_address,
    market: M,
    record,
  };
  fs.writeFileSync(path.join(REPO, "tools/judge/evidence/rewrite-mainnet.json"), JSON.stringify(ev, null, 1) + "\n");
  wrote = `${rec.id}, anchored in ${hash}`;
  break;
}
console.log(wrote ? `rewrite-mainnet.json: ${wrote}` : "rewrite-mainnet.json: no anchored mainnet rewrite found, file left as it was");
