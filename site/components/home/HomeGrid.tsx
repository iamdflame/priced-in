"use client";
// Every fact as a card, with topic filters and search. Prices refresh while the tab is visible: the
// same claim views the server read, quoted again with the contract's own fill.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TopicIcon } from "../Brand";
import { FactCard } from "../FactCard";
import { Icon } from "../Icon";
import { SEARCH_EVENT } from "../shell/Search";
import { StateBox } from "../States";
import { liveNumbers, topicsOf, type ClaimView, type Fact } from "@/lib/model";

const ALL = "All";
const WRONG = "A newer source disagrees";
const REFRESH_MS = 20_000;
const EAGER_CARDS = 4;
const QUIET_SHOWN = 6;
/** A fact earns the full card once something has happened to it: a bet, a newer source that disagrees, or a ruling. */
const loud = (f: Fact) => f.trades > 0 || f.status !== "open" || !!f.caught;

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

export function HomeGrid({ initial, leadId = null, points, reopened, picks = false }: {
  /** every Wikipedia fact, the lead's included: the tabs and "See all" count them all */
  initial: Fact[];
  /** the lead's id: it sits above the grid, so the grid's first rows leave it out */
  leadId?: number | null;
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
  // how many cards show first is a width's business, so it lives in home.css: no flash, no mismatch
  const clamped = !all && tab === ALL && !q.trim();
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return facts.filter((f) => (tab === ALL || (tab === WRONG ? !!f.caught : f.topic === tab)) && (!needle || `${f.question} ${f.text} ${f.topic}`.toLowerCase().includes(needle)));
  }, [facts, tab, q]);
  // the first rows leave out the lead, shown just above; "See all", a tab or a search shows it too
  const shown = clamped ? matching.filter((f) => f.id !== leadId) : matching;
  // forty cards that all say "50%, no bets yet" are one card forty times: those are a list of titles
  const cards = shown.filter(loud);
  const quiet = shown.filter((f) => !loud(f));
  const quietShown = clamped ? quiet.slice(0, QUIET_SHOWN) : quiet;
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
        {cards.map((f, i) => <FactCard key={f.id} f={f} points={points[String(f.id)]} reopened={reopened.includes(f.id)} eager={i < EAGER_CARDS} picks={picks} />)}
      </div>
      {quietShown.length > 0 && (
        <div className="quiet">
          <div className="quiet-hd"><h3>Not bet on yet</h3><p>{quiet.length === 1 ? "This one opens" : `These ${quiet.length} open`} at our AI’s starting estimate. The first bet moves the price.</p></div>
          <ul className="qlist">
            {quietShown.map((f) => (
              <li key={f.id}>
                <TopicIcon icon={f.icon} />
                <Link className="ql-q" href={`/c/${f.id}`} prefetch={false}>{f.question}</Link>
                <span className="ql-p"><b className="num">{Math.round(f.price * 100)}%</b></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {clamped && (cards.length > 4 || quiet.length > QUIET_SHOWN) && <div className="seeall" data-more={quiet.length > QUIET_SHOWN || undefined}><button type="button" className="btn soft lg" onClick={seeAll}>See all {matching.length} facts</button></div>}
      {!shown.length && (
        <StateBox icon="search" title="No facts match" actions={<button type="button" className="btn soft" onClick={() => { setQ(""); setTab(ALL); }}>Show every fact</button>}>
          Nothing here says “{q}”{tab !== ALL ? ` under ${tab}` : ""}. Try another word, or see every fact.
        </StateBox>
      )}
    </section>
  );
}
