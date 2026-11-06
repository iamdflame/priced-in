// Fixed-window daily counters keyed by UTC day. In memory: a restart resets them, which is
// safe because the contract's lane budget is the hard limit and this is the soft one.
import { timingSafeEqual } from "node:crypto";

export const DAY_MS = 86_400_000;

export class DailyLimiter {
  /**
   * @param {number} limit per key per UTC day; 0 or less refuses everything
   * @param {{ now?: () => number }} [o]
   */
  constructor(limit, { now = Date.now } = {}) {
    this.limit = limit;
    this.now = now;
    this.day = -1;
    this.counts = new Map();
  }

  roll() {
    const d = Math.floor(this.now() / DAY_MS);
    if (d !== this.day) {
      this.day = d;
      this.counts.clear();
    }
  }

  /** Seconds until the window resets. */
  retryAfterS() {
    return Math.max(1, Math.ceil(((this.day + 1) * DAY_MS - this.now()) / 1000));
  }

  /** Take one unit; returns { ok, remaining, retryAfterS }. */
  take(key) {
    this.roll();
    const used = this.counts.get(key) || 0;
    if (used >= this.limit) return { ok: false, remaining: 0, retryAfterS: this.retryAfterS() };
    this.counts.set(key, used + 1);
    return { ok: true, remaining: this.limit - used - 1, retryAfterS: 0 };
  }

  /** Give a unit back (the work it paid for failed). */
  release(key) {
    this.roll();
    const used = this.counts.get(key) || 0;
    if (used <= 1) this.counts.delete(key);
    else this.counts.set(key, used - 1);
  }

  used(key) {
    this.roll();
    return this.counts.get(key) || 0;
  }
}

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The visitor's address on the hosting edge, or null. The edge sets x-real-ip to whoever connected.
 * When the product site forwards a request, that is the site, so it passes the visitor's own address
 * in x-visitor-ip with PROXY_SECRET in x-proxy-secret. Without the secret the header is ignored, so
 * nobody can spend another address's allowance by claiming it.
 */
export function visitorIp(headers, proxySecret = process.env.PROXY_SECRET) {
  const forwarded = headers["x-visitor-ip"];
  if (proxySecret && typeof forwarded === "string" && forwarded.trim() && sameSecret(headers["x-proxy-secret"], proxySecret)) return forwarded.trim();
  const real = headers["x-real-ip"];
  return typeof real === "string" && real.trim() ? real.trim() : null;
}

/** The client IP: the socket address, or the last X-Forwarded-For hop behind a trusted proxy. */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (hops.length) return normalizeIp(hops[hops.length - 1]);
    }
  }
  return normalizeIp(req.socket?.remoteAddress || "unknown");
}

/** IPv4 as is; IPv6 bucketed by its /64, since one host can rotate through a whole /64. */
export function normalizeIp(ip) {
  if (ip.startsWith("::ffff:") && ip.includes(".")) return ip.slice(7);
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.split("%")[0].split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
