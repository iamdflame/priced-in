// Read-only NEAR JSON-RPC with failover. No dependencies, no keys: the judge only reads.
export const TESTNET_RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org", "https://testnet-rpc.intea.rs"];
export const MAINNET_RPCS = ["https://rpc.fastnear.com", "https://near.lava.build", "https://rpc.mainnet.near.org"];
// Ordinary nodes keep a few days of transactions; older ones are only on archival nodes.
export const TESTNET_ARCHIVAL = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"];
export const MAINNET_ARCHIVAL = ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"];
const UNKNOWN_TX = /UNKNOWN_TRANSACTION|doesn.t exist/i;

const RATE_LIMITED = /HTTP 429|too many requests|TooManyRequests|rate.?limit/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A check that threw for a reason outside our code: no network, a rate limit, a transaction an
 * RPC doesn't have, a node that is unavailable. Then the row is a SKIP with the reason, not "the
 * check itself crashed". Null for anything else: that is a real crash.
 */
export function crashAsSkip(e) {
  const text = `${e?.message ?? e} ${e?.cause?.code ?? ""}`;
  const reason = String(e?.cause?.code || e?.message || e).slice(0, 120);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|aborted|EAI_AGAIN/i.test(text)) return { status: "SKIP", detail: `offline or the RPC is unreachable: ${reason}`, see: "npm run judge -- --offline" };
  if (/\b429\b|too many requests|TooManyRequests/i.test(text)) return { status: "SKIP", detail: `rate-limited by the RPC (too many requests): ${reason}`, see: "run it again in a minute" };
  if (/UNKNOWN_TRANSACTION/.test(text)) return { status: "SKIP", detail: `no RPC we tried, archival included, returned the transaction (UNKNOWN_TRANSACTION): ${reason}`, see: "run it again in a minute" };
  if (/UNAVAILABLE/.test(text)) return { status: "SKIP", detail: `the RPC said it is unavailable: ${reason}`, see: "run it again in a minute" };
  return null;
}

/** Where a read is taken: one block when pinned (`{ blockId }`), else the latest final block. */
export function at(blockId) {
  return blockId == null ? { finality: "final" } : { block_id: blockId };
}

export class Rpc {
  constructor(urls = TESTNET_RPCS, timeoutMs = 15_000, archival = urls.some((u) => /mainnet|rpc\.fastnear\.com|lava/.test(u) && !/test/.test(u)) ? MAINNET_ARCHIVAL : TESTNET_ARCHIVAL, { fetchImpl = globalThis.fetch, backoffMs = [500, 1500, 4000] } = {}) {
    this.urls = urls;
    this.timeoutMs = timeoutMs;
    this.archival = archival;
    this.fetch = fetchImpl;
    // waits after an HTTP 429 (or "too many requests"), on the same URL, before the next one is tried
    this.backoffMs = backoffMs;
  }
  async call(method, params) {
    let last;
    for (const url of this.urls) {
      let limited = 0;
      for (let attempt = 0; attempt < 2 + limited; attempt++) {
        try {
          const r = await this.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "judge", method, params }), signal: AbortSignal.timeout(this.timeoutMs) });
          if (!r.ok) { const e = new Error(`${url}: HTTP ${r.status}`); if (r.status === 429) e.retryAfter = Number(r.headers?.get?.("retry-after")) || 0; throw e; }
          const j = await r.json();
          if (j.error) {
            const msg = JSON.stringify(j.error.data ?? j.error.cause ?? j.error.message ?? j.error);
            // a real answer from the chain (unknown account, a panic): don't retry it elsewhere.
            // UNKNOWN_BLOCK is a node behind the pinned block: the next node may have it.
            if (!/TIMEOUT|Timeout|too many requests|429|UNAVAILABLE|UNKNOWN_BLOCK/i.test(JSON.stringify(j.error))) { const e = new Error(msg); e.chain = true; throw e; }
            throw new Error(msg);
          }
          if (j.result?.error) { const e = new Error(String(j.result.error)); e.chain = true; throw e; }
          return j.result;
        } catch (e) {
          if (e.chain) throw e;
          last = e;
          // rate limited: wait and ask the same node again, a few times, before moving on
          if (RATE_LIMITED.test(String(e.message)) && limited < this.backoffMs.length) {
            await sleep(Math.min(10_000, Math.max(this.backoffMs[limited], (e.retryAfter || 0) * 1000)));
            limited++;
          }
        }
      }
    }
    throw last;
  }
  /** The latest final block's height: pass it as `blockId` so every read sees the same state. */
  async finalHeight() {
    return (await this.call("block", { finality: "final" })).header.height;
  }
  async view(contract, method, args = {}, { blockId } = {}) {
    const r = await this.call("query", { request_type: "call_function", ...at(blockId), account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
    return JSON.parse(Buffer.from(r.result).toString("utf8"));
  }
  account(id, { blockId } = {}) { return this.call("query", { request_type: "view_account", ...at(blockId), account_id: id }); }
  state(id, prefix = "", { blockId } = {}) { return this.call("query", { request_type: "view_state", ...at(blockId), account_id: id, prefix_base64: Buffer.from(prefix).toString("base64") }); }
  /** Reads bound to one block: `view(contract, method, args)` and `state(account, prefix)`. */
  pinned(blockId) {
    return { blockId, view: (c, m, a = {}) => this.view(c, m, a, { blockId }), state: (id, prefix = "") => this.state(id, prefix, { blockId }) };
  }
  async tx(hash, sender) {
    const params = { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" };
    try { return await this.call("EXPERIMENTAL_tx_status", params); } catch (e) {
      if (!UNKNOWN_TX.test(String(e.message)) || !this.archival?.length) throw e;
      return new Rpc(this.archival, this.timeoutMs, [], { fetchImpl: this.fetch, backoffMs: this.backoffMs }).call("EXPERIMENTAL_tx_status", params);
    }
  }
}

/** The market's NEP-297 events in a transaction, from receipts the market executed. */
export function marketEvents(tx, market) {
  const out = [];
  for (const r of tx.receipts_outcome || []) {
    if (r.outcome.executor_id !== market || r.outcome.status?.Failure) continue;
    for (const l of r.outcome.logs) {
      if (!l.startsWith("EVENT_JSON:")) continue;
      try {
        const j = JSON.parse(l.slice(11));
        if (j.standard === "pricedin") for (const d of j.data) out.push({ event: j.event, ...d });
      } catch { /* not ours */ }
    }
  }
  return out;
}
