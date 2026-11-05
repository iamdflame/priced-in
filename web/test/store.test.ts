import { describe, expect, test, vi } from "vitest";
import { Api, type Claim, type Rewrite, type Rationale } from "../src/core/api";
import { loadConfig } from "../src/core/config";
import { laneFailure, type LaneFailureReason, type LaneState, type Trade } from "../src/core/lane";
import { quoteBuy, marketFromReceipt } from "../src/core/lmsr";
import {
  createStore, doubtReducer, doubtFailure, IDLE, DOUBT_ORDER, inkGrad, type DoubtEvent, type DoubtState, type DoubtFailureReason,
} from "../src/core/store";
import fixture from "./fixtures/rewrite-signed.json";

const config = loadConfig({});

// ---------- the machine, pure ----------

const start: DoubtEvent = { type: "start", key: "c0", claimId: 0, side: "no", amountMicro: 1_000_000n, priceBefore: 0.5, at: 1 };
const quote = quoteBuy(marketFromReceipt(500_000, 3_000_000), "no", 1);
const trade: Trade = { claim_id: 0, trader: "lane:ed25519:me", side: "no", shares_micro: "2333296", amount_micro: "999999", price_yes_ppm_before: 500000, price_yes_ppm_after: 358265, balance_micro: "1" };
const rw = (status: Rewrite["status"], version = 1): Rewrite => ({ id: `near:0:v${version}`, page: "near", paragraph: 0, version, status, createdAt: 5, text: "t", sentences: [{ claim_id: 0, claim: "c", probability: 0.36, band: "negate", text: "t" }], provenance: { kind: status === "template" ? "template" : "model", status, verified: status === "signed", model: status === "template" ? null : "z-ai/glm-5.3-flash" } });
const answer = { agent: "house-ledger", claim_id: 0, side: "yes", source_url: "https://example.org", at: 9 } as Rationale;
const run = (...events: DoubtEvent[]) => events.reduce(doubtReducer, IDLE as DoubtState);

