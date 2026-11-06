"use client";
// The ticket: Yes or No, "Bet $1 free", the exact payout, confirm. It runs the proven engine's doubt
// flow (lib/core/store): the free $1 key made in this browser, signed here, sent to NEAR, then the
// receipt. Before any tap it says when the free bet is unavailable and why, with the replay as the
// way on. Prices refresh live; the quote is the contract's own fill on the current claim view.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Receipt } from "./Receipt";
import type { Claim } from "@/lib/core/api";
import { doubtBusy } from "@/lib/core/store";
import { hadIntent, liveEngine, recordedEngine, warmLane, type Engine } from "@/lib/engine";
import { explorerTx, money, shortHash } from "@/lib/format";
import { myBets, saveBet, type MyBet } from "@/lib/mybets";
import { backUsd, quoteClaim } from "@/lib/quote";
import { useLane, useStore } from "@/lib/useStore";
import { IDLE } from "@/lib/core/store";

type Side = "yes" | "no";

export interface TicketProps {
  id: number;
  question: string;
  sentence: string;
  claim: Claim & Record<string, any>;
  open: boolean;
  lane: { open: boolean; creditsLeft: number | null; paused: boolean } | null;
  initialSide: Side | null;
  recorded: boolean;
  replayBlock?: number | null;
  settled?: { verdict: string; payoutUsd: number | null; correctedId: number | null; correctedQuestion: string | null } | null;
}

const STEPS = [
  { id: "lane", label: "Preparing your free $1 in this browser" },
  { id: "signing", label: "Signing it here, no wallet needed" },
  { id: "optimistic", label: "NEAR executed it" },
  { id: "final", label: "Final on NEAR" },
];

