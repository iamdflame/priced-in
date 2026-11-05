// The market's event stream.
//
// The scanner follows the chain head block by block. For each new block it reads only the
// chunks that carry transactions (an empty tx_root means none), keeps the transactions that
// reach the market (direct calls, ft_transfer_call deposits through the USDC token, and
// meta-transactions delegated to either), and fetches each one's receipt outcomes. Every
// receipt the market executed contributes its NEP-297 "pricedin" EVENT_JSON logs.
//
// Why transactions and not chunk receipts: logs live in execution outcomes, and the RPC only
// returns outcomes by transaction. A transaction whose signer and receiver share a shard never
// shows its first receipt in any chunk's receipt list either, so following transactions is
// both the only way to read logs and the complete way to see direct calls.

export const EMPTY_ROOT = "11111111111111111111111111111111";
const PREFIX = "EVENT_JSON:";

/**
 * Parse NEP-297 logs of one standard. Returns one record per data element.
 * @param {string[]} logs
 * @param {string} [standard]
 */
export function parseEventLogs(logs, standard = "pricedin") {
  const out = [];
  if (!Array.isArray(logs)) return out;
  logs.forEach((log, logIndex) => {
    if (typeof log !== "string" || !log.startsWith(PREFIX)) return;
    let j;
    try { j = JSON.parse(log.slice(PREFIX.length)); } catch { return; }
    if (!j || j.standard !== standard || typeof j.event !== "string") return;
    const data = Array.isArray(j.data) ? j.data : j.data === undefined ? [null] : [j.data];
    data.forEach((d, dataIndex) => out.push({ event: j.event, version: j.version ?? null, data: d, logIndex, dataIndex }));
  });
  return out;
}

/**
 * Market events from a transaction outcome (EXPERIMENTAL_tx_status shape).
 * @param {object} tx the RPC result
 * @param {string} marketId
 */
export function extractMarketEvents(tx, marketId) {
  const out = [];
  for (const r of tx?.receipts_outcome || []) {
    const o = r.outcome;
    if (!o || o.executor_id !== marketId) continue;
    for (const e of parseEventLogs(o.logs)) {
      out.push({ ...e, receiptId: r.id, receiptBlockHash: r.block_hash, uid: `${r.id}:${e.logIndex}:${e.dataIndex}` });
    }
  }
  return out;
}

function decodeArgs(b64) {
  try { return JSON.parse(Buffer.from(b64 || "", "base64").toString("utf8")); } catch { return null; }
}

function actionsReach(receiverId, actions, marketId, usdcId) {
  if (receiverId === marketId) return true;
  for (const a of actions || []) {
    if (a && typeof a === "object") {
      if (usdcId && receiverId === usdcId && a.FunctionCall?.method_name === "ft_transfer_call") {
        if (decodeArgs(a.FunctionCall.args)?.receiver_id === marketId) return true;
      }
      const d = a.Delegate?.delegate_action;
      if (d && actionsReach(d.receiver_id, d.actions, marketId, usdcId)) return true;
    }
  }
  return false;
}

/** Whether a chunk transaction (RPC view) can produce market events. */
export function txReachesMarket(tx, marketId, usdcId = null) {
  if (!tx || !marketId) return false;
  return actionsReach(tx.receiver_id, tx.actions, marketId, usdcId);
}

/** Ring buffer, de-duplication and fan-out to subscribers. */
export class EventHub {
  constructor({ size = 200, now = Date.now } = {}) {
    this.size = size;
    this.now = now;
    this.buf = [];
    this.seq = 0;
    this.seen = new Set();
    this.seenOrder = [];
    this.subs = new Set();
    this.lastEventAt = 0;
  }

  publish(evt) {
    if (evt.uid) {
      if (this.seen.has(evt.uid)) return null;
      this.seen.add(evt.uid);
      this.seenOrder.push(evt.uid);
      if (this.seenOrder.length > this.size * 10) this.seen.delete(this.seenOrder.shift());
    }
    const rec = { seq: ++this.seq, ...evt };
    this.buf.push(rec);
    if (this.buf.length > this.size) this.buf.shift();
    this.lastEventAt = this.now();
    for (const fn of this.subs) {
      try { fn(rec); } catch { /* a broken subscriber never stops the others */ }
    }
    return rec;
  }

  since(seq = 0) {
    return this.buf.filter((e) => e.seq > seq);
  }

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}