describe("doubt machine: idle, quoting, signing, optimistic, final, rewritten, answered", () => {
  test("the happy path passes every stage in order, with a time for each", () => {
    const stages: string[] = [];
    let s: DoubtState = IDLE;
    for (const e of [start, { type: "quoted", quote, at: 2 }, { type: "signing", at: 3 }, { type: "optimistic", txHash: "T", trade, at: 4 }, { type: "final", trade, at: 5 }, { type: "rewrite", rewrite: rw("signed"), at: 6 }, { type: "answer", rationale: answer, at: 7 }] as DoubtEvent[]) {
      s = doubtReducer(s, e);
      if (stages.at(-1) !== s.stage) stages.push(s.stage);
    }
    expect(stages).toEqual(["quoting", "signing", "optimistic", "final", "rewritten", "answered"]);
    expect(stages).toEqual(DOUBT_ORDER.slice(1));
    expect(s.ctx).toMatchObject({ txHash: "T", claimId: 0, quote, rewrite: { status: "signed" }, answer: { agent: "house-ledger" } });
    expect(s.ctx!.t).toEqual({ quoting: 1, signing: 3, optimistic: 4, final: 5, rewritten: 6, answered: 7 });
  });

  test("a rewrite and an answer that arrive before final are kept, then land in order", () => {
    const s = run(start, { type: "signing", at: 2 }, { type: "optimistic", txHash: "T", trade, at: 3 }, { type: "rewrite", rewrite: rw("unsigned"), at: 4 }, { type: "answer", rationale: answer, at: 4 });
    expect(s.stage).toBe("optimistic");
    const f = doubtReducer(s, { type: "final", trade, at: 6 });
    expect(f.stage).toBe("answered");
    expect(f.ctx!.t).toMatchObject({ final: 6, rewritten: 6, answered: 6 });
    const onlyRewrite = doubtReducer(run(start, { type: "signing", at: 2 }, { type: "optimistic", txHash: "T", trade, at: 3 }, { type: "rewrite", rewrite: rw("template"), at: 4 }), { type: "final", trade, at: 5 });
    expect(onlyRewrite.stage).toBe("rewritten");
  });

  test("the late signature swaps in: template, then unsigned, then signed; an older version never wins", () => {
    let s = run(start, { type: "signing", at: 2 }, { type: "optimistic", txHash: "T", trade, at: 3 }, { type: "final", trade, at: 4 }, { type: "rewrite", rewrite: rw("template"), at: 5 });
    expect(s.stage).toBe("rewritten");
    s = doubtReducer(s, { type: "rewrite", rewrite: rw("unsigned"), at: 6 });
    s = doubtReducer(s, { type: "rewrite", rewrite: rw("signed"), at: 9 });
    expect(s.ctx!.rewrite!.status).toBe("signed");
    s = doubtReducer(s, { type: "rewrite", rewrite: rw("unsigned"), at: 10 });
    expect(s.ctx!.rewrite!.status).toBe("signed");
    s = doubtReducer(s, { type: "rewrite", rewrite: rw("template", 2), at: 11 });
    expect(s.ctx!.rewrite!.version).toBe(2);
    s = doubtReducer(s, { type: "rewrite", rewrite: rw("signed", 1), at: 12 });
    expect(s.ctx!.rewrite!.version).toBe(2);
    expect(s.ctx!.t.rewritten).toBe(5);
  });

  test("a second tap while a bet is on its way is ignored; reset only once it has landed or failed", () => {
    const busy = run(start, { type: "signing", at: 2 });
    expect(doubtReducer(busy, { ...start, key: "c9" })).toBe(busy);
    expect(doubtReducer(busy, { type: "reset" })).toBe(busy);
    const done = run(start, { type: "signing", at: 2 }, { type: "optimistic", txHash: "T", trade, at: 3 }, { type: "final", trade, at: 4 });
    expect(doubtReducer(done, { type: "reset" })).toBe(IDLE);
    expect(doubtReducer(done, { ...start, key: "c1" }).stage).toBe("quoting");
  });

  test("failures from quoting, signing and optimistic; never after the bet executed", () => {
    expect(run(start, { type: "fail", reason: "preparing", at: 2 })).toMatchObject({ stage: "failed", failure: { reason: "preparing", at: "quoting", retryable: true } });
    expect(run(start, { type: "signing", at: 2 }, { type: "fail", reason: "rpc_stall", at: 3 })).toMatchObject({ stage: "failed", failure: { at: "signing", reason: "rpc_stall" } });
    expect(run(start, { type: "signing", at: 2 }, { type: "optimistic", txHash: "T", trade, at: 3 }, { type: "fail", reason: "rejected", at: 4 }).failure!.at).toBe("optimistic");
    const final = run(start, { type: "signing", at: 2 }, { type: "optimistic", txHash: "T", trade, at: 3 }, { type: "final", trade, at: 4 });
    expect(doubtReducer(final, { type: "fail", reason: "rejected", at: 5 })).toBe(final);
    expect(doubtReducer(final, { type: "final_late", note: "x" })).toBe(final);
  });

  test("events out of order are ignored", () => {
    const q = run(start);
    expect(doubtReducer(q, { type: "optimistic", txHash: "T", trade, at: 3 })).toBe(q);
    expect(doubtReducer(q, { type: "final", trade, at: 3 })).toBe(q);
    expect(doubtReducer(IDLE, { type: "rewrite", rewrite: rw("signed"), at: 1 })).toBe(IDLE);
    expect(doubtReducer(IDLE, { type: "answer", rationale: answer, at: 1 })).toBe(IDLE);
  });

  test("every failure reason has plain words; the read-only ones say prices still work", () => {
    const reasons: DoubtFailureReason[] = ["preparing", "used_up", "rate_limited", "daily_cap", "paused", "unavailable", "offline", "network_mismatch", "rpc_stall", "nonce_clash", "allowance_spent", "credit_spent", "settled", "slippage", "no_such_claim", "bad_receipt", "not_allowed", "rejected", "unpriced", "overflow", "busy"];
    for (const r of reasons) {
      const f = doubtFailure(r, "signing");
      expect(f.message.length, r).toBeGreaterThan(15);
      expect(f.message, r).not.toMatch(/undefined|Error|panicked|\{/);
    }
    expect(doubtFailure("used_up", "quoting")).toMatchObject({ readOnly: true, retryable: false });
    expect(doubtFailure("used_up", "quoting").message).toMatch(/price/i);
    expect(doubtFailure("rpc_stall", "signing")).toMatchObject({ retryable: true, readOnly: false });
    expect(doubtFailure("preparing", "quoting").message).toBe("Preparing your $1…");
  });
});

// ---------- the store, end to end against fakes ----------

const claim = (id: number, ppm: number, over: Partial<Claim> = {}): Claim => ({
  id, text: `Claim ${id} is true.`, page: "near", kind: "data", price_yes_ppm: ppm, cost_up_10_micro: "0", cost_down_10_micro: "0", status: "Open", outcome: null, provisional: null,
  trades: 0, volume_micro: "0", price_yes: ppm / 1e6, cost_to_move: { up_10_points_usd: 0, down_10_points_usd: 0 }, volume_usd: 0, ...over,
});
// cost_up_10 for b = $3 at 50%: 3 ln(0.5 / 0.4)
const c0 = claim(0, 500000, { cost_up_10_micro: String(Math.round(3e6 * Math.log(0.5 / 0.4))), cost_down_10_micro: String(Math.round(3e6 * Math.log(0.5 / 0.4))) });

function fakeApi(over: Record<string, (url: string) => unknown> = {}) {
  const routes: Record<string, (url: string) => unknown> = {
    "/claims?page=near": () => ({ claims: [c0, claim(1, 900000)] }),
    "/claims?page=x-20": () => ({ claims: [claim(7, 600000, { page: "x-20", text: "NEAR Intents passed $10B." })] }),
    "/claims": () => ({ claims: [c0, claim(1, 900000), claim(5, 400000, { page: "solana", trades: 9 })] }),
    "/rewrites?page=near": () => ({ rewrites: [] }),
    "/rewrites?page=x-20": () => ({ rewrites: [] }),
    "/rationales?page=near": () => ({ rationales: [] }),
    "/events/recent?since=0": () => ({ events: [], lastSeq: 0 }),
    ...over,
  };
  const f = (async (u: any) => {
    const path = String(u).replace("http://api", "");
    const h = routes[path] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && path.startsWith(k.slice(0, -1)))?.[1];
    if (!h) return new Response(JSON.stringify({ error: { code: "not_found", message: `no ${path}` } }), { status: 404 });
    const v = h(path) as any;
    if (v instanceof Response) return v;
    return new Response(JSON.stringify(v), { status: 200 });
  }) as typeof fetch;
  return new Api({ baseUrl: "http://api", fetch: f });
}

