// Check 12 and the lock's own rules (tools/judge/lib/lock.mjs, tools/judge/checks/lock.mjs). No network.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyState, lockPlan, marketSources, promiseScan } from "../lib/lock.mjs";
import { checkLock } from "../checks/lock.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FULL = (pk) => ({ public_key: pk, access_key: { nonce: 1, permission: "FullAccess" } });
const FC = (pk, receiver) => ({ public_key: pk, access_key: { nonce: 1, permission: { FunctionCall: { receiver_id: receiver, method_names: ["finalize"], allowance: null } } } });
const HASH = "FQJXhaVJGwC37dekdneGvEoR9mzJUMkpp4sRjR3WtueC";
const M = "market.example.near", OWNER = "example.near";
const mainnet = (keys, { codeHash = HASH, recorded = HASH } = {}) => {
  const calls = [];
  return {
    calls,
    dep: { root: OWNER, accounts: { market: M }, keys: { owner: OWNER }, code: { market: { code_hash: recorded } } },
    rpc: {
      finalHeight: async () => 777,
      call: async (method, params) => { calls.push(params); return { keys }; },
      account: async (id, o) => { calls.push({ request_type: "view_account", account_id: id, ...o }); return { code_hash: codeHash, amount: "6291000000000000000000000" }; },
    },
  };
};

test("keyState: locked means no key at all, a function-call key included", () => {
  assert.deepEqual(keyState([]), { keys: 0, full: 0, functionCall: 0, locked: true });
  assert.deepEqual(keyState([FULL("ed25519:a")]), { keys: 1, full: 1, functionCall: 0, locked: false });
  assert.equal(keyState([FC("ed25519:b", M)]).locked, false);
});

test("promiseScan: the market's real source makes promises only as function calls", () => {
  const s = promiseScan(marketSources(REPO));
  assert.equal(s.ok, true, JSON.stringify(s.forbidden));
  assert.deepEqual(s.forbidden, []);
  assert.ok(s.promises >= 2 && s.functionCalls >= s.promises, `${s.promises} promises, ${s.functionCalls} function calls`);
});

test("promiseScan: each other action is caught with its file and line; a comment about one is not", () => {
  const bad = (text) => promiseScan([{ file: "x.rs", text }]);
  for (const call of ["deploy_contract(code)", "add_full_access_key(pk)", "add_access_key_allowance(pk, a, r, m)", "delete_key(pk)", "delete_account(to)", "transfer(amount)", "stake(a, pk)", "create_account()", "use_global_contract(h)", "deploy_global_contract_by_account_id(c)"]) {
    const s = bad(`fn f() {\n    Promise::new(a).${call};\n}`);
    assert.equal(s.ok, false, call);
    assert.deepEqual([s.forbidden[0].file, s.forbidden[0].line], ["x.rs", 2], call);
  }
  assert.equal(bad("unsafe { sys::promise_batch_action_deploy_contract(i, l, p) }").ok, false);
  const fine = bad("// it never calls .deploy_contract( or .transfer(\n/// nor .delete_account(\nPromise::new(usdc).function_call(m, a, d, g)");
  assert.deepEqual([fine.ok, fine.promises, fine.functionCalls, fine.forbidden.length], [true, 1, 1, 0]);
  assert.equal(bad("fn pure() -> u8 { 1 }").ok, false, "no promise at all is not what the market is");
});

test("lockPlan: the signing key goes last, and it must be the owner's own full-access key on both accounts", () => {
  const base = { market: M, owner: OWNER, codeHash: HASH, recordedHash: HASH };
  const ok = lockPlan({ ...base, marketKeys: [FULL("ed25519:own"), FC("ed25519:other", M)], ownerKeys: [FULL("ed25519:own")], signerPk: "ed25519:own" });
  assert.deepEqual([ok.already, ok.refusals, ok.order], [false, [], ["ed25519:other", "ed25519:own"]]);
  assert.equal(lockPlan({ ...base, marketKeys: [], ownerKeys: [FULL("ed25519:own")] }).already, true);
  const refuses = (over, re) => assert.match(lockPlan({ ...base, marketKeys: [FULL("ed25519:own")], ownerKeys: [FULL("ed25519:own")], signerPk: "ed25519:own", ...over }).refusals.join(" | "), re);
  refuses({ codeHash: "other" }, /not the recorded code/);
  refuses({ recordedHash: undefined }, /records no code hash/);
  refuses({ owner: M }, /other than the market/);
  refuses({ ownerKeys: [] }, /no full-access key/);
  refuses({ signerPk: "ed25519:stranger" }, /not a full-access key on the market.*not a full-access key on example\.near/);
  refuses({ ownerKeys: [FULL("ed25519:elsewhere")] }, /lock only with the owner's own key/);
  // the read-only plan knows no signing key and refuses nothing on that account
  assert.deepEqual(lockPlan({ ...base, marketKeys: [FULL("ed25519:own")], ownerKeys: [FULL("ed25519:own")] }).refusals, []);
});

test("check 12: no key and the recorded code is a PASS that names what the owner keeps; both reads at one block", async () => {
  const m = mainnet([]);
  const r = await checkLock(REPO, m);
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, /^market\.example\.near has no access key at block 777: nobody can sign as it/);
  assert.match(r.detail, /This locks the code, not the owner: example\.near can still pause, .*change the judges' keys, rule on an escalated claim, and withdraw the treasury's own money$/);
  assert.deepEqual(m.calls.map((c) => [c.request_type, c.block_id ?? c.blockId]), [["view_access_key_list", 777], ["view_account", 777]]);
});

test("check 12: any key fails, and so does code that isn't the recorded code", async () => {
  const one = await checkLock(REPO, mainnet([FULL("ed25519:a")]));
  assert.equal(one.status, "FAIL");
  assert.match(one.detail, /has 1 access key \(1 full access\) at block 777: whoever holds one can replace the code and send the market's USDC out/);
  assert.equal((await checkLock(REPO, mainnet([FC("ed25519:b", M)]))).status, "FAIL", "a function-call key still signs as the market");
  const code = await checkLock(REPO, mainnet([], { codeHash: "Zzz" }));
  assert.deepEqual([code.status, /the code on chain is Zzz, not the recorded/.test(code.detail)], ["FAIL", true]);
});

test("check 12: a source that could deploy fails before any read; --offline and no deployment are SKIPs", async () => {
  const m = mainnet([]);
  const r = await checkLock(REPO, m, { sources: [{ file: "contracts/market/src/lib.rs", text: "Promise::new(me).deploy_contract(code);" }] });
  assert.deepEqual([r.status, m.calls.length], ["FAIL", 0]);
  assert.match(r.detail, /contracts\/market\/src\/lib\.rs:1 deploy_contract/);
  const off = await checkLock(REPO, mainnet([FULL("ed25519:a")]), { offline: true });
  assert.deepEqual([off.status, /mainnet's keys not read/.test(off.detail)], ["SKIP", true]);
  assert.equal((await checkLock(REPO, null)).status, "SKIP");
});
