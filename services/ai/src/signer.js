// The house agents' signer: a separate OS process that holds the agents' function-call keys.
//
// The agent process (the one that talks to models and reads the web) never receives key
// material. It starts this process with the PATH to a keys file it does not open itself, and
// then sends only decision objects over IPC: { agent, claim_id, side, amount_micro,
// min_shares_micro }. This process checks every decision on its own (a $2 hard cap per bet,
// a daily spend cap per agent, buy only, known agents only), signs with the agent's key, sends
// the transaction, and answers with the transaction hash and the trade. It never sends a key
// back and never logs one.
//
// At start it refuses any key that is not a function-call key on the market limited to buy
// and sell, so even this process cannot move an agent's NEAR or withdraw its USDC.
//
// Keys file (git-ignored, readable by this process only):
//   { "agents": { "house-ledger": { "accountId": "ledger.pricedin.testnet", "privateKey": "ed25519:..." } } }

import { fork } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { Rpc } from "../../api/src/rpc.mjs";
import { loadConfig } from "../../api/src/config.mjs";
import { FunctionCallSender } from "./txsender.js";

export const HARD_MAX_BET_MICRO = 2_000_000n; // $2: the policy cap, enforced again here
export const DECISION_FIELDS = ["agent", "claim_id", "side", "amount_micro", "min_shares_micro"];
const ALLOWED_METHODS = new Set(["buy", "sell", "redeem"]);
const SELF = fileURLToPath(import.meta.url);

/** Strict check of a decision object; returns the cleaned decision or throws. */
export function validateDecision(d, { maxBetMicro = HARD_MAX_BET_MICRO } = {}) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("a decision must be an object");
  const extra = Object.keys(d).filter((k) => !DECISION_FIELDS.includes(k));
  if (extra.length) throw new Error(`unexpected fields in the decision: ${extra.join(", ")}`);
  if (typeof d.agent !== "string" || !/^[a-z0-9-]{1,40}$/.test(d.agent)) throw new Error("agent must be a short name");
  if (!Number.isSafeInteger(d.claim_id) || d.claim_id < 0) throw new Error("claim_id must be a whole number");
  if (d.side !== "yes" && d.side !== "no") throw new Error("side must be yes or no");
  if (typeof d.amount_micro !== "string" || !/^\d{1,12}$/.test(d.amount_micro)) throw new Error("amount_micro must be a decimal string");
  if (typeof d.min_shares_micro !== "string" || !/^\d{1,15}$/.test(d.min_shares_micro)) throw new Error("min_shares_micro must be a decimal string");
  const amt = BigInt(d.amount_micro);
  const cap = maxBetMicro < HARD_MAX_BET_MICRO ? maxBetMicro : HARD_MAX_BET_MICRO;
  if (amt <= 0n) throw new Error("amount must be positive");
  if (amt > cap) throw new Error(`amount ${d.amount_micro} is over the per-bet cap of ${cap} micro-USDC`);
  return { agent: d.agent, claim_id: d.claim_id, side: d.side, amount_micro: d.amount_micro, min_shares_micro: d.min_shares_micro };
}

/** Is this access key a function-call key on the market limited to buy, sell and redeem? */
export function checkPermission(ak, marketId) {
  const p = ak?.permission;
  if (p === "FullAccess" || p?.FullAccess !== undefined) return "a full-access key: refused (agents get function-call keys only)";
  const fc = p?.FunctionCall;
  if (!fc) return "not a function-call key";
  if (fc.receiver_id !== marketId) return `the key is for ${fc.receiver_id}, not the market ${marketId}`;
  const methods = fc.method_names || [];
  if (!methods.length) return "the key allows every method of the market: refused (buy, sell and redeem only)";
  const bad = methods.filter((m) => !ALLOWED_METHODS.has(m));
  if (bad.length) return `the key allows ${bad.join(", ")}: refused (buy, sell and redeem only)`;
  return null;
}

// ---------- the parent side: no keys here ----------

