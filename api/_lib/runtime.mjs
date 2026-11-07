// The Priced In services on Vercel functions, with no long-running process.
//
// The same createApp (services/api) and mountAi (services/ai) the server runs, built in a
// function instance:
//   read mode  one app per instance answers the API's routes; its rewrites, rationales and market
//              events are refreshed from the store at most every 1.5 s
//   job mode   POST /api/after-trade, /api/after-challenge and the cron take the store's job lock,
//              rebuild DATA_DIR from the store, start the AI layer's hooks (the signer process
//              included), drive the writer, the agents or the jury directly, wait for them, upload
//              what they appended, and stop
// The scanner and SSE are replaced: trades reach the store through after-trade (the browser
// reports its own trade once it is final, and the function checks it on-chain) and through the
// agents' own transactions; the browser polls.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig } from "../../services/ai/src/config.js";
import { createApp } from "../../services/api/src/app.mjs";
import { extractMarketEvents } from "../../services/api/src/events.mjs";
import { RewriteStore } from "../../services/api/src/rewrites.mjs";
import { mountAi } from "../../services/ai/src/mount.js";
import { Writer } from "../../services/ai/src/writer.js";
import { makeState, JournalDir } from "./store.mjs";
import { installSpendMeter } from "./spend.mjs";
import { ClaimsSnapshot } from "./snapshot.mjs";
import { storeMeter } from "./meter.mjs";
import { ledgerChecks } from "./sentinel.mjs";
import { cachedLines, mergeNews, newsConfig } from "./news.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");
const TMP = path.join(os.tmpdir(), "pricedin");
export const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

let prepared = null;

/** Once per instance: defaults for this runtime, secrets written to /tmp, the store, the spend meter. */
export function prepare() {
  if (prepared) return prepared;
  // a background upload that fails is logged and retried by the next flush; it never takes the instance down
  process.on("unhandledRejection", (e) => log(`unhandled: ${e?.message || e}`));
  const env = process.env;
  const set = (k, v) => { if (env[k] === undefined || env[k] === "") env[k] = v; };
  set("NEAR_NETWORK", "testnet");
  set("DATA_DIR", path.join(TMP, "data"));
  set("KEYSTORE_DIR", path.join(TMP, "keystore"));
  set("TRUST_PROXY", "1");
  set("AGENT_WEB_SEARCH", "0");
  set("AGENT_SWEEP_MS", "0");
  set("AGENT_BILLING", "none");
  set("JURY_AUTO", "0");
  set("POST_SELF_HOSTS", "isitpriced.com,www.isitpriced.com");
  const pages = path.join(REPO, "api/_data/pages.json");
  if (fs.existsSync(pages)) set("PAGES_FILE", pages);
  const evidence = path.join(REPO, "tools/judge/evidence/rewrite.json");
  if (fs.existsSync(evidence)) set("REWRITE_EVIDENCE_FILES", evidence);
  // the attestor writes fresh bundles next to the committed ones: a writable copy
  const att = path.join(TMP, "attestations");
  fs.mkdirSync(att, { recursive: true });
  const src = path.join(REPO, "services/ai/attestations");
  if (fs.existsSync(src)) for (const f of fs.readdirSync(src)) if (!fs.existsSync(path.join(att, f))) fs.copyFileSync(path.join(src, f), path.join(att, f));
  set("ATTESTATIONS_DIR", att);

  // keys that move money live only in files the signer process opens: the bundle arrives as one
  // encrypted environment variable, is written out with mode 0600, and is removed from this
  // process's environment before any model code runs
  let operatorAccountId = null;
  const operatorAccounts = {}; // role -> account, public: the Sentinel needs to know its own and the Checker's
  if (env.PRICEDIN_KEYSTORE) {
    const bundle = JSON.parse(Buffer.from(env.PRICEDIN_KEYSTORE, "base64").toString("utf8"));
    delete env.PRICEDIN_KEYSTORE;
    fs.mkdirSync(env.KEYSTORE_DIR, { recursive: true, mode: 0o700 });
    for (const [name, rec] of Object.entries(bundle.keystore || {})) {
      if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) continue;
      fs.writeFileSync(path.join(env.KEYSTORE_DIR, name), JSON.stringify(rec), { mode: 0o600 });
      if (rec.kind === "operator" && rec.role === "market") operatorAccountId = rec.accountId;
      if (rec.kind === "operator" && rec.role && rec.accountId) operatorAccounts[rec.role] = rec.accountId;
    }
    if (bundle.signerKeys) {
      const f = path.join(TMP, "keys", "signer-keys.json");
      fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      fs.writeFileSync(f, JSON.stringify(bundle.signerKeys), { mode: 0o600 });
      env.SIGNER_KEYS_FILE = f;
    }
  }
  const { api, ai, errors } = loadAiConfig(env);
  if (errors.length) throw new Error(`configuration: ${errors.join("; ")}`);
  const state = makeState({ prefix: `state/${api.network}/${api.marketId || "no-market"}`, log });
  const journals = new JournalDir(state, env.DATA_DIR, { log });
  const spend = installSpendMeter({ baseUrl: ai.nearai.baseUrl, capUsd: Number(env.NEARAI_DAILY_CAP_USD || 1), dir: env.DATA_DIR, log });
  const claims = new ClaimsSnapshot({ urls: api.rpcUrls, marketId: api.marketId, state, log });
  prepared = { env, api, ai, state, journals, spend, claims, operatorAccountId, operatorAccounts, laneAccountId: api.lane.accountId };
  return prepared;
}

