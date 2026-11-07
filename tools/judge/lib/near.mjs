// Read-only NEAR JSON-RPC with failover. No dependencies, no keys: the judge only reads.
export const TESTNET_RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org", "https://testnet-rpc.intea.rs"];
export const MAINNET_RPCS = ["https://rpc.fastnear.com", "https://near.lava.build", "https://rpc.mainnet.near.org"];
// Ordinary nodes keep a few days of transactions; older ones are only on archival nodes.
export const TESTNET_ARCHIVAL = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"];
export const MAINNET_ARCHIVAL = ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"];
const UNKNOWN_TX = /UNKNOWN_TRANSACTION|doesn.t exist/i;

export class Rpc {
  constructor(urls = TESTNET_RPCS, timeoutMs = 15_000, archival = urls.some((u) => /mainnet|rpc\.fastnear\.com|lava/.test(u) && !/test/.test(u)) ? MAINNET_ARCHIVAL : TESTNET_ARCHIVAL) {
    this.urls = urls;
    this.timeoutMs = timeoutMs;
    this.archival = archival;
  }
  async call(method, params) {
    let last;
    for (const url of this.urls) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "judge", method, params }), signal: AbortSignal.timeout(this.timeoutMs) });
          if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
          const j = await r.json();
          if (j.error) {
            const msg = JSON.stringify(j.error.data ?? j.error.cause ?? j.error.message ?? j.error);
            // a real answer from the chain (unknown account, a panic): don't retry it elsewhere
            if (!/TIMEOUT|Timeout|too many requests|429|UNAVAILABLE/i.test(msg)) { const e = new Error(msg); e.chain = true; throw e; }
            throw new Error(msg);
          }
          if (j.result?.error) { const e = new Error(String(j.result.error)); e.chain = true; throw e; }
          return j.result;
        } catch (e) {
          if (e.chain) throw e;
          last = e;
        }
      }
    }
    throw last;
  }
  async view(contract, method, args = {}) {
    const r = await this.call("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
    return JSON.parse(Buffer.from(r.result).toString("utf8"));
  }
  account(id) { return this.call("query", { request_type: "view_account", finality: "final", account_id: id }); }
  state(id, prefix = "") { return this.call("query", { request_type: "view_state", finality: "final", account_id: id, prefix_base64: Buffer.from(prefix).toString("base64") }); }
  async tx(hash, sender) {
    const params = { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" };
    try { return await this.call("EXPERIMENTAL_tx_status", params); } catch (e) {
      if (!UNKNOWN_TX.test(String(e.message)) || !this.archival?.length) throw e;
      return new Rpc(this.archival, this.timeoutMs, []).call("EXPERIMENTAL_tx_status", params);
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
