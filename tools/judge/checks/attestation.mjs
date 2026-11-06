// Check 10: the jury's and the writer's attestations, offline, and the keys the mainnet market holds.
// For each published proof (tools/judge/evidence/attestations/), the committed bundle it names
// (services/ai/attestations/) is checked again with no network: its Intel TDX quote with dcap-qvl and
// the Intel collateral kept in the proof, NVIDIA's NRAS token against NVIDIA's kept key, and the
// report's own bindings (our nonce, the signing key in report_data, the compose hash, the event log).
// The key it proves must be the key deployments/mainnet.json records and, online, the key get_model
// returns on market.isitpriced.near: the key the market checks every verdict's signature with.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export async function checkAttestations(repo, { mainnet = null, offline = false } = {}) {
  if (!fs.existsSync(path.join(repo, "node_modules/@phala/dcap-qvl"))) return { status: "SKIP", detail: "not installed: @phala/dcap-qvl (run npm ci)", see: "npm ci, then npm run judge" };
  const dir = path.join(repo, "tools/judge/evidence/attestations");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  if (!files.length) return { status: "FAIL", detail: "no published attestation proof in tools/judge/evidence/attestations", see: "node scripts/attestation/prove.mjs" };
  const { checkBundle } = await import(path.join(repo, "services/ai/src/attestproof.js").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
  const registered = new Map((mainnet?.dep?.models || []).map((m) => [m.model, String(m.signing_address_hex || "").toLowerCase()]));
  const bad = [], good = [];
  let collateralAt = null;
  for (const f of files) {
    const proof = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const name = proof.model || f;
    const bfile = path.join(repo, "services/ai/attestations", proof.bundle || f);
    if (!fs.existsSync(bfile)) { bad.push(`${name}: the bundle ${proof.bundle} is not committed`); continue; }
    const raw = fs.readFileSync(bfile);
    if (crypto.createHash("sha256").update(raw).digest("hex") !== proof.bundle_sha256) { bad.push(`${name}: the committed bundle is not the one the proof was made from`); continue; }
    const v = await checkBundle(JSON.parse(raw.toString("utf8")), { collateral: proof.collateral, jwks: proof.jwks, jwt: proof.gpu?.jwt });
    if (!v.ok) { bad.push(`${name}: ${v.failures.slice(0, 2).join("; ")}`); continue; }
    const key = String(v.signer?.signing_address || "").toLowerCase();
    if (key !== String(proof.signing_address).toLowerCase()) { bad.push(`${name}: the bundle proves ${key.slice(0, 16)}…, the proof says ${String(proof.signing_address).slice(0, 16)}…`); continue; }
    if (registered.size && registered.get(proof.model) !== key) { bad.push(`${name}: deployments/mainnet.json records ${registered.get(proof.model)?.slice(0, 16) ?? "no key"}…, the bundle proves ${key.slice(0, 16)}…`); continue; }
    let onChain = "not read (--offline)";
    if (!offline && mainnet?.rpc) {
      const m = await mainnet.rpc.view(mainnet.dep.accounts.market, "get_model", { model: proof.model });
      if (String(m?.signing_address_hex || "").toLowerCase() !== key) { bad.push(`${name}: get_model on ${mainnet.dep.accounts.market} returns ${m?.signing_address_hex?.slice(0, 16) ?? "nothing"}…, the bundle proves ${key.slice(0, 16)}…`); continue; }
      onChain = "= get_model";
    }
    collateralAt ||= proof.collateral?.fetched_at?.slice(0, 10);
    good.push(`${name.split("/").pop()} ${key.slice(0, 8)}… ${onChain}`);
  }
  if (bad.length) return { status: "FAIL", detail: bad.join(" | "), see: "node scripts/attestation/prove.mjs (fresh proofs), then npm run judge" };
  return {
    status: "PASS",
    detail: `${good.length} models: TDX quotes verified offline with dcap-qvl (Intel's collateral of ${collateralAt}, kept in each proof), NVIDIA's GPU tokens verified against NVIDIA's kept key, each report binding its signing key to our nonce; each key is the one ${mainnet?.dep?.accounts?.market ?? "the mainnet market"} holds (${good.join(", ")})`,
    see: "tools/judge/evidence/attestations/*.json · GET /api/attestations",
  };
}
