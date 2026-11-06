"use client";
// The receipt after a bet: the screenshot moment. "Settled on NEAR in X s" is measured in this browser,
// from the tap to the chain's final; the needle swings from the old odds to the new; the rewrite of the
// sentence arrives signed and is verified here, in the browser, against the model's key on the market;
// an AI trader replies; and it shares to X with the market's card.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Icon, Arrow } from "./Icon";
import { useToast } from "./Toasts";
import type { DoubtState, Store } from "@/lib/core/store";
import type { VerifyResult } from "@/lib/core/verify";
import { explorerTx, modelShort, money, shortHash } from "@/lib/format";
import { useStore } from "@/lib/useStore";
import { SITE_URL } from "@/lib/nav";

function SwingDial({ from, to }: { from: number; to: number }) {
  const [p, setP] = useState(from);
  const [go, setGo] = useState(false);
  useEffect(() => {
    const a = requestAnimationFrame(() => requestAnimationFrame(() => { setP(to); setGo(true); }));
    return () => cancelAnimationFrame(a);
  }, [to]);
  return (
    <div className={`dial ${go ? "go" : ""}`} style={{ "--p": p } as CSSProperties} role="img" aria-label={`The needle moved from ${Math.round(from * 100)}% to ${Math.round(to * 100)}%`}>
      <Image src="/art/dial.webp" alt="" width={900} height={900} sizes="180px" />
      <span className="scale a" aria-hidden="true">0</span><span className="scale b" aria-hidden="true">100</span>
      <div className="needle" aria-hidden="true"><svg viewBox="0 0 20 100" preserveAspectRatio="none"><path d="M10 0C10.9 0 11.5.6 11.7 1.5L16 100H4L8.3 1.5C8.5.6 9.1 0 10 0Z" fill="oklch(.86 .15 205)" /></svg></div>
      <div className="ring" aria-hidden="true" /><div className="hub" aria-hidden="true" />
    </div>
  );
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

export function Receipt({ doubt, store, question, sentence, recorded, onClose, replayBlock }: {
  doubt: DoubtState; store: Store; question: string; sentence: string; recorded: boolean; onClose: () => void; replayBlock?: number | null;
}) {
  const toast = useToast();
  const c = doubt.ctx!;
  const verify = useStore(store, (s) => s.page.verify, null as any) as { rewriteId: string | null; result: VerifyResult | null; running: boolean; error: string | null } | null;
  const asked = useRef<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [waited, setWaited] = useState(0);

  const before = c.trade ? c.trade.price_yes_ppm_before / 1e6 : c.priceBefore ?? 0.5;
  const after = c.trade ? c.trade.price_yes_ppm_after / 1e6 : c.quote?.priceAfter ?? before;
  const shares = c.trade ? Number(c.trade.shares_micro) / 1e6 : c.quote?.shares ?? 0;
  const sideWord = c.side === "yes" ? "true" : "false";
  const final = doubt.stage === "final" || doubt.stage === "rewritten" || doubt.stage === "answered";
  const ms = (final ? c.t.final : c.t.optimistic) ?? null;
  const secs = ms ? ((ms - c.startedAt) / 1000).toFixed(1) : null;
  const rewritten = c.rewrite?.sentences?.find((s) => s.claim_id === c.claimId) ?? null;
  const rewriteSigned = c.rewrite?.status === "signed";

  // verify the signed rewrite in this browser as soon as it arrives
  useEffect(() => {
    if (!c.rewrite || !rewriteSigned || asked.current === c.rewrite.id) return;
    asked.current = c.rewrite.id;
    void store.verify(c.rewrite.page, c.rewrite.id);
  }, [c.rewrite, rewriteSigned, store]);
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    const t = setInterval(() => setWaited((w) => w + 1), 1000);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    return () => { clearInterval(t); removeEventListener("keydown", esc); };
  }, [onClose]);

  const v = verify && c.rewrite && verify.rewriteId === c.rewrite.id ? verify : null;
  const url = `${SITE_URL}/c/${c.claimId}`;
  const post = `I bet $1 that this is ${sideWord}: “${question}” It’s ${Math.round(after * 100)}% chance it’s true now. Is it true? Bet on it.`;
  const share = () => window.open(`https://x.com/intent/post?text=${encodeURIComponent(post)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast("Link copied.", "ok"); } catch { toast("Couldn’t copy. The link is " + url, "err"); }
  };

  // a portal: the ticket is sticky (its own stacking context), and the sheet must cover the whole page
  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="rc-h" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-in">
        <button ref={close} type="button" className="iconbtn sheet-close" aria-label="Close the receipt" onClick={onClose}><Icon name="x" /></button>
        <div className="rc">
          <section className="panel slip" aria-label="Your receipt">
            {recorded ? (
              <span className="ok"><Icon name="check" />{c.txHash ? `Replay · final on NEAR in block ${replayBlock?.toLocaleString("en-US") ?? "—"}` : "Rehearsal · nothing was sent"}</span>
            ) : final ? (
              <span className="ok" data-testid="settled"><Icon name="check" />Settled on NEAR in {secs} s</span>
            ) : (
              <span className="ok wait"><span className="spin" />Executed in {secs} s · waiting for NEAR to make it final</span>
            )}
            <h2 id="rc-h">You bet $1 that it’s {sideWord}</h2>
            <p className="lq">{question}</p>
            <div className="move">
              <SwingDial from={before} to={after} />
              <div>
                <div className="big-move num" aria-label={`${Math.round(before * 100)}% to ${Math.round(after * 100)}% chance it’s true`}>
                  <span className="from">{Math.round(before * 100)}%</span><Arrow /><span><Count from={Math.round(before * 100)} to={Math.round(after * 100)} /><i>%</i></span>
                </div>
                <span className="lab"><b>chance it’s true</b><span>Your $1 moved it.</span></span>
              </div>
            </div>
            <div className="lines">
              <div className="kv"><span>If it’s {sideWord}, you get back</span><b>{money(shares)}</b></div>
              <div className="kv"><span>You got</span><b>{shares.toFixed(2)} shares, $1 each if you’re right</b></div>
              {c.txHash && <div className="kv"><span>Transaction</span><a className="hashv" href={explorerTx(c.txHash)} target="_blank" rel="noopener">{shortHash(c.txHash)}</a></div>}
            </div>
            <div className="acts">
              <button type="button" className="btn primary" onClick={share}><Icon name="share" />Share on X</button>
              <button type="button" className="btn soft" onClick={copy}><Icon name="link" />Copy link</button>
              <a className="btn soft" href={`/c/${c.claimId}/opengraph-image`} target="_blank" rel="noopener"><Icon name="down" />Image</a>
            </div>
            <p className="fine">{recorded ? "A replay of the real run on 5 Nov 2026: the transaction, the rewrite and the reply are the recorded ones." : "Recorded on NEAR. Your free $1’s winnings count as score."}</p>
          </section>
          <div className="side">
            <section className="panel" aria-label="The sentence, rewritten">
              <div className="ph">
                <h3>Wikipedia’s sentence, rewritten</h3>
                {v?.result ? (v.result.ok ? <span className="sig" data-testid="sig-ok">Signature ✓</span> : <span className="sig bad"><Icon name="alert" />Not verified</span>)
                  : v?.running ? <span className="sig wait"><span className="spin" />Checking signature</span>
                  : c.rewrite && !rewriteSigned ? <span className="sig wait">Unsigned draft</span> : null}
              </div>
              {rewritten ? (
                <>
                  <div className="ba"><span>Before</span><del>{sentence}</del><span>After</span><ins>{rewritten.text}</ins></div>
                  <div className="chipline"><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="chip" className="!w-4 !h-4" />An AI ({modelShort(c.rewrite?.provenance?.model)}) rewrote it and signed it inside a secure chip, so it can’t be faked.</span></div>
                  {v?.result && (
                    <details style={{ marginTop: 8 }}>
                      <summary className="link" style={{ cursor: "pointer", fontSize: 13, minHeight: 32, display: "inline-flex", alignItems: "center" }}>Checked in your browser: {v.result.steps.filter((s) => s.status === "pass").length} of {v.result.steps.length} checks</summary>
                      <ul className="checks">
                        {v.result.steps.map((s) => <li key={s.id} className={s.status}><Icon name={s.status === "pass" ? "check" : s.status === "fail" ? "x" : "info"} /><span>{s.label}{s.status !== "pass" && s.detail ? ` (${s.detail})` : ""}</span></li>)}
                      </ul>
                    </details>
                  )}
                  {v?.error && <p className="fine" style={{ marginTop: 6 }}>Couldn’t check the signature here: {v.error}</p>}
                </>
              ) : (
                <p className="waiting">{waited < 30 ? <><span className="spin" />An AI is rewriting the sentence to match the new odds…</> : "No rewrite this time: the writer rewrites a sentence when its odds cross into a new band."}</p>
              )}
            </section>
            <section className="panel" aria-label="An AI trader’s reply">
              {c.answer ? (
                <>
                  <div className="ph"><h3>The {(c.answer as any).persona ?? c.answer.agent}, an AI trader, replied</h3><span className={`ag big ${(c.answer as any).persona ?? ""}`}>{String((c.answer as any).persona ?? c.answer.agent)[0]}</span></div>
                  <p className="reason">{c.answer.rationale}</p>
                  <p className="held">{c.answer.side === "no_bet" || c.answer.side === "agree" ? `It puts it at ${Math.round(c.answer.credence * 100)}% and held off: ${(c.answer.text || "").replace(/^no bet:\s*/i, "")}.` : `It puts it at ${Math.round(c.answer.credence * 100)}% and bet ${money(c.answer.size_usd)} that it’s ${c.answer.side === "yes" ? "true" : "false"}.`}</p>
                  {c.answer.source_url && <a className="src" href={c.answer.source_url} target="_blank" rel="noopener nofollow">{c.answer.source_title || "Its source"}<Icon name="ext" /></a>}
                </>
              ) : (
                <><div className="ph"><h3>The AI traders</h3></div><p className="waiting">{waited < 40 ? <><span className="spin" />Three AI traders are reading your bet…</> : "No AI trader has answered yet. Their replies show on the fact’s Discussion tab."}</p></>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
