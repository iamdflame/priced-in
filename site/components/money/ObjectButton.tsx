"use client";
// "Object to this ruling", on the ruling itself, only while its window is open: for a connected NEAR
// wallet (a tap without one asks to connect first), never for the free-bet lane, and never from a region
// where money can't go in. It hides itself the second the window closes. Before the first paint it
// renders nothing, so the server's HTML never promises a window that has already closed.
import { Icon } from "../Icon";
import { useClock } from "../Live";
import { moneyConfig } from "@/lib/money/config";
import { objectGate } from "@/lib/money/dispute";
import { openSheet, useGeo, useWallet } from "@/lib/money/hooks";
import { mmss, money } from "@/lib/format";

const cfg = moneyConfig();

export function ObjectButton({ challengeId, claimId, question, status, windowEndsAt, disputes, bondUsd }: {
  challengeId: number; claimId: number; question: string; status: string; windowEndsAt: number | null; disputes: number; bondUsd: number | null;
}) {
  const now = useClock();
  const w = useWallet();
  const geo = useGeo();
  if (now === null) return null;
  const gate = objectGate({ status, windowEndsAt, disputes }, now, w, geo.access, cfg.lane);
  if (gate === "hidden" || windowEndsAt === null) return null;
  const req = { kind: "dispute" as const, challengeId, claimId, question };
  return (
    <div className="objectbox">
      <button type="button" className="btn primary" onClick={() => openSheet(gate === "ready" ? req : { kind: "connect", then: req })} data-testid="object-open">
        <Icon name="flag" />Object to this ruling
      </button>
      <p className="fine">
        Closes in <span className="num" suppressHydrationWarning>{mmss(windowEndsAt - now)}</span>
        {bondUsd !== null ? <> · a {money(bondUsd)} bond, twice the last</> : null}
        {gate === "connect" ? " · needs a NEAR wallet" : null}
      </p>
    </div>
  );
}
