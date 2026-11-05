// P&L you can rebuild: every agent's profit and loss, inference bill included, from chain
// events alone, then compared field by field with the runner's own ledger.
//
// 1. scan: read every block in a height range, keep each transaction that reaches the market
//    or the swarm (direct calls, USDC ft_transfer_call deposits to the market, delegated
//    actions), fetch its final outcome and keep the NEP-297 events of every successful receipt
//    the market ("pricedin") or the swarm ("pricedin-swarm") executed. This finds a swarm
//    agent's balance released by close_agent too, which runs on the market inside a swarm
//    transaction. Nothing here reads the runner's files.
// 2. rebuild: per swarm agent, in integers: trade cost and proceeds, redemptions, inference
//    charged from the balance (charge), escrow swept (sweep, yoctoNEAR, and in micro-USD at the
//    published rate), shares held per claim, and the capital that came in and out.
// 3. check the rebuild against the chain's own state: the agent's balance must equal
//    deposits - releases - cost + proceeds + redemptions - charges, every position must match,
//    and the swarm's escrow and charged totals must match. A missed event fails here.
// 4. compare with the runner's ledger (Ledger.pnl) to the micro-USDC and to the yoctoNEAR.

import { parseEventLogs, txReachesMarket, EMPTY_ROOT } from "../../api/src/events.mjs";

const big = (v) => BigInt(v ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, n = 5) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= n || e.rpcCause?.name === "UNKNOWN_BLOCK") throw e; await sleep(400 * (i + 1)); }
  }
}

function reachesSwarm(tx, swarm) {
  if (!swarm) return false;
  if (tx.receiver_id === swarm) return true;
  return (tx.actions || []).some((a) => a?.Delegate?.delegate_action?.receiver_id === swarm);
}

/**
 * Every market and swarm event in [from, to]. `cache` ({ events, to }) from an earlier scan makes
 * it incremental.
 * @param {{ rpc: import('../../api/src/rpc.mjs').Rpc, market: string, swarm?: string|null, usdc?: string|null, from: number, to?: number|null, cache?: object|null, log?: (m: string) => void }} o
 */
export async function scanEvents({ rpc, market, swarm = null, usdc = null, from, to = null, cache = null, log = () => {} }) {
  const head = to ?? (await retry(() => rpc.block("final"))).header.height;
  const start = cache?.to ? Math.max(from, cache.to + 1) : from;
  const txs = [];
  let blocks = 0;
  for (let h = start; h <= head; h += 8) {
    const heights = [];
    for (let x = h; x <= Math.min(head, h + 7); x++) heights.push(x);
    const bs = await Promise.all(heights.map((x) => retry(() => rpc.block(x)).catch((e) => { if (e.rpcCause?.name === "UNKNOWN_BLOCK") return null; throw e; })));
    for (const b of bs) {
      if (!b) continue;
      blocks++;
      const chunks = (b.chunks || []).filter((c) => c.height_included === b.header.height && c.tx_root && c.tx_root !== EMPTY_ROOT);
      const bodies = await Promise.all(chunks.map((c) => retry(() => rpc.chunk(c.chunk_hash))));
      for (const body of bodies) for (const tx of body.transactions || []) {
        if (txReachesMarket(tx, market, usdc) || reachesSwarm(tx, swarm)) txs.push({ hash: tx.hash, signer: tx.signer_id, height: b.header.height });
      }
    }
    if ((h - start) % 400 < 8) log(`pnl scan: block ${h} of ${head}`);
  }
  const events = [...(cache?.events || [])];
  const seen = new Set(events.map((e) => e.uid));
  for (let i = 0; i < txs.length; i += 6) {
    const outs = await Promise.all(txs.slice(i, i + 6).map((t) => retry(() => rpc.txStatus(t.hash, t.signer, "FINAL", { timeoutMs: 15000 })).then((r) => ({ t, r }))));
    for (const { t, r } of outs) {
      for (const ro of r?.receipts_outcome || []) {
        const o = ro.outcome;
        if (!o || o.status?.Failure !== undefined) continue;
        const std = o.executor_id === market ? "pricedin" : o.executor_id === swarm ? "pricedin-swarm" : null;
        if (!std) continue;
        for (const e of parseEventLogs(o.logs, std)) {
          const uid = `${ro.id}:${e.logIndex}:${e.dataIndex}`;
          if (seen.has(uid)) continue;
          seen.add(uid);
          events.push({ uid, contract: o.executor_id, standard: std, event: e.event, data: e.data, tx_hash: t.hash, height: t.height });
        }
      }
    }
  }
  return { market, swarm, usdc, from: cache?.from ?? from, to: head, blocks, txs: txs.length, events };
}

