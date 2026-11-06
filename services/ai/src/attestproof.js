// Attestation proofs that anyone can check offline. For one committed bundle
// (services/ai/attestations/<model>.json, the report NEAR AI Cloud gave for our fresh nonce):
//   tdx   the Intel TDX quote, verified with dcap-qvl against Intel's collateral (PCK CRL, TCB info,
//         QE identity: each signed by Intel) as it was when we fetched it; the collateral is kept in
//         the proof, so the check runs again with no network, at that same time
//   gpu   NVIDIA's NRAS token for the GPU evidence: its ES384 signature checked here against the key
//         NVIDIA published (kept in the proof), the overall result true, and the token's nonce ours
//   bind  every other check verifyModelReport makes: the report's nonce is ours, report_data binds
//         the signing key and our nonce, MRCONFIGID is the compose file's hash, the event log
//         replays to RTMR3, debug is off
//   chain the signing key the bundle proves equals the key registered on the mainnet market
//         (get_model), the key the market verifies every juror's and the writer's signature with
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { verifyModelReport } from "./nearai.js";

const require = createRequire(import.meta.url);
let dcap = null;
export function dcapQvl() {
  dcap ||= require("@phala/dcap-qvl");
  return dcap;
}

const toJson = (col) => JSON.parse(JSON.stringify(col, (k, x) => (x instanceof Uint8Array || (Array.isArray(x) && k && /crl|signature/.test(k) && x.every((n) => Number.isInteger(n))) ? { hex: Buffer.from(x).toString("hex") } : x)));
const fromJson = (col) => JSON.parse(JSON.stringify(col), (k, x) => (x && typeof x === "object" && typeof x.hex === "string" && Object.keys(x).length === 1 ? [...Buffer.from(x.hex, "hex")] : x));

/** Intel's collateral for a quote, fetched now, in a form that survives JSON. */
export async function fetchCollateral(quoteBytes) {
  const q = dcapQvl();
  return { fetched_at: new Date().toISOString(), pccs: q.PHALA_PCCS_URL, data: toJson(await q.getCollateral(q.PHALA_PCCS_URL, Buffer.from(quoteBytes))) };
}

/** A quote verifier that needs no network: the kept collateral, at the time it was fetched. */
export function offlineQuoteVerifier(collateral) {
  const at = Math.floor(Date.parse(collateral.fetched_at) / 1000);
  const fn = async (quoteBytes) => {
    const v = dcapQvl().verify(Buffer.from(quoteBytes), fromJson(collateral.data), at);
    return { status: v.status, advisory_ids: v.advisory_ids || [], type: v.report?.type, data: v.report?.data };
  };
  fn.label = `dcap-qvl (offline: Intel's collateral as fetched ${collateral.fetched_at}, kept in the proof)`;
  return fn;
}

