// Cached reads of the market's views. Each answer is at most about a second old, and
// concurrent requests share one RPC round trip.

export class TtlCache {
  constructor(ttlMs, { max = 2000, now = Date.now } = {}) {
    this.ttl = ttlMs;
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  /** Get a fresh value or compute it once for every concurrent caller. */
  async get(key, compute) {
    const hit = this.map.get(key);
    const t = this.now();
    if (hit && (hit.pending || t - hit.at < this.ttl)) return hit.pending || hit.value;
    const pending = compute().then(
      (value) => { this.map.set(key, { value, at: this.now() }); return value; },
      (e) => { if (hit && !hit.pending) this.map.set(key, hit); else this.map.delete(key); throw e; },
    );
    this.map.set(key, { pending, at: t, value: hit?.value });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return pending;
  }

  /** The last good value even if stale (for an honest "as of" answer when the RPC fails). */
  stale(key) {
    const hit = this.map.get(key);
    return hit && "value" in hit && hit.value !== undefined ? { value: hit.value, at: hit.at } : null;
  }
}

const usd = (micro) => Number(micro) / 1e6;

/** A claim view plus the human figures the page shows. */
export function decorateClaim(c) {
  return {
    ...c,
    price_yes: c.price_yes_ppm / 1e6,
    cost_to_move: {
      up_10_points_usd: usd(c.cost_up_10_micro),
      down_10_points_usd: usd(c.cost_down_10_micro),
    },
    volume_usd: usd(c.volume_micro),
  };
}

export class Claims {
  constructor({ rpc, marketId, ttlMs = 1000, maxClaims = 5000, now = Date.now }) {
    this.rpc = rpc;
    this.marketId = marketId;
    this.cache = new TtlCache(ttlMs, { now });
    this.maxClaims = maxClaims;
  }

  stats() {
    return this.cache.get("stats", () => this.rpc.viewFunction(this.marketId, "stats", {}, { timeoutMs: 4000 }));
  }

  /**
   * Stats for a soft check on a hot path: a value up to maxStaleMs old is returned at once
   * and refreshed in the background; older or missing values are fetched.
   */
  async statsFast(maxStaleMs = 10_000) {
    const s = this.cache.stale("stats");
    if (s && this.cache.now() - s.at < maxStaleMs) {
      this.stats().catch(() => {});
      return s.value;
    }
    return this.stats();
  }

  all() {
    return this.cache.get("all", async () => {
      const s = await this.stats();
      const n = Math.min(Number(s.claims), this.maxClaims);
      const pages = [];
      for (let from = 0; from < n; from += 100) pages.push(this.rpc.viewFunction(this.marketId, "get_claims", { from, limit: 100 }, { timeoutMs: 4000 }));
      return (await Promise.all(pages)).flat().map(decorateClaim);
    });
  }

  async byPage(page) {
    return (await this.all()).filter((c) => c.page === page);
  }

  one(id) {
    return this.cache.get(`claim:${id}`, async () => {
      const c = await this.rpc.viewFunction(this.marketId, "get_claim", { claim_id: id }, { timeoutMs: 4000 });
      return c ? decorateClaim(c) : null;
    });
  }
}
