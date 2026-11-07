"use client";
// Every fact as a card, with topic filters and search. Prices refresh while the tab is visible: the
// same claim views the server read, quoted again with the contract's own fill.
import { useEffect, useMemo, useRef, useState } from "react";
import { FactCard } from "../FactCard";
import { Icon } from "../Icon";
import { SEARCH_EVENT } from "../shell/Search";
import { StateBox } from "../States";
import { liveNumbers, topicsOf, type ClaimView, type Fact } from "@/lib/model";

const ALL = "All";
const WRONG = "A newer source disagrees";
const REFRESH_MS = 20_000;
const EAGER_CARDS = 4;

function useLiveFacts(initial: Fact[]) {
  const [facts, setFacts] = useState(initial);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/claims", { headers: { accept: "application/json" } });
        if (!r.ok) return;
        const { claims } = (await r.json()) as { claims: ClaimView[] };
        if (stop) return;
        const fresh = new Map(claims.map((c) => [c.id, c]));
        // keep the order the page was laid out in; only the numbers move
        setFacts((cur) => cur.map((f) => { const c = fresh.get(f.id); return c ? { ...f, ...liveNumbers(c) } : f; }));
      } catch { /* the next tick tries again */ }
    };
    const t = setInterval(tick, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return facts;
}

function useSearchTerm() {
  const [q, setQ] = useState("");
  useEffect(() => {
    setQ(new URLSearchParams(location.search).get("q") ?? "");
    const on = (e: Event) => setQ(String((e as CustomEvent<string>).detail ?? ""));
    addEventListener(SEARCH_EVENT, on);
    return () => removeEventListener(SEARCH_EVENT, on);
  }, []);
  return [q, setQ] as const;
}

export function HomeGrid({ initial, points, reopened, picks = false }: {
  initial: Fact[];
  points: Record<string, [number, number][]>;
  reopened: number[];
  /** today's news is on: every card's Yes and No is a free pick */
  picks?: boolean;
}) {
  const facts = useLiveFacts(initial);
  const [q, setQ] = useSearchTerm();
  const [tab, setTab] = useState(ALL);
  const [all, setAll] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const topics = useMemo(() => topicsOf(facts), [facts]);
  const wrong = useMemo(() => facts.filter((f) => f.caught).length, [facts]);
  const filters = [{ topic: ALL, n: facts.length }, ...(wrong ? [{ topic: WRONG, n: wrong }] : []), ...topics];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return facts.filter((f) => (tab === ALL || (tab === WRONG ? !!f.caught : f.topic === tab)) && (!needle || `${f.question} ${f.text} ${f.topic}`.toLowerCase().includes(needle)));
  }, [facts, tab, q]);
  // how many cards show first is a width's business, so it lives in home.css: no flash, no mismatch
  const clamped = !all && tab === ALL && !q.trim();
  const seeAll = () => {
    const next = [...(grid.current?.children ?? [])].find((c) => getComputedStyle(c).display === "none");
    setAll(true);
    requestAnimationFrame(() => next?.querySelector<HTMLElement>("a.q")?.focus({ preventScroll: true }));
  };
  return (
    <section id="facts" aria-labelledby="facts-h">
      <div className="sec">
        <h2 id="facts-h">{q ? `Facts matching “${q}”` : tab === ALL ? "Trending" : tab}</h2>
        <div className="tabs" role="group" aria-label="Filter by topic">
        {filters.map((t) => (
          <button key={t.topic} type="button" className="tab" aria-pressed={tab === t.topic} onClick={() => setTab(t.topic)}>
            {t.topic === WRONG && <Icon name="flag" />}{t.topic}{t.topic !== ALL && <span className="n">{t.n}</span>}
          </button>
        ))}
        </div>
      </div>
      <div className={`grid${clamped ? " clamped" : ""}`} ref={grid}>
        {shown.map((f, i) => <FactCard key={f.id} f={f} points={points[String(f.id)]} reopened={reopened.includes(f.id)} eager={i < EAGER_CARDS} picks={picks} />)}
      </div>
      {clamped && shown.length > 4 && <div className="seeall"><button type="button" className="btn soft lg" onClick={seeAll}>See all {shown.length} facts</button></div>}
      {!shown.length && (
        <StateBox icon="search" title="No facts match" actions={<button type="button" className="btn soft" onClick={() => { setQ(""); setTab(ALL); }}>Show every fact</button>}>
          Nothing here says “{q}”{tab !== ALL ? ` under ${tab}` : ""}. Try another word, or see every fact.
        </StateBox>
      )}
    </section>
  );
}
