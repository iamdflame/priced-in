// The truth API's meter on the hosted runtime: services/api's meter shape over the store, so what
// it counts holds across function instances.
//
//   free tier   the store's daily limit. If the store can't answer, this instance's own counter
//               takes over for that call: a free call is cheap, and our outage shouldn't refuse it
//   settlement  a lease on the relayer. Its one key has one nonce, so a second transaction in flight
//               would be refused; and a payment replayed at another instance finds the delegate's
//               nonce already spent when its turn comes, so the relayer never pays gas for it.
//               Without the lease nothing is sent, and the caller is told nothing was charged
//   payments    x402.jsonl, a journal in the store: one line per settled payment

import { DailyLimiter } from "../../services/api/src/ratelimit.mjs";
import { paymentTotals } from "../../services/api/src/meter.mjs";

export const PAYMENTS = "x402.jsonl";
const SCOPE = "credence";

/** The public figure from the journal, for /v1 and any other read route. */
export const truthApiOf = (journals) => paymentTotals(journals.readCached(PAYMENTS));

/**
 * @param {{ state: import('./store.mjs').BlobState, journals: import('./store.mjs').JournalDir, limit: number,
 *   leaseMs?: number, waitMs?: number, log?: (m: string) => void }} o
 */
export function storeMeter({ state, journals, limit, leaseMs = 45_000, waitMs = 15_000, log = () => {} }) {
  const fallback = new DailyLimiter(limit);
  return {
    async take(ip) {
      try { return await state.take(SCOPE, ip, limit); } catch (e) {
        log(`credence limit: the store did not answer (${e.message}); counting on this instance`);
        return { ...fallback.take(ip), local: true };
      }
    },
    async release(ip, taken) {
      if (taken?.local) fallback.release(ip);
      else await state.release(SCOPE, ip);
    },
    async exclusive(fn) {
      const lease = await state.acquire("x402-relayer", { ttlMs: leaseMs, waitMs });
      if (!lease) throw new Error("the relayer stayed busy");
      try { return await fn(); } finally { await lease.release(); }
    },
    async record(payment) {
      journals.append(PAYMENTS, payment);
      await journals.flush({ only: [PAYMENTS] });
    },
    totals: () => truthApiOf(journals),
  };
}
