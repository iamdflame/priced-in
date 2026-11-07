"use client";
// After a pick: it's saved, it wins nothing, and here is what can follow it, in plain words. Back it with
// the free $1 (the fact's page, the side already picked) or with real USDC (the wallet's own sheet).
// Mounted once, only while the API has today's news on; a new page closes it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { markIntent } from "@/lib/client/intent";
import { myBets } from "@/lib/client/mybets";
import { setPicksOn } from "@/lib/client/picks";
import { canAddMoney } from "@/lib/money/geo";
import { openSheet, useGeo, useWallet, type SheetReq } from "@/lib/money/hooks";
import { payoutWords } from "@/lib/quote";
import { closeTray, useTray } from "./tray";

export function PickTray() {
  const t = useTray();
  const w = useWallet();
  const geo = useGeo();
  const path = usePathname();
  const [freeUsed, setFreeUsed] = useState(false);

  useEffect(() => { setPicksOn(true); }, []);
  useEffect(() => { closeTray(); }, [path]);
  useEffect(() => {
    if (!t) return;
    setFreeUsed(myBets().length > 0);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") closeTray(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [t]);

  if (!t) return null;
  const side = t.side === "yes" ? "Yes, it’s true" : "No, it’s false";
  const q = t.quotes?.[t.side] ?? null;
  const pay = q ? payoutWords(q) : null;
  const trade: SheetReq = { kind: "trade", claimId: t.claimId, question: t.question, mode: "buy", side: t.side };
  const usdc = canAddMoney(geo.access);
  return (
    <aside className="ptray" aria-label="Your pick">
      <div className="ptray-hd">
        <p className="ptray-ok" role="status"><span className={`ptray-dot ${t.side}`}><Icon name="check" /></span>{t.fresh ? "Pick saved:" : "Your pick:"} <b className={t.side === "yes" ? "pos" : "neg"}>{side}</b></p>
        <button type="button" className="iconbtn" aria-label="Close" onClick={closeTray}><Icon name="x" /></button>
      </div>
      <p className="ptray-q">{t.question}</p>
      <p className="ptray-rule">Picks are free and win nothing. {t.settlesBy ? <>Come back after {t.settlesBy} to see if you called it.</> : <>Come back when it settles to see if you called it.</>}</p>
      {(pay && !freeUsed) || usdc ? (
        <div className="ptray-acts">
          {pay && !freeUsed && (
            <Link className="btn primary" href={`/c/${t.claimId}?side=${t.side}`} onClick={() => { markIntent(); closeTray(); }}>Back it with your free $1</Link>
          )}
          {usdc && (
            <button type="button" className="btn soft" onClick={() => { closeTray(); openSheet(w.status === "in" ? trade : { kind: "connect", then: trade }); }}>Bet real USDC</button>
          )}
        </div>
      ) : null}
      {pay && !freeUsed ? <p className="ptray-fine">{pay.right}. {pay.wrong}.</p> : freeUsed ? <p className="ptray-fine">You’ve used your free $1. Real USDC wins real money.</p> : null}
    </aside>
  );
}
