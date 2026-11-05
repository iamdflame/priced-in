// Recorded mode: when the API can't be reached, the site shows the testnet deployment as it was
// recorded (web/src/ui/data/recorded.json, built from deployments/testnet.json by
// scripts/make-ui-data.mjs), always labelled as recorded. It answers the API's routes from that
// record, so the engine runs unchanged. A doubt here is a rehearsal: the contract's own LMSR
// computes what your $1 would do, and nothing is sent anywhere.
import type { Claim } from "../core/api";
import type { Lane, LaneState, Trade } from "../core/lane";
import { contractBuy, marketFromPrice, priceYes } from "../core/lmsr";
import { CORPUS } from "./data";
import rec from "./data/recorded.json";

export const RECORDED = rec as any as {
  network: string; recordedAt: string; marketId: string; rpc: string; page: string; title: string; revision: string; attribution: string;
  explorer: Record<string, string>;
  claims: (Claim & { section: string; b_micro: string; movers: any[] })[];
  events: any[];
  rewrite: any;
};

export const recordedDate = () => new Date(RECORDED.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refuse = (code: string, message: string) => json({ error: { code, message } }, 503);

/** The claims as they stand in this session (a rehearsal moves them, as the chain would). */
const claims = RECORDED.claims.map((c) => ({ ...c }));

export const recordedFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://recorded");
  const p = url.pathname;
  const q = url.searchParams;
  await new Promise((r) => setTimeout(r, 30));
  if (p === "/health") return json({ ok: true, network: RECORDED.network, marketId: RECORDED.marketId, failures: [], checks: { recorded: RECORDED.recordedAt } });
  if (p === "/claims") return json({ claims: q.get("page") && q.get("page") !== RECORDED.page ? [] : claims });
  const one = /^\/claims\/(\d+)$/.exec(p);
  if (one) {
    const c = claims.find((x) => x.id === Number(one[1]));
    return c ? json({ claim: c }) : json({ error: { code: "no_such_claim", message: "No claim with that number in the recording." } }, 404);
  }
  if (p === "/events/recent") {
    const since = Number(q.get("since") || 0);
    return json({ events: RECORDED.events.filter((e) => e.seq > since), lastBlockHeight: null, lastSeq: RECORDED.events.length });
  }
  if (p === "/events") {
    // an open stream that never carries a live event: nothing here is live
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(": recorded\n\n")); } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (p === "/rewrites") {
    if (q.get("page") !== RECORDED.page) return json({ writer: null, rewrites: [] });
    const r = RECORDED.rewrite;
    return json(q.get("history") ? { writer: null, rewrites: [{ paragraph: r.paragraph, latest: r, versions: [r] }] } : { writer: null, rewrites: [r] });
  }
  if (p === "/rationales") return json({ rationales: [], agents: null });
  if (p === "/ai/status") {
    return json({
      writer: { model: RECORDED.rewrite.provenance.model, recorded: true },
      agents: { recorded: true, roster: CORPUS.house.map((a) => ({ name: a.name, label: a.name, house: true, model: a.model, persona: a.instructions, limits: { max_bet_usd: a.maxBetUsd }, recorded: true })) },
      jury: null, attestations: null,
    });
  }
  if (p.startsWith("/post")) return refuse("x_unavailable", "Posts open only while Priced In is live, and this is recorded data. Try the link again in a minute.");
  if (p === "/paste") return refuse("upstream_error", "Pricing new text needs the live service, and this is recorded data.");
  if (p === "/lane/key") return refuse("lane_unavailable", "Bets are off in recorded mode.");
  return json({ error: { code: "not_found", message: "Nothing here in the recording." } }, 404);
};

/** A lane that sends nothing: it quotes with the contract's LMSR and says it rehearsed. */
export function recordedLane(): Lane {
  const st: LaneState = { state: "ready", session: { laneAccountId: "recorded", contractId: RECORDED.marketId, publicKey: "recorded", nonce: "0", blockHash: "", rpc: "", rpcs: [], methods: [], allowanceYocto: null, maxGasTgas: 0, reused: true, trader: "recorded:you", rpcUrls: [] } };
  const listeners = new Set<(s: LaneState) => void>();
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const buy = async (claimId: number, side: "yes" | "no", amountMicro: bigint) => {
    const c = claims.find((x) => x.id === claimId);
    if (!c) return { ok: false as const, failure: { reason: "no_such_claim" as const, message: "That sentence isn't in the recording.", retryable: false, readOnly: true } };
    const m = marketFromPrice(c.price_yes_ppm, BigInt(c.b_micro));
    const r = contractBuy(m, side, amountMicro);
    const before = c.price_yes_ppm;
    const after = Number(priceYes(r.after) / 1_000_000n);
    c.price_yes_ppm = after;
    await pause(800);
    const trade: Trade = { claim_id: claimId, trader: "recorded:you", side, shares_micro: String(r.sharesMicro), amount_micro: String(amountMicro), price_yes_ppm_before: before, price_yes_ppm_after: after, balance_micro: "0" };
    return { ok: true as const, txHash: "", outcome: {} as any, value: trade, ms: 800, final: pause(800).then(() => ({ ok: true as const, txHash: "", outcome: {} as any, value: trade, ms: 1600 })) };
  };
  const lane = {
    st,
    rpc: null,
    get trader() { return "recorded:you"; },
    subscribe(fn: (s: LaneState) => void) { listeners.add(fn); return () => listeners.delete(fn); },
    publicKey: () => "recorded",
    prepare: async () => st,
    whenReady: async () => ({ ok: true as const, session: (st as any).session }),
    buy,
    openAndBuy: async () => ({ ok: false as const, failure: { reason: "unavailable" as const, message: "New sentences can't open in recorded mode.", retryable: false, readOnly: true } }),
    final: async () => ({ ok: true as const, txHash: "", outcome: {} as any, value: null, ms: 0 }),
    claimLane: async () => ({ ok: false as const, failure: { reason: "unavailable" as const, message: "Nothing to claim in recorded mode.", retryable: false, readOnly: true } }),
  };
  return lane as unknown as Lane;
}
