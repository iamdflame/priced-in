// The signer: a separate OS process, and the only process that holds keys that move money.
//
// The agent process (the one that talks to models and reads the web) never receives key
// material. It starts this process with paths it does not open itself, and then sends only
// small request objects over IPC. This process checks every request on its own, signs, sends,
// and answers with the transaction hash and the contract's return value. It never sends a key
// back and never logs one.
//
// What it holds:
//   - swarm agents' runner keys (KEYSTORE_DIR, runner-*.json): an agent is driven only when the
//     swarm lists it with a runner_public_key this keystore holds. Agents whose key we don't
//     hold are counted and left alone. Every key must be a function-call key on the market
//     limited to buy, sell and redeem.
//   - legacy agents with their own accounts (SIGNER_KEYS_FILE), under the same rule.
//   - the operator's function-call keys (operator-market.json: anchor_rewrite and
//     charge_inference; operator-swarm.json: sweep_escrow). A key allowing anything else is
//     refused.
//
// Requests: agents | trade | redeem | bill | anchor | issue_key | outcome. Every money request
// carries an intent id. The intent and each signed transaction hash are journaled
// (SIGNER_JOURNAL) BEFORE broadcast, the outcome after, so a restart neither forgets a spend nor
// sends the same intent twice: a known intent returns its recorded outcome, and an intent whose
// outcome is unknown is looked up on-chain by its hashes instead of being re-sent.
//
// Caps enforced here, whatever the agent process asks: $2 per bet, a daily spend cap per agent
// (buys), a daily inference-bill cap per agent, buy/sell/redeem only for agents, and the
// daily totals survive restarts because they are rebuilt from the journal.

import { fork } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { Rpc } from "../../api/src/rpc.mjs";
import { loadConfig } from "../../api/src/config.mjs";
import { FunctionCallSender } from "./txsender.js";
import { Journal } from "./journal.js";
import { loadKeystore, newRunnerKey } from "./keystore.js";

export const HARD_MAX_BET_MICRO = 2_000_000n; // $2: the policy cap, enforced again here
export const HARD_MAX_BILL_MICRO = 5_000_000n; // $5 in one inference bill
export const AGENT_METHODS = ["buy", "sell", "redeem"];
export const OPERATOR_METHODS = { market: ["anchor_rewrite", "charge_inference"], swarm: ["sweep_escrow"] };
export const DECISION_FIELDS = ["agent", "claim_id", "action", "side", "amount_micro", "min_shares_micro", "shares_micro", "min_proceeds_micro"];
const SELF = fileURLToPath(import.meta.url);
const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const INTENT_RE = /^[A-Za-z0-9:._-]{8,160}$/;
const SUPERSEDED_AFTER_MS = Number(process.env.SIGNER_SUPERSEDED_AFTER_MS || 120_000);
const NEVER_LANDED_MS = 26 * 3600_000; // past NEAR's transaction validity window (~1 day of blocks)
const digits = (s, n) => typeof s === "string" && new RegExp(`^\\d{1,${n}}$`).test(s);