export class SignerClient {
  /**
   * @param {{ keysFile: string, marketId: string, rpcUrls: string[], network?: string, maxBetMicro?: number, dailySpendMicro?: number, log?: (m: string) => void, startTimeoutMs?: number }} o
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
    // the child's whole environment: no model key, no agent key, only the path to the keys file
    const env = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      NEAR_NETWORK: o.network || "testnet",
      SIGNER_KEYS_FILE: o.keysFile,
      MARKET_CONTRACT_ID: o.marketId,
      RPC_URLS: o.rpcUrls.join(","),
      SIGNER_MAX_BET_MICRO: String(o.maxBetMicro ?? Number(HARD_MAX_BET_MICRO)),
      SIGNER_DAILY_SPEND_MICRO: String(o.dailySpendMicro ?? 10_000_000),
    };
    this.child = fork(SELF, ["--signer-child"], { env, stdio: ["ignore", "pipe", "pipe", "ipc"], execArgv: [] });
    this.child.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => this.log(`signer: ${l}`)));
    this.child.stderr.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => this.log(`signer!: ${l}`)));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the signer did not start in time")), o.startTimeoutMs ?? 30000);
      this.child.on("message", (m) => {
        if (m?.type === "ready") { clearTimeout(timer); this.agents = m.agents; resolve(m.agents); return; }
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

  request(msg, timeoutMs = 45000) {
    if (!this.child) return Promise.resolve({ ok: false, error: "the signer is not running" });
    const id = ++this.seq;
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiting.delete(id); resolve({ ok: false, error: "the signer did not answer in time" }); }, timeoutMs);
      this.waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
      this.child.send({ ...msg, id });
    });
  }

  /** Send a decision. Only the decision fields cross the process boundary. */
  bet(decision) {
    const d = {};
    for (const k of DECISION_FIELDS) d[k] = decision[k];
    return this.request({ type: "bet", decision: d });
  }

  accountOf(agent) {
    return this.agents.find((a) => a.agent === agent && a.ok)?.accountId || null;
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
  const maxBet = BigInt(env.SIGNER_MAX_BET_MICRO || HARD_MAX_BET_MICRO);
  const dailyCap = BigInt(env.SIGNER_DAILY_SPEND_MICRO || 10_000_000);
  const rpc = new Rpc(config.rpcUrls, { timeoutMs: 8000 });
  let file;
  try { file = JSON.parse(fs.readFileSync(env.SIGNER_KEYS_FILE, "utf8")); } catch (e) { process.send({ type: "fatal", error: `cannot read the keys file (${e.code || "bad JSON"})` }); process.exit(1); }
  const wrongSuffix = config.network === "testnet" ? ".near" : ".testnet";
  const agents = new Map();
  const report = [];
  for (const [name, a] of Object.entries(file.agents || {})) {
    const r = { agent: name, accountId: a.accountId, publicKey: null, ok: false, error: null };
    try {
      if (!a.accountId || a.accountId.endsWith(wrongSuffix)) throw new Error(`account ${a.accountId} is not a ${config.network} account`);
      let kp;
      try { kp = KeyPair.fromString(a.privateKey); } catch { throw new Error("the private key is malformed"); } // never echo the parser's message
      r.publicKey = kp.getPublicKey().toString();
      const sender = new FunctionCallSender({ rpc, accountId: a.accountId, keyPair: kp, receiverId: marketId });
      const ak = await sender.accessKey();
      const bad = checkPermission(ak, marketId);
      if (bad) throw new Error(bad);
      r.methods = ak.permission.FunctionCall.method_names;
      r.allowanceYocto = ak.permission.FunctionCall.allowance ?? null;
      r.ok = true;
      agents.set(name, { sender, spent: new Map() });
    } catch (e) {
      r.error = e.message;
    }
    report.push(r);
    console.log(`${name} ${a.accountId} ${r.ok ? `ready (function-call key ${r.publicKey}, methods ${r.methods.join(",")})` : `refused: ${r.error}`}`);
  }
  process.send({ type: "ready", agents: report });

  process.on("message", async (m) => {
    if (m?.type !== "bet") return process.send({ id: m?.id, ok: false, error: "unknown request" });
    try {
      const d = validateDecision(m.decision, { maxBetMicro: maxBet });
      const a = agents.get(d.agent);
      if (!a) throw new Error(`no usable key for agent ${d.agent}`);
      const day = new Date().toISOString().slice(0, 10);
      const spent = a.spent.get(day) || 0n;
      if (spent + BigInt(d.amount_micro) > dailyCap) throw new Error(`agent ${d.agent} would pass its daily spend cap of ${dailyCap} micro-USDC`);
      a.spent.set(day, spent + BigInt(d.amount_micro));
      try {
        const r = await a.sender.call("buy", { claim_id: d.claim_id, side: d.side, amount_micro: d.amount_micro, min_shares_micro: d.min_shares_micro }, { gasTgas: 30 });
        process.send({ id: m.id, ok: true, txHash: r.txHash, trade: r.value, accountId: a.sender.accountId, publicKey: a.sender.publicKey });
      } catch (e) {
        a.spent.set(day, spent); // nothing was spent
        throw e;
      }
    } catch (e) {
      process.send({ id: m.id, ok: false, error: e.message, txHash: e.txHash ?? null });
    }
  });
  process.on("disconnect", () => process.exit(0));
}

if (process.argv.includes("--signer-child") && process.send) runChild();
