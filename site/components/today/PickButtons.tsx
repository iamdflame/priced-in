"use client";
// Yes and No as a free pick: one tap, signed by this browser's key, saved at once, no wallet and no page
// change. Each is a real link to the fact's page with the side picked, so a tap before scripts load still
// goes somewhere useful; once loaded, the tap picks in place and the tray offers the next step in plain
// words: back it with the free $1, or with real USDC. Picks are free and win nothing.
import { useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import { Icon } from "../Icon";
import { localPicks, sendPick, subscribePicks } from "@/lib/client/picks";
import type { Side } from "@/lib/news";
import { pickPayout, type Quotes } from "@/lib/quote";
import { openTray } from "./tray";

const SERVER = { picks: {}, seen: 0 };

/** This browser's pick on a line, live: a pick made on one card shows on every card of the same line. */
export function useMyPick(id: number): Side | null {
  const all = useSyncExternalStore(subscribePicks, localPicks, () => SERVER);
  return (all.picks as Record<string, { side: Side }>)[id]?.side ?? null;
}

export interface PickProps {
  id: number;
  question: string;
  quotes: Quotes | null;
  /** "14 Nov": when it settles, for the tray's last line */
  settlesBy?: string | null;
  size?: "lead" | "card";
  /**
   * A Wikipedia fact, a real-money market: each button also says what the free $1 becomes if it's right,
   * from the contract's exact quote (the market page's own words). Today's news lines stay a plain pick.
   */
  pays?: boolean;
}

export function PickButtons({ id, question, quotes, settlesBy = null, size = "card", pays = false }: PickProps) {
  const mine = useMyPick(id);
  const [busy, setBusy] = useState<Side | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (side: Side) => {
    if (busy) return;
    setError(null);
    if (mine) { openTray({ claimId: id, question, side: mine, quotes, settlesBy, fresh: false }); return; }
    setBusy(side);
    const r = await sendPick(id, side);
    setBusy(null);
    if (r.ok) openTray({ claimId: id, question, side: r.pick.side, quotes, settlesBy, fresh: !r.duplicate });
    else if (r.code === "already_picked" && r.pick) openTray({ claimId: id, question, side: r.pick.side, quotes, settlesBy, fresh: false });
    else setError(r.message);
  };
  const tap = (side: Side) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // a new tab: the link as it is
    e.preventDefault();
    void pick(side);
  };
  const key = (side: Side) => (e: KeyboardEvent<HTMLAnchorElement>) => { if (e.key === " ") { e.preventDefault(); void pick(side); } };

  const button = (side: Side) => {
    const yes = side === "yes";
    const chosen = mine === side;
    const label = yes ? "Yes, it’s true" : "No, it’s false";
    const payout = pickPayout(quotes, side, pays);
    const name = chosen ? `Your pick: ${label}.` : payout ? `${label}. Pick free, or bet the free $1. ${payout}.` : `Pick ${label} Free, wins nothing.`;
    return (
      <a
        className={`bet ${yes ? "yes" : "no"} pick${payout ? " pays" : ""}${chosen ? " mine" : ""}${mine && !chosen ? " other" : ""}`}
        href={`/c/${id}?side=${side}`}
        role="button"
        aria-pressed={chosen}
        aria-busy={busy === side || undefined}
        aria-label={`${name} ${question}`}
        onClick={tap(side)}
        onKeyDown={key(side)}
      >
        <b>{busy === side ? <span className="spin" aria-hidden="true" /> : chosen ? <Icon name="check" /> : null}{chosen ? `Your pick: ${yes ? "Yes" : "No"}` : label}</b>
        {payout && <small>{payout}</small>}
      </a>
    );
  };

  return (
    <div className={`picks pk-${size}`}>
      <div className="bets">{button("yes")}{button("no")}</div>
      {error && <p className="pickerr" role="alert">{error}</p>}
    </div>
  );
}
