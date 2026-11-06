"use client";
// The ticket: Yes or No, "Bet $1 free", the exact payout, confirm. Before any tap it says when the free
// bet is unavailable and why, with the replay as the way on. useBetFlow holds the logic.
import Link from "next/link";
import { useRef } from "react";
import { Icon } from "../Icon";
import { FreeCashNote } from "../Live";
import { WalletEntry } from "../money/WalletEntry";
import { BetProgress } from "./BetProgress";
import { Receipt } from "./Receipt";
import { SettledTicket, type SettledInfo } from "./SettledTicket";
import { useBetFlow, type Side } from "./useBetFlow";
import type { MyBet } from "@/lib/client/mybets";
import type { LaneState } from "@/lib/core/lane";
import { explorerTx, money, shortHash } from "@/lib/format";
import type { ClaimView } from "@/lib/model";
import { REPLAY_HREF } from "@/lib/nav";
import { payoutWords, type Quotes } from "@/lib/quote";
import type { Site } from "@/lib/server/site";

export interface TicketProps {
  id: number;
  question: string;
  sentence: string;
  claim: ClaimView;
  lane: Site["lane"];
  initialSide: Side | null;
  recorded: boolean;
  replayBlock: number | null;
  settled: SettledInfo | null;
}

/** What stands in the way of the free bet, in plain words, before the tap. */
function freeBetBlock(serverLane: Site["lane"], lane: LaneState, mine: MyBet | null, id: number): { text: string; replay: boolean } | null {
  if (serverLane && !serverLane.open) return { text: serverLane.paused ? "The market is paused, so nothing can be bet right now." : "Free bets are switched off right now.", replay: true };
  if (serverLane?.creditsLeft === 0) return { text: "Today’s free bets are all taken. Every price still updates live; come back tomorrow.", replay: true };
  if (lane.state === "failed" && lane.failure.readOnly) return { text: lane.failure.message, replay: true };
  if (mine) return { text: mine.claimId === id ? "You’ve placed your free $1 on this fact." : "You’ve already placed your free $1.", replay: false };
  return null;
}

function HowItWorks({ quotes }: { quotes: Quotes }) {
  return (
    <ol className="howto hide-dock" aria-label="How your free $1 works">
      <li><span className="n">1</span><span><b>Pick Yes or No.</b> Your free $1 is made in this browser: no wallet, no sign-up.</span></li>
      <li><span className="n">2</span><span><b>3 AI judges decide</b> when the fact is challenged, signing their verdicts on-chain.</span></li>
      <li><span className="n">3</span><span><b>Right answers get paid:</b> you get {payoutWords(quotes.yes).get} on Yes, or {payoutWords(quotes.no).get} on No.</span></li>
    </ol>
  );
}

function Picked({ side, quotes }: { side: Side; quotes: Quotes }) {
  const q = quotes[side];
  return (
    <div className="hide-dock">
      <div className="towin"><span className="k">If you’re right, you get</span><span className="v num">{payoutWords(q).get}</span></div>
      <p className="decide"><b>If you’re wrong, you lose the $1.</b> Your $1 moves it to <b>{Math.round(q.priceAfter * 100)}% chance it’s true</b>.{q.fee > 0 ? ` That includes the ${money(q.fee)} fee.` : ""}</p>
    </div>
  );
}

function BetTicket(p: TicketProps) {
  const flow = useBetFlow({ claim: p.claim, question: p.question, initialSide: p.initialSide, recorded: p.recorded });
  const { bet, busy, done, side, quotes, mine } = flow;
  const blocked = p.recorded || (bet.ctx && done) ? null : freeBetBlock(p.lane, flow.lane, mine, p.id);
  const failure = bet.stage === "failed" ? bet.failure : null;
  const ref = useRef<HTMLElement>(null);
  return (
    <aside className="panel ticket dock" aria-label="Bet ticket" ref={ref}>
      <h2>{p.recorded ? "Replay the free $1" : "Bet your free $1"}<span className="chip brand hide-dock"><Icon name="gift" />No wallet</span></h2>
      {blocked && (
        <div className="notice" role="status">
          <Icon name="info" />
          <p><b>Free bet unavailable.</b> {blocked.text} {blocked.replay ? <Link href={REPLAY_HREF}>Watch a replay</Link> : mine?.tx ? <a href={explorerTx(mine.tx)} target="_blank" rel="noopener">See your bet ({shortHash(mine.tx, 5, 4)})</a> : null}</p>
        </div>
      )}
      {quotes ? (
        <div className="seg" role="group" aria-label="Pick a side">
          <button type="button" className="y" aria-pressed={side === "yes"} disabled={busy || !!blocked} onClick={() => flow.pick("yes")}>Yes, it’s true<small>{payoutWords(quotes.yes).right}</small></button>
          <button type="button" className="n" aria-pressed={side === "no"} disabled={busy || !!blocked} onClick={() => flow.pick("no")}>No, it’s false<small>{payoutWords(quotes.no).right}</small></button>
        </div>
      ) : <p className="decide">This market can’t be quoted right now: one side is at its price cap.</p>}
      {quotes && !blocked && (side ? <Picked side={side} quotes={quotes} /> : <HowItWorks quotes={quotes} />)}
      {failure && (
        <div className="notice err" role="alert">
          <Icon name="alert" />
          <p><b>Your bet didn’t go through.</b> {failure.message} {failure.readOnly ? <Link href={REPLAY_HREF}>Watch a replay</Link> : null}</p>
        </div>
      )}
      {busy && <BetProgress bet={bet} recorded={p.recorded} />}
      {side && !blocked && !done && (
        <button type="button" className={`btn lg ${side === "yes" ? "yesfill" : "nofill"}`} disabled={busy || !quotes} onClick={flow.confirm} data-testid="confirm">
          {busy ? <><span className="spin" />Sending your $1…</> : failure?.retryable ? "Try again" : `Bet $1 free: ${side === "yes" ? "Yes, it’s true" : "No, it’s false"}`}
        </button>
      )}
      {done && !flow.receiptOpen && <button type="button" className="btn soft" onClick={flow.openReceipt}>See your receipt</button>}
      {!p.recorded && flow.lane.state === "preparing" && !busy && <p className="fine hide-dock">Preparing your free $1 in this browser…</p>}
      {p.recorded ? <p className="fine hide-dock">This is a replay of the real free $1 bet on this fact. Nothing is sent.</p> : <p className="fine">{quotes ? `${payoutWords(quotes.yes).wrong} · ` : ""}<FreeCashNote /></p>}
      {!p.recorded && <WalletEntry claimId={p.id} question={p.question} status={p.claim.status} outcome={p.claim.outcome} side={side} />}
      {flow.receiptOpen && flow.store && bet.ctx && (
        <Receipt bet={bet} store={flow.store} question={p.question} sentence={p.sentence} recorded={p.recorded} replayBlock={p.replayBlock} onClose={() => { flow.closeReceipt(); ref.current?.querySelector("button")?.focus(); }} />
      )}
    </aside>
  );
}

export function Ticket(p: TicketProps) {
  return p.settled ? <SettledTicket s={p.settled} wallet={<WalletEntry claimId={p.id} question={p.question} status={p.claim.status} outcome={p.claim.outcome} side={null} />} /> : <BetTicket {...p} />;
}
