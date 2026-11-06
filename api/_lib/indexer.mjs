// The market's history, indexed. Every transaction to the market account is found through an
// explorer's account index (nearblocks first; FastNEAR's transaction API is the fallback, and the
// first choice on testnet, where nearblocks' index was six weeks behind when measured on
// 2026-11-06), read back from the chain itself with EXPERIMENTAL_tx_status, and its market events
// are appended to the store's events.jsonl once each (by uid). The explorer only says which
// transactions to read; every event comes from the chain's own receipts, and a receipt that
// failed contributes nothing.
//
//   full   the cron: newest pages until one holds nothing new, then the backfill from its saved
//          cursor until the oldest page, bounded by the run's time (it resumes next run)
//   quick  after a reported trade: the newest page only, at most once every 30 s across instances
//
// State (indexer/state.json in the store): the hashes already read, the backfill cursor, a short
// retry list for transactions the RPC could not answer yet, and the last run's summary.

import { extractMarketEvents } from "../../services/api/src/events.mjs";

const STATE_DOC = "indexer/state.json";
const NEARBLOCKS = { mainnet: "https://api.nearblocks.io", testnet: "https://api-testnet.nearblocks.io" };
const FASTNEAR_TX = { mainnet: "https://tx.main.fastnear.com", testnet: "https://tx.test.fastnear.com" };

export class SourceError extends Error {
  constructor(message, { rateLimited = false } = {}) { super(message); this.rateLimited = rateLimited; }
}

