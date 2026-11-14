// What "locked" means for the market account, shared by check 12 (tools/judge/checks/lock.mjs) and the
// owner's script that locks it (scripts/mainnet/lock-market.mjs). Pure functions: no network, no key.
//
// On NEAR a contract's code changes in one of two ways: a DeployContract action signed with a key of
// the contract's own account, or the contract deploying over itself from its own code. So a market is
// locked when both are closed:
//   keys     its account has no access key at all. A key there could also send the market's USDC
//            straight out through the USDC contract, and call the market's #[private] callbacks;
//   source   its code makes promises only as function calls, so it deploys nothing, adds no key,
//            deletes no account and sends no NEAR.
// The second is read from the source, which check 3 ties to the code on chain by rebuilding it. The
// wasm's import table can't show it: near-sdk links every promise action into every contract, whether
// or not its source uses one.
import fs from "node:fs";
import path from "node:path";

const full = (k) => k?.access_key?.permission === "FullAccess";

/** An account's keys as counts. Locked means none: a function-call key still signs as the account. */
export function keyState(keys = []) {
  const f = keys.filter(full).length;
  return { keys: keys.length, full: f, functionCall: keys.length - f, locked: keys.length === 0 };
}

/** The Rust sources compiled into the market: the contract and the two crates it depends on. */
export const MARKET_SOURCES = ["contracts/market/src", "crates/lmsr/src", "crates/rules/src"];

export function marketSources(repo, dirs = MARKET_SOURCES) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".rs")) out.push({ file: path.relative(repo, p).replace(/\\/g, "/"), text: fs.readFileSync(p, "utf8") });
    }
  };
  for (const d of dirs) walk(path.join(repo, d));
  return out;
}

// every promise action of near-sdk 5 except function_call, and the raw host calls under them
const ACTION = /\.\s*(create_account|deploy_contract|deploy_global_contract\w*|use_global_contract\w*|transfer|stake|add_full_access_key\w*|add_access_key\w*|delete_key|delete_account)\s*\(|promise_batch_action_\w+|\bsys::\w+/g;

/**
 * Every promise the sources make. `forbidden` lists each action that isn't a function call, with its
 * file and line. Comment lines are skipped, so prose about an action isn't counted as one.
 * @param {{ file: string, text: string }[]} sources
 */
export function promiseScan(sources) {
  let promises = 0, functionCalls = 0;
  const forbidden = [];
  for (const { file, text } of sources) {
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith("//")) return;
      promises += (line.match(/\bPromise::new\s*\(/g) || []).length;
      functionCalls += (line.match(/\.\s*function_call(_weight)?\s*\(/g) || []).length;
      for (const m of line.matchAll(ACTION)) forbidden.push({ file, line: i + 1, what: (m[1] || m[0]).trim() });
    });
  }
  return { promises, functionCalls, forbidden, ok: forbidden.length === 0 && promises > 0 && functionCalls >= promises };
}

/**
 * Whether the owner's script may delete the market's keys, and in which order. It refuses unless the
 * code on chain is the recorded code, the signing key is a full-access key on the market and also on
 * the owner (so the owner keeps its own account and every owner method), and the owner is not the
 * market itself. The signing key goes last: it signs every deletion, its own included.
 */
export function lockPlan({ market, owner, marketKeys = [], ownerKeys = [], codeHash, recordedHash, signerPk = null }) {
  const refusals = [];
  const st = keyState(marketKeys);
  if (st.locked) return { already: true, refusals, order: [] };
  if (!recordedHash) refusals.push("deployments/mainnet.json records no code hash for the market");
  else if (codeHash !== recordedHash) refusals.push(`the code on chain (${codeHash}) is not the recorded code (${recordedHash}): a lock would freeze code nobody has checked`);
  if (!owner || owner === market) refusals.push("the owner must be an account other than the market: after the lock nobody signs as the market");
  if (!ownerKeys.some(full)) refusals.push(`${owner} has no full-access key: it could not act as the owner afterwards`);
  if (signerPk !== null) {
    if (!marketKeys.some((k) => k.public_key === signerPk && full(k))) refusals.push("the signing key is not a full-access key on the market: it can't delete the market's keys");
    if (!ownerKeys.some((k) => k.public_key === signerPk && full(k))) refusals.push(`the signing key is not a full-access key on ${owner}: lock only with the owner's own key`);
  }
  const pks = marketKeys.map((k) => k.public_key);
  const order = signerPk === null ? pks : [...pks.filter((p) => p !== signerPk), ...pks.filter((p) => p === signerPk)];
  return { already: false, refusals, order };
}