const isSwarmAgent = (acct, swarm) => Boolean(swarm && typeof acct === "string" && acct.endsWith(`.${swarm}`) && /^a\d+$/.test(acct.slice(0, -swarm.length - 1)));

function emptyRow() {
  return { cost_micro: 0n, proceeds_micro: 0n, redeemed_micro: 0n, charged_micro: 0n, swept_yocto: 0n, swept_micro: 0n, trades: 0, bills: 0, positions: {}, deposited_micro: 0n, released_micro: 0n, spawn_escrow_yocto: 0n, top_up_yocto: 0n, close_refund_yocto: 0n, owner: null, model: null };
}

/** Per-agent figures from events alone. `rate`: yoctoNEAR per micro-USD for sweeps. */
export function rebuild(events, { market, swarm, rate, agents = [] }) {
  const extra = new Set(agents);
  const rows = {};
  const row = (a) => (rows[a] ||= emptyRow());
  const mine = (a) => isSwarmAgent(a, swarm) || extra.has(a);
  const redeemed = {};
  const R = big(rate);
  for (const e of events) {
    const d = e.data || {};
    if (e.contract === market) {
      if (e.event === "trade" && mine(d.trader)) {
        const r = row(d.trader);
        const sell = String(d.side).startsWith("sell_");
        const side = String(d.side).replace(/^sell_/, "");
        const p = (r.positions[String(d.claim_id)] ||= { yes: 0n, no: 0n });
        if (sell) { r.proceeds_micro += big(d.amount_micro); p[side] -= big(d.shares_micro); }
        else { r.cost_micro += big(d.amount_micro); p[side] += big(d.shares_micro); }
        r.trades++;
      } else if (e.event === "redeem" && mine(d.trader)) {
        row(d.trader).redeemed_micro += big(d.amount_micro);
        (redeemed[d.trader] ||= new Set()).add(String(d.claim_id));
      } else if (e.event === "charge" && mine(d.trader)) {
        const r = row(d.trader);
        r.charged_micro += big(d.amount_micro);
        r.bills++;
      } else if (e.event === "deposit" && mine(d.trader ?? d.to)) row(d.trader ?? d.to).deposited_micro += big(d.amount_micro);
      else if (e.event === "agent_release" && mine(d.trader)) row(d.trader).released_micro += big(d.amount_micro);
    } else if (e.contract === swarm) {
      if (!mine(d.agent)) continue;
      const r = row(d.agent);
      if (e.event === "spawn") { r.spawn_escrow_yocto += big(d.escrow_yocto); r.owner = d.owner; r.model = d.model; }
      else if (e.event === "sweep") { const y = big(d.amount_yocto); r.swept_yocto += y; if (R > 0n) r.swept_micro += y / R; r.bills++; }
      else if (e.event === "top_up") r.top_up_yocto += big(d.amount_yocto);
      else if (e.event === "close") r.close_refund_yocto += big(d.refund_yocto);
    }
  }
  for (const [a, set] of Object.entries(redeemed)) for (const c of set) rows[a].positions[c] = { yes: 0n, no: 0n };
  return rows;
}

/** Mark-to-market in micro-USDC from a price snapshot (claim id -> { price_yes_ppm, outcome }). */
export function markMicro(positions, prices) {
  let m = 0n;
  for (const [c, p] of Object.entries(positions)) {
    const v = prices.get(Number(c));
    if (!v) continue;
    const yes = v.outcome === true ? 1_000_000n : v.outcome === false ? 0n : big(v.price_yes_ppm);
    m += (p.yes * yes) / 1_000_000n + (p.no * (1_000_000n - yes)) / 1_000_000n;
  }
  return m;
}

