"use client";
// The receipt after a bet: the screenshot moment. "Settled on NEAR in X s" is measured in this browser,
// from the tap to the chain's final, and the needle swings from the old odds to the new. A native modal
// dialog: focus stays inside, Escape closes it, and it sits above everything.
import { useEffect, useRef, useState } from "react";
import { Dial } from "../Dial";
import { Arrow, Icon } from "../Icon";
import { ReplyPanel, RewritePanel } from "./ReceiptPanels";
import type { DoubtState, Store } from "@/lib/core/store";
import { explorerTx, money, shortHash } from "@/lib/format";

function SwingDial({ from, to }: { from: number; to: number }) {
  const [p, setP] = useState(from);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setP(to)));
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <Dial p={p} read={false} sizes="180px" go={p === to} />;
}

/** Count from one whole percent to another, so the number moves with the needle. */
function Count({ from, to }: { from: number; to: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setV(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);
  return <>{v}</>;
}

function Status({ bet, recorded, replayBlock }: { bet: DoubtState; recorded: boolean; replayBlock: number | null }) {
  const c = bet.ctx!;
  if (recorded) return <span className="ok"><Icon name="check" />{c.txHash ? `Replay · final on NEAR in block ${replayBlock?.toLocaleString("en-US")}` : "Rehearsal · nothing was sent"}</span>;
  const at = c.t.final ?? c.t.optimistic ?? c.startedAt;
  const secs = ((at - c.startedAt) / 1000).toFixed(1);
  if (c.t.final) return <span className="ok" data-testid="settled"><Icon name="check" />Settled on NEAR in {secs} s</span>;
  return <span className="ok wait"><span className="spin" />Executed in {secs} s · {c.finalNote ?? "waiting for NEAR to make it final"}</span>;
}

function ShareActions({ claimId, text }: { claimId: number; text: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${location.origin}/c/${claimId}`;
  const share = () => window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url())}`, "_blank", "noopener,noreferrer");
  const copy = async () => {
    try { await navigator.clipboard.writeText(url()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt("Copy this link", url()); }
  };
  return (
    <div className="acts">
      <button type="button" className="btn primary" onClick={share}><Icon name="share" />Share on X</button>
      <button type="button" className="btn soft" onClick={copy}><Icon name={copied ? "check" : "link"} />{copied ? "Copied" : "Copy link"}</button>
      <a className="btn soft" href={`/c/${claimId}/opengraph-image`} target="_blank" rel="noopener"><Icon name="down" />Image</a>
    </div>
  );
}

export function Receipt({ bet, store, question, sentence, recorded, replayBlock, onClose }: {
  bet: DoubtState; store: Store; question: string; sentence: string; recorded: boolean; replayBlock: number | null; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  const c = bet.ctx!;
  const before = c.trade ? c.trade.price_yes_ppm_before / 1e6 : c.priceBefore ?? 0.5;
  const after = c.trade ? c.trade.price_yes_ppm_after / 1e6 : c.quote?.priceAfter ?? before;
  const shares = c.trade ? Number(c.trade.shares_micro) / 1e6 : c.quote?.shares ?? 0;
  const word = c.side === "yes" ? "true" : "false";
  const [from, to] = [Math.round(before * 100), Math.round(after * 100)];
  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="rc-h" onClose={onClose} onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
      <button type="button" className="iconbtn sheet-close" aria-label="Close the receipt" onClick={() => dialog.current?.close()}><Icon name="x" /></button>
      <div className="rc">
        <section className="panel slip" aria-label="Your receipt">
          <Status bet={bet} recorded={recorded} replayBlock={replayBlock} />
          <h2 id="rc-h">You bet $1 that it’s {word}</h2>
          <p className="lq">{question}</p>
          <div className="move">
            <SwingDial from={before} to={after} />
            <div>
              <div className="big-move num" aria-label={`${from}% to ${to}% chance it’s true`}>
                <span className="from">{from}%</span><Arrow /><span><Count from={from} to={to} /><i>%</i></span>
              </div>
              <span className="lab"><b>chance it’s true</b><span>Your $1 moved it.</span></span>
            </div>
          </div>
          <div className="lines">
            <div className="kv"><span>If it’s {word}, you get back</span><b>{money(shares)}</b></div>
            <div className="kv"><span>You got</span><b>{shares.toFixed(2)} shares, $1 each if you’re right</b></div>
            {c.txHash && <div className="kv"><span>Transaction</span><a className="hashv" href={explorerTx(c.txHash)} target="_blank" rel="noopener">{shortHash(c.txHash)}</a></div>}
          </div>
          <ShareActions claimId={c.claimId ?? 0} text={`I bet $1 that this is ${word}: “${question}” It’s ${to}% chance it’s true now. Is it true? Bet on it.`} />
          <p className="fine">{recorded ? "A replay of the real run on 5 Nov 2026: the transaction, the rewrite and the reply are the recorded ones." : "Recorded on NEAR. Your free $1’s winnings count as score."}</p>
        </section>
        <div className="side">
          <RewritePanel bet={bet} store={store} sentence={sentence} />
          <ReplyPanel bet={bet} />
        </div>
      </div>
    </dialog>
  );
}
