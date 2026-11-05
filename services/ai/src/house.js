// Setting up the house: the operator's function-call keys and the three house agents
// (archivist, skeptic, quant), spawned through the swarm. Used by scripts/house-agents.mjs and
// by the testnet e2e. Every step checks the chain first, so running it again changes nothing.
//
// Order matters for idempotency: a runner key is saved to the keystore BEFORE the spawn that
// names it, so a crash between the two leaves a saved key that the next run reuses, never an
// agent whose key nobody holds.

import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { HOUSE_PERSONAS, personaHash } from "./personas.js";
import { loadKeystore, newRunnerKey, operatorKey, writeKeyFile } from "./keystore.js";
import { OPERATOR_METHODS } from "./signer.js";

const TGAS = 10n ** 12n;

export async function keyOnChain(provider, accountId, publicKey) {
  // list the keys rather than ask for one: a missing key is an error some providers retry and fail over on
  const r = await provider.query({ request_type: "view_access_key_list", finality: "optimistic", account_id: accountId });
  return (r.keys || []).some((k) => k.public_key === publicKey);
}

export async function listAgents(provider, swarmId) {
  const out = [];
  for (let from = 0; ; from += 100) {
    const page = await provider.callFunction({ contractId: swarmId, method: "get_agents", args: { from, limit: 100 }, blockQuery: { finality: "optimistic" } });
    out.push(...page);
    if (page.length < 100) return out;
  }
}

/**
 * The operator's function-call keys on the owner's account (the owner is an operator of both
 * contracts): market anchor_rewrite + charge_inference, swarm sweep_escrow, and a jury key for
 * submit_verdict written to <dataDir>/jury-key.json for the model process (JURY_KEY_FILE).
 */
export async function setupOperator({ owner, provider, marketId, swarmId, keystoreDir, dataDir, allowanceYocto = 10n ** 23n, log = () => {} }) {
  const out = {};
  for (const [role, receiverId] of [["market", marketId], ["swarm", swarmId]]) {
    const { rec, created } = operatorKey(keystoreDir, role, { accountId: owner.accountId, receiverId, methods: OPERATOR_METHODS[role] });
    if (rec.accountId !== owner.accountId || rec.receiverId !== receiverId) throw new Error(`the keystore's operator-${role} key is for ${rec.accountId} on ${rec.receiverId}, not ${owner.accountId} on ${receiverId}`);
    const on = await keyOnChain(provider, owner.accountId, rec.publicKey);
    if (!on) await owner.addFunctionCallAccessKey({ publicKey: rec.publicKey, contractId: receiverId, methodNames: OPERATOR_METHODS[role], allowance: allowanceYocto });
    out[role] = { publicKey: rec.publicKey, methods: OPERATOR_METHODS[role], created: created || !on };
    log(`operator ${role}: ${owner.accountId} ${rec.publicKey} (${OPERATOR_METHODS[role].join(", ")})${!on ? " added" : " already there"}`);
  }
  const juryFile = path.join(dataDir, "jury-key.json");
  let jury = fs.existsSync(juryFile) ? JSON.parse(fs.readFileSync(juryFile, "utf8")) : null;
  if (jury && jury.accountId !== owner.accountId) throw new Error(`${juryFile} is for ${jury.accountId}, not ${owner.accountId}`);
  if (!jury) {
    const kp = KeyPair.fromRandom("ed25519");
    jury = { kind: "jury", accountId: owner.accountId, receiverId: marketId, methods: ["submit_verdict"], publicKey: kp.getPublicKey().toString(), privateKey: kp.toString(), created_at: new Date().toISOString() };
    writeKeyFile(juryFile, jury);
  }
  const juryOn = await keyOnChain(provider, owner.accountId, jury.publicKey);
  if (!juryOn) await owner.addFunctionCallAccessKey({ publicKey: jury.publicKey, contractId: marketId, methodNames: ["submit_verdict"], allowance: allowanceYocto });
  out.jury = { accountId: owner.accountId, publicKey: jury.publicKey, file: juryFile, created: !juryOn };
  log(`jury: ${owner.accountId} ${jury.publicKey} (submit_verdict)${!juryOn ? " added" : " already there"}`);
  return out;
}

