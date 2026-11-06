// The record behind the replay (?recorded=1): the complete real mainnet run on the Tether T-Bills fact,
// from data/rehearsal-mainnet.json (a copy of deployments/rehearsal/mainnet.json), every transaction
// read back from the chain. Safe on the server and in the browser; lib/replay/engine.ts plays it.
import rehearsal from "@/data/rehearsal-mainnet.json";
import type { Rationale, Rewrite } from "../core/api";
import { cost, costOpen, MICRO, marketFromClaim, priceYes } from "../core/lmsr";
import type { ClaimView } from "../model";

interface BetStep { kind: "bet"; at: number; claim_id: number; side: "yes" | "no"; shares: number; price_after: number; chain: { tx: string; block_height: number } }
interface RewriteStep { kind: "rewrite"; signed_after_ms: number; record: Rewrite }
interface AnswerStep { kind: "answer"; record: Rationale }
type Step = BetStep | RewriteStep | AnswerStep | { kind: "ruling" };

interface Rehearsal {
  market: string;
  recorded_at: string;
  claim: { id: number; text: string; page: string; kind: string };
  timings_ms: { bet_to_answer: number };
  steps: Step[];
}

const RECORD = rehearsal as unknown as Rehearsal;
const step = <K extends Step["kind"]>(kind: K) => RECORD.steps.find((s): s is Extract<Step, { kind: K }> => s.kind === kind)!;
const BET = step("bet");
const REWRITE = step("rewrite");

export const REPLAY = {
  claimId: BET.claim_id,
  betTx: BET.chain.tx,
  betBlock: BET.chain.block_height,
  betAt: BET.at,
  betSide: BET.side,
  sharesMicro: Math.round(BET.shares * 1e6),
  priceAfterPpm: Math.round(BET.price_after * 1e6),
  rewriteAfterMs: REWRITE.signed_after_ms,
  answerAfterMs: RECORD.timings_ms.bet_to_answer,
  recordedAt: RECORD.recorded_at,
  market: RECORD.market,
};
export const REPLAY_REWRITE = REWRITE.record;
export const REPLAY_ANSWER = step("answer").record;

// Claim 18 as the chain held it just before the free $1: the final view's quantities less the two buys
// that came after it in the log (this bet, 1.203049 No, and the Archivist's 0.248424 No). The taker fee
// came later, with v3, so the fill then was fee-free.
const FINAL_Q_YES = 1_740_974;
const FINAL_Q_NO = 4_930_100;
const LATER_NO = 1_203_049 + 248_424;
const BETS_BEFORE = 5;

export function preBetClaim(): ClaimView {
  const market = { b_micro: "1450000", d0: "0", q_yes_micro: String(FINAL_Q_YES), q_no_micro: String(FINAL_Q_NO - LATER_NO), fee_bps: 0 };
  const m = marketFromClaim(market)!;
  const ppm = Number(priceYes(m) / 1_000_000n);
  // only buys had reached this market and the fill was fee-free, so what was bet is what the market cost
  const volumeMicro = (cost(m) - costOpen(m)) / MICRO;
  return {
    ...market, id: RECORD.claim.id, text: RECORD.claim.text, page: RECORD.claim.page, kind: RECORD.claim.kind, price_yes_ppm: ppm, cost_up_10_micro: "0", cost_down_10_micro: "0",
    status: "Open", outcome: null, provisional: null, trades: BETS_BEFORE, volume_micro: String(volumeMicro), challenge_id: null, prev: null, next: null,
    price_yes: ppm / 1e6, cost_to_move: { up_10_points_usd: 0, down_10_points_usd: 0 }, volume_usd: Number(volumeMicro) / 1e6,
  };
}
