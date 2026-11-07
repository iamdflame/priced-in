"use client";
// You against the AIs. On a first visit: what picks are, and the three AI traders' real records (all time,
// as /api/leaderboard?period=all counts them, the same count as yours).
// Once this browser has picked: its results first, what it called right or wrong since the last visit
// ("You called it"), its streak, and where it stands against the AIs. Read from /api/picks with this
// browser's key; nothing is asked for until the browser has made a pick.
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "../Icon";
import { localPicks, markSeen, myRecord, subscribePicks, type LocalPicks } from "@/lib/client/picks";
import { aiName, pctWords, recordWords, type BoardRow, type MyRecord } from "@/lib/news";

const SERVER: LocalPicks = { picks: {}, seen: 0 };

interface Props {
  ai: BoardRow[];
  board: BoardRow[];
  minSettled: number;
  /** the site's question for each line, by id, for picks the API names only by their sentence */
  questions: Record<number, string>;
}

function AiRows({ ai, me }: { ai: BoardRow[]; me?: { name: string; right: number; settled: number; accuracy: number | null } }) {
  const rows = [...(me ? [{ ...me, kind: "you" as const, id: "you" }] : []), ...ai.map((a) => ({ name: aiName(a.name), right: a.right, settled: a.settled, accuracy: a.accuracy, kind: "ai" as const, id: a.id }))];
  rows.sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.settled - a.settled);
  return (
    <ul className="vs">
      {rows.map((r) => (
        <li key={r.id} className={r.kind === "you" ? "me" : ""}>
          <span className="vs-n">{r.kind === "ai" ? <Icon name="bot" /> : <Icon name="users" />}{r.name}</span>
          <span className="vs-r">{recordWords(r.right, r.settled)}</span>
          <b className="vs-a num">{pctWords(r.accuracy)}</b>
        </li>
      ))}
    </ul>
  );
}

export function YouPanel({ ai, board, minSettled, questions }: Props) {
  const local = useSyncExternalStore(subscribePicks, localPicks, () => SERVER);
  const picked = Object.keys(local.picks).length > 0;
  const [rec, setRec] = useState<MyRecord | null>(null);
  const [failed, setFailed] = useState(false);
  const [seenAt] = useState(() => (typeof window === "undefined" ? 0 : localPicks().seen));

  useEffect(() => {
    if (!picked) return;
    let off = false;
    myRecord().then((r) => {
      if (off || !r) return;
      if (r.ok) setRec(r); else setFailed(true);
    });
    return () => { off = true; };
  }, [picked, Object.keys(local.picks).length]); // eslint-disable-line react-hooks/exhaustive-deps

  // what was new this time has now been shown: next visit starts from here
  useEffect(() => {
    if (!rec) return;
    const t = setTimeout(() => markSeen(Date.now()), 2500);
    return () => clearTimeout(t);
  }, [rec]);

  if (!picked) {
    return (
      <section className="you first" aria-labelledby="you-h">
        <div className="you-hd"><h2 id="you-h">You vs the AIs</h2><span>All time</span></div>
        <p className="you-lede">Pick today’s claims. When they settle, every right call counts here, against three AI traders that bet real money.</p>
        <AiRows ai={ai} />
        <p className="you-rule">Picks are free and win nothing. Ranked from {minSettled} settled picks.</p>
        <Link className="btn soft" href="/leaderboard">See the leaderboard</Link>
      </section>
    );
  }

  if (!rec) {
    return (
      <section className="you" aria-labelledby="you-h" aria-busy={!failed}>
        <div className="you-hd"><h2 id="you-h">Your picks</h2><span>All time</span></div>
        {failed ? <p className="you-lede">We couldn’t load your picks just now. They’re saved; try again in a moment.</p> : <div className="you-sk"><span className="sk" /><span className="sk" /><span className="sk" /></div>}
      </section>
    );
  }

  const s = rec.stats;
  const fresh = rec.picks.filter((p) => (p.state === "right" || p.state === "wrong") && (p.settled_at ?? 0) > seenAt);
  const won = fresh.filter((p) => p.state === "right");
  const open = rec.picks.filter((p) => p.state === "open" || p.state === "ruling");
  const ranked = board.find((r) => r.id === rec.key);
  const q = (p: { claim_id: number; question: string | null; claim: string | null }) => p.question ?? questions[p.claim_id] ?? p.claim ?? `Claim ${p.claim_id}`;
  return (
    <section className="you back" aria-labelledby="you-h">
      <div className="you-hd"><h2 id="you-h">{rec.nickname ? `${rec.nickname}, your picks` : "Your picks"}</h2><span>Since your last visit</span></div>
      {fresh.length ? (
        <div className={`landed ${won.length ? "won" : "lost"}`} role="status">
          <p className="landed-big">{won.length ? <><Icon name="check" />You called it</> : "Not this time"}</p>
          <ul>
            {fresh.slice(0, 3).map((p) => (
              <li key={p.claim_id} className={p.state}>
                <Link href={`/c/${p.claim_id}`}>{q(p)}</Link>
                <span>{p.state === "right" ? `Right · +${p.points} points` : `You picked ${p.side === "yes" ? "Yes" : "No"}`}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="you-lede">Nothing new has settled since your last visit.{open.length === 1 ? " Your open pick settles after its date." : open.length > 1 ? ` Your ${open.length} open picks settle as their dates come.` : ""}</p>
      )}
      <dl className="you-stats">
        <div><dt>Right</dt><dd className="num">{s.settled ? recordWords(s.right, s.settled) : <>—<small> none settled</small></>}</dd></div>
        <div><dt>Streak</dt><dd className="num">{s.streak.current}<small> best {s.streak.best}</small></dd></div>
        <div><dt>Place</dt><dd className="num">{ranked?.rank ? `#${ranked.rank}` : s.settled >= minSettled ? "Ranked" : `${minSettled - s.settled} to go`}</dd></div>
      </dl>
      <AiRows ai={ai} me={{ name: "You", right: s.right, settled: s.settled, accuracy: s.accuracy }} />
      <Link className="btn soft" href="/leaderboard">See the leaderboard</Link>
    </section>
  );
}
