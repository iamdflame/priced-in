import { describe, expect, test, vi } from "vitest";
import { Api, EventStream, mapFailure, parseSse, type MarketEvent, type LiveStatus } from "../src/core/api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const f = (async (input: any, init?: RequestInit) => { const url = String(input); calls.push(url); return handler(url, init); }) as typeof fetch;
  return { f, calls };
}

describe("api: every failure is a designed state", () => {
  test("server codes map to the states the views design for", () => {
    expect(mapFailure(503, { error: { code: "lane_used_up", message: "The judges' lane is used up for now." } })).toMatchObject({ state: "used_up", message: "The judges' lane is used up for now.", retryable: false });
    expect(mapFailure(429, { error: { code: "rate_limited", message: "This address has used its 3 free bets for today.", retryAfterS: 3600 } })).toMatchObject({ state: "rate_limited", retryAfterS: 3600 });
    expect(mapFailure(429, { error: { code: "lane_daily_cap", message: "x" } }).state).toBe("daily_cap");
    expect(mapFailure(503, { error: { code: "market_paused", message: "The market is paused." } }).state).toBe("paused");
    expect(mapFailure(504, { error: { code: "lane_timeout", message: "try again" } })).toMatchObject({ state: "timeout", retryable: true });
    expect(mapFailure(502, null)).toMatchObject({ state: "unavailable", code: "http_502", retryable: true });
    expect(mapFailure(400, { error: { code: "invalid_page", message: "page must be a slug" } }).state).toBe("invalid");
    expect(mapFailure(404, { error: { code: "no_such_claim", message: "No claim 9." } }).state).toBe("not_found");
    expect(mapFailure(418, "teapot").message.length).toBeGreaterThan(10);
  });

  test("a network failure or a timeout resolves as a Result, never a throw", async () => {
    const down = new Api({ baseUrl: "http://api", fetch: (async () => { throw new TypeError("fetch failed"); }) as any });
    expect(await down.claimsByPage("near")).toMatchObject({ ok: false, error: { state: "offline", retryable: true } });
    const slow = new Api({ baseUrl: "http://api", timeoutMs: 20, fetch: ((_u: any, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as any });
    expect(await slow.health()).toMatchObject({ ok: false, error: { state: "timeout" } });
    const garbage = new Api({ baseUrl: "http://api", fetch: (async () => new Response("<html>", { status: 200 })) as any });
    expect(await garbage.claim(1)).toMatchObject({ ok: false, error: { code: "bad_body" } });
  });

  test("claims, one claim, health (a 503 health is still an answer), lane key and paste", async () => {
    const { f, calls } = fakeFetch((url, init) => {
      if (url.endsWith("/claims?page=near")) return json(200, { claims: [{ id: 1, page: "near" }] });
      if (url.endsWith("/claims/1")) return json(200, { claim: { id: 1 } });
      if (url.endsWith("/health")) return json(503, { ok: false, failures: ["scanner: no block scanned yet"] });
      if (url.endsWith("/lane/key")) return json(200, { publicKey: JSON.parse(String(init!.body)).publicKey, nonce: "5" });
      if (url.endsWith("/paste")) return json(200, { page: "paste-abc", sentences: [] });
      return json(404, { error: { code: "not_found", message: "nope" } });
    });
    const api = new Api({ baseUrl: "http://api/", fetch: f });
    expect(await api.claimsByPage("near")).toEqual({ ok: true, value: [{ id: 1, page: "near" }] });
    expect(await api.claim(1)).toEqual({ ok: true, value: { id: 1 } });
    expect(await api.health()).toMatchObject({ ok: true, value: { ok: false } });
    expect(await api.laneKey("ed25519:abc")).toMatchObject({ ok: true, value: { publicKey: "ed25519:abc" } });
    expect(await api.paste("NEAR is fast.")).toMatchObject({ ok: true, value: { page: "paste-abc" } });
    expect(calls[0]).toBe("http://api/claims?page=near");
  });

  test("posts: the site's own path or any link; a deleted post is a designed value, not an error", async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.includes("/post/jack/status/404")) return json(410, { source: "x", page: "x-404", id: "404", gone: true, reason: "deleted", link: "https://x.com/i/status/404", message: "This post was deleted, so we show nothing from it." });
      if (url.includes("/post")) return json(200, { source: "x", page: "x-20", gone: false, post: { id: "20" }, notices: [], sentences: [] });
      return json(404, {});
    });
    const api = new Api({ baseUrl: "http://api", fetch: f });
    expect(await api.post("/jack/status/20")).toMatchObject({ ok: true, value: { gone: false, page: "x-20" } });
    expect(await api.post("20")).toMatchObject({ ok: true });
    expect(await api.post("https://x.com/jack/status/20?s=20")).toMatchObject({ ok: true });
    const gone = await api.post("jack/status/404");
    expect(gone).toMatchObject({ ok: true, value: { gone: true, reason: "deleted" } });
    expect(calls).toEqual([
      "http://api/post/jack/status/20",
      "http://api/post/20",
      `http://api/post?url=${encodeURIComponent("https://x.com/jack/status/20?s=20")}`,
      "http://api/post/jack/status/404",
    ]);
  });

  test("rewrites: the latest per paragraph, and one version with its bytes from the history", async () => {
    const v1 = { id: "near:0:v1", version: 1 }, v2 = { id: "near:0:v2", version: 2 };
    const { f } = fakeFetch((url) => url.includes("history=1")
      ? json(200, { rewrites: [{ paragraph: 0, latest: v2, versions: [v1, v2] }] })
      : json(200, { rewrites: [v2] }));
    const api = new Api({ baseUrl: "http://api", fetch: f });
    expect(await api.latestRewrites("near")).toEqual({ ok: true, value: [v2] });
    expect(await api.rewriteById("near", "near:0:v1")).toEqual({ ok: true, value: v1 });
    expect(await api.rewriteById("near", "near:9:v1")).toEqual({ ok: true, value: null });
  });

  test("rationales, AI status, attestations and jury runs", async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.includes("/rationales")) return json(200, { rationales: [{ agent: "house-ledger", claim_id: 3 }], agents: {} });
      return json(200, { ok: true });
    });
    const api = new Api({ baseUrl: "http://api", fetch: f });
    expect(await api.rationales({ page: "near", claim: 3 })).toMatchObject({ ok: true, value: [{ claim_id: 3 }] });
    await api.aiStatus(); await api.attestations(); await api.attestation("a b.json"); await api.jury(4);
    expect(calls).toEqual(["http://api/rationales?page=near&claim=3", "http://api/ai/status", "http://api/attestations", "http://api/attestations/a%20b.json", "http://api/jury?challenge=4"]);
  });
});

