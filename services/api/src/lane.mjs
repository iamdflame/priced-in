// The judges' lane: adds a visitor's browser-held key to the pooled lane account as a
// function-call key on the market (buy, sell, open_and_buy, redeem, claim_lane; 0.25 NEAR allowance),
// so the visitor's first bet needs no wallet. Requests that arrive while a transaction is in
// flight ride the next one together (one AddKey action each), so a burst of judges costs
// one round trip per batch instead of one each, and nonces never race.

import { KeyPair, KeyPairSigner, PublicKey, actions, createTransaction, baseDecode, baseEncode } from "near-api-js";
import { RpcError, sleep } from "./rpc.mjs";

const TGAS = 10n ** 12n;

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Validate and normalise "ed25519:<base58 32 bytes>". */
export function parsePublicKey(s) {
  if (typeof s !== "string" || s.length > 100) throw new ApiError(400, "invalid_public_key", "publicKey must be a string like ed25519:<base58>");
  const t = s.trim();
  if (!t.startsWith("ed25519:")) throw new ApiError(400, "invalid_public_key", "publicKey must be an ed25519 key: ed25519:<base58>");
  let bytes;
  try { bytes = baseDecode(t.slice(8)); } catch { throw new ApiError(400, "invalid_public_key", "publicKey is not valid base58"); }
  if (bytes.length !== 32) throw new ApiError(400, "invalid_public_key", `publicKey must be 32 bytes, got ${bytes.length}`);
  return `ed25519:${baseEncode(bytes)}`;
}

/** Find which AddKey failed in a batch (ActionError index), if that's what happened. */
function addKeyExistsIndex(failure) {
  const ae = failure?.ActionError;
  if (ae?.kind?.AddKeyAlreadyExists) return ae.index ?? 0;
  return null;
}

export class LaneIssuer {
  /**
   * @param {{ rpc: import('./rpc.mjs').Rpc, config: object, stats: () => Promise<object>, now?: () => number, log?: (m: string) => void }} o
   */
  constructor({ rpc, config, stats, now = Date.now, log = () => {} }) {
    this.rpc = rpc;
    this.cfg = config.lane;
    this.marketId = config.marketId;
    this.publicRpcUrls = config.publicRpcUrls;
    this.stats = stats;
    this.now = now;
    this.log = log;
    this.enabled = Boolean(this.cfg.accountId && this.cfg.privateKey && this.marketId);
    if (this.enabled) {
      this.adminKey = KeyPair.fromString(this.cfg.privateKey);
      this.signer = new KeyPairSigner(this.adminKey);
      this.adminPublicKey = this.adminKey.getPublicKey().toString();
    }
    this.queue = [];
    this.busy = false;
    this.nonce = null;
    this.blockHash = null;
    this.blockHashAt = 0;
    /** publicKey -> issuedAt, for keys that haven't been seen trading */
    this.outstanding = new Map();
    this.issuedTotal = 0;
    this.lastIssueMs = null;
  }

  /** A trade by a lane identity spends that key's credit: it no longer holds a slot. */
  noteTrade(trader) {
    if (typeof trader === "string" && trader.startsWith("lane:")) this.outstanding.delete(trader.slice(5));
  }

  pruneOutstanding() {
    const cutoff = this.now() - 86_400_000;
    for (const [k, t] of this.outstanding) if (t < cutoff) this.outstanding.delete(k);
  }

  /**
   * The contract-side budget, mirrored: refuse a key whose $1 credit the contract couldn't pay.
   * credits = floor(min(lane_budget, treasury) / lane_credit) minus keys issued in the last 24 h
   * that haven't traded yet.
   */
  async budget() {
    const s = await this.stats();
    const credit = BigInt(s.lane_credit_micro);
    const budget = BigInt(s.lane_budget_micro);
    const treasury = BigInt(s.treasury_micro);
    const pool = budget < treasury ? budget : treasury;
    const credits = credit > 0n ? Number(pool / credit) : 0;
    this.pruneOutstanding();
    return { paused: s.paused, credits, outstanding: this.outstanding.size, free: credits - this.outstanding.size, creditMicro: s.lane_credit_micro };
  }

  async recentBlockHash() {
    if (this.blockHash && this.now() - this.blockHashAt < 60_000) return this.blockHash;
    const b = await this.rpc.block("final");
    this.blockHash = b.header.hash;
    this.blockHashAt = this.now();
    return this.blockHash;
  }

  /** Read the admin nonce and a block hash ahead of the first request, and keep the hash fresh. */
  async warm() {
    if (!this.enabled) return;
    try {
      if (this.nonce === null) {
        const ak = await this.rpc.viewAccessKey(this.cfg.accountId, this.adminPublicKey, "optimistic");
        if (this.nonce === null && !this.busy) this.nonce = BigInt(ak.nonce);
      }
      this.blockHash = null;
      await this.recentBlockHash();
    } catch (e) {
      this.log(`lane warm-up: ${e.message}`);
    }
  }

  async adminNonce() {
    if (this.nonce === null) {
      const ak = await this.rpc.viewAccessKey(this.cfg.accountId, this.adminPublicKey, "optimistic");
      this.nonce = BigInt(ak.nonce);
    }
    return ++this.nonce;
  }