/**
 * Spawn the three house agents through the swarm (once), and top each bankroll up to
 * `bankrollMicro` if given. Returns one row per house agent.
 * @param {{ owner: import('near-api-js').Account, provider: object, swarmId: string, marketId: string, usdcId?: string|null, keystoreDir: string,
 *   depositYocto?: bigint|null, bankrollMicro?: bigint|null, faucet?: boolean, models?: Record<string,string>, log?: (m: string) => void }} o
 */
export async function ensureHouseAgents({ owner, provider, swarmId, marketId, usdcId = null, keystoreDir, depositYocto = null, bankrollMicro = null, faucet = false, models = {}, log = () => {} }) {
  const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } });
  const stats = await view(swarmId, "stats");
  const min = BigInt(stats.min_spawn_yocto);
  const deposit = depositYocto && BigInt(depositYocto) > min ? BigInt(depositYocto) : min;
  let listed = await listAgents(provider, swarmId);
  const rows = [];
  for (const h of HOUSE_PERSONAS) {
    const hash = personaHash(h.persona);
    const model = models[h.key] || h.model;
    const ks = loadKeystore(keystoreDir);
    let agent = listed.find((a) => a.owner === owner.accountId && a.persona_hash === hash && !a.closed && !a.deleted);
    let created = false;
    if (agent && !ks.runners.has(agent.runner_public_key)) {
      rows.push({ key: h.key, account: agent.account, model: agent.model, created: false, error: "spawned, but this keystore does not hold its runner key: close it (close_agent) and run again" });
      continue;
    }
    if (!agent) {
      const used = new Set(listed.map((a) => a.runner_public_key));
      const k = [...ks.runners.values()].find((r) => r.label === h.key && !used.has(r.publicKey)) || newRunnerKey(keystoreDir, { label: h.key, persona_hash: hash });
      log(`spawning ${h.key} (${model}) with ${Number(deposit) / 1e24} NEAR`);
      await owner.callFunction({ contractId: swarmId, methodName: "spawn_agent", args: { model, persona_hash: hash, runner_public_key: k.publicKey }, deposit, gas: 100n * TGAS });
      listed = await listAgents(provider, swarmId);
      agent = listed.find((a) => a.runner_public_key === k.publicKey);
      if (!agent) throw new Error(`spawn_agent for ${h.key} went through but the swarm does not list it`);
      created = true;
    }
    const row = { key: h.key, account: agent.account, id: agent.id, model: agent.model, persona_hash: hash, created, escrow_yocto: agent.escrow_yocto, sleeping: agent.sleeping };
    if (bankrollMicro && usdcId) {
      const bal = BigInt(await view(marketId, "get_balance", { trader: agent.account }));
      const want = BigInt(bankrollMicro);
      if (bal < want) {
        const diff = want - bal;
        let have = BigInt(await view(usdcId, "ft_balance_of", { account_id: owner.accountId }));
        while (faucet && have < diff) { await owner.callFunction({ contractId: usdcId, methodName: "faucet", args: {}, gas: 30n * TGAS }); have = BigInt(await view(usdcId, "ft_balance_of", { account_id: owner.accountId })); }
        if (have < diff) throw new Error(`${owner.accountId} holds ${have} micro-USDC; ${h.key} needs ${diff} more`);
        await owner.callFunction({ contractId: usdcId, methodName: "ft_transfer_call", args: { receiver_id: marketId, amount: String(diff), msg: JSON.stringify({ for: agent.account }) }, deposit: 1n, gas: 100n * TGAS });
        log(`${h.key}: bankroll topped up by ${diff} micro-USDC`);
      }
      row.bankroll_micro = String(await view(marketId, "get_balance", { trader: agent.account }));
    }
    rows.push(row);
  }
  return rows;
}