describe("api: the live stream", () => {
  test("SSE frames: ids, events, retry, comments, multi-line data and CRLF", () => {
    const { frames, rest } = parseSse("retry: 2000\n\nid: 3\ndata: {\"a\":1}\n\n: ping\n\nevent: hello\r\ndata: x\r\ndata: y\r\n\r\nid: 4\ndata: {\"partial\"");
    expect(frames).toEqual([
      { event: "message", data: "", id: null, retry: 2000 },
      { event: "message", data: '{"a":1}', id: "3", retry: null },
      { event: "message", data: "", id: null, retry: null },
      { event: "hello", data: "x\ny", id: null, retry: null },
    ]);
    expect(rest).toBe('id: 4\ndata: {"partial"');
  });

  function sseBody(chunks: string[], { hold = false } = {}) {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); if (!hold) c.close(); },
    });
  }
  const frame = (e: Partial<MarketEvent>) => `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;

  test("events arrive once; a drop backfills from /events/recent, polls, and reconnects from the cursor", async () => {
    let connects = 0;
    const { f, calls } = fakeFetch((url) => {
      if (url.includes("/events?since=")) {
        connects++;
        if (connects === 1) return new Response(sseBody([`retry: 10\n\n`, frame({ seq: 1, uid: "a", event: "trade" }), `event: hello\ndata: {}\n\n`, frame({ seq: 2, uid: "b", event: "trade" })]), { status: 200 });
        if (connects === 2) return json(503, { error: { code: "too_many_streams" } });
        return new Response(sseBody([frame({ seq: 3, uid: "c", event: "trade" }), frame({ seq: 4, uid: "d", event: "trade" }), `event: hello\ndata: {}\n\n`], { hold: true }), { status: 200 });
      }
      if (url.includes("/events/recent")) return json(200, { events: [{ seq: 2, uid: "b", event: "trade" }, { seq: 3, uid: "c", event: "trade" }], lastSeq: 3 });
      return json(404, {});
    });
    const api = new Api({ baseUrl: "http://api", fetch: f });
    const got: string[] = [];
    const statuses: LiveStatus[] = [];
    const s = new EventStream({ api, onEvent: (e) => got.push(e.uid!), onStatus: (st) => statuses.push(st), minBackoffMs: 5, maxBackoffMs: 20, pollMs: 5 }).start();
    await vi.waitFor(() => expect(got).toEqual(["a", "b", "c", "d"]), { timeout: 3000 });
    await vi.waitFor(() => expect(s.status).toBe("live"), { timeout: 3000 });
    s.close();
    expect(statuses).toContain("polling");
    expect(statuses.at(-1)).toBe("closed");
    expect(s.cursor).toBe(4);
    expect(calls.filter((u) => u.includes("/events?since=")).slice(1).every((u) => !u.endsWith("since=0"))).toBe(true); // reconnects resume from the cursor
    expect(calls.some((u) => u.includes("/events/recent?since=2"))).toBe(true);
  });

  test("a restarted server (its sequence behind ours) is followed from its start", async () => {
    const { f } = fakeFetch((url) => {
      if (url.includes("/events/recent?since=50")) return json(200, { events: [], lastSeq: 2 });
      if (url.includes("/events/recent?since=0")) return json(200, { events: [{ seq: 1, uid: "fresh1", event: "trade" }, { seq: 2, uid: "fresh2", event: "trade" }], lastSeq: 2 });
      return json(200, {});
    });
    const got: string[] = [];
    const s = new EventStream({ api: new Api({ baseUrl: "http://api", fetch: f }), onEvent: (e) => got.push(e.uid!), since: 50 });
    expect(await s.backfill()).toBe(true);
    expect(got).toEqual(["fresh1", "fresh2"]);
    expect(s.cursor).toBe(2);
  });

  test("with the API unreachable the stream says offline and keeps trying", async () => {
    const api = new Api({ baseUrl: "http://api", fetch: (async () => { throw new TypeError("fetch failed"); }) as any });
    const statuses: LiveStatus[] = [];
    const s = new EventStream({ api, onEvent: () => {}, onStatus: (st) => statuses.push(st), minBackoffMs: 5, maxBackoffMs: 10, pollMs: 5 }).start();
    await vi.waitFor(() => expect(statuses).toContain("offline"), { timeout: 2000 });
    s.close();
  });

  test("a view that throws on an event never stops the stream", async () => {
    const s = new EventStream({ api: new Api({ baseUrl: "http://x", fetch: (async () => json(200, {})) as any }), onEvent: () => { throw new Error("view bug"); } });
    expect(() => s.deliver({ seq: 1, uid: "u", event: "trade", data: {} })).not.toThrow();
    expect(s.cursor).toBe(1);
  });
});