/** Strict check of a trade decision; returns the cleaned decision or throws. */
export function validateDecision(d, { maxBetMicro = HARD_MAX_BET_MICRO } = {}) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("a decision must be an object");
  const extra = Object.keys(d).filter((k) => !DECISION_FIELDS.includes(k));
  if (extra.length) throw new Error(`unexpected fields in the decision: ${extra.join(", ")}`);
  if (typeof d.agent !== "string" || !ACCOUNT_RE.test(d.agent)) throw new Error("agent must be the agent's NEAR account");
  if (!Number.isSafeInteger(d.claim_id) || d.claim_id < 0) throw new Error("claim_id must be a whole number");
  if (d.side !== "yes" && d.side !== "no") throw new Error("side must be yes or no");
  const set = (k) => d[k] !== undefined && d[k] !== null;
  if (d.action === "buy") {
    if (set("shares_micro") || set("min_proceeds_micro")) throw new Error("a buy carries amount_micro and min_shares_micro only");
    if (!digits(d.amount_micro, 12)) throw new Error("amount_micro must be a decimal string");
    if (!digits(d.min_shares_micro, 15)) throw new Error("min_shares_micro must be a decimal string");
    const amt = BigInt(d.amount_micro);
    const cap = maxBetMicro < HARD_MAX_BET_MICRO ? maxBetMicro : HARD_MAX_BET_MICRO;
    if (amt <= 0n) throw new Error("amount must be positive");
    if (amt > cap) throw new Error(`amount ${d.amount_micro} is over the per-bet cap of ${cap} micro-USDC`);
    return { agent: d.agent, claim_id: d.claim_id, action: "buy", side: d.side, amount_micro: d.amount_micro, min_shares_micro: d.min_shares_micro };
  }
  if (d.action === "sell") {
    if (set("amount_micro") || set("min_shares_micro")) throw new Error("a sale carries shares_micro and min_proceeds_micro only");
    if (!digits(d.shares_micro, 15) || BigInt(d.shares_micro) <= 0n) throw new Error("shares_micro must be a positive decimal string");
    if (!digits(d.min_proceeds_micro, 12)) throw new Error("min_proceeds_micro must be a decimal string");
    return { agent: d.agent, claim_id: d.claim_id, action: "sell", side: d.side, shares_micro: d.shares_micro, min_proceeds_micro: d.min_proceeds_micro };
  }
  throw new Error("action must be buy or sell");
}

/** Strict check of an inference bill. */
export function validateBill(b, { maxBillMicro = HARD_MAX_BILL_MICRO } = {}) {
  if (!b || typeof b.agent !== "string" || !ACCOUNT_RE.test(b.agent)) throw new Error("bill: agent must be a NEAR account");
  if (b.route !== "balance" && b.route !== "escrow") throw new Error("bill: route must be balance or escrow");
  if (!digits(b.amount_micro, 12) || BigInt(b.amount_micro) <= 0n) throw new Error("bill: amount_micro must be a positive decimal string");
  if (BigInt(b.amount_micro) > maxBillMicro) throw new Error(`bill: ${b.amount_micro} is over the per-bill cap of ${maxBillMicro} micro-USD`);
  if (typeof b.usage_hash !== "string" || !HEX64.test(b.usage_hash)) throw new Error("bill: usage_hash must be 64 lowercase hex");
  return { agent: b.agent, route: b.route, amount_micro: b.amount_micro, usage_hash: b.usage_hash };
}

/** Strict check of a rewrite anchor. */
export function validateAnchor(a) {
  if (!a || !Number.isSafeInteger(a.claim_id) || a.claim_id < 0) throw new Error("anchor: claim_id must be a whole number");
  if (!Number.isSafeInteger(a.version) || a.version < 1) throw new Error("anchor: version must be a positive whole number");
  for (const k of ["prices_hash", "request_hash", "response_hash"]) if (typeof a[k] !== "string" || !HEX64.test(a[k])) throw new Error(`anchor: ${k} must be 64 lowercase hex`);
  if (typeof a.signature_hex !== "string" || !/^[0-9a-f]{128}$/.test(a.signature_hex)) throw new Error("anchor: signature_hex must be 128 lowercase hex");
  if (typeof a.model !== "string" || !a.model || a.model.length > 128) throw new Error("anchor: model must be 1..128 characters");
  return { claim_id: a.claim_id, version: a.version, prices_hash: a.prices_hash, request_hash: a.request_hash, response_hash: a.response_hash, signature_hex: a.signature_hex, model: a.model };
}

/** Is this access key a function-call key on `receiverId` limited to `allowed`? null when it is. */
export function checkPermission(ak, receiverId, allowed = AGENT_METHODS) {
  const p = ak?.permission;
  const only = allowed.join(", ");
  if (p === "FullAccess" || p?.FullAccess !== undefined) return "a full-access key: refused (function-call keys only)";
  const fc = p?.FunctionCall;
  if (!fc) return "not a function-call key";
  if (fc.receiver_id !== receiverId) return `the key is for ${fc.receiver_id}, not ${receiverId}`;
  const methods = fc.method_names || [];
  if (!methods.length) return `the key allows every method of ${receiverId}: refused (${only} only)`;
  const bad = methods.filter((m) => !allowed.includes(m));
  if (bad.length) return `the key allows ${bad.join(", ")}: refused (${only} only)`;
  return null;
}