export function Ticket(p: TicketProps) {
  const [eng, setEng] = useState<Engine | null>(null);
  const [side, setSide] = useState<Side | null>(p.initialSide);
  const [view, setView] = useState(p.claim);
  const [mine, setMine] = useState<MyBet | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const store = eng?.store ?? null;
  const doubt = useStore(store, (s) => s.doubt, IDLE);
  const loading = useStore(store, (s) => s.page.loading, true);
  const sentence = useStore(store, (s) => s.page.sentences.find((x) => x.claimId === p.id) ?? null, null);
  const lane = useLane(p.recorded ? null : eng?.lane ?? null);
  const ref = useRef<HTMLElement>(null);

  // the engine: live, or the replay of the real run
  useEffect(() => {
    let off = false;
    const start = (e: Engine) => { if (off) return; void e.store.open({ name: "claim", id: p.id }); setEng(e); };
    if (p.recorded) void recordedEngine().then(start);
    else {
      const e = liveEngine();
      start(e);
      if (hadIntent() && p.open) warmLane(); // a person tapped Yes or No on a card to get here
    }
    if (!p.recorded) setMine(myBets().find((b) => !b.recorded) ?? null);
    return () => { off = true; };
  }, [p.id, p.recorded, p.open]);

  // a price that moved on the chain: read the exact claim view again, so the quote stays exact
  const chainPpm = sentence?.chainPpm ?? null;
  useEffect(() => {
    if (p.recorded || chainPpm === null || chainPpm === view.price_yes_ppm || doubtBusy(doubt)) return;
    let off = false;
    fetch(`/api/claims/${p.id}`, { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off && j?.claim) setView(j.claim); }).catch(() => {});
    return () => { off = true; };
  }, [chainPpm, view.price_yes_ppm, p.id, p.recorded, doubt]);

  const quotes = useMemo(() => quoteClaim(view as any), [view]);
  const mineHere = doubt.ctx?.claimId === p.id ? doubt : null;
  const stage = mineHere?.stage ?? "idle";
  const done = stage === "optimistic" || stage === "final" || stage === "rewritten" || stage === "answered";

  // the receipt opens the moment NEAR executes the bet; the bet is kept in this browser
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (!mineHere || !done) return;
    const c = mineHere.ctx!;
    const k = `${c.txHash}:${c.startedAt}`;
    if (saved.current === k) return;
    saved.current = k;
    setShowReceipt(true);
    const b: MyBet = {
      claimId: p.id, question: p.question, side: c.side, tx: c.txHash, at: c.startedAt,
      before: c.trade ? c.trade.price_yes_ppm_before / 1e6 : c.priceBefore, after: c.trade ? c.trade.price_yes_ppm_after / 1e6 : null,
      shares: c.trade ? Number(c.trade.shares_micro) / 1e6 : null, finalMs: null, recorded: p.recorded,
    };
    saveBet(b);
    if (!p.recorded) setMine(b);
  }, [mineHere, done, p.id, p.question, p.recorded]);

  const pick = (s: Side) => {
    setSide(s);
    if (!p.recorded) warmLane();
  };
  const confirm = useCallback(async () => {
    if (!eng || !side) return;
    if (doubt.stage === "failed") eng.store.resetDoubt();
    const key = eng.store.state.page.sentences.find((x) => x.claimId === p.id)?.key ?? `c${p.id}`;
    await eng.store.doubt(key, side);
  }, [eng, side, doubt.stage, p.id]);
  const closeReceipt = useCallback(() => {
    setShowReceipt(false);
    if (eng && !doubtBusy(eng.store.state.doubt)) eng.store.resetDoubt();
    setTimeout(() => ref.current?.querySelector<HTMLElement>("button, a")?.focus(), 50);
  }, [eng]);

  // ---- what stands in the way of the free bet, said before the tap ----
  let blocked: { text: string; replay: boolean } | null = null;
  if (!p.recorded) {
    if (p.lane && !p.lane.open) blocked = { text: p.lane.paused ? "The market is paused, so nothing can be bet right now." : "Free bets are switched off right now.", replay: true };
    else if (p.lane && p.lane.creditsLeft === 0) blocked = { text: "Today’s free bets are all taken. Every price still updates live; come back tomorrow.", replay: true };
    else if (lane.state === "failed" && lane.failure.readOnly) blocked = { text: lane.failure.message, replay: true };
    else if (mine && !(mineHere && done)) blocked = { text: mine.claimId === p.id ? "You’ve placed your free $1 on this fact." : "You’ve already placed your free $1.", replay: false };
  }
  const failure = mineHere && stage === "failed" ? mineHere.failure : null;
  const busy = mineHere ? doubtBusy(mineHere) : false;
  const curStep = !mineHere ? -1 : stage === "quoting" ? (mineHere.ctx?.waitingFor === "lane" ? 0 : 1) : stage === "signing" ? 1 : stage === "optimistic" ? 2 : done ? 4 : -1;

  if (!p.open) {
    const s = p.settled;
    return (
      <aside className={`panel ticket ${s?.correctedId != null ? "dock" : ""}`} aria-label="Result" ref={ref}>
        {s ? (
          <div className="settledbox">
            <span className={`verdict ${s.verdict.toLowerCase()} hide-dock`} style={{ alignSelf: "flex-start" }}>DECIDED: {s.verdict}</span>
            <p className="big hide-dock">{s.verdict === "FALSE" ? "No won." : "Yes won."}</p>
            <p className="decide hide-dock">Three AI judges ruled it {s.verdict.toLowerCase()}{s.payoutUsd ? `, and ${money(s.payoutUsd)} went to everyone who bet ${s.verdict === "FALSE" ? "No" : "Yes"}` : ""}. It can’t be bet on any more.</p>
            {s.correctedId !== null && (
              <>
                <p className="decide hide-dock"><b>Corrected and reopened:</b> {s.correctedQuestion}</p>
                <Link className="btn primary lg" href={`/c/${s.correctedId}`}>Bet on the corrected fact<Icon name="arrow" /></Link>
              </>
            )}
            <Link className="btn soft hide-dock" href="/c/18?recorded=1">Watch a replay of the run</Link>
          </div>
        ) : (
          <div className="settledbox"><p className="big">Being decided</p><p className="decide">The AI judges are ruling on this fact, so betting is closed until they finish.</p><a className="btn soft" href="#ruling">See the ruling</a></div>
        )}
      </aside>
    );
  }

  return (
    <aside className="panel ticket dock" aria-label="Bet ticket" ref={ref}>
      <h2>{p.recorded ? "Replay the free $1" : "Bet your free $1"}<span className="chip brand hide-dock"><Icon name="gift" />No wallet</span></h2>
      {blocked && (
        <div className="notice" role="status">
          <Icon name="info" />
          <p><b>Free bet unavailable.</b> {blocked.text} {blocked.replay ? <Link href="/c/18?recorded=1">Watch a replay</Link> : mine?.tx ? <a href={explorerTx(mine.tx)} target="_blank" rel="noopener">See your bet ({shortHash(mine.tx, 5, 4)})</a> : null}</p>
        </div>
      )}
      {quotes ? (
        <div className="seg" role="group" aria-label="Pick a side">
          <button type="button" className="y" aria-pressed={side === "yes"} disabled={busy || !!blocked} onClick={() => pick("yes")}>
            Yes, it’s true<small>Bet $1 → get {backUsd(quotes.yes)} back</small>
          </button>
          <button type="button" className="n" aria-pressed={side === "no"} disabled={busy || !!blocked} onClick={() => pick("no")}>
            No, it’s false<small>Bet $1 → get {backUsd(quotes.no)} back</small>
          </button>
        </div>
      ) : <p className="decide">This market can’t be quoted right now.</p>}
      {side && quotes && !blocked && (
        <>
          <div className="towin hide-dock"><span className="k">If you’re right, you get back</span><span className="v num">{backUsd(quotes[side])}</span></div>
          <p className="decide">
            <span className="hide-dock">Your $1 moves it to <b>{Math.round(quotes[side].priceAfter * 100)}% chance it’s true</b>. Three AI judges decide; if you’re right, you get {backUsd(quotes[side])} back.</span>
            {quotes[side].fee > 0 && <span className="hide-dock"> Includes the {money(quotes[side].fee)} fee.</span>}
          </p>
        </>
      )}
      {!side && !blocked && quotes && (
        <ol className="howto hide-dock" aria-label="How your free $1 works">
          <li><span className="n">1</span><span><b>Pick Yes or No.</b> Your free $1 is made in this browser: no wallet, no sign-up.</span></li>
          <li><span className="n">2</span><span><b>3 AI judges decide</b> when the fact is challenged, signing their verdicts on-chain.</span></li>
          <li><span className="n">3</span><span><b>Right answers get paid:</b> {backUsd(quotes.yes)} back on Yes, or {backUsd(quotes.no)} on No.</span></li>
        </ol>
      )}
      {failure ? (
        <div className="notice err" role="alert">
          <Icon name="alert" />
          <p><b>Your bet didn’t go through.</b> {failure.message} {failure.readOnly ? <Link href="/c/18?recorded=1">Watch a replay</Link> : null}</p>
        </div>
      ) : null}
      {curStep >= 0 && !done && (
        <ol className="progress" aria-live="polite">
          {STEPS.map((s, i) => (i === 0 && mineHere?.ctx?.waitingFor !== "lane" && curStep > 0 ? null : (
            <li key={s.id} className={`pstep ${i < curStep ? "done" : i === curStep ? "on" : ""}`}><span className="b">{i < curStep ? <Icon name="check" /> : null}</span>{p.recorded && i > 0 ? s.label.replace("NEAR executed it", "Replaying the real transaction") : s.label}</li>
          )))}
        </ol>
      )}
      {side && !blocked && (
        <button type="button" className={`btn lg ${side === "yes" ? "yesfill" : "nofill"}`} disabled={busy || loading || !quotes} onClick={confirm} data-testid="confirm">
          {busy ? <><span className="spin" />Sending your $1…</> : failure?.retryable ? "Try again" : `Bet $1 free: ${side === "yes" ? "Yes, it’s true" : "No, it’s false"}`}
        </button>
      )}
      {mineHere && done && !showReceipt && <button type="button" className="btn soft" onClick={() => setShowReceipt(true)}>See your receipt</button>}
      {!p.recorded && lane.state === "preparing" && !mineHere && <p className="fine hide-dock">Preparing your free $1 in this browser…</p>}
      <p className="fine hide-dock">{p.recorded ? "This is a replay of the real free $1 bet on this fact. Nothing is sent." : "Your free $1’s winnings count as score, not cash. Betting real USDC needs a NEAR wallet."}</p>
      {showReceipt && mineHere && mineHere.ctx && store && (
        <Receipt doubt={mineHere} store={store} question={p.question} sentence={p.sentence} recorded={p.recorded} onClose={closeReceipt} replayBlock={p.replayBlock} />
      )}
    </aside>
  );
}
