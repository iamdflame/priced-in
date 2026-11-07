// The browser signs picks, nicknames and reports without near-api-js (lib/client/picks.ts). These tests
// hold it to the two things that must not drift: the key is the very key near-api-js reads from the same
// slot (so the free $1 and the board are one person), and the API's own parser accepts every signature
// (api/_lib/picks.mjs, the code the hosted API runs).
import { KeyPair } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error: plain ESM from the API, read here as it runs there
import { parsePick, parseProfile, parseReport, reportDigest as apiDigest } from "../../../api/_lib/picks.mjs";
import { b58decode, b58encode, browserKey, cleanNick, existingKey, pickMessage, profileMessage, reportDigest, reportMessage, cleanReport, saveNickname, sendPick, sendReport } from "@/lib/client/picks";

const NET = "mainnet";

describe("a signed write the API can't take just now", () => {
  const BUSY = { error: { code: "busy", message: "That didn't go through just now. Try again in a moment.", retryAfterS: 0 } };
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  let sent: { path: string; body: string }[];
  const answers = (...list: Response[]) => vi.fn(async (path: string, init: RequestInit) => { sent.push({ path, body: String(init.body) }); return list.shift()!; });

  beforeEach(() => {
    sent = [];
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a pick goes again once, the very same signed body, and lands", async () => {
    vi.stubGlobal("fetch", answers(answer(503, BUSY), answer(200, { ok: true, pick: { claim_id: 7, side: "yes", at: 1, price_yes_ppm: 500000 } })));
    const r = await sendPick(7, "yes");
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  it("a nickname and a report go again the same way", async () => {
    vi.stubGlobal("fetch", answers(answer(503, BUSY), answer(200, { ok: true, key: "k", nickname: "Ama" })));
    expect((await saveNickname("Ama")).ok).toBe(true);
    expect(sent.map((x) => x.path)).toEqual(["/api/profile", "/api/profile"]);
    sent = [];
    vi.stubGlobal("fetch", answers(answer(503, BUSY), answer(202, { ok: true, report: { id: "r" }, next: "" })));
    expect((await sendReport(7, "false", { url: "https://www.reuters.com/a", quote: "the words on it", note: "" })).ok).toBe(true);
    expect(sent.map((x) => x.path)).toEqual(["/api/reports", "/api/reports"]);
  });

  it("twice busy comes back in the API's own words, with no third try", async () => {
    vi.stubGlobal("fetch", answers(answer(503, BUSY), answer(503, BUSY)));
    const r = await sendPick(7, "yes");
    expect(sent).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, code: "busy", message: BUSY.error.message, status: 503, retryAfterS: 0 });
  });

  it("any other refusal is the answer: nothing goes again, and hosts come through", async () => {
    vi.stubGlobal("fetch", answers(answer(400, { error: { code: "untrusted_source", message: "Our Checker…", hosts: ["colts.com"] } })));
    const r = await sendReport(7, "false", { url: "https://example.org/a", quote: "the words on it", note: "" });
    expect(sent).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, code: "untrusted_source", hosts: ["colts.com"] });
  });
});

describe("the browser's key", () => {
  beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }; });

  it("base58 round-trips, leading zeros included", () => {
    for (const bytes of [new Uint8Array([0, 0, 1, 2, 255]), new Uint8Array(32).fill(7), new Uint8Array([0]), new Uint8Array(64).map((_, i) => i * 3)]) {
      expect([...b58decode(b58encode(bytes))]).toEqual([...bytes]);
    }
    expect(b58encode(new Uint8Array([0, 0, 0]))).toBe("111");
  });

  it("is made only on a tap, and near-api-js reads the same key from the same slot", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    expect(existingKey()).toBeNull();
    const k = browserKey();
    const secret = store.get("pricedin.lane.mainnet.v1")!;
    expect(secret).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
    const kp = KeyPair.fromString(secret as `ed25519:${string}`);
    expect(kp.getPublicKey().toString()).toBe(k.publicKey);
    // the same signature near-api-js makes
    const msg = pickMessage(40, "yes", 1794045600000);
    const theirs = Buffer.from(kp.sign(new TextEncoder().encode(msg)).signature).toString("hex");
    expect(k.sign(msg)).toBe(theirs);
    expect(existingKey()?.publicKey).toBe(k.publicKey);
  });

  it("reads a key the lane made", () => {
    const kp = KeyPair.fromRandom("ed25519");
    const store = new Map([["pricedin.lane.mainnet.v1", kp.toString()]]);
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} };
    expect(existingKey()?.publicKey).toBe(kp.getPublicKey().toString());
  });
});

describe("the API accepts what the browser signs", () => {
  const now = 1794045600000;
  const k = (() => { (globalThis as { localStorage?: unknown }).localStorage = undefined; return browserKey(); })();

  it("a pick", () => {
    const body = { public_key: k.publicKey, claim_id: 40, side: "no", issued_at: now, signature: k.sign(pickMessage(40, "no", now)) };
    const p = parsePick(body, { network: NET, nowMs: now + 1000 });
    expect(p).toMatchObject({ claim_id: 40, side: "no", key: k.publicKey });
  });

  it("a nickname, cleaned the same way", () => {
    const nickname = cleanNick("  Ｄiego   the  Ox ");
    expect(nickname).toBe("Diego the Ox");
    const p = parseProfile({ public_key: k.publicKey, nickname, issued_at: now, signature: k.sign(profileMessage(nickname, now)) }, { network: NET, nowMs: now });
    expect(p.nickname).toBe("Diego the Ox");
  });

  it("a report, its words digested the same way", () => {
    const words = cleanReport({ url: " https://www.mlb.com/news/mariners-hire-tanner-swanson ", quote: "The Mariners  announced\n on Friday that they have hired Tanner Swanson", note: "Already  announced." });
    expect(reportDigest(words)).toBe(apiDigest(words));
    const sig = k.sign(reportMessage(41, "true", reportDigest(words), now));
    const p = parseReport({ public_key: k.publicKey, claim_id: 41, says: "true", ...words, issued_at: now, signature: sig }, { network: NET, nowMs: now });
    expect(p).toMatchObject({ claim_id: 41, says: "true", quote: "The Mariners announced on Friday that they have hired Tanner Swanson" });
  });

  it("refuses a pick signed for another side", () => {
    const body = { public_key: k.publicKey, claim_id: 40, side: "yes", issued_at: now, signature: k.sign(pickMessage(40, "no", now)) };
    expect(() => parsePick(body, { network: NET, nowMs: now })).toThrow(/signature does not match/);
  });
});
