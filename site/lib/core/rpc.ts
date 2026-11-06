// Copied unchanged from web/src/core/rpc.ts (the proven engine). Fix bugs there first, then copy.
// NEAR JSON-RPC from the browser: reads with failover, and a transaction send raced across
// two RPCs (a synchronous send to one, an async broadcast to the other, and status polls on
// both every 250 ms), the way services/api sends the lane's own transactions.

export class RpcError extends Error {
  constructor(message: string, readonly info: { name?: string; cause?: string; data?: unknown; url?: string; transport?: boolean } = {}) {
    super(message);
    this.name = "RpcError";
  }
}

const RETRYABLE = new Set(["UNKNOWN_BLOCK", "UNKNOWN_CHUNK", "NOT_SYNCED_YET", "NO_SYNCED_BLOCKS", "TIMEOUT_ERROR", "INTERNAL_ERROR", "UNAVAILABLE_SHARD", "GARBAGE_COLLECTED_BLOCK", "UNKNOWN_TRANSACTION"]);

export const isRetryable = (e: unknown) => !(e instanceof RpcError) || Boolean(e.info.transport) || RETRYABLE.has(e.info.cause || e.info.name || "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TxOutcome {
  status: { SuccessValue?: string; Failure?: any } | string;
  transaction?: { hash: string; signer_id?: string };
  transaction_outcome?: { id: string; block_hash?: string };
  receipts_outcome?: { id: string; block_hash?: string; outcome: { executor_id: string; logs: string[]; status: any } }[];
  final_execution_status?: string;
}

export interface RpcOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  pollMs?: number;
}

export class NearRpc {
  readonly urls: string[];
  private f: typeof fetch;
  private timeoutMs: number;
  private pollMs: number;
  private id = 0;

  constructor(urls: string[], o: RpcOptions = {}) {
    if (!urls.length) throw new Error("NearRpc needs at least one URL");
    this.urls = [...new Set(urls)];
    this.f = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.timeoutMs = o.timeoutMs ?? 8000;
    this.pollMs = o.pollMs ?? 250;
  }

  async callOn<T = any>(url: string, method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    let j: any;
    try {
      const r = await this.f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }), signal: ac.signal });
      if (r.status === 429 || r.status >= 500) throw new RpcError(`${url} answered HTTP ${r.status}`, { url, transport: true });
      j = await r.json();
    } catch (e) {
      if (e instanceof RpcError) throw e;
      throw new RpcError(`${url} unreachable: ${(e as Error)?.message || e}`, { url, transport: true });
    } finally {
      clearTimeout(t);
    }
    if (j?.error) {
      const cause = j.error.cause?.name;
      const data = j.error.data ?? j.error.cause?.info;
      throw new RpcError(`${j.error.name || "RPC error"}${cause ? `: ${cause}` : ""} ${typeof data === "string" ? data : JSON.stringify(data ?? "")}`.trim(), { name: j.error.name, cause, data, url });
    }
    return j.result as T;
  }

  /** Try each URL in order on transport and "not here yet" errors. */
  async call<T = any>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    let last: unknown;
    for (const url of this.urls) {
      try { return await this.callOn<T>(url, method, params, timeoutMs); } catch (e) {
        if (!isRetryable(e)) throw e;
        last = e;
      }
    }
    throw last;
  }

  async view<T = any>(contractId: string, methodName: string, args: object = {}, finality: "optimistic" | "final" = "optimistic"): Promise<T> {
    const r = await this.call<{ result: number[] }>("query", { request_type: "call_function", finality, account_id: contractId, method_name: methodName, args_base64: b64(new TextEncoder().encode(JSON.stringify(args))) });
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
  }

  viewAccessKey(accountId: string, publicKey: string) {
    return this.call<{ nonce: number | string; permission: any; block_hash: string }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey });
  }

  async finalBlockHash(): Promise<string> {
    const b = await this.call<{ header: { hash: string } }>("block", { finality: "final" });
    return b.header.hash;
  }

  /**
   * Send a signed transaction, racing the RPCs, until it has executed (optimistically).
   * Resolves with the outcome, rejects with a definite error (an invalid transaction) at once,
   * or with a stall after deadlineMs.
   */
  async sendRace(signedB64: string, txHash: string, senderId: string, { deadlineMs = 12000 } = {}): Promise<TxOutcome> {
    const [first, ...rest] = this.urls;
    const deadline = Date.now() + deadlineMs;
    let done = false;
    let definite: unknown = null;
    const sync = this.callOn<TxOutcome>(first, "send_tx", { signed_tx_base64: signedB64, wait_until: "EXECUTED_OPTIMISTIC" }, deadlineMs)
      .catch((e) => { if (!isRetryable(e)) definite = e; throw e; });
    for (const url of rest) this.callOn(url, "broadcast_tx_async", [signedB64], 3000).catch(() => {});
    const poll = (async () => {
      await sleep(this.pollMs);
      while (!done && Date.now() < deadline) {
        for (const url of this.urls) {
          if (done) break;
          if (definite) throw definite;
          try {
            const r = await this.callOn<TxOutcome>(url, "EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: senderId, wait_until: "EXECUTED_OPTIMISTIC" }, Math.max(400, Math.min(2500, deadline - Date.now())));
            if (r?.status) return r;
          } catch (e) {
            if (!isRetryable(e)) throw e;
          }
        }
        await sleep(this.pollMs);
      }
      throw definite || new RpcError(`not executed within ${deadlineMs} ms`, { transport: true, name: "STALL" });
    })();
    try {
      return await Promise.any([sync, poll]);
    } catch (agg: any) {
      throw definite || agg?.errors?.find((e: unknown) => !isRetryable(e)) || agg?.errors?.find((e: any) => e?.info?.name === "STALL") || agg?.errors?.[0] || agg;
    } finally {
      done = true;
    }
  }

  /** Wait for a transaction to be final, polling every RPC. */
  async waitFinal(txHash: string, senderId: string, { deadlineMs = 20000 } = {}): Promise<TxOutcome> {
    const deadline = Date.now() + deadlineMs;
    let last: unknown = null;
    while (Date.now() < deadline) {
      for (const url of this.urls) {
        try {
          const r = await this.callOn<TxOutcome>(url, "EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: senderId, wait_until: "FINAL" }, Math.max(500, Math.min(4000, deadline - Date.now())));
          if (r?.status && (r.final_execution_status === undefined || r.final_execution_status === "FINAL")) return r;
        } catch (e) {
          if (!isRetryable(e)) throw e;
          last = e;
        }
      }
      await sleep(this.pollMs * 2);
    }
    throw new RpcError(`not final within ${deadlineMs} ms${last ? ` (${(last as Error).message})` : ""}`, { transport: true, name: "STALL" });
  }

  /** A transaction's outcome, for reading its logs (verify's anchor check). */
  txStatus(txHash: string, senderId: string) {
    return this.call<TxOutcome>("EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: senderId, wait_until: "NONE" });
  }
}

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The pricedin EVENT_JSON logs a receipt executed by `executor` emitted. */
export function eventsInOutcome(o: TxOutcome, executor: string): { event: string; data: any }[] {
  const out: { event: string; data: any }[] = [];
  for (const r of o.receipts_outcome || []) {
    if (r.outcome?.executor_id !== executor) continue;
    for (const log of r.outcome.logs || []) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const j = JSON.parse(log.slice(11));
        if (j?.standard !== "pricedin") continue;
        for (const d of Array.isArray(j.data) ? j.data : [j.data]) out.push({ event: j.event, data: d });
      } catch { /* not ours */ }
    }
  }
  return out;
}
