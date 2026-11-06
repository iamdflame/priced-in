"use client";
// One-tap explanations: a small "?" that opens a short plain answer, closed by a tap anywhere or Escape.
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { Caught } from "@/lib/model";

export function Explain({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(340, window.innerWidth - 24);
      setPos({ left: Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12)), top: r.bottom + 10 });
    };
    place();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } return; }
      const t = e.target as Node;
      if (!document.getElementById(id)?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, id]);
  return (
    <>
      <button ref={btn} type="button" className="whyest" aria-label={label} aria-expanded={open} aria-controls={id}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>?</button>
      {open && pos && (
        <div id={id} role="dialog" aria-label={label} className="pop" style={{ left: pos.left, top: pos.top }}>
          <button type="button" className="iconbtn x" aria-label="Close" onClick={() => setOpen(false)}><Icon name="x" /></button>
          <div className="pop-in">{children}</div>
        </div>
      )}
    </>
  );
}

export function WhyEstimate({ pct }: { pct: number }) {
  return (
    <Explain label="What is the AI’s starting estimate?">
      <b>Nobody has bet on this yet.</b> Before a fact opens, our AI reads the sentence and its sources and sets the opening odds: {pct}% chance it’s true. The first bet moves it, and from then on the % is what the money says.
    </Explain>
  );
}

/** What the "A newer source disagrees" chip means, with the source one tap away. */
export function WrongExplain({ caught }: { caught: Caught }) {
  return (
    <Explain label="What does the newer source say?">
      <b>{caught.today}.</b> <a className="link" href={caught.source} target="_blank" rel="noopener nofollow">{caught.label}</a>. It doesn’t decide the bet: three AI judges do.
    </Explain>
  );
}

/** The one trust line for the judges, on the home page and near every ticket. */
export function JudgesLine({ className = "" }: { className?: string }) {
  return (
    <p className={`judgesline ${className}`}>
      <Icon name="scale" />
      <span>3 AI judges read the sources and rule within minutes. Anyone can object.<Explain label="How does it work?">
        <b>How it works.</b> You pick true or false. When a fact is challenged, three different AI models read the sources and sign their verdicts on-chain. Anyone can object for 10 minutes, then right answers get paid. Less likely answers pay more. <Link className="link" href="/rulings">See every ruling</Link>
      </Explain></span>
    </p>
  );
}