// ---------- the parent side: no keys here ----------

export class SignerClient {
  /**
   * @param {{ marketId: string, rpcUrls: string[], network?: string, swarmId?: string|null, keystoreDir?: string|null, keysFile?: string|null,
   *   journalFile?: string|null, maxBetMicro?: number, dailySpendMicro?: number, dailyBillMicro?: number, yoctoPerMicro?: bigint|string,
   *   maxIssued?: number, log?: (m: string) => void, startTimeoutMs?: number }} o
   */
  constructor(o) {
    this.o = o;
    this.log = o.log || (() => {});
    this.child = null;
    this.waiting = new Map();
    this.seq = 0;
    this.agents = [];
  }

  /** Start the signer process. Resolves with the agents it accepted (public keys only). */
  start() {
    const o = this.o;
    // the child's whole environment: no model key, no agent key, only paths
    const env = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      NEAR_NETWORK: o.network || "testnet",
      MARKET_CONTRACT_ID: o.marketId,
      SWARM_CONTRACT_ID: o.swarmId || "",
      KEYSTORE_DIR: o.keystoreDir || "",
      SIGNER_KEYS_FILE: o.keysFile || "",
      SIGNER_JOURNAL: o.journalFile || "",
      RPC_URLS: o.rpcUrls.join(","),
      SIGNER_MAX_BET_MICRO: String(o.maxBetMicro ?? Number(HARD_MAX_BET_MICRO)),
      SIGNER_DAILY_SPEND_MICRO: String(o.dailySpendMicro ?? 10_000_000),
      SIGNER_DAILY_BILL_MICRO: String(o.dailyBillMicro ?? 2_000_000),
      SIGNER_YOCTO_PER_MICRO: String(o.yoctoPerMicro ?? 0),
      SIGNER_MAX_ISSUED: String(o.maxIssued ?? 50),
      SIGNER_SUPERSEDED_AFTER_MS: String(o.supersededAfterMs ?? 120_000),
    };
    this.child = fork(SELF, ["--signer-child"], { env, stdio: ["ignore", "pipe", "pipe", "ipc"], execArgv: [] });
    this.child.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => this.log(`signer: ${l}`)));
    this.child.stderr.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => this.log(`signer!: ${l}`)));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the signer did not start in time")), o.startTimeoutMs ?? 30000);
      this.child.on("message", (m) => {
        if (m?.type === "ready") { clearTimeout(timer); this.ready = m; this.agents = m.agents; resolve(m.agents); return; }
        if (m?.type === "fatal") { clearTimeout(timer); reject(new Error(`signer: ${m.error}`)); return; }
        const w = this.waiting.get(m?.id);
        if (w) { this.waiting.delete(m.id); w(m); }
      });
      this.child.on("exit", (code) => {
        clearTimeout(timer);
        for (const w of this.waiting.values()) w({ ok: false, error: `the signer exited (${code})` });
        this.waiting.clear();
        this.child = null;
        reject(new Error(`the signer exited (${code})`));
      });
    });
  }

  request(msg, timeoutMs = 60000) {
    if (!this.child) return Promise.resolve({ ok: false, error: "the signer is not running" });
    const id = ++this.seq;
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiting.delete(id); resolve({ ok: false, error: "the signer did not answer in time", timeout: true }); }, timeoutMs);
      this.waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
      this.child.send({ ...msg, id });
    });
  }

  /** The agents this signer can drive, refreshed from the swarm. */
  async listAgents({ force = false } = {}) {
    const r = await this.request({ type: "agents", force });
    if (r.ok) { this.agents = r.agents; this.unheld = r.unheld; this.operator = r.operator; }
    return r;
  }

  /** Send a trade decision. Only the decision fields cross the process boundary. */
  trade(intent, decision) {
    const d = {};
    for (const k of DECISION_FIELDS) if (decision[k] !== undefined) d[k] = decision[k];
    return this.request({ type: "trade", intent, decision: d });
  }

  /** Legacy shape: a buy. */
  bet(decision, intent = `bet:${Date.now()}:${Math.random().toString(36).slice(2)}`) {
    return this.trade(intent, { ...decision, action: decision.action || "buy" });
  }

  redeem(intent, agent, claim_id) { return this.request({ type: "redeem", intent, agent, claim_id }); }
  bill(intent, bill) { return this.request({ type: "bill", intent, bill: { agent: bill.agent, route: bill.route, amount_micro: bill.amount_micro, usage_hash: bill.usage_hash } }); }
  anchor(intent, a) { return this.request({ type: "anchor", intent, anchor: a }); }
  issueKey(persona_hash) { return this.request({ type: "issue_key", persona_hash }); }
  outcome(intent) { return this.request({ type: "outcome", intent }); }
  spent() { return this.request({ type: "spent" }); }

  accountOf(agent) {
    return this.agents.find((a) => (a.label === agent || a.accountId === agent) && a.ok)?.accountId || null;
  }

  async stop() {
    if (!this.child) return;
    const c = this.child;
    await new Promise((r) => { c.once("exit", r); c.kill(); setTimeout(r, 2000).unref?.(); });
  }
}

