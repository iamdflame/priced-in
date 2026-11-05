// Attaches the AI layer to a running API app: the writer, the crowd of agents, billing, the
// jury runner, and their routes and health. Each part says plainly when it is off and why.
//
// State lives in DATA_DIR (ledger.jsonl, rewrites.jsonl, rationales.jsonl, personas.jsonl,
// signer.jsonl) and keys in KEYSTORE_DIR, which only the signer process opens.

import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { NearAI, Attestor } from "./nearai.js";
import { Writer } from "./writer.js";
import { Ledger } from "./ledger.js";
import { Research } from "./research.js";
import { Crowd } from "./agents.js";
import { SignerClient } from "./signer.js";
import { JuryRunner } from "./jury.js";
import { FunctionCallSender } from "./txsender.js";
import { Biller } from "./billing.js";
import { journalIn } from "./journal.js";
import { PersonaRegistry, personaHash, normalizePersona } from "./personas.js";

/**
 * @param {object} app from createApp
 * @param {object} ai from loadAiConfig
 * @param {{ quoteVerifier?: Function, gpuVerifier?: Function, researchFetch?: typeof fetch, log?: (m: string) => void, overrides?: object }} [deps]
 *   The verifiers can only be replaced in code (the offline tests); no setting does it.
 */
export function mountAi(app, ai, deps = {}) {
  const log = deps.log || ((m) => console.log(`${new Date().toISOString()} ${m}`));
  const api = app.config;
  const dir = ai.dataDir || null;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const client = new NearAI({ apiKey: ai.nearai.apiKey, baseUrl: ai.nearai.baseUrl });
  const attestor = new Attestor({ client, quoteVerifier: deps.quoteVerifier, gpuVerifier: deps.gpuVerifier, requireGpu: ai.requireGpu, dir: ai.attestationsDir, log });
  const ledger = new Ledger({ journal: journalIn(dir, "ledger.jsonl"), pricing: (m) => client.model(m) });
  const personas = new PersonaRegistry(journalIn(dir, "personas.jsonl"));
  let pagesDoc = null;
  if (ai.pagesFile) { try { pagesDoc = JSON.parse(fs.readFileSync(ai.pagesFile, "utf8")); } catch (e) { log(`pages file unreadable: ${e.message}`); } }
  const o = deps.overrides || {};
  const state = { agents: { status: "off", reason: null }, jury: { status: "off", reason: null }, signer: { status: "off", reason: null } };
  const view = (method, args) => app.rpc.viewFunction(api.marketId, method, args);
  const balanceOf = async (id) => Number(await view("get_balance", { trader: id })) / 1e6;
  const positionOf = async (claimId, id) => { const p = await view("get_position", { claim_id: claimId, trader: id }); return { yes: Number(p?.yes_micro || 0) / 1e6, no: Number(p?.no_micro || 0) / 1e6 }; };

  // the signer: started whenever there are keys to hold (agents, or the operator's anchor key)
  const keystoreDir = ai.agents.keystoreDir && fs.existsSync(ai.agents.keystoreDir) ? ai.agents.keystoreDir : null;
  let signer = null;
  if (!api.marketId) state.signer.reason = "MARKET_CONTRACT_ID is not set";
  else if (!keystoreDir && !ai.agents.keysFile) state.signer.reason = "no keystore (KEYSTORE_DIR) and no SIGNER_KEYS_FILE: nothing to sign with";
  else signer = new SignerClient({
    marketId: api.marketId, swarmId: ai.swarmId, rpcUrls: api.rpcUrls, network: api.network, keystoreDir, keysFile: ai.agents.keysFile,
    journalFile: dir ? path.join(dir, "signer.jsonl") : null, dailySpendMicro: ai.agents.dailySpendMicro, dailyBillMicro: ai.agents.billing.dailyBillMicro,
    yoctoPerMicro: ai.agents.billing.yoctoPerMicro, log,
  });
  const anchorOn = () => Boolean(signer?.operator?.market?.ok);
  const anchor = async (intent, args) => (anchorOn() ? signer.anchor(intent, args) : { ok: false, final: true, error: "no operator market key: rewrites are not anchored" });

  let writer = null;
  if (!api.marketId) app.rewrites.status = { writer: "off", reason: "MARKET_CONTRACT_ID is not set" };
  else if (!ai.writer.enabled) app.rewrites.status = { writer: "off", reason: "WRITER_ENABLED=0" };
  else writer = new Writer({ client, attestor, model: ai.writer.model, store: app.rewrites, hub: app.hub, claims: app.claims, pagesDoc, ledger, log, signatureDeadlineMs: ai.writer.signatureDeadlineMs, journal: journalIn(dir, "rewrites.jsonl"), anchor: signer ? anchor : null, ...o.writer });

  let crowd = null, biller = null;
  if (!api.marketId) state.agents.reason = "MARKET_CONTRACT_ID is not set";
  else if (!client.hasKey) state.agents.reason = "NEARAI_API_KEY is not set: agents form no credences without a model, so they stay silent";
  else if (!signer) state.agents.reason = state.signer.reason;
  else {
    const research = new Research({ client, useWebSearch: ai.agents.useWebSearch, ledger, log, fetchImpl: deps.researchFetch });
    biller = new Biller({ ledger, signer, rateYoctoPerMicro: ai.agents.billing.yoctoPerMicro, balanceOf, log });
    const { route, overrides } = ai.agents.billing;
    crowd = new Crowd({
      client, attestor, claims: app.claims, hub: app.hub, signer, ledger, research, personas, pagesDoc, log, balanceOf, positionOf, biller,
      staticAgents: ai.agents.list, houseOwners: ai.houseOwners, rationales: journalIn(dir, "rationales.jsonl"),
      billingRoute: (p) => overrides[p.name] || (p.source === "static" ? (overrides[p.name] || "none") : route),
      policy: ai.agents.policy, sweepMs: ai.agents.sweepMs, cycleMs: ai.agents.cycleMs, freshCooldownMs: ai.agents.freshCooldownMs,
      ...o.swarm, ...o.crowd,
    });
  }

  let jury = null;
  if (!api.marketId) state.jury.reason = "MARKET_CONTRACT_ID is not set";
  else if (!client.hasKey) state.jury.reason = "NEARAI_API_KEY is not set";
  else if (!ai.jury.accountId || !ai.jury.privateKey) state.jury.reason = "JURY_ACCOUNT_ID or JURY_PRIVATE_KEY (or JURY_KEY_FILE) is not set";
  else {
    const sender = new FunctionCallSender({ rpc: app.rpc, accountId: ai.jury.accountId, keyPair: KeyPair.fromString(ai.jury.privateKey), receiverId: api.marketId });
    jury = new JuryRunner({ client, attestor, rpc: app.rpc, marketId: api.marketId, sender, models: ai.jury.models, timeoutMs: ai.jury.timeoutMs, ledger, hub: ai.jury.auto ? app.hub : null, log, ...o.jury });
    state.jury = { status: "on", reason: null, account: ai.jury.accountId };
  }

  /** Resolve every money intent the ledger has no final outcome for, through the signer's journal. */
  async function reconcile() {
    let n = 0;
    for (const it of ledger.pending()) {
      const r = await signer.outcome(it.id);
      if (r.final === false || r.pending) continue;
      ledger.recordOutcome(it.id, r.unknownIntent ? { ok: false, final: true, error: "never sent: the signer has no record of it" } : r);
      n++;
    }
    return n;
  }

  const status = () => ({
    writer: app.rewrites.status,
    signer: { ...state.signer, operator: signer?.operator ?? null, unheld_agents: signer?.unheld ?? null },
    agents: { ...state.agents, stats: crowd?.stats ?? null, roster: crowd?.publicRoster() ?? [], inference: ledger.totals(), billing: biller ? { ...biller.stats, route: ai.agents.billing.route, yocto_per_micro_usd: String(ai.agents.billing.yoctoPerMicro) } : null },
    anchoring: { on: anchorOn(), anchored: writer?.stats.anchored ?? 0, failures: writer?.stats.anchorFailures ?? 0 },
    jury: { ...state.jury, models: ai.jury.models },
    attestations: attestor.snapshot(),
  });

  app.addRoute("GET", "/ai/status", async () => status());
  app.addRoute("GET", "/agents", async () => ({ agents: crowd?.publicRoster() ?? [], unheld: crowd?.unheld ?? 0, swarm: ai.swarmId, state: state.agents }));
  app.addRoute("GET", "/rationales", async ({ url }) => {
    const claim = url.searchParams.get("claim");
    return { rationales: crowd ? crowd.recent({ page: url.searchParams.get("page"), claim: claim === null ? null : Number(claim), agent: url.searchParams.get("agent") }) : [], agents: state.agents };
  });
  // a stranger's agent, step 1: register a persona and get a runner key whose private half only
  // the signer holds. Step 2 is theirs: spawn_agent on the swarm with both, in one transaction.
  const issued = new Map(); // ip -> [ms]
  app.addRoute("POST", "/agents/runner-key", async ({ readJson, ip }) => {
    if (!signer || !ai.swarmId) return { status: 503, body: { error: { code: "agents_off", message: "This API runs no swarm agents." } } };
    const recent = (issued.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
    if (recent.length >= 5) return { status: 429, body: { error: { code: "rate_limited", message: "At most five runner keys an hour from one address." } } };
    let persona;
    try { persona = normalizePersona((await readJson(8 * 1024)).persona); } catch (e) { return { status: 400, body: { error: { code: "invalid_persona", message: e.message } } }; }
    const hash = personas.add(persona);
    const r = await signer.issueKey(hash);
    if (!r.ok) return { status: 503, body: { error: { code: "no_key", message: r.error } } };
    issued.set(ip, [...recent, Date.now()]);
    const stats = await app.rpc.viewFunction(ai.swarmId, "stats", {}).catch(() => null);
    return {
      runner_public_key: r.publicKey, persona_hash: hash, persona,
      spawn: { contract: ai.swarmId, method: "spawn_agent", args: { model: "<a NEAR AI model id>", persona_hash: hash, runner_public_key: r.publicKey }, min_deposit_yocto: stats?.min_spawn_yocto ?? null },
      note: "The runner key can only buy, sell and redeem on the market. Your agent's USDC leaves only to you, through the swarm.",
    };
  });
  app.addRoute("GET", "/ai/usage/*", async ({ path: p }) => {
    const hash = p.split("/").pop();
    const b = /^[0-9a-f]{64}$/.test(hash) ? ledger.billByHash(hash) : null;
    if (!b) return { status: 404, body: { error: { code: "no_such_usage", message: "No inference bill with that usage hash." } } };
    return { raw: b.intent.usage_json, headers: { "x-usage-hash": hash } };
  });
  app.addRoute("GET", "/jury", async ({ url }) => {
    const id = Number(url.searchParams.get("challenge"));
    return { run: jury?.runs.get(id) ?? null, jury: state.jury };
  });
  app.addRoute("GET", "/attestations", async () => ({ attestations: attestor.snapshot(), files: fs.existsSync(ai.attestationsDir) ? fs.readdirSync(ai.attestationsDir).filter((f) => f.endsWith(".json")) : [] }));
  app.addRoute("GET", "/attestations/*", async ({ path: p }) => {
    const name = p.split("/").pop();
    const file = path.join(ai.attestationsDir, name);
    if (!/^[A-Za-z0-9._-]+\.json$/.test(name) || !fs.existsSync(file)) return { status: 404, body: { error: { code: "no_such_bundle", message: "No attestation bundle by that name." } } };
    return { body: JSON.parse(fs.readFileSync(file, "utf8")) };
  });
  app.addHealth("ai", async () => {
    const failures = [];
    const w = attestor.cache.get(ai.writer.model);
    if (client.hasKey && w && !w.ok) failures.push(`the writer's model ${ai.writer.model} did not attest, so no rewrite can be signed`);
    return { check: status(), failures };
  });

  app.hooks.start.push(async () => {
    if (signer) {
      try {
        await signer.start();
        await signer.listAgents({ force: true });
        state.signer = { status: "on", reason: null };
        const fixed = await reconcile();
        if (fixed) log(`ledger: ${fixed} open intent(s) resolved from the signer's journal`);
      } catch (e) { state.signer = { status: "off", reason: e.message }; log(`signer off: ${e.message}`); }
    }
    writer?.start();
    if (writer && signer && state.signer.status === "on") writer.reanchor().catch((e) => log(`writer reanchor: ${e.message}`));
    jury?.start();
    if (crowd) {
      if (state.signer.status !== "on") state.agents = { status: "off", reason: `the signer is off (${state.signer.reason})` };
      else {
        await crowd.refresh().catch((e) => log(`agents: ${e.message}`));
        const ok = crowd.roster.filter((a) => a.ok);
        state.agents = ok.length ? { status: "on", reason: null } : { status: "waiting", reason: `the signer holds no usable agent key yet (${signer.agents.map((a) => `${a.accountId}: ${a.error}`).join("; ") || "no agents"})` };
        crowd.start(); // keeps refreshing: a stranger's agent spawned later joins on the next cycle
      }
    }
    if (client.hasKey) {
      const models = new Set([ai.writer.model, ...ai.agents.list.map((a) => a.model), ...(crowd?.roster.map((a) => a.model).filter(Boolean) || [])]);
      for (const m of models) attestor.ensure(m).catch((e) => log(`attestation ${m}: ${e.message}`));
    }
  });
  app.hooks.stop.push(async () => { writer?.stop(); crowd?.stop(); jury?.stop(); await signer?.stop(); });
  return { client, attestor, ledger, personas, writer, crowd, swarm: crowd, biller, signer, jury, status, reconcile, personaHash };
}
