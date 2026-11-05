// JSON-RPC client for NEAR with ordered failover, per-call timeouts and per-URL health.
// Reads go to the healthiest URL first and fall through to the next on network errors,
// timeouts, rate limits and "this node doesn't have it yet" errors. Errors that are a real
// answer (a contract panic, an invalid transaction) are thrown at once, without failover.

export class RpcError extends Error {
  constructor(message, { name, cause, data, url, transport = false } = {}) {
    super(message);
    this.rpcName = name;
    this.rpcCause = cause;
    this.data = data;
    this.url = url;
    this.transport = transport;
  }
}

// Error causes that mean "ask another node" rather than "this is the answer".
const RETRYABLE_CAUSES = new Set([
  "UNKNOWN_BLOCK", "UNKNOWN_CHUNK", "NOT_SYNCED_YET", "NO_SYNCED_BLOCKS", "TIMEOUT_ERROR",
  "INTERNAL_ERROR", "UNAVAILABLE_SHARD", "GARBAGE_COLLECTED_BLOCK", "UNKNOWN_TRANSACTION",
]);

export function isRetryable(err) {
  if (!(err instanceof RpcError)) return true;
  if (err.transport) return true;
  return RETRYABLE_CAUSES.has(err.rpcCause?.name || err.rpcName);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

export class Rpc {
  /**
   * @param {string[]} urls ordered list; the first is preferred
   * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, cooldownMs?: number }} [opts]
   */
  constructor(urls, { timeoutMs = 5000, fetchImpl = globalThis.fetch, cooldownMs = 15000 } = {}) {
    if (!urls?.length) throw new Error("Rpc needs at least one URL");
    this.urls = urls;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.cooldownMs = cooldownMs;
    this.health = new Map(urls.map((u) => [u, { ok: null, lastOkAt: 0, lastErrorAt: 0, lastError: null, latencyMs: null }]));
    this.lastSuccessAt = 0;
    this.seq = 0;
  }

  /** URLs in try order: one whose latest result was a failure inside the cooldown goes last. */
  order() {
    const now = Date.now();
    const cold = (u) => {
      const h = this.health.get(u);
      return h.lastErrorAt > h.lastOkAt && now - h.lastErrorAt < this.cooldownMs ? 1 : 0;
    };
    return [...this.urls].sort((a, b) => cold(a) - cold(b));
  }

  /** One call against one URL. */
  async callOn(url, method, params, { timeoutMs = this.timeoutMs } = {}) {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let status = 0;
    let body = null;
    try {
      const res = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.seq, method, params }),
        signal: ac.signal,
      });
      status = res.status;
      const text = await res.text();
      try { body = JSON.parse(text); } catch { body = null; }
      if (!body || (!body.error && !("result" in body))) {
        throw new RpcError(`${res.ok ? "non-JSON-RPC reply" : `HTTP ${res.status}`} from ${hostOf(url)}`, { url, transport: true });
      }
    } catch (e) {
      const err = e instanceof RpcError ? e : new RpcError(
        ac.signal.aborted ? `timeout after ${timeoutMs} ms from ${hostOf(url)}` : `${hostOf(url)} unreachable: ${e.cause?.code || e.message}`,
        { url, transport: true },
      );
      this.mark(url, false, err.message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (body.error) {
      const e = body.error;
      const transport = e.code === -429 || status === 429 || (status >= 500 && !e.cause);
      const err = new RpcError(rpcMessage(e), { name: e.name, cause: e.cause, data: e.data, url, transport });
      // a node that answers with a real error is still reachable
      this.mark(url, !transport, transport ? err.message : null, Date.now() - t0);
      throw err;
    }
    this.mark(url, true, null, Date.now() - t0);
    return body.result;
  }

  mark(url, ok, error, latencyMs) {
    const h = this.health.get(url);
    if (!h) return;
    const now = Date.now();
    h.ok = ok;
    if (ok) {
      h.lastOkAt = now;
      if (latencyMs != null) h.latencyMs = latencyMs;
      this.lastSuccessAt = now;
    } else {
      h.lastErrorAt = now;
      h.lastError = error;
    }
  }

  /** A call with failover across URLs. */
  async call(method, params, opts = {}) {
    let last;
    for (const url of this.order()) {
      try {
        return await this.callOn(url, method, params, opts);
      } catch (e) {
        last = e;
        if (!isRetryable(e)) throw e;
      }
    }
    throw last;
  }

  block(ref, opts) {
    return this.call("block", typeof ref === "number" ? { block_id: ref } : { finality: ref || "final" }, opts);
  }

  chunk(chunkHash, opts) {
    return this.call("chunk", { chunk_id: chunkHash }, opts);
  }

  async viewFunction(accountId, methodName, args = {}, { finality = "optimistic", timeoutMs } = {}) {
    const r = await this.call("query", {
      request_type: "call_function",
      finality,
      account_id: accountId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    }, { timeoutMs });
    const bytes = Buffer.from(r.result);
    return bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
  }

  viewAccessKey(accountId, publicKey, finality = "optimistic") {
    return this.call("query", { request_type: "view_access_key", finality, account_id: accountId, public_key: publicKey });
  }

  viewAccount(accountId, finality = "final") {
    return this.call("query", { request_type: "view_account", finality, account_id: accountId });
  }

  /** A transaction's outcome with its receipts, waiting server-side until the given stage. */
  txStatus(txHash, senderId, waitUntil = "EXECUTED_OPTIMISTIC", opts = {}) {
    return this.call("EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: senderId, wait_until: waitUntil }, opts);
  }

  /**
   * Send a signed transaction the way the S3 spike measured fastest: a synchronous send to
   * the preferred RPC raced against an async broadcast to every other RPC plus status polls
   * every 250 ms. Resolves with the outcome at EXECUTED_OPTIMISTIC. Rejects at once with a
   * transaction error that is a real answer (an invalid nonce, say).
   */
  async sendTxRace(signedB64, txHash, senderId, { deadlineMs = 15000 } = {}) {
    const [first, ...rest] = this.order();
    const deadline = Date.now() + deadlineMs;
    let done = false;
    let definite = null;
    const sync = this.callOn(first, "send_tx", { signed_tx_base64: signedB64, wait_until: "EXECUTED_OPTIMISTIC" }, { timeoutMs: deadlineMs })
      .catch((e) => { if (!isRetryable(e)) definite = e; throw e; });
    for (const url of rest) this.callOn(url, "broadcast_tx_async", [signedB64], { timeoutMs: 3000 }).catch(() => {});
    const poll = (async () => {
      await sleep(1000);
      const targets = rest.length ? [...rest, first] : [first];
      while (!done && Date.now() < deadline) {
        if (definite) throw definite;
        for (const url of targets) {
          if (done || definite) break;
          try {
            const r = await this.callOn(url, "EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: senderId, wait_until: "EXECUTED_OPTIMISTIC" }, { timeoutMs: Math.max(400, Math.min(2500, deadline - Date.now())) });
            if (r?.status) return r;
          } catch (e) {
            if (!isRetryable(e)) throw e;
          }
        }
        await sleep(250);
      }
      throw definite || new RpcError(`transaction not seen executed within ${deadlineMs} ms`, { transport: true });
    })();
    try {
      return await Promise.any([sync, poll]);
    } catch (agg) {
      throw definite || agg.errors?.find((e) => !isRetryable(e)) || agg.errors?.[0] || agg;
    } finally {
      done = true;
    }
  }

  /** Probe every URL with `status`; used by /health. */
  probe({ timeoutMs = 2500 } = {}) {
    return Promise.all(this.urls.map(async (url) => {
      const t0 = Date.now();
      try {
        const s = await this.callOn(url, "status", [], { timeoutMs });
        return { url, ok: true, latencyMs: Date.now() - t0, chainId: s.chain_id, height: s.sync_info?.latest_block_height };
      } catch (e) {
        return { url, ok: false, error: e.message };
      }
    }));
  }
}

function rpcMessage(e) {
  const cause = e.cause?.name;
  const info = e.cause?.info;
  let detail = "";
  if (info && Object.keys(info).length) detail = info.error_message || JSON.stringify(info);
  else if (typeof e.data === "string") detail = e.data;
  else if (e.data) detail = JSON.stringify(e.data);
  return [e.name, cause, detail].filter(Boolean).join(": ").slice(0, 600);
}
