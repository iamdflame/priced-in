"use client";
// The receipt's right side: the rewritten sentence, verified in this browser against the model's key on
// the market, and an AI trader's reply. Each says honestly when nothing has come.
import { sourceLabel } from "@/lib/tidy";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useStore } from "@/lib/client/useStore";
import type { DoubtState, PageState, Store } from "@/lib/core/store";
import { modelShort, money } from "@/lib/format";

const REWRITE_PATIENCE_S = 30;
const REPLY_PATIENCE_S = 40;

/** True once `seconds` have passed since the panel opened. */
function useGaveUp(seconds: number) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOver(true), seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return over;
}

function SignatureBadge({ v, signed }: { v: PageState["verify"] | null; signed: boolean }) {
  if (v?.result) return v.result.ok ? <span className="sig" data-testid="sig-ok">Signature ✓</span> : <span className="sig bad"><Icon name="alert" />Not verified</span>;
  if (v?.running) return <span className="sig wait"><span className="spin" />Checking signature</span>;
  return signed ? null : <span className="sig wait">Unsigned draft</span>;
}

function Checks({ v }: { v: PageState["verify"] }) {
  if (!v.result) return v.error ? <p className="fine">Couldn’t check the signature here: {v.error}</p> : null;
  const { steps } = v.result;
  return (
    <details className="checkbox">
      <summary className="link">Checked in your browser: {steps.filter((s) => s.status === "pass").length} of {steps.length} checks</summary>
      <ul className="checks">
        {steps.map((s) => <li key={s.id} className={s.status}><Icon name={s.status === "pass" ? "check" : s.status === "fail" ? "x" : "info"} /><span>{s.label}{s.status !== "pass" && s.detail ? ` (${s.detail})` : ""}</span></li>)}
      </ul>
    </details>
  );
}

export function RewritePanel({ bet, store, sentence }: { bet: DoubtState; store: Store; sentence: string }) {
  const c = bet.ctx!;
  const rewrite = c.rewrite;
  const signed = rewrite?.status === "signed";
  const gaveUp = useGaveUp(REWRITE_PATIENCE_S);
  const verify = useStore(store, (s) => s.page.verify, null);
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!rewrite || !signed || asked.current === rewrite.id) return;
    asked.current = rewrite.id;
    void store.verify(rewrite.page, rewrite.id);
  }, [rewrite, signed, store]);
  const v = verify && rewrite && verify.rewriteId === rewrite.id ? verify : null;
  const text = rewrite?.sentences?.find((s) => s.claim_id === c.claimId)?.text ?? null;
  return (
    <section className="panel" aria-label="The sentence, rewritten">
      <div className="ph"><h3>Wikipedia’s sentence, rewritten</h3>{rewrite && <SignatureBadge v={v} signed={signed} />}</div>
      {text ? (
        <>
          <div className="ba"><span>Before</span><del>{sentence}</del><span>After</span><ins>{text}</ins></div>
          <p className="chipline"><Icon name="chip" />An AI ({modelShort(rewrite?.provenance?.model)}) rewrote it and signed it inside a secure chip, so it can’t be faked.</p>
          {v && <Checks v={v} />}
        </>
      ) : (
        <p className="waiting">{gaveUp ? "No rewrite this time: the writer rewrites a sentence when its odds cross into a new band." : <><span className="spin" />An AI is rewriting the sentence to match the new odds…</>}</p>
      )}
    </section>
  );
}

export function ReplyPanel({ bet }: { bet: DoubtState }) {
  const a = bet.ctx!.answer;
  const gaveUp = useGaveUp(REPLY_PATIENCE_S);
  if (!a) {
    return (
      <section className="panel" aria-label="An AI trader’s reply">
        <div className="ph"><h3>The AI traders</h3></div>
        <p className="waiting">{gaveUp ? "No AI trader has answered yet. Their replies show on the fact’s Discussion tab." : <><span className="spin" />The AI traders are reading your bet…</>}</p>
      </section>
    );
  }
  const name = a.persona ?? a.agent;
  const held = a.side === "no_bet" || a.side === "agree";
  return (
    <section className="panel" aria-label="An AI trader’s reply">
      <div className="ph"><h3>The {name}, an AI trader, replied</h3><span className={`ag big ${name}`}>{name[0]}</span></div>
      <p className="reason">{a.rationale}</p>
      <p className="held">It puts it at {Math.round(a.credence * 100)}% and {held ? `held off: ${(a.text || "").replace(/^no bet:\s*/i, "")}.` : `bet ${money(a.size_usd)} that it’s ${a.side === "yes" ? "true" : "false"}.`}</p>
      {a.source_url && <a className="src" href={a.source_url} target="_blank" rel="noopener nofollow"><span>{sourceLabel(a.source_title, a.source_url)}</span><Icon name="ext" /></a>}
    </section>
  );
}
