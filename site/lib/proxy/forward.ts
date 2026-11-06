// What the site tells the API about a forwarded request. Every request the site forwards reaches the
// API from the site's own edge, so per-address limits (the free $1, most of all) would fall into one
// bucket for all visitors. The site vouches for the visitor instead: the address in x-visitor-ip and
// the shared secret in x-proxy-secret, which services/api/src/ratelimit.mjs `visitorIp` checks.
// Whatever a client sent in those two headers is dropped first, so nobody can claim another address.

/** The paths next.config.ts rewrites to API_ORIGIN. proxy.ts's matcher lists the same ones, literally. */
export const API_PATHS = ["/api", "/health", "/claims", "/events", "/lane", "/v1", "/post"] as const;

export const isApiPath = (path: string) => API_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** The visitor's address as the edge saw it: x-real-ip, else the first x-forwarded-for hop. */
export function visitorAddress(h: Headers): string | null {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** The headers a forwarded request carries. No secret, or no address to vouch for: neither header. */
export function forwardHeaders(incoming: Headers, secret: string | undefined): Headers {
  const out = new Headers(incoming);
  out.delete("x-visitor-ip");
  out.delete("x-proxy-secret");
  const address = visitorAddress(incoming);
  if (secret && address) {
    out.set("x-visitor-ip", address);
    out.set("x-proxy-secret", secret);
  }
  return out;
}