// ---------- building the app ----------

/** A crowd that sees no agents: a writer-only job never touches the agents' keys. */
const NO_AGENTS = { listAgents: async () => ({ ok: true, agents: [], unheld: 0 }) };

function build({ agents = true } = {}) {
  const p = prepare();
  const { api, ai } = loadAiConfig(p.env);
  const meter = storeMeter({ state: p.state, journals: p.journals, limit: api.credence.freePerIpPerDay, log });
  const app = createApp(api, { log, meter });
  const evidence = new Map();
  for (const list of app.rewrites.byKey.values()) for (const r of list) evidence.set(r.id, r);
  // every claims read in this app comes from the snapshot (one get_claims, raced across the RPCs)
  if (app.claims) {
    const one = app.claims.one.bind(app.claims);
    // with NEWS_ENABLED=1 a news line carries its question, source and date, so the truth API answers about it too
    const news = newsConfig(p.env).enabled;
    app.claims.all = async () => { const claims = (await p.claims.decorated()).claims; return news ? mergeNews(claims, await cachedLines(p.state).catch(() => null)) : claims; };
    app.claims.one = async (id) => (await app.claims.all()).find((c) => c.id === id) ?? one(id);
  }
  // the jury's receipt checks live in the store's Sentinel ledger, shared by every instance
  const receipts = { store: ledgerChecks(p.state) };
  const layer = mountAi(app, ai, { log, overrides: agents ? { receipts } : { receipts, crowd: { signer: NO_AGENTS, reconcile: null } } });
  for (const r of evidence.values()) if (!app.rewrites.get(r.id) || app.rewrites.get(r.id).anchor?.status !== "anchored") app.rewrites.put(r);
  for (const e of p.journals.read("events.jsonl")) app.hub.publish(e);
  return { app, layer, ai, api, evidence };
}

/** The journals' contents, applied in place to a running read-mode app. */
function refresh(ctx) {
  const p = prepare();
  const recs = p.journals.read("rewrites.jsonl");
  const store = new RewriteStore();
  // the writer's own restore logic, over a read-only view of the journal
  new Writer({ client: { hasKey: false }, model: null, store, hub: { publish() {} }, claims: null, journal: { read: () => recs, append() {}, rewrite() {} } });
  for (const r of ctx.evidence.values()) if (!store.get(r.id) || store.get(r.id).anchor?.status !== "anchored") store.put(r);
  ctx.app.rewrites.byKey = store.byKey;
  if (ctx.layer.crowd) ctx.layer.crowd.rationales = p.journals.read("rationales.jsonl").slice(-500);
  for (const e of p.journals.read("events.jsonl")) ctx.app.hub.publish(e);
}

let readCtx = null;
let hydrating = null;

