"use client";
// /portfolio, beside the money: this browser's free picks and reports. Kept apart from bets on purpose:
// a pick wins nothing, so nothing here is in dollars. Read only when the browser already has its key;
// reading this page never makes one.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { Sk } from "../States";
import { existingKey, myRecord, myReports } from "@/lib/client/picks";
import { pctWords, REPORT_WORDS, type MyRecord, type Report } from "@/lib/news";

const STATE: Record<string, { word: string; cls: string }> = {
  open: { word: "Open", cls: "" },
  ruling: { word: "AI judges deciding", cls: "warn" },
  right: { word: "You called it", cls: "yes" },
  wrong: { word: "Missed", cls: "no" },
  unknown: { word: "Open", cls: "" },
};

export function PicksRecord({ questions }: { questions: Record<number, string> }) {
  const [rec, setRec] = useState<MyRecord | null | undefined>(undefined);
  const [reports, setReports] = useState<Report[]>([]);
  useEffect(() => {
    if (!existingKey()) { setRec(null); return; }
    myRecord().then((r) => setRec(r?.ok ? r : null));
    myReports().then((r) => { if (r?.ok) setReports(r.reports); });
  }, []);
  const q = (id: number, fallback: string | null) => questions[id] ?? fallback ?? `Claim ${id}`;
  const s = rec?.stats;
  return (
    <section aria-labelledby="pf-picks">
      <div className="pf-sec"><h2 id="pf-picks"><Icon name="board" />Your picks</h2><span className="score-note">Free picks win nothing: they count on the leaderboard</span></div>
      {rec === undefined ? <Sk h={88} r={20} /> : !rec || !s || !rec.picks.length ? (
        <div className="panel pf-empty"><div><h3>No picks yet</h3><p>Tap Yes or No on today’s claims. It’s free, and every right call counts against the AI traders.</p></div><Link className="btn primary" href="/#today">Pick today’s claims</Link></div>
      ) : (
        <>
          <div className="pf-stats">
            <div className="panel pf-stat lead"><span className="k">Right</span><span className="v">{pctWords(s.accuracy)}</span><span className="s">{s.settled ? `${s.right} of ${s.settled} settled` : "Nothing settled yet"}</span></div>
            <div className="panel pf-stat"><span className="k">Streak</span><span className="v">{s.streak.current}</span><span className="s">best {s.streak.best}</span></div>
            <div className="panel pf-stat"><span className="k">Picks</span><span className="v">{s.picks_total}</span><span className="s">{s.open_picks} still open</span></div>
            <div className="panel pf-stat"><span className="k">Leaderboard</span><span className="v">{s.ranked ? "Ranked" : `${Math.max(0, s.min_settled - s.settled)} to go`}</span><span className="s">{rec.nickname ? `as ${rec.nickname}` : <Link className="link" href="/leaderboard">Set a nickname</Link>}</span></div>
          </div>
          <ul className="panel pf-picks">
            {rec.picks.slice(0, 30).map((p) => {
              const st = STATE[p.state] ?? STATE.open;
              return (
                <li key={p.claim_id}>
                  <span className={`chip ${p.side}`}>You said: {p.side === "yes" ? "true" : "false"}</span>
                  <Link className="pf-pq" href={`/c/${p.claim_id}`}>{q(p.claim_id, p.question ?? p.claim)}</Link>
                  <span className={`chip ${st.cls}`}>{st.word}{p.state === "right" ? ` · +${p.points}` : ""}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {reports.length > 0 && (
        <>
          <div className="pf-sec"><h2>Your reports</h2><span className="n">Mistakes you showed us, and where each one stands</span></div>
          <ul className="panel pf-picks">
            {reports.map((r) => {
              const w = REPORT_WORDS[r.status];
              return (
                <li key={r.id}>
                  <span className={`chip ${w?.tone === "ok" ? "yes" : w?.tone === "bad" ? "no" : ""}`}>{w?.label ?? r.status}</span>
                  <Link className="pf-pq" href={`/c/${r.claim_id}`}>{q(r.claim_id, null)}</Link>
                  {r.reason && <span className="pf-why">{r.reason}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
