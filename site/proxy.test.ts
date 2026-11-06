// The front door, run for real: what proxy() hands Next for forwarded requests, pages and /bridge.
// NextResponse.next({ request }) carries changed request headers as x-middleware-request-* and lists
// the ones that survive in x-middleware-override-headers; Next removes all of them before the response
// leaves, which a build was checked for against a real origin (.apex/streams/money-result.md).
import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { API_PATHS } from "./lib/proxy/forward";
import { config, proxy } from "./proxy";

const req = (path: string, headers: Record<string, string> = {}, method = "GET") => new NextRequest(`https://site.test${path}`, { headers, method });
const forwarded = (r: Response, name: string) => r.headers.get(`x-middleware-request-${name}`);
const kept = (r: Response) => (r.headers.get("x-middleware-override-headers") ?? "").split(",");

afterEach(() => vi.unstubAllEnvs());

describe("forwarded API requests", () => {
  test("carry the visitor's address and the secret, on every API path", () => {
    vi.stubEnv("PROXY_SECRET", "the-shared-secret");
    for (const p of API_PATHS) {
      const r = proxy(req(p, { "x-real-ip": "203.0.113.7", "x-visitor-ip": "6.6.6.6", "x-proxy-secret": "a-guess" }));
      expect(forwarded(r, "x-visitor-ip")).toBe("203.0.113.7");
      expect(forwarded(r, "x-proxy-secret")).toBe("the-shared-secret");
    }
  });
  test("with no secret set, carry neither header, and drop a client's", () => {
    vi.stubEnv("PROXY_SECRET", "");
    const r = proxy(req("/claims", { "x-real-ip": "203.0.113.7", "x-visitor-ip": "6.6.6.6", "x-proxy-secret": "a-guess" }));
    expect(kept(r)).not.toContain("x-visitor-ip");
    expect(kept(r)).not.toContain("x-proxy-secret");
    expect(forwarded(r, "x-visitor-ip")).toBeNull();
  });
  test("set no geo cookie: an API answer stays cacheable", () => {
    expect(proxy(req("/claims", { "x-vercel-ip-country": "US" })).headers.get("set-cookie")).toBeNull();
  });
  test("the matcher lists every API path, so none can pass on a file-like name", () => {
    for (const p of API_PATHS) expect(config.matcher).toContain(`${p}/:path*`);
  });
});

describe("the geofence", () => {
  const cookie = (r: Response) => r.headers.get("set-cookie") ?? "";
  test("a page gets the region's cookie", () => {
    expect(cookie(proxy(req("/", { "x-vercel-ip-country": "US" })))).toContain("pi_geo=close_only.US");
    expect(cookie(proxy(req("/", { "x-vercel-ip-country": "KE" })))).toContain("pi_geo=open.KE");
    expect(cookie(proxy(req("/", { "x-vercel-ip-country": "CA", "x-vercel-ip-country-region": "ON" })))).toContain("pi_geo=close_only.CA");
  });
  test("a cookie already right isn't set again", () => {
    expect(cookie(proxy(req("/", { "x-vercel-ip-country": "KE", cookie: "pi_geo=open.KE" })))).toBe("");
  });
  test("deposits are refused where money may not go in, withdrawals only where nothing may move", () => {
    const quote = (dir: string, country: string) => proxy(req(`/bridge/quote?dir=${dir}`, { "x-vercel-ip-country": country }, "POST")).status;
    expect(quote("in", "US")).toBe(451);
    expect(quote("out", "US")).toBe(200);
    expect(quote("in", "IR")).toBe(451);
    expect(quote("out", "IR")).toBe(451);
    expect(quote("in", "KE")).toBe(200);
  });
  test("on Vercel a visitor it can't place may not put new money in", () => {
    vi.stubEnv("VERCEL", "1");
    expect(proxy(req("/bridge/quote?dir=in", {}, "POST")).status).toBe(451);
    expect(proxy(req("/bridge/quote?dir=out", {}, "POST")).status).toBe(200);
  });
  test("off Vercel (a local run) no header means no fence", () => {
    expect(proxy(req("/bridge/quote?dir=in", {}, "POST")).status).toBe(200);
  });
});