async function getJson(fetchImpl, url, init = {}) {
  const r = await fetchImpl(url, { ...init, headers: { accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(init.timeoutMs || 10_000) });
  if (r.status === 429) throw new SourceError(`${new URL(url).host}: rate limited (429)`, { rateLimited: true });
  if (!r.ok) throw new SourceError(`${new URL(url).host}: HTTP ${r.status}`);
  try { return await r.json(); } catch { throw new SourceError(`${new URL(url).host}: not JSON`); }
}

/** nearblocks' account index: transactions where the account is the signer or the receiver. */
export class NearblocksSource {
  constructor({ network, accountId, fetchImpl = globalThis.fetch, perPage = 25, base = NEARBLOCKS[network] }) {
    Object.assign(this, { network, accountId, fetch: fetchImpl, perPage, base, name: "nearblocks" });
  }

  async page(cursor = null) {
    const u = new URL(`/v1/account/${encodeURIComponent(this.accountId)}/txns-only`, this.base);
    u.searchParams.set("per_page", String(this.perPage));
    u.searchParams.set("order", "desc");
    if (cursor) u.searchParams.set("cursor", cursor);
    const j = await getJson(this.fetch, u.href);
    const txs = (j.txns || []).filter((t) => t?.transaction_hash).map((t) => ({
      hash: t.transaction_hash,
      signer: t.signer_account_id || null,
      receiver: t.receiver_account_id || null,
      blockHeight: t.block?.block_height ?? null,
      blockTimestampMs: t.block_timestamp ? Math.floor(Number(t.block_timestamp) / 1e6) : null,
      method: t.actions?.[0]?.method ?? null,
    }));
    return { txs, next: txs.length >= this.perPage && j.cursor ? String(j.cursor) : null };
  }
}

/** FastNEAR's transaction API: every transaction the account takes part in, newest first. */
export class FastnearSource {
  constructor({ network, accountId, fetchImpl = globalThis.fetch, perPage = 50, base = FASTNEAR_TX[network] }) {
    Object.assign(this, { network, accountId, fetch: fetchImpl, perPage, base, name: "fastnear" });
  }

  async page(cursor = null) {
    const body = { account_id: this.accountId, limit: this.perPage, ...(cursor ? { resume_token: cursor } : {}) };
    const j = await getJson(this.fetch, `${this.base}/v0/account`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const rows = (j.account_txs || []).filter((t) => t?.transaction_hash);
    // the account index has no signer: the transactions endpoint has it (the RPC needs it to route)
    const signers = new Map();
    for (let i = 0; i < rows.length; i += 20) {
      const part = rows.slice(i, i + 20).map((t) => t.transaction_hash);
      const d = await getJson(this.fetch, `${this.base}/v0/transactions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_hashes: part }) });
      for (const t of d.transactions || []) if (t?.transaction?.hash || t?.transaction?.signer_id) signers.set(t.transaction.hash, t.transaction);
    }
    const txs = rows.map((t) => ({
      hash: t.transaction_hash,
      signer: signers.get(t.transaction_hash)?.signer_id ?? null,
      receiver: signers.get(t.transaction_hash)?.receiver_id ?? null,
      blockHeight: t.tx_block_height ?? null,
      blockTimestampMs: t.tx_block_timestamp ? Math.floor(Number(t.tx_block_timestamp) / 1e6) : null,
      method: null,
    }));
    return { txs, next: rows.length >= this.perPage && j.resume_token ? String(j.resume_token) : null };
  }
}

/** The sources for a network, in the order they are tried (INDEXER_SOURCES=nearblocks,fastnear overrides). */
export function sourcesFor(network, accountId, { fetchImpl = globalThis.fetch, order = process.env.INDEXER_SOURCES } = {}) {
  const make = { nearblocks: () => new NearblocksSource({ network, accountId, fetchImpl }), fastnear: () => new FastnearSource({ network, accountId, fetchImpl }) };
  const names = (order || (network === "mainnet" ? "nearblocks,fastnear" : "fastnear,nearblocks")).split(",").map((s) => s.trim()).filter((n) => make[n]);
  return names.map((n) => make[n]());
}

/** One transaction's market events, read from the chain, in the store's record shape. */
export async function eventsOfTx(rpc, marketId, tx, { now = Date.now } = {}) {
  const r = await rpc.txStatus(tx.hash, tx.signer, "EXECUTED_OPTIMISTIC", { timeoutMs: 10_000 });
  let blockHeight = tx.blockHeight ?? null, blockTimestampMs = tx.blockTimestampMs ?? null;
  if (blockTimestampMs === null && r?.transaction_outcome?.block_hash) {
    try {
      const b = await rpc.call("block", { block_id: r.transaction_outcome.block_hash }, { timeoutMs: 6000 });
      blockHeight = b.header.height;
      blockTimestampMs = Math.floor(Number(b.header.timestamp_nanosec) / 1e6);
    } catch { /* the events stand without the block's time */ }
  }
  return extractMarketEvents(r, marketId).map((e) => ({
    uid: e.uid, event: e.event, version: e.version, data: e.data,
    txHash: tx.hash, receiptId: e.receiptId, signerId: r.transaction?.signer_id ?? tx.signer,
    blockHeight, blockTimestampMs, seenAtMs: now(),
  }));
}

/** Run `fn` over items, `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export class Indexer {
  /**
   * @param {{ state: object, rpc: import('../../services/api/src/rpc.mjs').Rpc, marketId: string, sources: object[],
   *   record: (events: object[]) => Promise<object[]>, log?: (m: string) => void, now?: () => number, concurrency?: number,
   *   seenMax?: number, quickEveryMs?: number }} o
   */
  constructor(o) {
    Object.assign(this, { state: o.state, rpc: o.rpc, marketId: o.marketId, sources: o.sources, record: o.record });
    this.log = o.log || (() => {});
    this.now = o.now || Date.now;
    this.concurrency = o.concurrency ?? 4;
    this.seenMax = o.seenMax ?? 50_000;
    this.quickEveryMs = o.quickEveryMs ?? 30_000;
  }

  async status() {
    const d = await this.state.getDoc(STATE_DOC).catch(() => null);
    const v = d?.value;
    return v ? { last: v.last ?? null, backfill: v.backfill ?? null, seen: v.seen?.length ?? 0, retry: v.retry?.length ?? 0 } : null;
  }

  /** One bounded pass. Returns what it did; never throws for a source or RPC failure. */
  async run({ mode = "full", budgetMs = 30_000, maxPages = mode === "quick" ? 1 : 40 } = {}) {
    const t0 = this.now();
    const deadline = t0 + budgetMs;
    const doc = await this.state.getDoc(STATE_DOC).catch(() => null);
    const st = doc?.value || { seen: [], backfill: { cursor: null, done: false, source: null }, retry: [] };
    if (mode === "quick" && st.quickAt && t0 - st.quickAt < this.quickEveryMs) return { mode, skipped: "another pass ran in the last 30 s" };
    if (mode === "quick") await this.state.updateDoc(STATE_DOC, (cur = st) => ({ ...cur, quickAt: t0 })).catch(() => {});
    const seen = new Set(st.seen || []);
    const added = [];
    const retry = new Map((st.retry || []).map((r) => [r.hash, r]));
    const out = { mode, source: null, pages: 0, txs_read: 0, new_txs: 0, fresh_events: 0, errors: [], backfill_done: Boolean(st.backfill?.done) };
    const collected = [];

    const readTxs = async (txs) => {
      const todo = txs.filter((t) => !seen.has(t.hash) && t.signer);
      await pool(todo, this.concurrency, async (t) => {
        try {
          const evs = await eventsOfTx(this.rpc, this.marketId, t, { now: this.now });
          collected.push(...evs);
          seen.add(t.hash);
          added.push(t.hash);
          retry.delete(t.hash);
          out.txs_read++;
        } catch (e) {
          const r = retry.get(t.hash) || { ...t, attempts: 0 };
          r.attempts++;
          r.error = String(e.message).slice(0, 160);
          if (r.attempts < 6) retry.set(t.hash, r); else { retry.delete(t.hash); out.errors.push(`gave up on ${t.hash}: ${r.error}`); }
        }
      });
      return todo.length;
    };

    // the transactions an earlier run could not read yet
    if (retry.size && mode === "full") await readTxs([...retry.values()]);

    // pick the first source that answers
    let src = null, first = null;
    for (const s of this.sources) {
      try { first = await s.page(null); src = s; break; } catch (e) { out.errors.push(`${s.name}: ${e.message}`); }
    }
    let backfill = { cursor: st.backfill?.cursor ?? null, done: Boolean(st.backfill?.done), source: st.backfill?.source ?? null };
    if (src) {
      out.source = src.name;
      // a backfill cursor belongs to the source that made it
      if (backfill.source && backfill.source !== src.name && !backfill.done) backfill = { cursor: null, done: false, source: src.name };
      // 1. the head: newest pages until one holds nothing new (on the first run this walks it all)
      let pg = first, cursor = null;
      for (;;) {
        out.pages++;
        const fresh = await readTxs(pg.txs);
        out.new_txs += fresh;
        if (!pg.next) { backfill = { cursor: null, done: true, source: src.name }; break; }
        if (!fresh || mode === "quick" || out.pages >= maxPages || this.now() > deadline - 2000) {
          // a walk that has not reached the oldest page yet: the backfill resumes below this page
          if (!backfill.done && !backfill.cursor) backfill = { cursor: pg.next, done: false, source: src.name };
          break;
        }
        cursor = pg.next;
        try { pg = await src.page(cursor); } catch (e) { out.errors.push(`${src.name}: ${e.message}`); if (!backfill.done && !backfill.cursor) backfill = { cursor, done: false, source: src.name }; break; }
      }
      // 2. the backfill, from its saved cursor to the oldest page
      while (mode === "full" && !backfill.done && backfill.cursor && out.pages < maxPages && this.now() < deadline - 2000) {
        let p2;
        try { p2 = await src.page(backfill.cursor); } catch (e) { out.errors.push(`${src.name} backfill: ${e.message}`); break; }
        out.pages++;
        out.new_txs += await readTxs(p2.txs);
        backfill = p2.next ? { cursor: p2.next, done: false, source: src.name } : { cursor: null, done: true, source: src.name };
      }
    }
    out.backfill_done = backfill.done;

    const fresh = collected.length ? await this.record(collected) : [];
    out.fresh_events = fresh.length;
    out.events_seen = collected.length;
    out.ms = this.now() - t0;
    const last = { at: new Date(this.now()).toISOString(), ...out, errors: out.errors.slice(0, 5) };
    await this.state.updateDoc(STATE_DOC, (cur = {}) => {
      const merged = [...(cur.seen || [])];
      const have = new Set(merged);
      for (const h of added) if (!have.has(h)) { merged.push(h); have.add(h); }
      const curB = cur.backfill || {};
      // the further-along backfill wins: done beats a cursor, and a quick pass never moves one back
      const b = curB.done ? curB : mode === "quick" && curB.cursor ? curB : backfill;
      return { ...cur, seen: merged.slice(-this.seenMax), backfill: b, retry: [...retry.values()].slice(0, 200), last, ...(mode === "full" ? { lastFull: last } : {}) };
    }).catch((e) => out.errors.push(`state: ${e.message}`));
    if (out.errors.length) this.log(`indexer: ${out.errors.slice(0, 3).join(" | ")}`);
    return out;
  }
}
