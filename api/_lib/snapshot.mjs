// The market's claims, served from a snapshot: every read is answered at once from memory (or,
// on a cold instance, from the store's copy), and refreshed behind the answer with one get_claims
// view raced across every RPC (the first good answer wins, so a rate-limited endpoint and its
// retries never sit on the request path). after-trade and the cron refresh it too.

import { waitUntil } from "@vercel/functions";
import { decorateClaim } from "../../services/api/src/claims.mjs";

const FRESH_MS = 1500;
const STORE_EVERY_MS = 4000;

/** One view call sent to every RPC at once; the first valid answer wins. */
export function raceView(urls, contractId, method, args, { timeoutMs = 3000 } = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } });
  return new Promise((resolve, reject) => {
    let left = urls.length;
    const errors = [];
    const ac = new AbortController();
    const timer = setTimeout(() => { ac.abort(); reject(new Error(`no RPC answered ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    for (const url of urls) {
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ac.signal })
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok || j.error || !j.result?.result) throw new Error(`${new URL(url).host}: ${r.status} ${JSON.stringify(j.error ?? "").slice(0, 80)}`);
          clearTimeout(timer);
          ac.abort();
          resolve({ value: JSON.parse(Buffer.from(j.result.result).toString("utf8")), url, blockHeight: j.result.block_height });
        })
        .catch((e) => { errors.push(e.message); if (--left === 0) { clearTimeout(timer); reject(new Error(errors.join("; "))); } });
    }
  });
}

export class ClaimsSnapshot {
  /** @param {{ urls: string[], marketId: string, state: import('./store.mjs').BlobState, log?: (m: string) => void }} o */
  constructor({ urls, marketId, state, log = () => {} }) {
    Object.assign(this, { urls, marketId, state, log });
    this.snap = null; // { at, claims: [raw views], blockHeight, via }
    this.inflight = null;
    this.storedAt = 0;
    this.loadedFromStore = false;
  }

  /** Fetch now (one get_claims page of 100, more pages only if the market has more). */
  refresh() {
    this.inflight ||= (async () => {
      const t0 = Date.now();
      const all = [];
      let via = null, blockHeight = null;
      for (let from = 0; ; from += 100) {
        const r = await raceView(this.urls, this.marketId, "get_claims", { from, limit: 100 });
        all.push(...r.value);
        via ||= new URL(r.url).host;
        blockHeight ??= r.blockHeight;
        if (r.value.length < 100 || all.length >= 5000) break;
      }
      this.snap = { at: Date.now(), claims: all, blockHeight, via, ms: Date.now() - t0 };
      if (Date.now() - this.storedAt > STORE_EVERY_MS) {
        this.storedAt = Date.now();
        await this.state.updateDoc("snapshots/claims.json", () => this.snap).catch((e) => this.log(`claims snapshot: store: ${e.message}`));
      }
      return this.snap;
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** The newest snapshot this instance can give without waiting on the chain, refreshed behind it. */
  async get() {
    if (!this.snap && !this.loadedFromStore) {
      this.loadedFromStore = true;
      const d = await this.state.getDoc("snapshots/claims.json").catch(() => null);
      if (d?.value?.claims && (!this.snap || d.value.at > this.snap.at)) this.snap = d.value;
    }
    if (!this.snap) return this.refresh();
    if (Date.now() - this.snap.at > FRESH_MS) {
      const p = this.refresh().catch((e) => this.log(`claims snapshot: ${e.message}`));
      try { waitUntil(p); } catch { /* outside Vercel: the promise still runs */ }
    }
    return this.snap;
  }

  /** Decorated claims, as services/api's Claims class gives them. */
  async decorated() {
    const s = await this.get();
    return { claims: s.claims.map((c) => decorateClaim({ ...c, id: c.claim_id ?? c.id })), at: s.at, blockHeight: s.blockHeight ?? null };
  }
}
