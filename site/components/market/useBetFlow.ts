"use client";
// The ticket's logic: the side, the live quote, and the proven engine's bet flow (lib/core/store). The
// engine loads on a person's first move, so the page itself ships no NEAR code. Prices refresh by a
// small poll of the claim view, so the quote stays the contract's exact fill.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../Toasts";
import type { Engine } from "@/lib/client/engine";
import { takeIntent } from "@/lib/client/intent";
import { myBets, saveBet, type MyBet } from "@/lib/client/mybets";
import { useLane, useStore } from "@/lib/client/useStore";
import type { DoubtStage, DoubtState } from "@/lib/core/store";
import type { ClaimView } from "@/lib/model";
import { backUsd, quoteClaim } from "@/lib/quote";

export type Side = "yes" | "no";

const IDLE: DoubtState = { stage: "idle", ctx: null, failure: null };
const IN_FLIGHT: DoubtStage[] = ["quoting", "signing", "optimistic"];
const EXECUTED: DoubtStage[] = ["optimistic", "final", "rewritten", "answered"];
const REFRESH_MS = 15_000;

/** One engine load per ticket: the store opened on this claim, ready for a bet. */
function useEngineLoader(id: number, recorded: boolean) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const loading = useRef<Promise<Engine> | null>(null);
  const load = useCallback(() => {
    loading.current ??= import("@/lib/client/engine").then(async ({ liveEngine, recordedEngine }) => {
      const e = recorded ? await recordedEngine() : liveEngine();
      await e.store.open({ name: "claim", id });
      setEngine(e);
      return e;
    });
    return loading.current;
  }, [id, recorded]);
  return { engine, load };
}

/** The claim view, kept fresh while the tab is visible and no bet is on its way. */
function useLiveClaim(initial: ClaimView, paused: boolean) {
  const [view, setView] = useState(initial);
  useEffect(() => {
    if (paused) return;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/claims/${initial.id}`, { headers: { accept: "application/json" } });
        const j = r.ok ? ((await r.json()) as { claim: ClaimView }) : null;
        if (!stop && j?.claim) setView((v) => (v.price_yes_ppm === j.claim.price_yes_ppm ? v : j.claim));
      } catch { /* the next tick tries again */ }
    };
    const t = setInterval(tick, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [initial.id, paused]);
  return view;
}

export function useBetFlow({ claim, question, initialSide, recorded }: { claim: ClaimView; question: string; initialSide: Side | null; recorded: boolean }) {
  const id = claim.id;
  const toast = useToast();
  const { engine, load } = useEngineLoader(id, recorded);
  const store = engine?.store ?? null;
  const state = useStore(store, (s) => s.doubt, IDLE);
  const bet = state.ctx?.claimId === id ? state : IDLE;
  const busy = IN_FLIGHT.includes(bet.stage);
  const done = EXECUTED.includes(bet.stage);
  const lane = useLane(recorded ? null : engine?.lane ?? null);

  const [side, setSide] = useState<Side | null>(initialSide);
  const [mine, setMine] = useState<MyBet | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const view = useLiveClaim(claim, recorded || busy || done);
  const quotes = useMemo(() => quoteClaim(view), [view]);

  // what this browser has already bet, and a tap on a card that brought a person here
  useEffect(() => {
    if (!recorded) setMine(myBets()[0] ?? null);
    if (!recorded && initialSide && takeIntent()) void load().then((e) => e.warm());
  }, [recorded, initialSide, load]);

  // a price that moved under an open pick: say so, the number on the button already changed
  const shown = useRef(quotes);
  useEffect(() => {
    const was = shown.current;
    shown.current = quotes;
    if (side && was && quotes && backUsd(was[side]) !== backUsd(quotes[side])) toast(`The price moved: your $1 now gets ${backUsd(quotes[side])} back.`);
  }, [quotes, side, toast]);

  // the receipt opens the moment NEAR executes the bet, and the bet is kept in this browser
  const saved = useRef<number | null>(null);
  useEffect(() => {
    const c = bet.ctx;
    if (!c || !done || saved.current === c.startedAt) return;
    saved.current = c.startedAt;
    setReceiptOpen(true);
    const record: MyBet = { claimId: id, question, side: c.side, tx: c.txHash, at: c.startedAt, shares: c.trade ? Number(c.trade.shares_micro) / 1e6 : null };
    if (!recorded) { saveBet(record); setMine(record); }
  }, [bet.ctx, done, id, question, recorded]);

  const pick = useCallback((s: Side) => {
    setSide(s);
    void load().then((e) => e.warm());
  }, [load]);

  const confirm = useCallback(async () => {
    if (!side) return;
    const e = await load();
    if (e.store.state.doubt.stage === "failed") e.store.resetDoubt();
    await e.store.doubt(`c${id}`, side);
  }, [side, load, id]);

  const closeReceipt = useCallback(() => {
    setReceiptOpen(false);
    store?.resetDoubt();
  }, [store]);

  return { store, bet, busy, done, lane, side, pick, confirm, quotes, mine, receiptOpen, openReceipt: () => setReceiptOpen(true), closeReceipt };
}
