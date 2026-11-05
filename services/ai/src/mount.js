// Attaches the AI layer to a running API app: the writer, the house agents, the jury runner,
// and their routes and health. Each part says plainly when it is off and why.

import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { NearAI, Attestor } from "./nearai.js";
import { Writer } from "./writer.js";
import { Ledger } from "./ledger.js";
import { Research } from "./research.js";
import { Swarm } from "./agents.js";
import { SignerClient } from "./signer.js";
import { JuryRunner } from "./jury.js";
import { FunctionCallSender } from "./txsender.js";

/**
 * @param {object} app from createApp
 * @param {object} ai from loadAiConfig
 * @param {{ quoteVerifier?: Function, gpuVerifier?: Function, researchFetch?: typeof fetch, log?: (m: string) => void, overrides?: object }} [deps]
 *   The verifiers can only be replaced in code (the offline tests); no setting does it.
 */
export function mountAi(app, ai, deps = {}) {
  const log = deps.log || ((m) => console.log(`${new Date().toISOString()} ${m}`));
  const api = app.config;
  const client = new NearAI({ apiKey: ai.nearai.apiKey, baseUrl: ai.nearai.baseUrl });
  const attestor = new Attestor({ client, quoteVerifier: deps.quoteVerifier, gpuVerifier: deps.gpuVerifier, requireGpu: ai.requireGpu, dir: ai.attestationsDir, log });
  const ledger = new Ledger({ file: ai.ledgerFile, pricing: (m) => client.model(m) });
  let pagesDoc = null;
  if (ai.pagesFile) { try { pagesDoc = JSON.parse(fs.readFileSync(ai.pagesFile, "utf8")); } catch (e) { log(`pages file unreadable: ${e.message}`); } }
  const o = deps.overrides || {};
  const state = { agents: { status: "off", reason: null }, jury: { status: "off", reason: null } };

  let writer = null;
  if (!api.marketId) app.rewrites.status = { writer: "off", reason: "MARKET_CONTRACT_ID is not set" };
  else if (!ai.writer.enabled) app.rewrites.status = { writer: "off", reason: "WRITER_ENABLED=0" };
  else writer = new Writer({ client, attestor, model: ai.writer.model, store: app.rewrites, hub: app.hub, claims: app.claims, pagesDoc, ledger, log, signatureDeadlineMs: ai.writer.signatureDeadlineMs, ...o.writer });

  let signer = null, swarm = null;
  if (!api.marketId) state.agents.reason = "MARKET_CONTRACT_ID is not set";
  else if (!client.hasKey) state.agents.reason = "NEARAI_API_KEY is not set: agents form no credences without a model, so they stay silent";
  else if (!ai.agents.keysFile) state.agents.reason = "SIGNER_KEYS_FILE is not set: the agents have no signer";
  else {
    signer = new SignerClient({ keysFile: ai.agents.keysFile, marketId: api.marketId, rpcUrls: api.rpcUrls, network: api.network, dailySpendMicro: ai.agents.dailySpendMicro, log });
    const research = new Research({ client, useWebSearch: ai.agents.useWebSearch, ledger, log, fetchImpl: deps.researchFetch });
    swarm = new Swarm({
      agents: ai.agents.list, client, attestor, claims: app.claims, hub: app.hub, signer, ledger, research, pagesDoc, log, policy: ai.agents.policy, sweepMs: ai.agents.sweepMs,
      balanceOf: async (id) => Number(await app.rpc.viewFunction(api.marketId, "get_balance", { trader: id })) / 1e6,
      ...o.swarm,
    });
  }

  let jury = null;
  if (!api.marketId) state.jury.reason = "MARKET_CONTRACT_ID is not set";
  else if (!client.hasKey) state.jury.reason = "NEARAI_API_KEY is not set";
  else if (!ai.jury.accountId || !ai.jury.privateKey) state.jury.reason = "JURY_ACCOUNT_ID or JURY_PRIVATE_KEY is not set";
  else {
    const sender = new FunctionCallSender({ rpc: app.rpc, accountId: ai.jury.accountId, keyPair: KeyPair.fromString(ai.jury.privateKey), receiverId: api.marketId });
    jury = new JuryRunner({ client, attestor, rpc: app.rpc, marketId: api.marketId, sender, models: ai.jury.models, timeoutMs: ai.jury.timeoutMs, ledger, hub: ai.jury.auto ? app.hub : null, log, ...o.jury });
    state.jury = { status: "on", reason: null };
  }

  const status = () => ({
    writer: app.rewrites.status,
    agents: { ...state.agents, stats: swarm?.stats ?? null, accounts: signer?.agents ?? [], inference: ledger.totals(), onchain_metering: "not implemented: needs charge_inference on the market" },
    jury: { ...state.jury, models: ai.jury.models },
    attestations: attestor.snapshot(),
  });

  app.addRoute("GET", "/ai/status", async () => status());
  app.addRoute("GET", "/rationales", async ({ url }) => {
    const claim = url.searchParams.get("claim");
    return { rationales: swarm ? swarm.recent({ page: url.searchParams.get("page"), claim: claim === null ? null : Number(claim) }) : [], agents: state.agents };
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
    writer?.start();
    jury?.start();
    if (signer) {
      try {
        const accepted = await signer.start();
        const ok = accepted.filter((a) => a.ok);
        state.agents = ok.length ? { status: "on", reason: null } : { status: "off", reason: `the signer accepted no key (${accepted.map((a) => `${a.agent}: ${a.error}`).join("; ") || "empty keys file"})` };
        if (ok.length) swarm.start();
      } catch (e) { state.agents = { status: "off", reason: e.message }; log(`agents off: ${e.message}`); }
    }
    if (client.hasKey) {
      const models = new Set([ai.writer.model, ...ai.agents.list.map((a) => a.model)]);
      for (const m of models) attestor.ensure(m).catch((e) => log(`attestation ${m}: ${e.message}`));
    }
  });
  app.hooks.stop.push(async () => { writer?.stop(); swarm?.stop(); jury?.stop(); await signer?.stop(); });
  return { client, attestor, ledger, writer, swarm, signer, jury, status };
}
