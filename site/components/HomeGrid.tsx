"use client";
// Every live fact as a card, with topic tabs and search. Prices refresh while the tab is visible:
// the same claim views the server read, quoted again with the contract's own fill.
import { useEffect, useMemo, useState } from "react";
import { FactCard } from "./FactCard";
import { Icon } from "./Icon";
import { StateBox } from "./States";
import { toFact, topicsOf, type Fact } from "@/lib/model";
import type { Claim } from "@/lib/core/api";

const ALL = "All";
const WRONG = "Wikipedia may be wrong";

export function HomeGrid({ initial, points, agents, reopened, recorded = false }: {
  initial: Fact[];
  points: Record<string, [number, number][]>;
  agents: Record<number, string[]>;
  reopened: number[];
  recorded?: boolean;
}) {
  const [facts, setFacts] = useState(initial);
  const [tab, setTab] = useState(ALL);
  const [q, setQ] = useState("");
  useEffect(() => {
    const p = new URLSearchParams(location.search).get("q");
    if (p) setQ(p);
    const on = (e: Event) => setQ(String((e as CustomEvent).detail ?? ""));
    addEventListener("pi:search", on);
    return () => removeEventListener("pi:search", on);
  }, []);
  useEffect(() => {
    if (recorded) return;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/claims", { headers: { accept: "application/json" } });
        if (!r.ok) return;
        const j = (await r.json()) as { claims: Claim[] };
        if (stop || !Array.isArray(j.claims)) return;
        const fresh = new Map(j.claims.map((c) => [c.id, c]));
        // keep the order the page was laid out in; only the numbers move
        setFacts((cur) => cur.map((f) => { const c = fresh.get(f.id); return c ? toFact(c, f.openPrice === null ? null : Math.round(f.openPrice * 1e6)) : f; }));
      } catch { /* the next tick tries again */ }
    };
    const t = setInterval(tick, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, [recorded]);

  const tabs = useMemo(() => {
    const wrong = facts.filter((f) => f.caught).length;
    return [{ topic: ALL, n: facts.length }, ...(wrong ? [{ topic: WRONG, n: wrong }] : []), ...topicsOf(facts)];
  }, [facts]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return facts.filter((f) => (tab === ALL || (tab === WRONG ? !!f.caught : f.topic === tab)) && (!needle || `${f.question} ${f.text} ${f.topic}`.toLowerCase().includes(needle)));
  }, [facts, tab, q]);
  const reopenSet = useMemo(() => new Set(reopened), [reopened]);

  return (
    <section id="facts" aria-labelledby="facts-h">
      <div className="sec">
        <h2 id="facts-h">{q ? `Facts matching “${q}”` : tab === ALL ? "Every live fact" : tab}</h2>
        <span className="n">{shown.length} of {facts.length} facts · {tabs.length - (tabs[1]?.topic === WRONG ? 2 : 1)} topics</span>
      </div>
      <div className="tabs" role="tablist" aria-label="Topics">
        {tabs.map((t) => (
          <button key={t.topic} type="button" role="tab" className="tab" aria-selected={tab === t.topic} aria-controls="grid" onClick={() => setTab(t.topic)}>
            {t.topic === WRONG && <Icon name="flag" className="!w-4 !h-4" />}{t.topic}{t.topic !== ALL && <span className="n">{t.n}</span>}
          </button>
        ))}
      </div>
      <div className="grid" id="grid" role="tabpanel" style={{ marginTop: 10 }}>
        {shown.map((f, i) => <FactCard key={f.id} f={f} points={points[String(f.id)]} agents={agents[f.id] ?? []} reopened={reopenSet.has(f.id)} recorded={recorded} eager={i < 4} />)}
      </div>
      {!shown.length && (
        <StateBox icon="search" title="No facts match" actions={<button type="button" className="btn soft" onClick={() => { setQ(""); setTab(ALL); }}>Show every fact</button>}>
          Nothing here says “{q}”{tab !== ALL ? ` under ${tab}` : ""}. Try another word, or see every live fact.
        </StateBox>
      )}
    </section>
  );
}
