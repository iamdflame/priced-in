// The published attestation proofs verify offline, and nothing in them can be swapped unnoticed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBundle, verifyNrasToken, signerReport } from "../src/attestproof.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PROOFS = path.join(ROOT, "tools/judge/evidence/attestations");
const files = fs.existsSync(PROOFS) ? fs.readdirSync(PROOFS).filter((f) => f.endsWith(".json")) : [];
const load = (f) => {
  const proof = JSON.parse(fs.readFileSync(path.join(PROOFS, f), "utf8"));
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "services/ai/attestations", proof.bundle), "utf8"));
  return { proof, bundle, kept: { collateral: proof.collateral, jwks: proof.jwks, jwt: proof.gpu.jwt } };
};

test("every published proof verifies offline: the TDX quote, NVIDIA's token, and the bindings", { skip: !files.length && "no proofs published" }, async () => {
  assert.equal(files.length, 3, "one per jury model (the writer is one of them)");
  for (const f of files) {
    const { proof, bundle, kept } = load(f);
    const v = await checkBundle(bundle, kept);
    assert.equal(v.ok, true, `${proof.model}: ${v.failures.join("; ")}`);
    assert.equal(v.checks.intel_quote.tcb_status, "UpToDate");
    assert.equal(v.signer.signing_address, proof.signing_address);
    assert.equal(proof.registered.match, true, `${proof.model}: the key registered on mainnet`);
  }
});

test("a swapped signing key, a forged GPU token and stale collateral are each caught", { skip: !files.length && "no proofs published" }, async () => {
  const { bundle, kept } = load(files[0]);
  // another key in the report: report_data no longer binds it
  const swapped = structuredClone(bundle);
  const sr = signerReport(swapped);
  const flip = (hex) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
  sr.report.signing_address = flip(sr.report.signing_address);
  swapped.verified_signers[0].signing_address = sr.report.signing_address;
  const v1 = await checkBundle(swapped, kept);
  assert.equal(v1.ok, false);
  assert.match(v1.failures.join(" "), /report_data_binding/);
  // a token whose claims were edited: NVIDIA's signature fails
  const [h, p, s] = kept.jwt.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 1 })).toString("base64url")}.${s}`;
  assert.throws(() => verifyNrasToken(forged, kept.jwks, bundle.nonce), /does not verify/);
  assert.throws(() => verifyNrasToken(kept.jwt, { keys: [] }, bundle.nonce), /not in the kept key set/);
  assert.throws(() => verifyNrasToken(kept.jwt, kept.jwks, "00".repeat(32)), /nonce is not ours/);
  const v2 = await checkBundle(bundle, { ...kept, jwt: forged });
  assert.equal(v2.ok, false);
  assert.match(v2.failures.join(" "), /gpu/);
  // collateral checked at a time before Intel issued it is refused
  const early = { ...kept.collateral, fetched_at: "2020-01-01T00:00:00.000Z" };
  const v3 = await checkBundle(bundle, { ...kept, collateral: early });
  assert.equal(v3.ok, false);
  assert.match(v3.failures.join(" "), /intel_quote/);
});
