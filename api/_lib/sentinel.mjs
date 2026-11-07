// The Sentinel on the hosted runtime, and its record in the store.
//
//   sentinel/ledger.json   one document: { checks: { <challenge_id>: receipt check },
//                          sentinel: { <challenge_id>: { status, note, last_look_at, disputes, attempts } }, updated_at }
//
// Our jury runner's receipt gate (POST /api/after-challenge and the cron) writes checks; the
// Sentinel (GET /api/sentinel, every minute) writes checks and its own entries; GET /api/rulings
// reads both in one store read. The newest 400 challenges are kept.
//
// The per-minute round costs one view call when nothing is live: `stats` says whether any bond is
// held, and every live challenge holds at least its challenger's. Only then does it take the
// Sentinel's lock, read the ledger and look. The signer process (the only holder of the Sentinel's
// key, which may call nothing but `dispute`) starts only when a dispute is due.

import path from "node:path";
import { loadAiConfig } from "../../services/ai/src/config.js";
import { SignerClient } from "../../services/ai/src/signer.js";
import { checkReceipts } from "../../services/ai/src/receipts.js";
import { Attestor, NearAI } from "../../services/ai/src/nearai.js";
import { supportPanel } from "../../services/ai/src/support.js";
import { sentinelRound } from "../../services/ai/src/sentinel.js";
import { Rpc } from "../../services/api/src/rpc.mjs";
import { recordEvents, txEvents } from "./runtime.mjs";

export const LEDGER = "sentinel/ledger.json";
const KEEP = 400;
// the per-minute function has 60 s: a receipt check there gets 8 s a source and 24 s in all, and a
// PDF 6 s, which leaves the dispute its time
export const SENTINEL_LIMITS = { timeoutMs: 8000, totalMs: 24_000, maxSources: 4, pdfMs: 6000 };

const blank = () => ({ checks: {}, sentinel: {}, updated_at: null });
const prune = (m) => {
  for (const id of Object.keys(m).map(Number).sort((a, b) => b - a).slice(KEEP)) delete m[id];
  return m;
};

/** The ledger as stored (empty before anything was checked). */
export async function readLedger(state) {
  const doc = await state.getDoc(LEDGER);
  return { ...blank(), ...(doc?.value || {}) };
}

function update(state, fn) {
  return state.updateDoc(LEDGER, (cur) => {
    const next = { ...blank(), ...(cur || {}) };
    fn(next);
    prune(next.checks);
    prune(next.sentinel);
    next.updated_at = new Date().toISOString();
    return next;
  });
}

export const putCheck = (state, id, check) => update(state, (l) => { l.checks[id] = check; });
export const putSentinel = (state, id, entry) => update(state, (l) => { l.sentinel[id] = entry; });

/** The receipt gate's store: checks by challenge id, in the ledger. */
export function ledgerChecks(state) {
  return {
    get: async (id) => (await readLedger(state)).checks[id] ?? null,
    put: (id, check) => putCheck(state, id, check),
  };
}

/** A signer process for the Sentinel's key, with the signer journal current (the daily caps, any dispute in flight). */
export async function withSentinelSigner(p, fn, log = () => {}) {
  const { api, ai } = loadAiConfig(p.env);
  await p.journals.hydrate();
  const signer = new SignerClient({
    marketId: api.marketId, swarmId: null, rpcUrls: api.rpcUrls, network: api.network, keystoreDir: ai.agents.keystoreDir, keysFile: null,
    journalFile: path.join(ai.dataDir, "signer.jsonl"), dailyOpens: ai.agents.dailyOpens, dailyChallenges: ai.agents.dailyChallenges,
    dailyDisputes: ai.agents.dailyDisputes, dailyDisputeMicro: ai.agents.dailyDisputeMicro, maxDisputeBondMicro: ai.agents.maxDisputeBondMicro, log,
  });
  try {
    await signer.start();
    return await fn(signer);
  } finally {
    await signer.stop();
    await p.journals.flush({ only: ["signer.jsonl"] }).catch((e) => log(`sentinel: signer journal: ${e.message}`));
  }
}

/** The support question, only built when a receipt needs asking: attestation is not a per-minute cost. */
function support(p, view, log) {
  const { ai } = loadAiConfig(p.env);
  const client = new NearAI({ apiKey: ai.nearai.apiKey, baseUrl: ai.nearai.baseUrl });
  if (!client.hasKey) return null;
  const attestor = new Attestor({ client, requireGpu: ai.requireGpu, dir: ai.attestationsDir, log });
  return supportPanel({ client, attestor, models: ai.jury.models, extrasOf: async (model) => JSON.parse(`{${(await view("get_model", { model }))?.extras_json || ""}}`), log });
}

/**
 * One minute of the Sentinel. Never throws.
 * @param {object} p prepare()'s context
 * @param {{ budgetMs?: number, log?: (m: string) => void, now?: () => number }} [o]
 */
export async function runSentinel(p, { budgetMs = 50_000, log = () => {}, now = Date.now } = {}) {
  const t0 = now();
  const rpc = new Rpc(p.api.rpcUrls, { timeoutMs: 6000 });
  const view = (method, args = {}) => rpc.viewFunction(p.api.marketId, method, args);
  let stats;
  try { stats = await view("stats", {}); } catch (e) { return { ok: false, at: new Date(t0).toISOString(), error: `the market's stats did not answer: ${e.message}` }; }
  if (BigInt(String(stats?.bonds_micro ?? "0")) === 0n) return { ok: true, at: new Date(t0).toISOString(), idle: true, note: "No bond is held, so no challenge is live." };

  const lock = await p.state.acquire("sentinel", { ttlMs: budgetMs + 30_000, waitMs: 0 }).catch(() => null);
  if (!lock) return { ok: true, at: new Date(t0).toISOString(), busy: true, note: "The last minute's Sentinel is still looking." };
  try {
    const accounts = { sentinel: p.operatorAccounts?.sentinel ?? null, checker: p.operatorAccounts?.checker ?? null };
    const round = await sentinelRound({
      stats,
      view,
      ledger: { read: () => readLedger(p.state), putCheck: (id, c) => putCheck(p.state, id, c), putSentinel: (id, e) => putSentinel(p.state, id, e) },
      check: (a) => checkReceipts({ ...a, support: support(p, view, log), limits: SENTINEL_LIMITS, log }),
      dispute: accounts.sentinel ? (intent, d) => withSentinelSigner(p, (signer) => signer.dispute(intent, d), log) : null,
      accounts,
      now,
      left: () => t0 + budgetMs - now(),
      log,
    });
    // a dispute's events reach the store now, so /api/rulings shows it before the next index
    for (const x of round.disputed) {
      if (!x.tx) continue;
      await txEvents(rpc, p.api.marketId, x.tx, accounts.sentinel, { attempts: 3 }).then((r) => recordEvents(r.events)).catch((e) => log(`sentinel: events of ${x.tx}: ${e.message}`));
    }
    return { ok: round.errors.length === 0, ...round, sentinel: accounts.sentinel, ms: now() - t0 };
  } catch (e) {
    return { ok: false, at: new Date(t0).toISOString(), error: e.message };
  } finally {
    await lock.release();
  }
}