/** Verify an NRAS token: ES384 over header.payload with the published key of its kid. */
export function verifyNrasToken(jwt, jwks, nonceHex) {
  const [h, p, s] = String(jwt).split(".");
  if (!h || !p || !s) throw new Error("the GPU token is not a JWT");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  if (header.alg !== "ES384") throw new Error(`the GPU token is signed with ${header.alg}, not ES384`);
  const jwk = (jwks?.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`NVIDIA's key ${header.kid} is not in the kept key set`);
  const key = crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
  const ok = crypto.verify("sha384", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  if (!ok) throw new Error("the GPU token's signature does not verify against NVIDIA's key");
  if (claims["x-nvidia-overall-att-result"] !== true) throw new Error("NVIDIA's overall attestation result is not true");
  if (nonceHex && String(claims.eat_nonce || "").toLowerCase() !== nonceHex.toLowerCase()) throw new Error("the GPU token's nonce is not ours");
  return { kid: header.kid, iat: claims.iat, exp: claims.exp, iss: claims.iss, overall: true, eat_nonce: claims.eat_nonce };
}

/** A GPU verifier that needs no network: the token NRAS gave us, checked against NVIDIA's kept key. */
export function offlineGpuVerifier(jwt, jwks) {
  const fn = async (payloadText, nonceHex) => {
    const payload = JSON.parse(payloadText);
    if (typeof payload.nonce !== "string" || payload.nonce.toLowerCase() !== nonceHex.toLowerCase()) throw new Error("GPU evidence nonce does not match ours");
    return { ok: true, arch: payload.arch ?? null, gpus: payload.evidence_list?.length ?? null, ...verifyNrasToken(jwt, jwks, nonceHex) };
  };
  fn.label = "NVIDIA NRAS token, ES384 signature checked offline against NVIDIA's published key (kept in the proof)";
  return fn;
}

/** The candidate report in a bundle for its verified signer. */
export function signerReport(bundle) {
  const want = bundle.verified_signers?.[0]?.signing_address?.toLowerCase();
  const list = bundle.report?.model_attestations || [];
  const i = list.findIndex((r) => String(r.signing_address || "").toLowerCase() === want);
  return i >= 0 ? { report: list[i], index: i, stored: bundle.verification?.[i] ?? null } : null;
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * Check a bundle with the kept evidence only. Returns the proof's verdicts (no network).
 * @param {object} bundle the committed attestation bundle
 * @param {{ collateral: object, jwks: object, jwt?: string }} kept
 */
export async function checkBundle(bundle, kept) {
  const sr = signerReport(bundle);
  if (!sr) return { ok: false, failures: ["the bundle has no report for its verified signer"], checks: {} };
  const jwt = kept.jwt ?? sr.stored?.checks?.gpu?.jwt ?? null;
  const v = await verifyModelReport(sr.report, bundle.nonce, { quoteVerifier: offlineQuoteVerifier(kept.collateral), gpuVerifier: jwt ? offlineGpuVerifier(jwt, kept.jwks) : null, requireGpu: true });
  return { ok: v.ok, failures: v.failures, checks: v.checks, signer: v.signer };
}

/** The published proof for one bundle file, from fresh collateral and NVIDIA's current key set. */
export async function proveBundle(file, { jwks, getModel = null, network = "mainnet", market = null }) {
  const raw = fs.readFileSync(file);
  const bundle = JSON.parse(raw.toString("utf8"));
  const sr = signerReport(bundle);
  if (!sr) throw new Error(`${path.basename(file)}: no report for the verified signer`);
  const collateral = await fetchCollateral(Buffer.from(sr.report.intel_quote, "hex"));
  const jwt = sr.stored?.checks?.gpu?.jwt ?? null;
  const kid = jwt ? JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString("utf8")).kid : null;
  const keptJwks = { keys: (jwks?.keys || []).filter((k) => k.kid === kid) };
  const v = await checkBundle(bundle, { collateral, jwks: keptJwks, jwt });
  const signing = (v.signer?.signing_address || bundle.verified_signers?.[0]?.signing_address || "").toLowerCase();
  let registered = null;
  if (getModel) {
    try { registered = await getModel(bundle.model); } catch (e) { registered = { error: e.message }; }
  }
  const q = v.checks.intel_quote || {};
  const g = v.checks.gpu || {};
  return {
    model: bundle.model,
    bundle: path.basename(file),
    bundle_sha256: sha256(raw),
    fetched_at: bundle.fetched_at,
    nonce: bundle.nonce,
    signing_address: signing,
    signing_algo: v.signer?.signing_algo ?? "ed25519",
    verified: v.ok,
    failures: v.failures,
    tdx: { verified: q.ok === true, tcb_status: q.tcb_status ?? null, advisory_ids: q.advisory_ids ?? [], verifier: q.verifier ?? null, error: q.error ?? null },
    gpu: { verified: g.ok === true, verifier: g.verifier ?? null, kid: g.kid ?? null, iat: g.iat ?? null, exp: g.exp ?? null, gpus: g.gpus ?? null, arch: g.arch ?? null, error: g.error ?? null, jwt },
    binding: Object.fromEntries(["signer", "nonce_echo", "report_data_binding", "mr_config_id", "rtmr3_event_log", "debug_off"].map((k) => [k, v.checks[k]?.ok === true])),
    registered: { network, market, get_model: registered && !registered.error ? registered : null, error: registered?.error ?? null, match: Boolean(registered?.signing_address_hex && registered.signing_address_hex.toLowerCase() === signing), read_at: new Date().toISOString() },
    collateral,
    jwks: keptJwks,
    check: "npm run judge (check 10) runs this again offline: tools/judge/checks/attestation.mjs",
  };
}
