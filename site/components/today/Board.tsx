"use client";
// The leaderboard's live parts: the week, month and all-time boards (read on the server, switched here),
// "you" found by this browser's key, and the nickname, signed by that key. People and the three AI traders
// share one table and one count: a person's first pick on a line, an AI's first buy on it.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { existingKey, myRecord, saveNickname } from "@/lib/client/picks";
import { myScore, type Score } from "@/lib/client/score";
import { money } from "@/lib/format";
import { aiName, pctWords, recordWords, type Board, type BoardRow, type MyRecord, type Period } from "@/lib/news";

const PERIODS: { id: Period; label: string; empty: string }[] = [
  { id: "week", label: "This week", empty: "this week" },
  { id: "month", label: "This month", empty: "this month" },
  { id: "all", label: "All time", empty: "yet" },
];

function Who({ r, you }: { r: BoardRow; you: boolean }) {
  if (r.kind === "ai") {
    return (
      <span className="who">
        <span className="lb-av ai" aria-hidden="true"><Icon name="bot" /></span>
        <span><b><Link href="/agents">{aiName(r.name)}</Link></b><small>AI trader · bets real money</small></span>
      </span>
    );
  }
  return (
    <span className="who">
      <span className={`lb-av${you ? " you" : ""}`} aria-hidden="true">{r.name.charAt(0).toUpperCase()}</span>
      <span><b>{r.name}{you ? <span className="youtag">You</span> : null}</b><small>{r.picks_today ? `${r.picks_today} picked today` : `${r.picks_total} picks`}{!r.ranked && r.needs ? ` · ${r.settled} of ${r.settled + r.needs} settled to rank` : ""}</small></span>
    </span>
  );
}

function Row({ r, you, rank, score }: { r: BoardRow; you: boolean; rank: string; score: number | null | undefined }) {
  return (
    <tr className={`${r.kind}${you ? " me" : ""}${r.ranked ? "" : " unranked"}`}>
      <td><div className="lb-who"><span className="lb-rk">{rank}</span><Who r={r} you={you} /></div></td>
      <td className="n" data-l="Right">{pctWords(r.accuracy)}<small>{recordWords(r.right, r.settled)}</small></td>
      <td className="n" data-l="Streak">{r.streak.current}<small>best {r.streak.best}</small></td>
      <td className="n" data-l="Caught">{r.caught}</td>
      <td className="n" data-l="Points">{r.points}</td>
      <td className="n lb-sc" data-l="Free $1 score">{r.kind === "person" && score != null ? money(score) : "—"}</td>
    </tr>
  );
}

function Table({ b, me, scores }: { b: Board; me: string | null; scores: Record<string, number | null> }) {
  const unranked = [...b.ai.filter((a) => !a.ranked), ...b.waiting];
  return (
    <div className="panel boardwrap">
      <table className="board stack lbt">
        <thead><tr><th scope="col">Who</th><th scope="col" className="n">Right</th><th scope="col" className="n">Streak</th><th scope="col" className="n">Caught</th><th scope="col" className="n">Points</th><th scope="col" className="n lb-sc">Free $1 score</th></tr></thead>
        <tbody>
          {b.board.map((r) => <Row key={r.id} r={r} you={r.id === me} rank={`${r.rank}`} score={scores[r.id]} />)}
          {!b.board.length && (
            <tr className="lb-empty"><td colSpan={6}><b>Nobody is ranked {PERIODS.find((p) => p.id === b.period)?.empty} yet.</b> Ranking starts at {b.min_settled} settled picks, for people and AI traders alike. Here is everyone on the way.</td></tr>
          )}
          {unranked.length > 0 && b.board.length > 0 && <tr className="lb-sep"><td colSpan={6}>Not ranked yet: {b.min_settled} settled picks to rank</td></tr>}
          {unranked.map((r) => <Row key={r.id} r={r} you={r.id === me} rank="—" score={scores[r.id]} />)}
        </tbody>
      </table>
    </div>
  );
}

/** Beside the picks, the free $1's score: a separate thing, in its own words, never money. */
function ScoreLine({ score }: { score: Score | null }) {
  if (!score) return null;
  return (
    <div className="lb-score" data-testid="board-score">
      <p><span>Your score</span><b className="num">{money(score.worthUsd)}</b></p>
      <p className="sub">{score.balanceUsd >= 0.01 ? <>Your free $1 as it stands, {money(score.balanceUsd)} of it ready to bet again. <Link className="link" href="/#facts">Bet it on any fact</Link>.</> : "Your free $1 as it stands."} Score can’t be cashed out.</p>
    </div>
  );
}

