// The replay's engine: it answers the API's routes from the record and stands in for the lane, so the
// store runs unchanged. A No bet replays the real free $1 (tx FGFhi1W9…, 23% to 12%), then the signed
// rewrite 4.3 s later and the Skeptic's answer 12 s later, at their real offsets. Nothing is sent. A Yes
// bet is a rehearsal the contract's own math computes, labelled as one.
import type { Api } from "../core/api";
import type { Config } from "../core/config";
import { Lane, MemoryKeyStore, type LaneFailure, type LaneResult, type LaneSession, type LaneState, type Trade } from "../core/lane";
import { contractBuy, marketFromClaim, priceYes } from "../core/lmsr";
import type { TxOutcome } from "../core/rpc";
import type { Store } from "../core/store";
import { preBetClaim, REPLAY, REPLAY_ANSWER, REPLAY_REWRITE } from "./record";

const TRADER = "replay:you";
const EXECUTE_MS = 900;
const FINAL_MS = 1300;
const NO_OUTCOME: TxOutcome = { status: { SuccessValue: "" } };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notInReplay: LaneFailure = { reason: "no_such_claim", message: "The replay covers the T-Bills fact only.", retryable: false, readOnly: true };

/** The market as it stands in this replay, and whether the rewrite has been published yet. */
class ReplayState {
  claim = preBetClaim();
  rewriteOut = false;
}

function replayFetch(state: ReplayState): typeof fetch {
  return async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://recorded");
    const p = url.pathname;
    await pause(20);
    if (p === "/health") return json({ ok: true, network: "mainnet", marketId: REPLAY.market, failures: [], checks: {} });
    if (p === "/claims") return json({ claims: [state.claim] });
    if (p === `/claims/${REPLAY.claimId}`) return json({ claim: state.claim });
    if (p === "/events/recent") return json({ events: [], lastBlockHeight: null, lastSeq: 0 });
    if (p === "/rationales") return json({ rationales: [], agents: null });
    if (p === "/rewrites") {
      const r = REPLAY_REWRITE;
      if (url.searchParams.get("history")) return json({ writer: null, rewrites: [{ paragraph: r.paragraph, latest: r, versions: [r] }] });
      return json({ writer: null, rewrites: state.rewriteOut ? [r] : [] });
    }
    return json({ error: { code: "not_found", message: "Not in the replay." } }, 404);
  };
}

class ReplayLane extends Lane {
  store: Store | null = null;
  private readonly ready: LaneSession = { laneAccountId: "replay", contractId: REPLAY.market, publicKey: "replay", nonce: "0", blockHash: "", rpc: "", rpcs: [], methods: ["buy"], allowanceYocto: null, maxGasTgas: 0, reused: true, trader: TRADER, rpcUrls: [] };

  constructor(api: Api, config: Config, private state: ReplayState) {
    super({ api, config, keys: new MemoryKeyStore() });
    this.st = { state: "ready", session: this.ready };
  }

  override get trader() { return TRADER; }
  override publicKey() { return "replay"; }
  override prepare(): Promise<LaneState> { return Promise.resolve(this.st); }
  override whenReady() { return Promise.resolve({ ok: true as const, session: this.ready }); }

  override async buy(claimId: number, side: "yes" | "no", amountMicro: bigint) {
    if (claimId !== REPLAY.claimId) return { ok: false as const, failure: notInReplay };
    const { claim } = this.state;
    const real = side === REPLAY.betSide;
    const rehearsed = real ? null : contractBuy(marketFromClaim(claim)!, side, amountMicro, 0n);
    const after = rehearsed ? Number(priceYes(rehearsed.after) / 1_000_000n) : REPLAY.priceAfterPpm;
    const trade: Trade = {
      claim_id: claimId, trader: TRADER, side, shares_micro: String(rehearsed ? rehearsed.sharesMicro : REPLAY.sharesMicro), amount_micro: String(amountMicro),
      price_yes_ppm_before: claim.price_yes_ppm, price_yes_ppm_after: after, balance_micro: "0",
    };
    this.state.claim = { ...claim, price_yes_ppm: after, price_yes: after / 1e6, trades: claim.trades + 1 };
    await pause(EXECUTE_MS);
    const sent: LaneResult<Trade> = { ok: true, txHash: real ? REPLAY.betTx : "", outcome: NO_OUTCOME, value: trade, ms: EXECUTE_MS };
    if (real) this.playAftermath();
    return { ...sent, final: pause(FINAL_MS).then(() => sent) };
  }

  override final<T>(txHash: string): Promise<LaneResult<T>> {
    return Promise.resolve({ ok: true, txHash, outcome: NO_OUTCOME, value: null, ms: 0 });
  }

  /** The rewrite and the answer arrive at their real offsets after the bet. */
  private playAftermath() {
    setTimeout(() => {
      this.state.rewriteOut = true;
      this.store?.ingest({ seq: 1e9, uid: `replay-rewrite-${Date.now()}`, event: "rewrite", source: "ai", data: { ...REPLAY_REWRITE, createdAt: Date.now() } });
    }, REPLAY.rewriteAfterMs);
    setTimeout(() => {
      this.store?.ingest({ seq: 1e9 + 1, uid: `replay-answer-${Date.now()}`, event: "agent_rationale", source: "ai", data: { ...REPLAY_ANSWER, at: Date.now() } });
    }, REPLAY.answerAfterMs);
  }
}

export function makeReplay(makeApi: (fetchFn: typeof fetch) => Api, config: Config) {
  const state = new ReplayState();
  const api = makeApi(replayFetch(state));
  const lane = new ReplayLane(api, config, state);
  return { api, lane, attach: (store: Store) => { lane.store = store; } };
}