// ---------- the child side: the only place keys exist ----------

async function runChild() {
  const env = process.env;
  const { config, errors } = loadConfig({ NEAR_NETWORK: env.NEAR_NETWORK, RPC_URLS: env.RPC_URLS, MARKET_CONTRACT_ID: env.MARKET_CONTRACT_ID });
  if (errors.length || !config.marketId) { process.send({ type: "fatal", error: errors.join("; ") || "MARKET_CONTRACT_ID is not set" }); process.exit(1); }
  const marketId = config.marketId;
  const wrongSuffix = config.network === "testnet" ? ".near" : ".testnet";
  const swarmId = env.SWARM_CONTRACT_ID || null;
  if (swarmId && swarmId.endsWith(wrongSuffix)) { process.send({ type: "fatal", error: `SWARM_CONTRACT_ID ${swarmId} is not a ${config.network} account` }); process.exit(1); }
  const maxBet = BigInt(env.SIGNER_MAX_BET_MICRO || HARD_MAX_BET_MICRO);
  const dailyCap = BigInt(env.SIGNER_DAILY_SPEND_MICRO || 10_000_000);
  const dailyBillCap = BigInt(env.SIGNER_DAILY_BILL_MICRO || 2_000_000);
  const yoctoPerMicro = BigInt(env.SIGNER_YOCTO_PER_MICRO || 0);
  const maxIssued = Number(env.SIGNER_MAX_ISSUED || 50);
  const ksDir = env.KEYSTORE_DIR || null;
  const rpc = new Rpc(config.rpcUrls, { timeoutMs: 8000 });
  const journal = new Journal(env.SIGNER_JOURNAL || null);
  const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

  // ----- the journal: intents, attempts and outcomes; daily totals rebuilt from it -----
  const intents = new Map(); // id -> { intent, hashes: [], outcome }
  const spend = new Map(); // `${agent}|${day}` -> micro reserved or spent on buys
  const billed = new Map(); // `${agent}|${day}` -> micro billed
  const bump = (m, k, v) => m.set(k, (m.get(k) || 0n) + v);
  const releaseIntent = (it) => {
    if (it.spend_micro) bump(spend, `${it.agent}|${it.day}`, -BigInt(it.spend_micro));
    if (it.bill_micro) bump(billed, `${it.agent}|${it.day}`, -BigInt(it.bill_micro));
  };
  for (const r of journal.read()) {
    if (r.t === "intent") {
      intents.set(r.id, { intent: r, hashes: [], attempts: [], outcome: null });
      if (r.spend_micro) bump(spend, `${r.agent}|${r.day}`, BigInt(r.spend_micro));
      if (r.bill_micro) bump(billed, `${r.agent}|${r.day}`, BigInt(r.bill_micro));
    } else if (r.t === "attempt") { const x = intents.get(r.id); if (x) { x.hashes.push(r.hash); x.attempts.push(r); } }
    else if (r.t === "outcome") {
      const rec = intents.get(r.id);
      if (!rec) continue;
      rec.outcome = r;
      if (r.final && !r.ok) releaseIntent(rec.intent); // a clear failure spent nothing
    }
  }

  // ----- keys -----
  const agents = new Map(); // accountId -> entry
  let unheld = 0, lastRefresh = 0, keystoreErrors = [];
  const operator = {};
  let file = null;
  if (env.SIGNER_KEYS_FILE) {
    try { file = JSON.parse(fs.readFileSync(env.SIGNER_KEYS_FILE, "utf8")); } catch (e) { process.send({ type: "fatal", error: `cannot read the keys file (${e.code || "bad JSON"})` }); process.exit(1); }
  }
  const senderFor = (accountId, privateKey, receiverId) => {
    let kp;
    try { kp = KeyPair.fromString(privateKey); } catch { throw new Error("the private key is malformed"); } // never echo the parser's message
    return new FunctionCallSender({ rpc, accountId, keyPair: kp, receiverId });
  };
  async function admit(entry, receiverId, allowed) {
    try {
      const ak = await entry.sender.accessKey();
      const bad = checkPermission(ak, receiverId, allowed);
      if (bad) throw new Error(bad);
      entry.methods = ak.permission.FunctionCall.method_names;
      entry.allowanceYocto = ak.permission.FunctionCall.allowance ?? null;
      entry.ok = true;
      entry.error = null;
    } catch (e) {
      entry.ok = false;
      entry.error = /UNKNOWN_ACCESS_KEY|does not exist/i.test(`${e.message} ${e.rpcCause?.name || ""}`) ? "the key is not on the account" : e.message;
    }
    entry.checked = entry.ok;
  }
  for (const [name, a] of Object.entries(file?.agents || {})) {
    const entry = { accountId: a.accountId, label: name, source: "static", ok: false, error: null, swarm: null };
    try {
      if (!a.accountId || a.accountId.endsWith(wrongSuffix)) throw new Error(`account ${a.accountId} is not a ${config.network} account`);
      entry.sender = senderFor(a.accountId, a.privateKey, marketId);
      entry.publicKey = entry.sender.publicKey;
      await admit(entry, marketId, AGENT_METHODS);
    } catch (e) { entry.error = e.message; }
    agents.set(a.accountId || name, entry);
  }

  async function listSwarm() {
    const out = [];
    for (let from = 0; ; from += 100) {
      const page = await rpc.viewFunction(swarmId, "get_agents", { from, limit: 100 });
      out.push(...page);
      if (page.length < 100) return out;
    }
  }

  async function refresh(force = false) {
    if (!force && Date.now() - lastRefresh < 1000) return;
    lastRefresh = Date.now();
    const ks = loadKeystore(ksDir);
    keystoreErrors = ks.errors;
    for (const role of ["market", "swarm"]) {
      const k = ks.operator[role];
      if (!k || operator[role]?.publicKey === k.publicKey && operator[role].ok) continue;
      const receiver = role === "market" ? marketId : swarmId;
      const entry = { role, accountId: k.accountId, publicKey: k.publicKey, ok: false, error: null };
      try {
        if (!receiver) throw new Error("SWARM_CONTRACT_ID is not set");
        if (k.accountId.endsWith(wrongSuffix)) throw new Error(`account ${k.accountId} is not a ${config.network} account`);
        entry.sender = senderFor(k.accountId, k.privateKey, receiver);
        await admit(entry, receiver, OPERATOR_METHODS[role]);
      } catch (e) { entry.error = e.message; }
      operator[role] = entry;
    }
    if (!swarmId) return;
    const listed = await listSwarm();
    let n = 0;
    for (const a of listed) {
      const rec = ks.runners.get(a.runner_public_key);
      if (!rec) { n++; continue; } // not ours to drive
      let entry = agents.get(a.account);
      if (!entry) {
        entry = { accountId: a.account, label: rec.label, source: "swarm", ok: false, error: null, publicKey: a.runner_public_key };
        try { entry.sender = senderFor(a.account, rec.privateKey, marketId); } catch (e) { entry.error = e.message; }
        agents.set(a.account, entry);
      }
      entry.swarm = a;
      if (a.closed || a.deleted) { entry.ok = false; entry.error = a.deleted ? "deleted" : "closed by its owner"; continue; }
      if (entry.sender && !entry.checked) await admit(entry, marketId, AGENT_METHODS);
    }
    unheld = n;
  }

  const view = () => [...agents.values()].map((e) => ({
    accountId: e.accountId, label: e.label, source: e.source, ok: e.ok, error: e.error, publicKey: e.publicKey ?? null, methods: e.methods ?? null,
    allowanceYocto: e.allowanceYocto ?? null,
    swarm: e.swarm ? { id: e.swarm.id, owner: e.swarm.owner, model: e.swarm.model, persona_hash: e.swarm.persona_hash, escrow_yocto: e.swarm.escrow_yocto, charged_yocto: e.swarm.charged_yocto, sleeping: e.swarm.sleeping, closed: e.swarm.closed, deleted: e.swarm.deleted } : null,
  }));
  const opView = () => Object.fromEntries(Object.entries(operator).map(([k, v]) => [k, { accountId: v.accountId, publicKey: v.publicKey, ok: v.ok, error: v.error, methods: v.methods ?? null }]));
  const spentView = () => {
    const d = day(), out = {};
    for (const [k, v] of spend) { const [a, dd] = k.split("|"); if (dd === d) (out[a] ||= {}).spend_micro = String(v); }
    for (const [k, v] of billed) { const [a, dd] = k.split("|"); if (dd === d) (out[a] ||= {}).billed_micro = String(v); }
    return { day: d, agents: out };
  };

  try { await refresh(true); } catch (e) { console.log(`swarm listing failed at start: ${e.message}`); }
  for (const e of agents.values()) console.log(`${e.label} ${e.accountId} ${e.ok ? `ready (function-call key ${e.publicKey}, methods ${e.methods.join(",")})` : `refused: ${e.error}`}`);
  for (const [role, e] of Object.entries(operator)) console.log(`operator ${role} ${e.accountId} ${e.ok ? `ready (methods ${e.methods.join(",")})` : `refused: ${e.error}`}`);
  if (unheld) console.log(`${unheld} swarm agent(s) whose runner key this keystore does not hold: left alone`);
  process.send({ type: "ready", agents: view(), unheld, operator: opView(), spent: spentView() });

  // ----- outcomes: from the journal, else from the chain by the journaled hashes -----
  function finish(rec, outcome) {
    const o = { t: "outcome", id: rec.intent.id, at: new Date().toISOString(), ...outcome };
    journal.append(o);
    rec.outcome = o;
    if (o.final && !o.ok) releaseIntent(rec.intent);
    return o;
  }
  async function reconcile(rec) {
    let unknown = 0;
    for (const h of rec.hashes) {
      let tx;
      try { tx = await rpc.txStatus(h, rec.intent.signer, "EXECUTED_OPTIMISTIC", { timeoutMs: 8000 }); }
      catch (e) { if (e.rpcCause?.name === "UNKNOWN_TRANSACTION") unknown++; continue; }
      const failure = tx?.status?.Failure;
      if (failure) return finish(rec, { ok: false, final: true, txHash: h, error: failure?.ActionError?.kind?.FunctionCallError?.ExecutionError || JSON.stringify(failure).slice(0, 300), reconciled: true });
      if (tx?.status && "SuccessValue" in tx.status) {
        let value = null;
        try { value = tx.status.SuccessValue ? JSON.parse(Buffer.from(tx.status.SuccessValue, "base64").toString("utf8")) : null; } catch { value = null; }
        return finish(rec, { ok: true, final: true, txHash: h, value, reconciled: true });
      }
    }
    // No node knows any of its transactions, and the key has since used their nonces for later
    // transactions: they can never be included. (A landed transaction would have been found;
    // the two-minute wait covers indexing lag.)
    const nonces = rec.attempts.map((a) => a.nonce).filter((n) => n !== undefined && n !== null).map(BigInt);
    const last = rec.attempts.at(-1);
    if (rec.intent.key && unknown === rec.hashes.length && nonces.length === rec.hashes.length && nonces.length && last && Date.now() - Date.parse(last.at) > SUPERSEDED_AFTER_MS) {
      const ak = await rpc.viewAccessKey(rec.intent.signer, rec.intent.key).catch(() => null);
      const max = nonces.reduce((a, b) => (a > b ? a : b));
      if (ak && BigInt(ak.nonce) >= max) return finish(rec, { ok: false, final: true, txHash: last.hash, error: `never landed: no node knows it and the key's nonce (${ak.nonce}) has passed it`, reconciled: true });
    }
    if (Date.now() - Date.parse(rec.intent.at) > NEVER_LANDED_MS) return finish(rec, { ok: false, final: true, txHash: rec.hashes.at(-1) ?? null, error: "never landed: past the transaction validity window", reconciled: true });
    return null;
  }

  /** Run one money intent exactly once. `reserve` books caps synchronously before any await. */
  async function once(id, kind, { agent, signer, sender, method, args, gasTgas = 30, reserve = {} }) {
    if (typeof id !== "string" || !INTENT_RE.test(id)) throw new Error("an intent id is required");
    const known = intents.get(id);
    if (known) {
      if (known.outcome?.final) return { ...known.outcome, replayed: true };
      const r = await reconcile(known);
      if (r) return { ...r, replayed: true };
      return { ok: false, final: false, pending: true, txHash: known.hashes.at(-1) ?? null, error: "this intent's outcome is not known yet; it is not re-sent" };
    }
    const it = { t: "intent", id, kind, agent, signer, key: sender.publicKey, method, args, day: day(), at: new Date().toISOString(), ...reserve };
    const rec = { intent: it, hashes: [], attempts: [], outcome: null };
    intents.set(id, rec);
    if (reserve.spend_micro) bump(spend, `${agent}|${it.day}`, BigInt(reserve.spend_micro));
    if (reserve.bill_micro) bump(billed, `${agent}|${it.day}`, BigInt(reserve.bill_micro));
    journal.append(it);
    try {
      const r = await sender.call(method, args, { gasTgas, onSigned: (hash, nonce) => { const a = { t: "attempt", id, hash, nonce: String(nonce), at: new Date().toISOString() }; rec.hashes.push(hash); rec.attempts.push(a); journal.append(a); } });
      return finish(rec, { ok: true, final: true, txHash: r.txHash, value: r.value });
    } catch (e) {
      if (e.maybeSent) return finish(rec, { ok: false, final: false, unknown: true, txHash: e.txHash, error: `sent, outcome unknown: ${e.message}` });
      return finish(rec, { ok: false, final: true, txHash: e.txHash ?? null, error: e.message });
    }
  }

  const agentEntry = (account) => {
    const a = agents.get(account);
    if (!a || !a.ok) throw new Error(`no usable key for agent ${account}${a?.error ? ` (${a.error})` : ""}`);
    return a;
  };
  const opEntry = (role) => {
    const o = operator[role];
    if (!o?.ok) throw new Error(`no usable operator key for the ${role} (${o?.error || "none in the keystore"})`);
    return o;
  };

  async function handle(m) {
    switch (m?.type) {
      case "agents": await refresh(Boolean(m.force)); return { ok: true, agents: view(), unheld, operator: opView(), keystoreErrors };
      case "spent": return { ok: true, ...spentView() };
      case "outcome": {
        const rec = intents.get(m.intent);
        if (!rec) return { ok: false, final: true, unknownIntent: true, error: "this signer never saw that intent" };
        if (rec.outcome?.final) return rec.outcome;
        return (await reconcile(rec)) || { ok: false, final: false, pending: true, txHash: rec.hashes.at(-1) ?? null, error: "outcome not known yet" };
      }
      case "trade": {
        const d = validateDecision(m.decision, { maxBetMicro: maxBet });
        const a = agentEntry(d.agent);
        const reserve = {};
        if (d.action === "buy") {
          const k = `${d.agent}|${day()}`;
          if (!intents.has(m.intent) && (spend.get(k) || 0n) + BigInt(d.amount_micro) > dailyCap) throw new Error(`agent ${d.agent} would pass its daily spend cap of ${dailyCap} micro-USDC`);
          reserve.spend_micro = d.amount_micro;
        }
        const args = d.action === "buy"
          ? { claim_id: d.claim_id, side: d.side, amount_micro: d.amount_micro, min_shares_micro: d.min_shares_micro }
          : { claim_id: d.claim_id, side: d.side, shares_micro: d.shares_micro, min_proceeds_micro: d.min_proceeds_micro };
        const r = await once(m.intent, "trade", { agent: d.agent, signer: a.accountId, sender: a.sender, method: d.action, args, reserve });
        return { ...r, accountId: a.accountId, publicKey: a.publicKey };
      }
      case "redeem": {
        if (typeof m.agent !== "string" || !Number.isSafeInteger(m.claim_id) || m.claim_id < 0) throw new Error("redeem: agent and claim_id are required");
        const a = agentEntry(m.agent);
        return once(m.intent, "redeem", { agent: a.accountId, signer: a.accountId, sender: a.sender, method: "redeem", args: { claim_id: m.claim_id } });
      }
      case "bill": {
        const b = validateBill(m.bill);
        if (!agents.has(b.agent)) throw new Error(`bill: ${b.agent} is not an agent this signer runs`);
        const k = `${b.agent}|${day()}`;
        if (!intents.has(m.intent) && (billed.get(k) || 0n) + BigInt(b.amount_micro) > dailyBillCap) throw new Error(`bill: ${b.agent} would pass its daily inference-bill cap of ${dailyBillCap} micro-USD`);
        if (b.route === "escrow") {
          if (yoctoPerMicro <= 0n) throw new Error("bill: no NEAR rate is configured for escrow bills");
          const o = opEntry("swarm");
          return once(m.intent, "bill", { agent: b.agent, signer: o.accountId, sender: o.sender, method: "sweep_escrow", args: { agent_id: b.agent, amount_yocto: String(BigInt(b.amount_micro) * yoctoPerMicro), usage_hash: b.usage_hash }, reserve: { bill_micro: b.amount_micro } });
        }
        const o = opEntry("market");
        return once(m.intent, "bill", { agent: b.agent, signer: o.accountId, sender: o.sender, method: "charge_inference", args: { agent: b.agent, amount_micro: b.amount_micro, usage_hash: b.usage_hash }, reserve: { bill_micro: b.amount_micro } });
      }
      case "anchor": {
        const a = validateAnchor(m.anchor);
        const o = opEntry("market");
        return once(m.intent, "anchor", { agent: null, signer: o.accountId, sender: o.sender, method: "anchor_rewrite", args: a, gasTgas: 50 });
      }
      case "issue_key": {
        if (!ksDir) throw new Error("no KEYSTORE_DIR: this signer cannot issue runner keys");
        if (typeof m.persona_hash !== "string" || !HEX64.test(m.persona_hash)) throw new Error("persona_hash must be 64 lowercase hex");
        const ks = loadKeystore(ksDir);
        const used = new Set([...agents.values()].map((e) => e.publicKey));
        const waiting = [...ks.runners.values()].filter((r) => r.label === "issued" && !used.has(r.publicKey)).length;
        if (waiting >= maxIssued) throw new Error(`${waiting} issued runner keys are still waiting for a spawn; try again later`);
        const k = newRunnerKey(ksDir, { label: "issued", persona_hash: m.persona_hash });
        journal.append({ t: "issued", publicKey: k.publicKey, persona_hash: m.persona_hash, at: new Date().toISOString() });
        return { ok: true, publicKey: k.publicKey };
      }
      default: throw new Error("unknown request");
    }
  }

  process.on("message", async (m) => {
    try { const { t, id: intentId, ...rest } = (await handle(m)) || {}; process.send({ ...rest, ...(intentId ? { intent: intentId } : {}), id: m?.id }); }
    catch (e) { process.send({ id: m?.id, ok: false, final: true, error: e.message, txHash: e.txHash ?? null }); }
  });
  process.on("disconnect", () => process.exit(0));
}

if (process.argv.includes("--signer-child") && process.send) runChild();