/** The P&L in micro-USDC: trading cash, minus inference (charged, and swept at the rate), plus the mark. */
export function pnlMicro(r, prices) {
  return r.proceeds_micro + r.redeemed_micro - r.cost_micro - r.charged_micro - r.swept_micro + markMicro(r.positions, prices);
}

const FIELDS = ["cost_micro", "proceeds_micro", "redeemed_micro", "charged_micro", "swept_yocto", "swept_micro", "trades", "bills"];
const nz = (positions) => Object.fromEntries(Object.entries(positions).filter(([, p]) => p.yes !== 0n || p.no !== 0n).map(([c, p]) => [c, `${p.yes}/${p.no}`]));

/** Field-by-field comparison of two sets of rows. */
export function compare(chainRows, ledgerRows, prices = new Map()) {
  const accounts = [...new Set([...Object.keys(chainRows), ...Object.keys(ledgerRows)])].sort();
  const out = [];
  for (const a of accounts) {
    const c = chainRows[a] || emptyRow(), l = ledgerRows[a] || emptyRow();
    const diffs = [];
    for (const f of FIELDS) if (String(c[f]) !== String(l[f])) diffs.push(`${f}: chain ${c[f]} vs runner ${l[f]}`);
    const pc = JSON.stringify(nz(c.positions)), pl = JSON.stringify(nz(l.positions));
    if (pc !== pl) diffs.push(`positions: chain ${pc} vs runner ${pl}`);
    const chainPnl = pnlMicro(c, prices), runnerPnl = pnlMicro({ ...emptyRow(), ...l }, prices);
    if (chainPnl !== runnerPnl) diffs.push(`pnl_micro: chain ${chainPnl} vs runner ${runnerPnl}`);
    out.push({ account: a, ok: diffs.length === 0, diffs, chain: c, runner: l, pnl_micro: chainPnl });
  }
  return out;
}

/** The rebuild checked against the chain's own state, per agent that still exists. */
export async function checkState({ rpc, market, swarm, rows }) {
  const out = [];
  for (const [a, r] of Object.entries(rows)) {
    const problems = [];
    const ag = swarm ? await retry(() => rpc.viewFunction(swarm, "get_agent", { agent_id: a })).catch(() => null) : null;
    const bal = big(await retry(() => rpc.viewFunction(market, "get_balance", { trader: a })));
    const want = r.deposited_micro - r.released_micro - r.cost_micro + r.proceeds_micro + r.redeemed_micro - r.charged_micro;
    if (bal !== want) problems.push(`balance ${bal} on-chain vs ${want} from events`);
    for (const [c, p] of Object.entries(r.positions)) {
      const v = await retry(() => rpc.viewFunction(market, "get_position", { claim_id: Number(c), trader: a }));
      if (big(v?.yes_micro) !== p.yes || big(v?.no_micro) !== p.no) problems.push(`claim ${c}: position ${v?.yes_micro}/${v?.no_micro} on-chain vs ${p.yes}/${p.no} from events`);
    }
    if (ag) {
      const esc = r.spawn_escrow_yocto + r.top_up_yocto - r.swept_yocto - r.close_refund_yocto;
      if (big(ag.escrow_yocto) !== esc) problems.push(`escrow ${ag.escrow_yocto} on-chain vs ${esc} from events`);
      if (big(ag.charged_yocto) !== r.swept_yocto) problems.push(`charged ${ag.charged_yocto} on-chain vs ${r.swept_yocto} swept in events`);
    }
    out.push({ account: a, ok: problems.length === 0, problems, deleted: ag?.deleted ?? null });
  }
  return out;
}

/** Prices for the mark, read once, so both sides of a comparison use the same snapshot. */
export async function priceSnapshot({ rpc, market, claimIds }) {
  const m = new Map();
  for (const id of claimIds) {
    const c = await retry(() => rpc.viewFunction(market, "get_claim", { claim_id: id })).catch(() => null);
    if (c) m.set(id, { price_yes_ppm: c.price_yes_ppm, outcome: c.status === "Settled" ? c.outcome : null });
  }
  return m;
}

/** BigInt-safe JSON for printing. */
export const show = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x));