/** The read-mode app, current to within ~1.5 s of the store. */
export async function readContext() {
  const p = prepare();
  if (!readCtx || Date.now() - p.journals.hydratedAt > 1500) {
    hydrating ||= (async () => {
      try {
        const changed = await p.journals.hydrate();
        if (!readCtx) readCtx = build();
        else if (changed) refresh(readCtx);
        readCtx.storeError = null;
      } catch (e) {
        log(`store: ${e.message}`);
        if (!readCtx) readCtx = build();
        readCtx.storeError = e.message;
      }
    })().finally(() => { hydrating = null; });
    await hydrating;
  }
  return readCtx;
}

// ---------- chain events ----------

/** A transaction's market events, in the scanner's record shape. */
export async function txEvents(rpc, marketId, txHash, senderId, { attempts = 6 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const tx = await rpc.txStatus(txHash, senderId, "EXECUTED_OPTIMISTIC", { timeoutMs: 8000 });
      const status = tx?.final_execution_status;
      let blockHeight = null, blockTimestampMs = null;
      try {
        const b = await rpc.call("block", { block_id: tx.transaction_outcome.block_hash }, { timeoutMs: 6000 });
        blockHeight = b.header.height;
        blockTimestampMs = Math.floor(Number(b.header.timestamp_nanosec) / 1e6);
      } catch { /* the events stand without the block's time */ }
      const events = extractMarketEvents(tx, marketId).map((e) => ({
        uid: e.uid, event: e.event, version: e.version, data: e.data,
        txHash, receiptId: e.receiptId, signerId: tx.transaction?.signer_id ?? senderId,
        blockHeight, blockTimestampMs, seenAtMs: Date.now(),
      }));
      return { tx, events, status };
    } catch (e) {
      last = e;
      if (/does not exist|UNKNOWN_TRANSACTION|not found/i.test(e.message) && i < attempts - 1) { await new Promise((r) => setTimeout(r, 700 * (i + 1))); continue; }
      if (i < attempts - 1) { await new Promise((r) => setTimeout(r, 500 * (i + 1))); continue; }
    }
  }
  throw last;
}

/** Append market events to the store (once each, by uid). Returns the new ones. */
export async function recordEvents(events) {
  const p = prepare();
  await p.journals.hydrate().catch(() => {});
  const seen = new Set(p.journals.read("events.jsonl").map((e) => e.uid));
  const fresh = events.filter((e) => e.uid && !seen.has(e.uid));
  for (const e of fresh) p.journals.append("events.jsonl", e);
  if (fresh.length) await Promise.all([p.journals.flush().catch((e) => log(`events: flush: ${e.message}`)), p.claims.refresh().catch(() => {})]);
  return fresh;
}

