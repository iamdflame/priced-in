import { describe, expect, test, vi } from "vitest";
import { SignedTransaction, KeyPair, baseEncode } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Api } from "@/lib/core/api";
import { loadConfig } from "@/lib/core/config";
import { Lane, MemoryKeyStore, browserKeyStore, classifyTxError } from "@/lib/core/lane";
import { NearRpc, RpcError, b64, unb64, type TxOutcome } from "@/lib/core/rpc";

const config = { ...loadConfig({}), laneReadyTimeoutMs: 300, stallMs: 500 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const BLOCK = baseEncode(new Uint8Array(32).fill(7));

function laneApi(answer: (pk: string, n: number) => Response | Promise<Response>) {
  let n = 0;
  const api = new Api({ baseUrl: "http://api", fetch: (async (_u: any, init: RequestInit) => answer(JSON.parse(String(init.body)).publicKey, ++n)) as any });
  return { api, count: () => n };
}

const issued = (pk: string, over: object = {}) => json(200, {
  laneAccountId: "lane.basalt.testnet", contractId: "market.basalt.testnet", publicKey: pk, nonce: "1000", blockHash: BLOCK,
  rpc: "http://rpc-a", rpcs: ["http://rpc-a", "http://rpc-b"], methods: ["buy", "sell", "open_and_buy", "redeem", "claim_lane"], allowanceYocto: "250000000000000000000000", maxGasTgas: 20, reused: false, ...over,
});

const success = (value: unknown): TxOutcome => ({ status: { SuccessValue: b64(new TextEncoder().encode(JSON.stringify(value))) }, receipts_outcome: [] });
const panic = (msg: string): TxOutcome => ({ status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${msg}` } } } } } });

/** A stand-in RPC that records what it was sent. */
function fakeRpc(behave: { send?: (signed: string, n: number) => TxOutcome | Promise<TxOutcome>; final?: () => TxOutcome | Promise<TxOutcome>; nonce?: number } = {}) {
  const sent: SignedTransaction[] = [];
  let n = 0;
  const rpc = {
    urls: ["http://rpc-a", "http://rpc-b"],
    async sendRace(signedB64: string) { sent.push(SignedTransaction.decode(unb64(signedB64))); return (behave.send ?? (() => success({ claim_id: 1, price_yes_ppm_after: 358265 })))(signedB64, ++n); },
    async waitFinal() { return (behave.final ?? (() => success({ claim_id: 1, price_yes_ppm_after: 358265 })))(); },
    async finalBlockHash() { return BLOCK; },
    async viewAccessKey() { return { nonce: behave.nonce ?? 5000, permission: {}, block_hash: BLOCK }; },
    async view(_c: string, method: string) { return method === "lane_claimable" ? "250000" : method === "get_balance" ? "1250000" : { yes_micro: "0", no_micro: "2333296" }; },
  };
  return { rpc: rpc as unknown as NearRpc, sent };
}

function makeLane(o: { api?: Api; rpc?: NearRpc; keys?: MemoryKeyStore } = {}) {
  const keys = o.keys ?? new MemoryKeyStore();
  const f = fakeRpc();
  const api = o.api ?? laneApi((pk) => issued(pk)).api;
  return new Lane({ api, config, keys, rpc: () => o.rpc ?? f.rpc, sleep: async () => {} });
}

describe("lane: the browser's key", () => {
  test("made once and kept: a second visit signs with the same key", () => {
    const keys = new MemoryKeyStore();
    const a = makeLane({ keys }).publicKey();
    expect(a).toMatch(/^ed25519:/);
    expect(makeLane({ keys }).publicKey()).toBe(a);
    expect(makeLane({ keys }).trader).toBe(`lane:${a}`);
    expect(KeyPair.fromString(keys.get() as any).getPublicKey().toString()).toBe(a);
  });

  test("localStorage when it works, memory when the browser blocks it", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as Storage;
    const ks = browserKeyStore("testnet", storage);
    expect(ks.persistent).toBe(true);
    ks.set("ed25519:secret");
    expect(mem.get("pricedin.lane.testnet.v1")).toBe("ed25519:secret");
    const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() {} } as unknown as Storage;
    expect(browserKeyStore("testnet", blocked).persistent).toBe(false);
    expect(browserKeyStore("testnet", undefined).persistent).toBe(false);
  });
});

describe("lane: preparing your $1", () => {
  test("POST /lane/key with this browser's key; concurrent callers share one request", async () => {
    const { api, count } = laneApi((pk) => issued(pk));
    const lane = makeLane({ api });
    const [a, b] = await Promise.all([lane.prepare(), lane.prepare()]);
    expect(a).toBe(b);
    expect(count()).toBe(1);
    expect(lane.st).toMatchObject({ state: "ready", session: { laneAccountId: "lane.basalt.testnet", trader: `lane:${lane.publicKey()}` } });
    await lane.prepare();
    expect(count()).toBe(1);
  });

  test("a retryable failure is retried once; a second failure is the answer", async () => {
    const { api, count } = laneApi((pk, n) => (n === 1 ? json(504, { error: { code: "lane_timeout", message: "Adding your key took too long." } }) : issued(pk)));
    const lane = makeLane({ api });
    expect((await lane.prepare()).state).toBe("ready");
    expect(count()).toBe(2);
    const twice = laneApi(() => json(502, { error: { code: "lane_upstream_error", message: "x" } }));
    const l2 = makeLane({ api: twice.api });
    expect(await l2.prepare()).toMatchObject({ state: "failed", failure: { reason: "unavailable", readOnly: true } });
    expect(twice.count()).toBe(2);
  });

  test("the lane used up for today: plain words and the read-only path, no retry", async () => {
    const { api, count } = laneApi(() => json(503, { error: { code: "lane_used_up", message: "The judges' lane is used up for now: no free credit is left on the market." } }));
    const s = await makeLane({ api }).prepare();
    expect(s).toMatchObject({ state: "failed", failure: { reason: "used_up", readOnly: true, retryable: false, message: "The judges' lane is used up for now: no free credit is left on the market." } });
    expect(count()).toBe(1);
    const rl = await makeLane({ api: laneApi(() => json(429, { error: { code: "rate_limited", message: "This address has used its 3 free bets for today.", retryAfterS: 999 } })).api }).prepare();
    expect(rl).toMatchObject({ state: "failed", failure: { reason: "rate_limited", readOnly: true, retryAfterS: 999 } });
  });

  test("a key answer from the other network is refused before anything is signed", async () => {
    const { api } = laneApi((pk) => issued(pk, { contractId: "market.alice.near" }));
    expect(await makeLane({ api }).prepare()).toMatchObject({ state: "failed", failure: { reason: "network_mismatch" } });
    const rpcs = laneApi((pk) => issued(pk, { rpcs: ["https://rpc.mainnet.near.org"] }));
    expect(await makeLane({ api: rpcs.api }).prepare()).toMatchObject({ state: "failed", failure: { reason: "network_mismatch" } });
  });

  test("still preparing when the tap comes: whenReady says so after its timeout", async () => {
    const { api } = laneApi(() => new Promise(() => {}));
    const r = await makeLane({ api }).whenReady(30);
    expect(r).toMatchObject({ ok: false, failure: { reason: "preparing", retryable: true } });
  });
});

describe("lane: signing and sending", () => {
  test("buy is signed in the browser with the next nonce, for the market, as the lane account", async () => {
    const f = fakeRpc();
    const lane = makeLane({ rpc: f.rpc });
    const r = await lane.buy(0, "no", 1_000_000n);
    expect(r).toMatchObject({ ok: true, value: { claim_id: 1, price_yes_ppm_after: 358265 } });
    const tx = f.sent[0].transaction as any;
    expect(tx.signerId).toBe("lane.basalt.testnet");
    expect(tx.receiverId).toBe("market.basalt.testnet");
    expect(String(tx.nonce)).toBe("1001");
    expect(tx.publicKey.toString()).toBe(lane.publicKey());
    const fc = tx.actions[0].functionCall;
    expect(fc.methodName).toBe("buy");
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args)))).toEqual({ claim_id: 0, side: "no", amount_micro: "1000000", min_shares_micro: "0" });
    expect(String(fc.gas)).toBe(String(20n * 10n ** 12n));
    expect(String(fc.deposit)).toBe("0");
    // the signature is the browser key's, over sha256 of the transaction
    const sig = (f.sent[0].signature as any).ed25519Signature.data as Uint8Array;
    const pk = tx.publicKey.ed25519Key.data as Uint8Array;
    expect(ed25519.verify(Uint8Array.from(sig), sha256(f.sent[0].transaction.encode()), Uint8Array.from(pk))).toBe(true);
    const fin = await (r as any).final;
    expect(fin).toMatchObject({ ok: true });
  });

  test("bets from one key are serialized: nonces go up one at a time", async () => {
    const f = fakeRpc({ send: async (_s, n) => { await new Promise((r) => setTimeout(r, n === 1 ? 30 : 1)); return success({ n }); } });
    const lane = makeLane({ rpc: f.rpc });
    await Promise.all([lane.buy(0, "no", 1n), lane.sell(0, "no", 5n), lane.redeem(3)]);
    expect(f.sent.map((s) => String((s.transaction as any).nonce))).toEqual(["1001", "1002", "1003"]);
    expect(f.sent.map((s) => (s.transaction as any).actions[0].functionCall.methodName)).toEqual(["buy", "sell", "redeem"]);
  });

  test("open_and_buy sends the planner's receipt unchanged with the side and amount", async () => {
    const f = fakeRpc();
    const lane = makeLane({ rpc: f.rpc });
    const args = { text: "NEAR Intents passed $10B.", page: "paste-abc", kind: "data", p0_ppm: 600000, b_micro: "1000000", planner_sig_hex: "ab".repeat(64) };
    await lane.openAndBuy(args, "no", 1_000_000n);
    const fc = (f.sent[0].transaction as any).actions[0].functionCall;
    expect(fc.methodName).toBe("open_and_buy");
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args)))).toEqual({ ...args, side: "no", amount_micro: "1000000" });
  });

  test("a nonce clash re-reads the nonce from the error and re-signs once", async () => {
    const f = fakeRpc({ send: (_s, n) => { if (n === 1) throw new RpcError("INVALID_TRANSACTION", { name: "HANDLER_ERROR", cause: "INVALID_TRANSACTION", data: { TxExecutionError: { InvalidTxError: { InvalidNonce: { tx_nonce: 1001, ak_nonce: 1500 } } } } }); return success({ ok: 1 }); } });
    const lane = makeLane({ rpc: f.rpc });
    const r = await lane.buy(0, "no", 1n);
    expect(r.ok).toBe(true);
    expect(f.sent.map((s) => String((s.transaction as any).nonce))).toEqual(["1001", "1501"]);
    const always = fakeRpc({ send: () => { throw new RpcError("x", { cause: "INVALID_TRANSACTION", data: { InvalidNonce: { tx_nonce: 1, ak_nonce: 2 } } }); } });
    expect(await makeLane({ rpc: always.rpc }).buy(0, "no", 1n)).toMatchObject({ ok: false, failure: { reason: "nonce_clash", retryable: true } });
  });

  test("an RPC stall, a spent allowance and the contract's refusals each come back in plain words", async () => {
    const stall = fakeRpc({ send: () => { throw new RpcError("not executed within 500 ms", { transport: true, name: "STALL" }); } });
    expect(await makeLane({ rpc: stall.rpc }).buy(0, "no", 1n)).toMatchObject({ ok: false, failure: { reason: "rpc_stall", retryable: true } });
    const allowance = fakeRpc({ send: () => { throw new RpcError("x", { cause: "INVALID_TRANSACTION", data: { InvalidTxError: { InvalidAccessKeyError: { NotEnoughAllowance: { allowance: "1", cost: "2" } } } } }); } });
    expect(await makeLane({ rpc: allowance.rpc }).buy(0, "no", 1n)).toMatchObject({ ok: false, failure: { reason: "allowance_spent", readOnly: true } });
    for (const [msg, reason] of [["the judges' lane is used up for now", "used_up"], ["not enough balance", "credit_spent"], ["claim is settled", "settled"], ["paused", "paused"], ["slippage: fewer shares than min_shares", "slippage"], ["planner signature does not verify", "bad_receipt"], ["something new", "rejected"]] as const) {
      const p = fakeRpc({ send: () => panic(msg) });
      const r = await makeLane({ rpc: p.rpc }).buy(0, "no", 1n);
      expect(r).toMatchObject({ ok: false, failure: { reason } });
      expect((r as any).failure.message.length).toBeGreaterThan(10);
    }
  });

  test("a key the lane no longer has: prepare again", () => {
    expect(classifyTxError(new RpcError("x", { cause: "INVALID_TRANSACTION", data: { InvalidAccessKeyError: { AccessKeyNotFound: {} } } })).reason).toBe("preparing");
  });

  test("winnings: claim_lane to a real account, refused for an account on the other network", async () => {
    const f = fakeRpc();
    const lane = makeLane({ rpc: f.rpc });
    expect(await lane.claimLane("alice.near")).toMatchObject({ ok: false, failure: { reason: "network_mismatch" } });
    expect(f.sent).toHaveLength(0);
    await lane.claimLane("alice.testnet");
    const fc = (f.sent[0].transaction as any).actions[0].functionCall;
    expect(fc.methodName).toBe("claim_lane");
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args)))).toEqual({ account: "alice.testnet" });
    expect(await lane.claimableMicro("market.basalt.testnet")).toBe(250000n);
    expect(await lane.balanceMicro("market.basalt.testnet")).toBe(1250000n);
    expect(await lane.position("market.basalt.testnet", 0)).toEqual({ yes_micro: "0", no_micro: "2333296" });
  });
});

describe("rpc: the race across two RPCs", () => {
  const rpcFetch = (handler: (url: string, body: any) => any) => (async (url: any, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const r = await handler(String(url), body);
    if (r === "hang") return new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...r }), { status: 200 });
  }) as typeof fetch;

  test("the first RPC stalls; the second's status poll answers", async () => {
    const seen: string[] = [];
    const rpc = new NearRpc(["http://a", "http://b"], { pollMs: 5, fetch: rpcFetch((url, b) => {
      seen.push(`${url} ${b.method}`);
      if (url === "http://a") return "hang";
      if (b.method === "EXPERIMENTAL_tx_status") return { result: success({ via: "b" }) };
      return { result: "hash" };
    }) });
    const o = await rpc.sendRace("AAAA", "hash", "lane.testnet", { deadlineMs: 2000 });
    expect(o.status).toMatchObject({ SuccessValue: expect.any(String) });
    expect(seen).toContain("http://a send_tx");
    expect(seen).toContain("http://b broadcast_tx_async");
  });

  test("an invalid transaction is final at once; nothing executing is a stall", async () => {
    const rpc = new NearRpc(["http://a", "http://b"], { pollMs: 5, fetch: rpcFetch((_u, b) => b.method === "send_tx" ? { error: { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION", info: {} }, data: { InvalidNonce: { ak_nonce: 9 } } } } : { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } }) });
    await expect(rpc.sendRace("AAAA", "h", "lane.testnet", { deadlineMs: 1000 })).rejects.toMatchObject({ info: { cause: "INVALID_TRANSACTION" } });
    const never = new NearRpc(["http://a"], { pollMs: 5, fetch: rpcFetch((_u, b) => b.method === "send_tx" ? "hang" : { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } }) });
    await expect(never.sendRace("AAAA", "h", "lane.testnet", { deadlineMs: 150 })).rejects.toMatchObject({ info: { name: "STALL" } });
  });

  test("reads fail over to the next RPC", async () => {
    const rpc = new NearRpc(["http://a", "http://b"], { fetch: rpcFetch((url) => url === "http://a" ? { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK" } } } : { result: { header: { hash: "H" } } }) });
    expect(await rpc.finalBlockHash()).toBe("H");
    const view = new NearRpc(["http://a"], { fetch: rpcFetch(() => ({ result: { result: [...new TextEncoder().encode(JSON.stringify({ signing_address_hex: "ab" }))] } })) });
    expect(await view.view("m.testnet", "get_model", { model: "x" })).toEqual({ signing_address_hex: "ab" });
  });
});

vi.setConfig({ testTimeout: 10000 });
