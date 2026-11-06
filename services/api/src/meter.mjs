// What the truth API counts: free calls per address, settled payments, and the one relayer's turn.
//
// The app takes a meter with this shape:
//   take(ip), release(ip, taken)   the free tier: { ok, remaining, retryAfterS }
//   exclusive(fn)                  run a settlement alone: the relayer has one key, so one nonce
//   record(payment), totals()      every settled payment, and what they add up to
// localMeter is the single server's meter, in memory. The hosted API brings api/_lib/meter.mjs,
// the same shape over the store, so its counts hold across function instances.

import { DailyLimiter } from "./ratelimit.mjs";
import { explorerTx } from "./x402.mjs";

/** The public figure: paid calls and revenue. Each transaction counts once. */
export function paymentTotals(records) {
  const byTx = new Map(records.map((r) => [r.tx, r]));
  const list = [...byTx.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const micro = list.reduce((sum, r) => sum + BigInt(r.amount_micro), 0n);
  const last = list.at(-1);
  return {
    paid_calls: list.length,
    revenue_usd: Number(micro) / 1e6,
    revenue_micro: micro.toString(),
    payers: new Set(list.map((r) => r.payer)).size,
    last_paid_at: last?.at ?? null,
    last_tx: last?.tx ?? null,
    last_tx_explorer: last?.tx ? explorerTx(String(last.network).replace(/^near:/, ""), last.tx) : null,
  };
}

/** One server's meter: counts live in this process and a restart clears them. */
export function localMeter(limit, { now = Date.now } = {}) {
  const free = new DailyLimiter(limit, { now });
  const payments = [];
  let turn = Promise.resolve();
  return {
    take: (ip) => free.take(ip),
    release: (ip) => free.release(ip),
    exclusive(fn) {
      const run = turn.then(fn);
      turn = run.catch(() => {});
      return run;
    },
    record(payment) { payments.push(payment); },
    totals: () => paymentTotals(payments),
  };
}
