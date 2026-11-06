// The replay (?recorded=1): the complete real mainnet run on the Tether T-Bills fact (claim 18), from
// deployments/rehearsal/mainnet.json, every transaction read back from the chain. It answers the API's
// routes from that record so the engine runs unchanged: a No bet replays the real free $1
// (tx FGFhi1W9…, 23% to 12%), then the signed rewrite 4.3 s later and the Skeptic's answer 12 s later,
// at their real offsets. Nothing is sent anywhere. A Yes bet is a rehearsal the contract's own math
// computes, labelled as one.
import rehearsal from "@/data/rehearsal-mainnet.json";
import type { Claim, Rationale, Rewrite } from "./core/api";
import type { Lane, LaneState, Trade } from "./core/lane";
import { contractBuy, marketFromClaim, priceYes } from "./core/lmsr";
import type { Store } from "./core/store";

const R = rehearsal as any;
const BET = R.steps.find((s: any) => s.kind === "bet");
const REWRITE = R.steps.find((s: any) => s.kind === "rewrite");
const ANSWER = R.steps.find((s: any) => s.kind === "answer");
export const RULING = R.steps.find((s: any) => s.kind === "ruling") as { at: number; record: any; chain: any };
export const REPLAY = {
  claimId: BET.claim_id as number,
  betTx: BET.chain.tx as string,
  betBlock: BET.chain.block_height as number,
  betAt: BET.at as number,
  betSide: BET.side as "yes" | "no",
  sharesMicro: Math.round(BET.shares * 1e6),
  priceAfterPpm: Math.round(BET.price_after * 1e6),
  rewriteAfterMs: REWRITE.signed_after_ms as number,
  answerAfterMs: R.timings_ms.bet_to_answer as number,
  recordedAt: R.recorded_at as string,
  market: R.market as string,
};

