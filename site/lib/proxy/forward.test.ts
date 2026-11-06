// The site vouches for its visitor to the API: the address and the shared secret, and nothing a client
// sent. services/api/test/ratelimit.test.mjs holds the API's half of the same rule.
import { describe, expect, test } from "vitest";
import { API_PATHS, forwardHeaders, isApiPath, visitorAddress } from "./forward";

const SECRET = "the-shared-secret";
const h = (o: Record<string, string>) => new Headers(o);

describe("which paths are forwarded", () => {
  test("every API path and what is under it, and nothing that only starts the same", () => {
    for (const p of API_PATHS) {
      expect(isApiPath(p)).toBe(true);
      expect(isApiPath(`${p}/anything`)).toBe(true);
      expect(isApiPath(`${p}s`)).toBe(false);
    }
    for (const p of ["/", "/c/18", "/portfolio", "/terms", "/bridge/quote"]) expect(isApiPath(p)).toBe(false);
  });
});

describe("the visitor's address", () => {
  test("x-real-ip first", () => expect(visitorAddress(h({ "x-real-ip": " 203.0.113.7 ", "x-forwarded-for": "198.51.100.9" }))).toBe("203.0.113.7"));
  test("else the first x-forwarded-for hop", () => expect(visitorAddress(h({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }))).toBe("198.51.100.9"));
  test("none at all", () => {
    expect(visitorAddress(h({}))).toBeNull();
    expect(visitorAddress(h({ "x-forwarded-for": " , " }))).toBeNull();
  });
});

describe("the forwarded headers", () => {
  test("the address and the secret, in place of what a client claimed", () => {
    const out = forwardHeaders(h({ "x-real-ip": "203.0.113.7", "x-visitor-ip": "6.6.6.6", "x-proxy-secret": "a-guess", accept: "text/event-stream" }), SECRET);
    expect(out.get("x-visitor-ip")).toBe("203.0.113.7");
    expect(out.get("x-proxy-secret")).toBe(SECRET);
    expect(out.get("accept")).toBe("text/event-stream");
  });
  test("no secret set: neither header, and a client's are still dropped", () => {
    for (const secret of [undefined, ""]) {
      const out = forwardHeaders(h({ "x-real-ip": "203.0.113.7", "x-visitor-ip": "6.6.6.6", "x-proxy-secret": "a-guess" }), secret);
      expect(out.has("x-visitor-ip")).toBe(false);
      expect(out.has("x-proxy-secret")).toBe(false);
    }
  });
  test("no address to vouch for: the secret isn't sent alone", () => {
    const out = forwardHeaders(h({ "x-visitor-ip": "6.6.6.6" }), SECRET);
    expect(out.has("x-visitor-ip")).toBe(false);
    expect(out.has("x-proxy-secret")).toBe(false);
  });
  test("the incoming headers are left as they were", () => {
    const incoming = h({ "x-real-ip": "203.0.113.7", "x-visitor-ip": "6.6.6.6" });
    forwardHeaders(incoming, SECRET);
    expect(incoming.get("x-visitor-ip")).toBe("6.6.6.6");
  });
});
