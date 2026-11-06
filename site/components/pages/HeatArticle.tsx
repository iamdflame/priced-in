"use client";
// The article with odds heat: every sentence that has a market is tinted by its price, red to green.
// Each is a real link to its market (so it works before scripts load and from the keyboard); a tap opens
// a bottom sheet with the question, the %, Yes and No, and the way to the market.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { BetLinks } from "../Bet";
import { PctBlock } from "../FactCard";
import { Icon } from "../Icon";
import type { Fact } from "@/lib/model";
import type { ArticleLine, ArticleSection } from "@/lib/server/encyclopedia";

function Sheet({ f, onClose }: { f: Fact; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const ruled = f.status === "settled";
  return (
    <div className="bsheet" onClick={onClose}>
      <div className="bsheet-in" role="dialog" aria-modal="true" aria-labelledby="sheet-q" onClick={(e) => e.stopPropagation()}>
        <span className="grab" aria-hidden="true" />
        <button ref={close} type="button" className="iconbtn sx" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        <h2 id="sheet-q">{f.question}</h2>
        <PctBlock f={f} />
        {ruled ? <p className={`verdict ${f.outcome ? "true" : "false"} sheet-verdict`}>Ruled {f.outcome ? "TRUE" : "FALSE"}</p> : <BetLinks id={f.id} quotes={f.quotes} question={f.question} />}
        <Link className="btn soft" href={`/c/${f.id}`}>Open market<Icon name="arrow" /></Link>
      </div>
    </div>
  );
}

function Heat({ f, text, className = "", open, onTap }: { f: Fact | undefined; text: string; className?: string; open: boolean; onTap: (id: number) => (e: MouseEvent<HTMLAnchorElement>) => void }) {
  if (!f) return <>{text} </>;
  const pct = Math.round(f.price * 100);
  return (
    <><a className={`hs ${className}`} href={`/c/${f.id}`} style={{ "--h": f.price } as CSSProperties} aria-haspopup="dialog" aria-expanded={open} aria-label={`${text} ${pct}% chance it’s true`} onClick={onTap(f.id)}>
      {text}<sup aria-hidden="true">{pct}%</sup>
    </a>{" "}</>
  );
}

export function HeatArticle({ sections, opened, facts }: { sections: ArticleSection[]; opened: number[]; facts: Fact[] }) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shut = useCallback(() => { setOpen(null); opener.current?.focus(); }, []);
  const tap = (id: number) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    opener.current = e.currentTarget;
    setOpen(id);
  };

  const heat = (id: number, text: string, className?: string) => <Heat f={byId.get(id)} text={text} className={className} open={open === id} onTap={tap} />;
  const line = (l: ArticleLine, i: number) => {
    if (l.factId === null) return <span key={i} className={l.opinion ? "op" : undefined}>{l.text} </span>;
    if (l.correctedBy === null) return <span key={i}>{heat(l.factId, l.text)}</span>;
    return <span key={i}>{heat(l.factId, l.text, "gone")}{heat(l.correctedBy, byId.get(l.correctedBy)?.text ?? "", "new")}</span>;
  };

  return (
    <>
      <div className="article">
        {sections.map((s, i) => (
          <section key={i}>
            {s.title && <h2>{s.title}</h2>}
            {s.paragraphs.map((p, j) => <p key={j}>{p.map(line)}</p>)}
          </section>
        ))}
        {opened.length > 0 && (
          <section>
            <h2>Opened since this revision</h2>
            <p>{opened.map((id) => <span key={id}>{heat(id, byId.get(id)?.text ?? "")}</span>)}</p>
          </section>
        )}
      </div>
      {open !== null && byId.has(open) && <Sheet f={byId.get(open)!} onClose={shut} />}
    </>
  );
}
