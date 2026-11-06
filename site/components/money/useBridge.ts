"use client";
// The 1Click routes on offer, and a live status for one deposit address, polled until it is done.
import { useCallback, useEffect, useState } from "react";
import { fetchRoutes, fetchStatus } from "@/lib/money/bridge";
import { bridgeDone, type BridgeQuote, type BridgeRoute, type BridgeStatusView } from "@/lib/money/oneclick";

export function useBridgeRoutes(dir: "in" | "out") {
  const [routes, setRoutes] = useState<BridgeRoute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    fetchRoutes().then((list) => setRoutes(list.filter((r) => r[dir])), (e: Error) => setError(e.message));
  }, [dir]);
  useEffect(load, [load]);
  return { routes, error, retry: load };
}

export function useBridgeStatus(q: Pick<BridgeQuote, "depositAddress" | "depositMemo">) {
  const [status, setStatus] = useState<BridgeStatusView | null>(null);
  const [error, setError] = useState(false);
  const { depositAddress, depositMemo } = q;
  useEffect(() => {
    let off = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await fetchStatus({ depositAddress, depositMemo });
        if (off) return;
        setStatus(v);
        setError(false);
        if (bridgeDone(v.status)) return;
      } catch {
        if (off) return;
        setError(true);
      }
      timer = setTimeout(poll, document.hidden ? 15_000 : 5_000);
    };
    void poll();
    return () => { off = true; clearTimeout(timer); };
  }, [depositAddress, depositMemo]);
  return { status, error };
}