type Sent = { ok: true; txHash: string; outcome: any; value: Trade; ms: number; final: Promise<any> } | { ok: false; failure: ReturnType<typeof laneFailure> };

function fakeLane(o: { ready?: Promise<void>; buy?: (args: any) => Promise<Sent> | Sent; final?: () => Promise<any>; prepareFails?: LaneFailureReason } = {}) {
  let st: LaneState = { state: "idle" };
  const subs = new Set<(s: LaneState) => void>();
  const set = (s: LaneState) => { st = s; subs.forEach((f) => f(s)); };
  const session = { laneAccountId: "lane.basalt.testnet", contractId: "market.basalt.testnet", publicKey: "ed25519:me", trader: "lane:ed25519:me", rpcUrls: [] } as any;
  const calls: { method: string; args: any }[] = [];
  const finalP = () => (o.final ?? (async () => ({ ok: true, txHash: "TX1", value: trade })))();
  const send = async (method: string, args: any): Promise<Sent> => {
    calls.push({ method, args });
    return o.buy ? o.buy({ method, ...args }) : { ok: true, txHash: "TX1", outcome: {}, value: { ...trade, claim_id: args.claim_id ?? 7 }, ms: 1, final: finalP() };
  };
  const lane = {
    get st() { return st; },
    trader: "lane:ed25519:me",
    rpc: null,
    subscribe: (f: (s: LaneState) => void) => { subs.add(f); return () => subs.delete(f); },
    prepare: async () => {
      if (st.state === "ready") return st;
      set({ state: "preparing", since: 0, attempt: 1 });
      await (o.ready ?? Promise.resolve());
      set(o.prepareFails ? { state: "failed", failure: laneFailure(o.prepareFails) } : { state: "ready", session });
      return st;
    },
    async whenReady() { const s = await lane.prepare(); return s.state === "ready" ? { ok: true, session } : { ok: false, failure: (s as any).failure }; },
    buy: (claim_id: number, side: string, amount: bigint) => send("buy", { claim_id, side, amount_micro: String(amount) }),
    openAndBuy: (args: any, side: string, amount: bigint) => send("open_and_buy", { ...args, side, amount_micro: String(amount) }),
    final: () => finalP(),
    claimLane: async () => ({ ok: true }),
  };
  return { lane: lane as any, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function pageStore(lane = fakeLane(), api = fakeApi()) {
  const store = createStore({ api, lane: lane.lane, config, stream: false });
  await store.open({ name: "page", slug: "near" });
  return { store, ...lane };
}

describe("store: a page, its prices and the doubt", () => {
  test("a page loads with prices, ink and the cost to move 10 points", async () => {
    const { store } = await pageStore();
    const [s0, s1] = store.state.page.sentences;
    expect(store.state.page).toMatchObject({ kind: "page", slug: "near", loading: false, error: null });
    expect(store.derived.price(s0)).toBe(0.5);
    expect(store.derived.ink(s1)).toBe(inkGrad(0.9));
    expect(inkGrad(0)).toBe(-400);
    expect(inkGrad(1)).toBe(400);
    const c = store.derived.costToMove10(s0)!;
    expect(c.upUsd).toBeCloseTo(Number(c0.cost_up_10_micro) / 1e6, 4);
    expect(s0.bMicro).toBe(3_000_000n);
  });

  test("tap, doubt, and the ink moves at once from the quote, then follows the chain to final", async () => {
    let release!: (v: Sent) => void;
    const lane = fakeLane({ buy: () => new Promise<Sent>((r) => { release = r; }) });
    const { store, calls } = await pageStore(lane);
    store.select("c0");
    const done = store.doubt("c0");
    await vi.waitFor(() => expect(store.state.doubt.stage).toBe("signing"));
    const s = store.state.page.sentences[0];
    expect(s.optimisticPpm).toBe(Math.floor(quoteBuy(marketFromReceipt(500000, 3_000_000), "no", 1).priceAfter * 1e6));
    expect(store.derived.price(s)!).toBeLessThan(0.4);
    release({ ok: true, txHash: "TX1", outcome: {}, value: { ...trade, price_yes_ppm_after: 358000 }, ms: 1, final: Promise.resolve({ ok: true, txHash: "TX1", value: { ...trade, price_yes_ppm_after: 358000 } }) });
    await done;
    expect(store.state.doubt.stage).toBe("final");
    const after = store.state.page.sentences[0];
    expect(after).toMatchObject({ chainPpm: 358000, optimisticPpm: null });
    expect(after.movers[0]).toMatchObject({ mine: true, txHash: "TX1" });
    expect(calls).toEqual([{ method: "buy", args: { claim_id: 0, side: "no", amount_micro: "1000000" } }]);
  });

  test("then the paragraph rewrites itself and an agent answers with a source", async () => {
    const { store } = await pageStore();
    await store.doubt("c0");
    expect(store.state.doubt.stage).toBe("final");
    const rec = { ...structuredClone(fixture.record), page: "near", createdAt: Date.now() } as unknown as Rewrite;
    store.ingest({ seq: 1, uid: "r1", event: "rewrite", source: "ai", data: { ...rec, status: "unsigned", provenance: { ...rec.provenance, status: "unsigned" } } });
    expect(store.state.doubt.stage).toBe("rewritten");
    expect(store.state.page.sentences[0].text).toBe(rec.sentences[0].text);
    expect(store.state.page.sentences[0].rewrite).toMatchObject({ status: "unsigned", signed: false });
    store.ingest({ seq: 2, uid: "r2", event: "rewrite", source: "ai", data: rec });
    expect(store.state.page.sentences[0].rewrite).toMatchObject({ status: "signed", signed: true, model: fixture.model });
    store.ingest({ seq: 3, uid: "a1", event: "agent_rationale", source: "ai", data: { ...answer, account_id: "house-ledger.basalt.testnet", page: "near", at: Date.now() } });
    expect(store.state.doubt.stage).toBe("answered");
    expect(store.state.page.sentences[0].source).toEqual({ url: "https://example.org", title: null, agent: "house-ledger" });
  });

  test("key not ready on the tap: 'preparing your $1', then the bet goes", async () => {
    let ready!: () => void;
    const lane = fakeLane({ ready: new Promise<void>((r) => { ready = r; }) });
    const store = createStore({ api: fakeApi(), lane: lane.lane, config, stream: false });
    void store.open({ name: "page", slug: "near" });
    await vi.waitFor(() => expect(store.state.page.sentences.length).toBe(2));
    const done = store.doubt("c0");
    await tick();
    expect(store.state.doubt).toMatchObject({ stage: "quoting", ctx: { waitingFor: "lane" } });
    expect(store.state.page.sentences[0].optimisticPpm).not.toBeNull(); // the ink already moved
    ready();
    await done;
    expect(store.state.doubt.stage).toBe("final");
  });

  for (const [reason, label] of [["used_up", "the lane used up for the day"], ["rate_limited", "this address's free bets used"], ["preparing", "the key never got ready"]] as const) {
    test(`fails before signing when ${label}: the ink moves back, the read-only path stays`, async () => {
      const { store, calls } = await pageStore(fakeLane({ prepareFails: reason }));
      await store.doubt("c0");
      expect(store.state.doubt).toMatchObject({ stage: "failed", failure: { reason, at: "quoting" } });
      expect(store.state.page.sentences[0]).toMatchObject({ optimisticPpm: null, chainPpm: 500000 });
      expect(calls).toHaveLength(0);
      if (reason !== "preparing") expect(store.state.doubt.failure!.readOnly).toBe(true);
    });
  }

  for (const reason of ["rpc_stall", "nonce_clash", "allowance_spent", "credit_spent", "settled", "rejected"] as const) {
    test(`fails while sending (${reason}): rolled back, with its reason`, async () => {
      const { store } = await pageStore(fakeLane({ buy: () => ({ ok: false, failure: laneFailure(reason) }) }));
      await store.doubt("c0");
      expect(store.state.doubt).toMatchObject({ stage: "failed", failure: { reason, at: "signing" } });
      expect(store.state.page.sentences[0].optimisticPpm).toBeNull();
      expect(store.derived.price(store.state.page.sentences[0])).toBe(0.5);
    });
  }

  test("final slow to confirm: the bet stays optimistic with a note, then lands", async () => {
    let n = 0;
    const lane = fakeLane({ final: async () => (++n === 1 ? { ok: false, failure: laneFailure("rpc_stall") } : { ok: true, txHash: "TX1", value: trade }) });
    const { store } = await pageStore(lane);
    const seen: string[] = [];
    store.subscribe((s) => { if (s.doubt.ctx?.finalNote) seen.push(s.doubt.ctx.finalNote); });
    await store.doubt("c0");
    expect(seen[0]).toMatch(/Executed/);
    expect(store.state.doubt.stage).toBe("final");
  });

  test("an unpriced line can't be doubted; a doubt in flight ignores a second tap", async () => {
    const api = fakeApi({ "/post/20": () => ({ source: "x", page: "x-20", gone: false, post: { id: "20", text: "t" }, notices: [], sentences: [{ index: 0, text: "I love it!", status: "unfalsifiable", label: "judgment", reason: "Opinion or uncheckable: not priced." }] }) });
    const store = createStore({ api, lane: fakeLane().lane, config, stream: false });
    await store.open({ name: "post", id: "20", user: null, apiPath: "20" });
    await store.doubt("s0");
    expect(store.state.doubt).toMatchObject({ stage: "failed", failure: { reason: "unpriced", message: "Opinion or uncheckable: not priced." } });

    let release!: (v: Sent) => void;
    const slow = await pageStore(fakeLane({ buy: () => new Promise<Sent>((r) => { release = r; }) }));
    const first = slow.store.doubt("c0");
    await vi.waitFor(() => expect(slow.store.state.doubt.stage).toBe("signing"));
    const second = await slow.store.doubt("c1");
    expect(second.ctx!.key).toBe("c0");
    release({ ok: false, failure: laneFailure("rejected") });
    await first;
    expect(slow.calls).toHaveLength(1);
  });

  test("a post's sentence with no market yet opens with open_and_buy from the planner's receipt", async () => {
    const receipt = { message: "open:x-20:…", planner_sig_hex: "ab", args: { text: "NEAR Intents passed $10B.", page: "x-20", kind: "data", p0_ppm: 600000, b_micro: "1000000", planner_sig_hex: "ab" } };
    const api = fakeApi({ "/post/jack/status/20": () => ({ source: "x", page: "x-20", gone: false, post: { id: "20", text: "NEAR Intents passed $10B." }, notices: [{ code: "language", message: "Written in English." }], sentences: [{ index: 0, text: receipt.args.text, status: "priced", label: "data", kind: "data", p0_ppm: 600000, receipt }] }) });
    const lane = fakeLane();
    const store = createStore({ api, lane: lane.lane, config, stream: false });
    await store.open({ name: "post", id: "20", user: "jack", apiPath: "jack/status/20" });
    const s = store.state.page.sentences[0];
    expect(s).toMatchObject({ status: "unopened", claimId: null, chainPpm: 600000 });
    expect(store.derived.quote(s)!.priceBefore).toBeCloseTo(0.6, 9);
    await store.doubt("s0");
    expect(lane.calls[0]).toEqual({ method: "open_and_buy", args: { ...receipt.args, side: "no", amount_micro: "1000000" } });
    expect(store.state.page.sentences[0]).toMatchObject({ status: "open", claimId: 7, receipt: null });
    expect(store.state.doubt.stage).toBe("final");
  });

  test("a deleted post is a designed page, not an error", async () => {
    const api = fakeApi({ "/post/jack/status/404": () => new Response(JSON.stringify({ source: "x", page: "x-404", id: "404", gone: true, reason: "deleted", link: "https://x.com/i/status/404", message: "This post was deleted, so we show nothing from it." }), { status: 410 }) });
    const store = createStore({ api, lane: fakeLane().lane, config, stream: false });
    await store.open({ name: "post", id: "404", user: "jack", apiPath: "jack/status/404" });
    expect(store.state.page).toMatchObject({ error: null, gone: { reason: "deleted" }, sentences: [] });
  });

  test("live trades from others move the price, list the mover and feed the ticker", async () => {
    const { store } = await pageStore();
    store.ingest({ seq: 9, uid: "t9", event: "trade", txHash: "OTHER", data: { claim_id: 1, trader: "house-ledger.basalt.testnet", side: "no", amount_micro: "2000000", price_yes_ppm: 700000 } });
    const s1 = store.state.page.sentences[1];
    expect(s1).toMatchObject({ chainPpm: 700000, trades: 1 });
    expect(s1.movers[0]).toMatchObject({ trader: "house-ledger.basalt.testnet", amountUsd: 2, mine: false });
    expect(store.state.ticker[0].txHash).toBe("OTHER");
  });

  test("home: the live page is the busiest; errors are designed states", async () => {
    const store = createStore({ api: fakeApi(), lane: fakeLane().lane, config, stream: false });
    await store.open({ name: "home" });
    expect(store.state.page.pages.map((p) => p.slug)).toEqual(["solana", "near"]);
    expect(store.state.page.slug).toBe("solana");
    const down = createStore({ api: new Api({ baseUrl: "http://api", fetch: (async () => { throw new TypeError("fetch failed"); }) as any }), lane: fakeLane().lane, config, stream: false });
    await down.open({ name: "page", slug: "near" });
    expect(down.state.page.error).toMatchObject({ state: "offline" });
    await down.open({ name: "not_found", path: "/nope", reason: "No page at this address." });
    expect(down.state.page).toMatchObject({ kind: "not_found", message: "No page at this address." });
  });

  test("verify through the store: the record from GET /rewrites, the key from get_model", async () => {
    const rec = fixture.record;
    const api = fakeApi({ "/rewrites?page=near-intents&history=1": () => ({ rewrites: [{ paragraph: 0, latest: rec, versions: [rec] }] }) });
    const lane = fakeLane();
    lane.lane.rpc = { view: async (_c: string, m: string, a: any) => (m === "get_model" && a.model === fixture.model ? { signing_address_hex: fixture.signer } : null) };
    const store = createStore({ api, lane: lane.lane, config, stream: false });
    await store.open({ name: "page", slug: "near" });
    await lane.lane.prepare();
    const r = await store.verify("near-intents", rec.id);
    expect(r).toMatchObject({ ok: true, chip: `signed by ${fixture.model} in a TEE · verify` });
    expect(store.state.page.verify).toMatchObject({ running: false, result: { ok: true } });
  });

  test("the audit page loads the measured corpus result", async () => {
    const store = createStore({ api: fakeApi(), lane: fakeLane().lane, config, stream: false, loadAudit: async () => ({ headline: { numerator: 16, denominator: 232 } }) });
    await store.open({ name: "audit" });
    expect(store.state.page.audit.headline).toEqual({ numerator: 16, denominator: 232 });
  });
});