// Claim 18 as the chain held it just before the free $1: the final view's quantities less the two
// buys that came after it in the log (this bet, 1.203049 No, and the Archivist's 0.248424 No).
const FINAL_Q_YES = 1_740_974, FINAL_Q_NO = 4_930_100, LATER_NO = 1_203_049 + 248_424;
export function preBetClaim(): Claim & Record<string, any> {
  const view = { b_micro: "1450000", d0: "0", q_yes_micro: String(FINAL_Q_YES), q_no_micro: String(FINAL_Q_NO - LATER_NO), fee_bps: 0 };
  const ppm = Number(priceYes(marketFromClaim(view)!) / 1_000_000n);
  return {
    id: R.claim.id, text: R.claim.text, page: R.claim.page, kind: R.claim.kind, price_yes_ppm: ppm, cost_up_10_micro: "0", cost_down_10_micro: "0",
    status: "Open", outcome: null, provisional: null, trades: 5, volume_micro: "0", challenge_id: null, prev: null, next: null,
    price_yes: ppm / 1e6, cost_to_move: { up_10_points_usd: 0, down_10_points_usd: 0 }, volume_usd: 0, ...view,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function makeRecorded() {
  let claim = preBetClaim();
  let rewriteOut = false;
  const rewrite: Rewrite = { ...REWRITE.record };

  const fetchFn: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url, "http://recorded");
    const p = url.pathname.replace(/^\/api/, "");
    const q = url.searchParams;
    await new Promise((r) => setTimeout(r, 20));
    if (p === "/health") return json({ ok: true, network: "mainnet", marketId: REPLAY.market, failures: [], checks: { recorded: REPLAY.recordedAt } });
    if (p === "/claims") return json({ claims: [claim] });
    if (p === `/claims/${REPLAY.claimId}`) return json({ claim });
    if (p.startsWith("/claims/")) return json({ error: { code: "no_such_claim", message: "The replay covers the T-Bills fact only." } }, 404);
    if (p === "/events/recent") return json({ events: [], lastBlockHeight: null, lastSeq: 0 });
    if (p === "/rewrites") {
      if (q.get("history")) return json({ writer: null, rewrites: [{ paragraph: rewrite.paragraph, latest: rewrite, versions: [rewrite] }] });
      return json({ writer: null, rewrites: rewriteOut ? [rewrite] : [] });
    }
    if (p === "/rationales") return json({ rationales: [], agents: null });
    if (p === "/lane/key") return json({ error: { code: "lane_unavailable", message: "The replay sends nothing." } }, 503);
    return json({ error: { code: "not_found", message: "Not in the replay." } }, 404);
  };

  const session = { laneAccountId: "replay", contractId: REPLAY.market, publicKey: "replay", nonce: "0", blockHash: "", rpc: "", rpcs: [], methods: ["buy"], allowanceYocto: null, maxGasTgas: 0, reused: true, trader: "replay:you", rpcUrls: [] };
  const st: LaneState = { state: "ready", session };
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let store: Store | null = null;

  const buy = async (claimId: number, side: "yes" | "no", amountMicro: bigint) => {
    if (claimId !== REPLAY.claimId) return { ok: false as const, failure: { reason: "no_such_claim" as const, message: "The replay covers the T-Bills fact only.", retryable: false, readOnly: true } };
    const before = claim.price_yes_ppm;
    let trade: Trade;
    let txHash = "";
    if (side === REPLAY.betSide) {
      // the real bet, as the chain logged it
      trade = { claim_id: claimId, trader: "replay:you", side, shares_micro: String(REPLAY.sharesMicro), amount_micro: String(amountMicro), price_yes_ppm_before: before, price_yes_ppm_after: REPLAY.priceAfterPpm, balance_micro: "0" };
      txHash = REPLAY.betTx;
    } else {
      // a rehearsal: the contract's fill on the same market, nothing sent
      const r = contractBuy(marketFromClaim(claim as any)!, side, amountMicro, 0n);
      const after = Number(priceYes(r.after) / 1_000_000n);
      trade = { claim_id: claimId, trader: "replay:you", side, shares_micro: String(r.sharesMicro), amount_micro: String(amountMicro), price_yes_ppm_before: before, price_yes_ppm_after: after, balance_micro: "0" };
    }
    claim = { ...claim, price_yes_ppm: trade.price_yes_ppm_after, price_yes: trade.price_yes_ppm_after / 1e6, trades: claim.trades + 1 };
    await pause(900);
    const sent = { ok: true as const, txHash, outcome: {} as any, value: trade, ms: 900 };
    if (txHash) schedule(side);
    return { ...sent, final: pause(1300).then(() => ({ ...sent, ms: 2200 })) };
  };

  // the rewrite and the answer arrive at their real offsets after the bet
  function schedule(_side: string) {
    setTimeout(() => {
      rewriteOut = true;
      store?.ingest({ seq: 1e9, uid: `replay-rewrite-${Date.now()}`, event: "rewrite", source: "ai", data: { ...rewrite, createdAt: Date.now() } });
    }, REPLAY.rewriteAfterMs);
    setTimeout(() => {
      const a: Rationale = { ...ANSWER.record, at: Date.now() };
      store?.ingest({ seq: 1e9 + 1, uid: `replay-answer-${Date.now()}`, event: "agent_rationale", source: "ai", data: a });
    }, REPLAY.answerAfterMs);
  }

  const fail = (message: string) => async () => ({ ok: false as const, failure: { reason: "unavailable" as const, message, retryable: false, readOnly: true } });
  const lane = {
    st, rpc: null,
    get trader() { return "replay:you"; },
    subscribe: () => () => true,
    publicKey: () => "replay",
    prepare: async () => st,
    whenReady: async () => ({ ok: true as const, session }),
    buy,
    sell: fail("Nothing to sell in the replay."),
    openAndBuy: fail("New facts can't open in the replay."),
    redeem: fail("Nothing to collect in the replay."),
    final: async () => ({ ok: true as const, txHash: "", outcome: {} as any, value: null, ms: 0 }),
    claimLane: fail("Nothing to claim in the replay."),
  } as unknown as Lane;

  return { fetch: fetchFn, lane, attach: (s: Store) => { store = s; } };
}
