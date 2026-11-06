// AI layer configuration. Network rules come from the API's loadConfig: testnet by default,
// mainnet only with NEAR_NETWORK=mainnet, and accounts from the other network are refused.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../api/src/config.mjs";
import { DEFAULT_AGENTS, DEFAULT_POLICY } from "./agents.js";
import { DEFAULT_JURY_MODELS } from "./jury.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const list = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);

/** "name=model,name=model" to agent objects. */
export function parseAgents(s) {
  if (!s) return DEFAULT_AGENTS;
  return list(s).map((x) => {
    const i = x.indexOf("=");
    if (i < 1) throw new Error(`HOUSE_AGENTS entry "${x}" must be name=model`);
    return { name: x.slice(0, i), model: x.slice(i + 1) };
  });
}

export function loadAiConfig(env = process.env) {
  const { config: api, errors, warnings } = loadConfig(env);
  const baseUrl = (env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/+$/, "");
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:" && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) errors.push("NEARAI_BASE_URL must be https");
  } catch { errors.push("NEARAI_BASE_URL is not a URL"); }
  // agent keys live only in the signer's file: the model process must never hold one
  for (const k of Object.keys(env)) {
    if (/^(AGENT|HOUSE|SIGNER)_.*(KEY|SECRET)/.test(k) && k !== "SIGNER_KEYS_FILE") errors.push(`${k}: agent keys belong in SIGNER_KEYS_FILE, read only by the signer process, never in this environment`);
  }
  let agents = DEFAULT_AGENTS;
  try { agents = parseAgents(env.HOUSE_AGENTS); } catch (e) { errors.push(e.message); }
  const wrong = api.network === "testnet" ? ".near" : ".testnet";
  const swarmId = (env.SWARM_CONTRACT_ID || "").trim() || null;
  if (swarmId && swarmId.endsWith(wrong)) errors.push(`SWARM_CONTRACT_ID=${swarmId} is on the wrong network for NEAR_NETWORK=${api.network}`);
  const houseOwners = list(env.HOUSE_OWNER_IDS);
  for (const h of houseOwners) if (h.endsWith(wrong)) errors.push(`HOUSE_OWNER_IDS: ${h} is on the wrong network for NEAR_NETWORK=${api.network}`);
  const dataDir = env.DATA_DIR || path.join(HERE, "../data");
  const route = env.AGENT_BILLING || "escrow";
  if (!["escrow", "balance", "none"].includes(route)) errors.push("AGENT_BILLING must be escrow, balance or none");
  const overrides = {};
  for (const x of list(env.AGENT_BILLING_OVERRIDES)) {
    const [k, v] = x.split("=");
    if (!k || !["escrow", "balance", "none"].includes(v)) errors.push(`AGENT_BILLING_OVERRIDES entry "${x}" must be name=escrow|balance|none`);
    else overrides[k] = v;
  }
  // NEAR per micro-USD for escrow bills. Testnet defaults to $1 = 0.4 NEAR; mainnet has no default.
  const rateRaw = env.INFERENCE_YOCTO_PER_MICRO_USD ?? (api.network === "testnet" ? "400000000000000000" : "0");
  let yoctoPerMicro = 0n;
  try { yoctoPerMicro = BigInt(rateRaw); if (yoctoPerMicro < 0n) throw new Error(); } catch { errors.push("INFERENCE_YOCTO_PER_MICRO_USD must be a whole number of yoctoNEAR"); }
  let juryAccount = (env.JURY_ACCOUNT_ID || "").trim() || null;
  let juryKey = (env.JURY_PRIVATE_KEY || "").trim() || null;
  if (!juryKey && env.JURY_KEY_FILE) {
    try { const j = JSON.parse(fs.readFileSync(env.JURY_KEY_FILE, "utf8")); juryAccount ||= j.accountId || null; juryKey = j.privateKey || null; }
    catch (e) { errors.push(`JURY_KEY_FILE unreadable (${e.code || "bad JSON"})`); }
  }
  if (juryAccount && juryAccount.endsWith(api.network === "testnet" ? ".near" : ".testnet")) errors.push(`JURY_ACCOUNT_ID=${juryAccount} is on the wrong network for NEAR_NETWORK=${api.network}`);
  const ai = {
    nearai: { apiKey: (env.NEARAI_API_KEY || "").trim() || null, baseUrl },
    attestationsDir: env.ATTESTATIONS_DIR || path.join(HERE, "../attestations"),
    requireGpu: env.ATTESTATION_REQUIRE_GPU !== "0",
    pagesFile: env.PAGES_FILE || null,
    dataDir,
    swarmId,
    houseOwners,
    writer: {
      enabled: env.WRITER_ENABLED !== "0",
      model: env.WRITER_MODEL || "z-ai/glm-5.3-flash",
      signatureDeadlineMs: num(env.WRITER_SIGNATURE_DEADLINE_MS, 6000),
    },
    agents: {
      list: agents,
      keysFile: env.SIGNER_KEYS_FILE || null,
      keystoreDir: env.KEYSTORE_DIR || path.join(dataDir, "keystore"),
      cycleMs: num(env.AGENT_CYCLE_MS, 60_000),
      supersededAfterMs: num(env.SIGNER_SUPERSEDED_AFTER_MS, 120_000),
      freshCooldownMs: num(env.AGENT_FRESH_COOLDOWN_MS, 20_000),
      billing: { route, overrides, yoctoPerMicro, dailyBillMicro: num(env.SIGNER_DAILY_BILL_MICRO, 2_000_000) },
      useWebSearch: env.AGENT_WEB_SEARCH !== "0",
      sweepMs: num(env.AGENT_SWEEP_MS, 15 * 60_000),
      // AGENT_FEE_POINTS: what a trade pays the market, as a fraction (0.01 once a 1% taker fee is on)
      // AGENT_MAX_BET_USD: the most one bet can be, so a daily spend cap covers more than a few lines
      policy: { ...DEFAULT_POLICY, feePoints: num(env.AGENT_FEE_POINTS, DEFAULT_POLICY.feePoints), maxBetUsd: num(env.AGENT_MAX_BET_USD, DEFAULT_POLICY.maxBetUsd), dailyLossLimitUsd: num(env.AGENT_DAILY_LOSS_USD, DEFAULT_POLICY.dailyLossLimitUsd), kellyFraction: num(env.AGENT_KELLY_FRACTION, DEFAULT_POLICY.kellyFraction) },
      dailySpendMicro: num(env.SIGNER_DAILY_SPEND_MICRO, 10_000_000),
      // undefined leaves the signer's own defaults (DAILY_OPENS, DAILY_CHALLENGES)
      dailyOpens: num(env.SIGNER_DAILY_OPENS, undefined),
      dailyChallenges: num(env.SIGNER_DAILY_CHALLENGES, undefined),
    },
    jury: {
      models: list(env.JURY_MODELS).length ? list(env.JURY_MODELS) : DEFAULT_JURY_MODELS,
      accountId: juryAccount,
      privateKey: juryKey,
      auto: env.JURY_AUTO !== "0",
      timeoutMs: num(env.JURY_TIMEOUT_MS, 90_000),
    },
  };
  return { api, ai, errors, warnings };
}

/** Printable summary: secrets as set/unset. */
export function describeAi(a) {
  return {
    nearaiApiKey: a.nearai.apiKey ? "set" : "unset", baseUrl: a.nearai.baseUrl,
    writerModel: a.writer.model, agents: a.agents.list.map((x) => x.name), signerKeysFile: a.agents.keysFile ? "set" : "unset",
    swarm: a.swarmId, houseOwners: a.houseOwners, dataDir: a.dataDir, billing: a.agents.billing.route, yoctoPerMicroUsd: String(a.agents.billing.yoctoPerMicro),
    juryModels: a.jury.models, juryAccount: a.jury.accountId, juryKey: a.jury.privateKey ? "set" : "unset",
  };
}