  /** Issue one key. Resolves with what the browser needs to sign its first bet at once. */
  issue(publicKey) {
    if (!this.enabled) return Promise.reject(new ApiError(503, "lane_unavailable", "The judges' lane is not configured on this server."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ApiError(504, "lane_timeout", "Adding your key took too long. Try again in a few seconds.")), this.cfg.issueDeadlineMs);
      this.queue.push({ publicKey, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.pump();
    });
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const batch = [];
        const seen = new Map();
        while (this.queue.length && seen.size < this.cfg.batchMax) {
          const item = this.queue.shift();
          if (seen.has(item.publicKey)) seen.get(item.publicKey).push(item);
          else { seen.set(item.publicKey, [item]); batch.push(item.publicKey); }
        }
        try {
          const results = await this.addKeys(batch);
          for (const pk of batch) {
            const r = results.get(pk);
            for (const item of seen.get(pk)) r instanceof Error ? item.reject(r) : item.resolve(r);
          }
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(502, "lane_upstream_error", `Could not add your key: ${e.message}`);
          for (const items of seen.values()) for (const item of items) item.reject(err);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  /** Add a batch of keys in one transaction; returns publicKey -> result or Error. */
  async addKeys(keys) {
    const results = new Map();
    let todo = [...keys];
    for (let attempt = 0; attempt < 4 && todo.length; attempt++) {
      const t0 = this.now();
      const nonce = await this.adminNonce();
      const blockHash = await this.recentBlockHash();
      const acts = todo.map((pk) => actions.addFunctionCallAccessKey(PublicKey.fromString(pk), this.marketId, this.cfg.methods, this.cfg.allowanceYocto));
      const tx = createTransaction(this.cfg.accountId, this.adminKey.getPublicKey(), this.cfg.accountId, nonce, acts, baseDecode(blockHash));
      const { txHash, signedTransaction } = await this.signer.signTransaction(tx);
      const b64 = Buffer.from(signedTransaction.encode()).toString("base64");
      let outcome;
      try {
        outcome = await this.rpc.sendTxRace(b64, baseEncode(txHash), this.cfg.accountId, { deadlineMs: this.cfg.issueDeadlineMs - 1000 });
      } catch (e) {
        const msg = `${e.message} ${JSON.stringify(e.data || "")}`;
        if (/InvalidNonce|nonce/i.test(msg)) { this.nonce = null; continue; }
        if (/Expired|InvalidChain|block hash/i.test(msg)) { this.blockHash = null; continue; }
        this.nonce = null; // unknown state: re-read the nonce next time
        throw e instanceof RpcError ? new ApiError(502, "lane_upstream_error", "The NEAR RPC did not accept the key. Try again.") : e;
      }
      const failure = outcome.status?.Failure;
      if (failure) {
        const idx = addKeyExistsIndex(failure);
        if (idx !== null && todo[idx]) {
          // a key that already exists on the lane: hand back its nonce, retry the rest
          const pk = todo[idx];
          results.set(pk, await this.describeKey(pk, false).catch((e) => e));
          todo = todo.filter((_, i) => i !== idx);
          continue;
        }
        throw new ApiError(502, "lane_tx_failed", `Adding the key failed on-chain: ${JSON.stringify(failure).slice(0, 300)}`);
      }
      this.lastIssueMs = this.now() - t0;
      const described = await Promise.all(todo.map((pk) => this.describeKey(pk, true).catch((e) => e)));
      todo.forEach((pk, i) => results.set(pk, described[i]));
      todo = [];
    }
    for (const pk of todo) results.set(pk, new ApiError(502, "lane_upstream_error", "Could not add your key after several tries."));
    return results;
  }

  /** The key's nonce and a fresh block hash: everything needed to sign the first bet. */
  async describeKey(pk, fresh) {
    let ak = null;
    for (let i = 0; i < 12 && !ak; i++) {
      try {
        const r = await this.rpc.viewAccessKey(this.cfg.accountId, pk, "optimistic");
        if (r && !r.error) ak = r; // some nodes answer an unknown key with result.error
        else await sleep(200);
      } catch (e) {
        if (e.rpcCause?.name !== "UNKNOWN_ACCESS_KEY" && !e.transport) throw e;
        await sleep(200);
      }
    }
    if (!ak) throw new ApiError(502, "lane_upstream_error", "The key was added but is not visible yet. Try again.");
    const blockHash = this.recentBlockHash();
    const perm = ak.permission?.FunctionCall;
    if (!perm || perm.receiver_id !== this.marketId) throw new ApiError(409, "key_conflict", "That key already exists on the lane account with other permissions.");
    if (fresh) {
      this.outstanding.set(pk, this.now());
      this.issuedTotal++;
    }
    return {
      laneAccountId: this.cfg.accountId,
      contractId: this.marketId,
      publicKey: pk,
      nonce: String(ak.nonce),
      blockHash: await blockHash,
      rpc: this.publicRpcUrls[0],
      rpcs: this.publicRpcUrls,
      methods: perm.method_names,
      allowanceYocto: perm.allowance ?? null,
      maxGasTgas: 20,
      reused: !fresh,
    };
  }

  async adminBalance() {
    if (!this.enabled) return null;
    const a = await this.rpc.viewAccount(this.cfg.accountId, "final");
    return Number(BigInt(a.amount) / 10n ** 21n) / 1000;
  }
}

export { TGAS };
