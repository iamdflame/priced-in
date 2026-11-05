// The keystore: one file per key in a git-ignored directory, created with exclusive-create so
// two writers (the house-agents script and a running signer issuing a key) can never clobber
// each other. Only the signer process and the house-agents script open it; the model process
// never does.
//
//   runner-<base58 public key>.json  { kind: "runner", publicKey, privateKey, label, persona_hash, created_at }
//       the function-call key a swarm agent was spawned with (market buy, sell, redeem)
//   operator-market.json             { kind: "operator", role: "market", accountId, receiverId, methods, publicKey, privateKey }
//   operator-swarm.json              { kind: "operator", role: "swarm",  ... }
//       the operator's function-call keys: anchor_rewrite and charge_inference on the market,
//       sweep_escrow on the swarm. None of them can move money anywhere but the treasury.

import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";

const fileOf = (dir, publicKey) => path.join(dir, `runner-${String(publicKey).replace(/^ed25519:/, "").replace(/[^A-Za-z0-9]/g, "")}.json`);

/** Write a key file that must not exist yet (mode 0600, directory 0700). */
export function writeKeyFile(file, rec) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeSync(fd, JSON.stringify(rec, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** A fresh runner key, saved before anyone sees its public key. */
export function newRunnerKey(dir, { label, persona_hash = null } = {}) {
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  writeKeyFile(fileOf(dir, publicKey), { kind: "runner", publicKey, privateKey: kp.toString(), label: label || "issued", persona_hash, created_at: new Date().toISOString() });
  return { publicKey, label: label || "issued", persona_hash };
}

/** An operator key file for a role, created if missing. Returns { rec, created }. */
export function operatorKey(dir, role, { accountId, receiverId, methods }) {
  const file = path.join(dir, `operator-${role}.json`);
  if (fs.existsSync(file)) return { rec: JSON.parse(fs.readFileSync(file, "utf8")), created: false, file };
  const kp = KeyPair.fromRandom("ed25519");
  const rec = { kind: "operator", role, accountId, receiverId, methods, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString(), created_at: new Date().toISOString() };
  writeKeyFile(file, rec);
  return { rec, created: true, file };
}

/** Everything in the keystore. Unreadable files are reported, never thrown. */
export function loadKeystore(dir) {
  const out = { runners: new Map(), operator: {}, errors: [] };
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (r.kind === "runner" && r.publicKey && r.privateKey) out.runners.set(r.publicKey, r);
      else if (r.kind === "operator" && r.role) out.operator[r.role] = r;
    } catch (e) { out.errors.push(`${f}: ${e.code || "bad JSON"}`); }
  }
  return out;
}

/** Public keys and labels only: what a caller outside the signer may see. */
export function publicView(ks) {
  return [...ks.runners.values()].map((r) => ({ publicKey: r.publicKey, label: r.label, persona_hash: r.persona_hash ?? null, created_at: r.created_at }));
}
