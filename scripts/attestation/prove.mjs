// Publishes one attestation proof per jury and writer model (tools/judge/evidence/attestations/), from
// the committed bundles in services/ai/attestations/:
//   node scripts/attestation/prove.mjs
// For each bundle: Intel's collateral for its TDX quote (from Phala's PCCS) and NVIDIA's published
// key set are fetched once and kept in the proof, every check is run with them, offline, and the
// signing key is compared with get_model on the mainnet market. Reads only: no key, no transaction.
// GET /api/attestations serves the proofs; npm run judge (check 10) runs them again offline.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proveBundle } from "../../services/ai/src/attestproof.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "services/ai/attestations");
const OUT = path.join(ROOT, "tools/judge/evidence/attestations");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const RPCS = ["https://rpc.fastnear.com", "https://near.drpc.org", "https://free.rpc.fastnear.com"];

async function getModel(model) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: dep.accounts.market, method_name: "get_model", args_base64: Buffer.from(JSON.stringify({ model })).toString("base64") } }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
      return { ...JSON.parse(Buffer.from(j.result.result).toString("utf8")), rpc: url, block_height: j.result.block_height };
    } catch (e) { last = e; }
  }
  throw last;
}

const jwks = await (await fetch("https://nras.attestation.nvidia.com/.well-known/jwks.json", { signal: AbortSignal.timeout(15_000) })).json();
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith(".json")).sort()) {
  const proof = await proveBundle(path.join(SRC, f), { jwks, getModel, network: "mainnet", market: dep.accounts.market });
  fs.writeFileSync(path.join(OUT, f), JSON.stringify(proof, null, 1) + "\n");
  const ok = proof.verified && proof.registered.match;
  bad += ok ? 0 : 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${proof.model}: TDX ${proof.tdx.verified ? `verified (${proof.tdx.tcb_status})` : `not verified: ${proof.tdx.error}`}; GPU ${proof.gpu.verified ? `verified (NRAS token ${proof.gpu.kid?.slice(0, 24)}…)` : `not verified: ${proof.gpu.error}`}; binding ${Object.values(proof.binding).every(Boolean) ? "ok" : JSON.stringify(proof.binding)}; key ${proof.signing_address.slice(0, 16)}… ${proof.registered.match ? "= get_model on mainnet" : `≠ get_model on mainnet (${proof.registered.get_model?.signing_address_hex?.slice(0, 16) ?? proof.registered.error})`}`);
}
console.log(`wrote ${path.relative(ROOT, OUT)}`);
process.exit(bad ? 1 : 0);