function YourCard({ rec, onSaved, score }: { rec: MyRecord | null; onSaved: (nick: string) => void; score: Score | null }) {
  const [nick, setNick] = useState("");
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });
  useEffect(() => { if (rec?.nickname) setNick(rec.nickname); }, [rec?.nickname]);
  const save = async () => {
    setState({ busy: true, msg: null, ok: false });
    const r = await saveNickname(nick);
    if (r.ok) { setState({ busy: false, msg: `Saved. You’re ${r.nickname} on the board.`, ok: true }); onSaved(r.nickname); }
    else setState({ busy: false, msg: r.message, ok: false });
  };
  const s = rec?.stats;
  return (
    <div className="lb-you">
      <p className="lb-you-k">You</p>
      {s ? (
        <dl className="lb-you-s">
          <div><dt>Right</dt><dd className="num">{pctWords(s.accuracy)}</dd><dd className="sub">{recordWords(s.right, s.settled)}</dd></div>
          <div><dt>Streak</dt><dd className="num">{s.streak.current}</dd><dd className="sub">best {s.streak.best}</dd></div>
          <div><dt>Picks</dt><dd className="num">{s.picks_total}</dd><dd className="sub">{s.open_picks} still open</dd></div>
        </dl>
      ) : (
        <p className="lb-you-none">You haven’t picked yet. <Link className="link" href="/#today">Pick today’s claims</Link>: it’s free, and every right call counts here.</p>
      )}
      <ScoreLine score={score} />
      <form className="lb-nick" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label htmlFor="nick">Your name on the board</label>
        <div className="lb-nick-row">
          <input id="nick" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={20} minLength={3} placeholder={rec?.name ?? "Pick a nickname"} autoComplete="nickname" />
          <button type="submit" className="btn primary" disabled={state.busy || nick.trim().length < 3}>{state.busy ? <><span className="spin" />Saving…</> : "Save"}</button>
        </div>
        <p className={`lb-nick-m${state.ok ? " ok" : state.msg ? " bad" : ""}`} role="status">{state.msg ?? "3 to 20 letters, digits or spaces. Signed by this browser’s key; no sign-up."}</p>
      </form>
    </div>
  );
}

export function BoardView({ boards, scores = {}, initial = "week" }: { boards: Record<Period, Board | null>; scores?: Record<string, number | null>; initial?: Period }) {
  const [period, setPeriod] = useState<Period>(initial);
  const [me, setMe] = useState<string | null>(null);
  const [rec, setRec] = useState<MyRecord | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [score, setScore] = useState<Score | null>(null);
  useEffect(() => {
    const k = existingKey();
    if (!k) return;
    setMe(k.publicKey);
    myRecord().then((r) => { if (r?.ok) setRec(r); });
    myScore().then((s) => { if (s && s.portfolio.positions.length) setScore(s); });
  }, []);
  const b = boards[period];
  // a nickname just saved shows at once; the board catches up on its next read
  const shown = useMemo(() => {
    if (!b || !me || !names[me]) return b;
    const rename = (r: BoardRow) => (r.id === me ? { ...r, name: names[me] } : r);
    return { ...b, board: b.board.map(rename), waiting: b.waiting.map(rename) };
  }, [b, me, names]);
  const best = b?.you_vs_ai.best_ai ?? null;
  return (
    <>
      <div className="lb-top">
        <div className="tabs" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" className="tab" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
        {b && (
          <p className="lb-sum">
            {best ? <>Best AI: <b>{aiName(best.name)}</b>, {pctWords(best.accuracy)} on {best.settled}. People ahead of it: <b>{b.you_vs_ai.people_ahead_of_best_ai}</b>.</> : <>No AI trader is ranked {PERIODS.find((p) => p.id === period)?.empty} yet: each needs {b.min_settled} settled picks.</>}
          </p>
        )}
      </div>
      <div className="lb-grid">
        {shown ? <Table b={shown} me={me} scores={scores} /> : <div className="panel quiet"><Icon name="alert" /><div><b>The board didn’t load.</b><p>Picks are kept either way. Try again in a moment.</p></div></div>}
        <aside className="panel lb-side" aria-label="You">
          <YourCard rec={rec} score={score} onSaved={(n) => { const k = existingKey(); if (k) { setMe(k.publicKey); setNames({ [k.publicKey]: n }); } }} />
        </aside>
      </div>
      {b && <p className="fine lb-totals">{b.totals.people === 1 ? "1 person" : `${b.totals.people} people`} · {b.totals.picks} picks · {b.totals.settled_picks} settled · {b.totals.catches_upheld} {b.totals.catches_upheld === 1 ? "catch" : "catches"} upheld</p>}
    </>
  );
}