/** Follows the chain head and publishes market events. */
export class Scanner {
  /**
   * @param {{ rpc: import('./rpc.mjs').Rpc, marketId: string|null, usdcId?: string|null, hub: EventHub,
   *   intervalMs?: number, finality?: string, maxCatchupBlocks?: number, backfillBlocks?: number,
   *   log?: (msg: string) => void, now?: () => number }} o
   */
  constructor(o) {
    this.rpc = o.rpc;
    this.marketId = o.marketId;
    this.usdcId = o.usdcId || null;
    this.hub = o.hub;
    this.intervalMs = o.intervalMs ?? 400;
    this.finality = o.finality || "optimistic";
    this.maxCatchup = o.maxCatchupBlocks ?? 120;
    this.backfill = o.backfillBlocks ?? 0;
    this.log = o.log || (() => {});
    this.now = o.now || Date.now;
    this.state = {
      lastHeight: null, lastHash: null, lastBlockTimestampMs: null, lastScanAt: 0,
      lastError: null, lastErrorAt: 0, blocksScanned: 0, chunksRead: 0, txsTracked: 0,
      skippedBlocks: 0, lostTxs: 0, startedAt: 0,
    };
    this.pending = new Map();
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.state.startedAt = this.now();
    const loop = async () => {
      if (!this.running) return;
      const t0 = this.now();
      try {
        await this.tick();
      } catch (e) {
        this.state.lastError = e.message;
        this.state.lastErrorAt = this.now();
      }
      if (this.running) this.timer = setTimeout(loop, Math.max(50, this.intervalMs - (this.now() - t0)));
    };
    loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  async tick() {
    const head = await this.rpc.block(this.finality);
    const h = head.header.height;
    if (this.state.lastHeight === null) this.state.lastHeight = h - 1 - Math.max(0, this.backfill);
    if (h <= this.state.lastHeight) return;
    let from = this.state.lastHeight + 1;
    if (h - from + 1 > this.maxCatchup) {
      const skipped = h - this.maxCatchup + 1 - from;
      this.state.skippedBlocks += skipped;
      this.log(`scanner: ${skipped} blocks behind beyond the catch-up window; skipping to ${h - this.maxCatchup + 1}`);
      from = h - this.maxCatchup + 1;
    }
    // fetch blocks a few at a time, process them in order
    for (let start = from; start <= h; start += 6) {
      const heights = [];
      for (let x = start; x <= Math.min(h, start + 5); x++) heights.push(x);
      const blocks = await Promise.all(heights.map((x) => (x === h ? head : this.rpc.block(x).catch((e) => {
        if (e.rpcCause?.name === "UNKNOWN_BLOCK") return null; // NEAR skips heights; nothing to read
        throw e;
      }))));
      for (let i = 0; i < heights.length; i++) {
        if (blocks[i]) await this.processBlock(blocks[i]);
        this.state.lastHeight = heights[i];
        this.state.lastScanAt = this.now();
      }
    }
  }

  async processBlock(block) {
    const height = block.header.height;
    this.state.blocksScanned++;
    this.state.lastHash = block.header.hash;
    this.state.lastBlockTimestampMs = Math.floor(Number(block.header.timestamp_nanosec || block.header.timestamp) / 1e6);
    if (!this.marketId) return;
    const chunks = (block.chunks || []).filter((c) => c.height_included === height && c.tx_root && c.tx_root !== EMPTY_ROOT);
    const bodies = await Promise.all(chunks.map((c) => this.rpc.chunk(c.chunk_hash)));
    this.state.chunksRead += bodies.length;
    for (const body of bodies) {
      for (const tx of body.transactions || []) {
        if (txReachesMarket(tx, this.marketId, this.usdcId)) this.track(tx, block);
      }
    }
  }

  /** Fetch a relevant transaction's outcome in the background and publish its events. */
  track(tx, block) {
    if (this.pending.has(tx.hash)) return;
    this.state.txsTracked++;
    const meta = { txHash: tx.hash, signerId: tx.signer_id, blockHeight: block.header.height, blockTimestampMs: Math.floor(Number(block.header.timestamp_nanosec || block.header.timestamp) / 1e6) };
    const job = (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const r = await this.rpc.txStatus(tx.hash, tx.signer_id, "EXECUTED_OPTIMISTIC", { timeoutMs: 12000 });
          for (const e of extractMarketEvents(r, this.marketId)) {
            this.hub.publish({
              uid: e.uid, event: e.event, version: e.version, data: e.data,
              txHash: meta.txHash, receiptId: e.receiptId, signerId: meta.signerId,
              blockHeight: meta.blockHeight, blockTimestampMs: meta.blockTimestampMs, seenAtMs: this.now(),
            });
          }
          return;
        } catch (e) {
          await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
        }
      }
      this.state.lostTxs++;
      this.log(`scanner: gave up on tx ${tx.hash} after 6 attempts`);
    })().finally(() => this.pending.delete(tx.hash));
    this.pending.set(tx.hash, job);
  }
}
