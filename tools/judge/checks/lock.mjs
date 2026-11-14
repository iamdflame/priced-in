// Check 12: the real-money market is locked. Read from mainnet at one final block:
//   keys     market.isitpriced.near has no access key, so nobody can sign as it: no DeployContract,
//            no ft_transfer of its USDC signed by a key, no call to its #[private] callbacks;
//   code     the account's code hash is the one deployments/mainnet.json records, the code check 3
//            rebuilds from this repository;
//   source   that code's source makes promises only as function calls (to USDC and to itself), so
//            the contract itself deploys nothing, adds no key and deletes no account (lib/lock.mjs).
// It proves the code and the account, not the owner. The owner signs from its own account and keeps
// every owner method; the PASS line names them, so it can't be read as more than it is.
import { keyState, marketSources, promiseScan } from "../lib/lock.mjs";

const OWNER_KEEPS = "pause, set the limits and the fee (3% at most), change the judges' keys, rule on an escalated claim, and withdraw the treasury's own money";
const SEE = "docs/TRUST.md, section 1 (what the owner can still do)";

export async function checkLock(repo, mainnet, { offline = false, sources = null } = {}) {
  if (!mainnet) return { status: "SKIP", detail: "no deployments/mainnet.json: there is no real-money deployment to read", see: "deployments/" };
  const M = mainnet.dep.accounts.market, owner = mainnet.dep.keys?.owner || mainnet.dep.root, recorded = mainnet.dep.code?.market?.code_hash;
  const src = promiseScan(sources || marketSources(repo));
  if (!src.ok) {
    const what = src.forbidden.length ? src.forbidden.map((f) => `${f.file}:${f.line} ${f.what}`).join(", ") : `${src.promises} promises and ${src.functionCalls} function calls found`;
    return { status: "FAIL", detail: `the market's source makes a promise that is not a function call, so the code could change itself or its keys: ${what}`, see: "contracts/market/src/lib.rs" };
  }
  const srcLine = `its source makes ${src.promises} promises, all function calls, so the code deploys nothing and adds no key`;
  if (offline) return { status: "SKIP", detail: `--offline: mainnet's keys not read. From the source: ${srcLine}`, see: "npm run judge (without --offline)" };

  const rpc = mainnet.rpc;
  const blockId = await rpc.finalHeight();
  const [list, acct] = await Promise.all([
    rpc.call("query", { request_type: "view_access_key_list", block_id: blockId, account_id: M }),
    rpc.account(M, { blockId }),
  ]);
  const st = keyState(list.keys || []);
  const bad = [];
  if (!st.locked) bad.push(`${M} has ${st.keys} access key${st.keys === 1 ? "" : "s"} (${st.full} full access) at block ${blockId}: whoever holds one can replace the code and send the market's USDC out`);
  if (!recorded) bad.push("deployments/mainnet.json records no code hash for the market");
  else if (acct.code_hash !== recorded) bad.push(`the code on chain is ${acct.code_hash}, not the recorded ${recorded}`);
  if (bad.length) return { status: "FAIL", detail: bad.join(" | "), see: "node scripts/mainnet/lock-market.mjs (reads only: what a lock would delete)" };
  return {
    status: "PASS",
    detail: `${M} has no access key at block ${blockId}: nobody can sign as it, so no key can replace its code (${acct.code_hash}, the code check 3 rebuilds) or send its USDC out; ${srcLine}. This locks the code, not the owner: ${owner} can still ${OWNER_KEEPS}`,
    see: SEE,
  };
}