// ---------- job mode ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the writer, the agents and the signer have nothing in flight (or the deadline). */
async function idle(layer, deadline, { lateSignatureMs = 25_000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const w = layer.writer;
    const writerBusy = w ? [...w.paragraphs.values()].some((s) => s.busy || s.again) : false;
    const lateWait = w && w.timers.size > 0 && Date.now() - t0 < lateSignatureMs;
    const crowdBusy = layer.crowd ? layer.crowd.busy.size > 0 : false;
    const signerBusy = layer.signer ? layer.signer.waiting.size > 0 : false;
    if (!writerBusy && !lateWait && !crowdBusy && !signerBusy) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

/**
 * Run work under the job lock with the AI layer started.
 * @param {string} name for logs
 * @param {(ctx: object) => Promise<object>} work
 * @param {{ waitMs?: number, budgetMs?: number, reanchor?: boolean }} [o]
 */
export async function runJob(name, work, { lock: lockName = "ai-job", agents = true, waitMs = 120_000, budgetMs = 150_000, reanchor = false } = {}) {
  const p = prepare();
  const t0 = Date.now();
  // who waits for a lock says so: the cron gives the agents' lock up between its steps
  if (waitMs > 0) p.state.putDoc(`locks/${lockName}-wanted.json`, { at: Date.now(), by: name }, { etag: (await p.state.getDoc(`locks/${lockName}-wanted.json`).catch(() => null))?.etag ?? null }).catch(() => {});
  const lock = await p.state.acquire(lockName, { ttlMs: budgetMs + 60_000, waitMs });
  if (!lock) return { ok: false, busy: true, error: `another job held the ${lockName} lock for too long` };
  const timings = { lock_ms: Date.now() - t0 };
  let app = null, layer = null;
  const txs = new Map(); // txHash -> sender: agents' trades and anchors, recorded as market events afterwards
  try {
    p.journals.etag = null;
    await p.journals.hydrate();
    timings.hydrate_ms = Date.now() - t0 - timings.lock_ms;
    ({ app, layer } = build({ agents }));
    // upload whatever the AI layer publishes as it happens, so polling browsers see it at once
    let timer = null;
    app.hub.subscribe((e) => {
      if (e.source !== "ai") return;
      if (e.event === "agent_rationale" && e.data?.tx_hash) txs.set(e.data.tx_hash, e.data.account_id);
      if (e.event === "rewrite" && e.data?.anchor?.status === "anchored" && e.data.anchor.tx_hash) txs.set(e.data.anchor.tx_hash, p.operatorAccountId);
      clearTimeout(timer);
      timer = setTimeout(() => p.journals.flush().catch(() => {}), 200);
    });
    const reanchorFn = layer.writer?.reanchor?.bind(layer.writer);
    if (layer.writer) layer.writer.reanchor = async () => 0; // only the cron re-anchors
    const tHooks = Date.now();
    // the AI layer's start (the signer process, the roster, open intents): work that needs no key
    // (the writer's model call) begins at once; whatever needs the signer awaits `started`
    const started = (async () => {
      for (const fn of app.hooks.start) await fn();
      layer.crowd?.stop(); // its cycle loop belongs to the cron; the trade path drives rounds directly
      timings.start_ms = Date.now() - tHooks;
    })();
    started.catch((e) => log(`${name}: start: ${e.message}`));
    const out = await work({ app, layer, p, started, reanchor: reanchor ? reanchorFn : null, deadline: t0 + budgetMs, track: (hash, sender) => { if (hash && sender) txs.set(hash, sender); }, wanted: async () => { const d = await p.state.getDoc(`locks/${lockName}-wanted.json`).catch(() => null); return d?.value?.at > t0 && d.value.by !== name; } });
    await started.catch(() => {});
    const settled = await idle(layer, Math.max(t0 + budgetMs, Date.now() + 20_000)); // an anchor already sent is always waited for
    await p.spend.settle();
    // the agents' and the operator's transactions become market events in the store too
    // (the most recent dozen, in parallel: a re-anchoring backlog must not hold the job)
    const evs = [];
    await Promise.all([...txs].filter(([, s2]) => s2).slice(-12).map(async ([hash, sender]) => {
      try { evs.push(...(await txEvents(app.rpc, p.api.marketId, hash, sender, { attempts: 3 })).events); } catch (e) { log(`${name}: events of ${hash}: ${e.message}`); }
    }));
    for (const e of evs) if (!p.journals.read("events.jsonl").some((x) => x.uid === e.uid)) p.journals.append("events.jsonl", e);
    if (agents) await p.state.updateDoc("snapshots/status.json", () => ({ at: new Date().toISOString(), job: name, status: safeStatus(layer.status()), spend: p.spend.status() })).catch((e) => log(`${name}: status snapshot: ${e.message}`));
    timings.total_ms = Date.now() - t0;
    return { ok: true, settled, timings, ...out };
  } finally {
    if (app) for (const fn of app.hooks.stop) { try { await fn(); } catch { /* keep stopping */ } }
    await p.journals.flush().catch((e) => log(`${name}: final flush: ${e.message}`));
    await lock.release();
  }
}

/** The AI status without anything that is not for the public (no key material is in it; trimmed). */
function safeStatus(s) {
  return JSON.parse(JSON.stringify(s, (k, v) => (/private|secret/i.test(k) ? undefined : v)));
}

/** A JSON body from a Node request, capped. */
export function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (c) => { size += c.length; if (size <= limit) parts.push(c); });
    req.on("end", () => {
      if (size > limit) return reject(Object.assign(new Error("body too large"), { status: 413 }));
      const raw = Buffer.concat(parts).toString("utf8");
      try { resolve(raw.trim() ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error("the body is not valid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

export function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*", ...headers });
  res.end(JSON.stringify(obj, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
