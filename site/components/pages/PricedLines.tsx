"use client";
// Sentences as the planner read them, for /new and the post page: what is checkable, our AI's starting
// estimate, what isn't priced and why, the way to the closest live fact, and how a new market really
// opens. The contract lets anyone open one with the planner's signed receipt and a first bet
// (open_and_buy); this site's free $1 only bets on facts that are already live, and the copy says so.
import Link from "next/link";
import { useState } from "react";
import { BetLinks } from "../Bet";
import { Icon } from "../Icon";
import { CopyButton } from "./Copy";
import { closestFact, type Closest } from "@/lib/client/api";
import type { PlannedSentence } from "@/lib/core/api";
import { quoteClaim } from "@/lib/quote";

const LABEL: Record<string, string> = {
  data: "Checkable against public data",
  document: "Checkable against a public document",
  judgment: "A claim a panel could rule on",
};

function ClosestLive({ sentence }: { sentence: string }) {
  const [state, setState] = useState<"idle" | "busy" | Closest>("idle");
  if (state === "idle" || state === "busy") {
    return (
      <button type="button" className="btn soft" disabled={state === "busy"} onClick={async () => { setState("busy"); setState(await closestFact(sentence)); }}>
        {state === "busy" ? <><span className="spin" aria-hidden="true" />Looking…</> : <><Icon name="search" />Find the closest live fact</>}
      </button>
    );
  }
  if ("failed" in state) return <p className="fine" role="status">{state.failed}</p>;
  if ("none" in state) return <p className="fine" role="status">No live fact is close to this yet.</p>;
  const f = state.found;
  return (
    <div className="closest" role="status">
      <span className="k">Closest live fact · {f.pct}% chance it’s true</span>
      <Link className="cq" href={`/c/${f.id}`}>{f.text}</Link>
      <BetLinks id={f.id} quotes={f.quotes} question={f.text} />
    </div>
  );
}

function OpenItYourself({ s }: { s: PlannedSentence }) {
  if (!s.receipt) return null;
  return (
    <details className="opens">
      <summary>How this becomes a market</summary>
      <p>Our planner signed this estimate. The first bet opens the market: the contract accepts this receipt with a first bet from any funded NEAR account or AI agent, through <span className="tcode">open_and_buy</span>. The free $1 on this site only bets on facts that are already live.</p>
      <CopyButton text={JSON.stringify(s.receipt.args)} label="Copy the signed receipt" />
    </details>
  );
}

function Line({ s }: { s: PlannedSentence }) {
  const priced = s.status === "priced";
  const listed = s.status === "listed" && s.claim;
  const grey = !priced && !listed;
  return (
    <li className={`pline ${grey ? "grey" : ""}`}>
      <div>
        <p className="st">{s.text}</p>
        <p className="why">
          {priced || listed ? <span className="chip brand">{LABEL[s.kind ?? ""] ?? "Checkable"}</span> : <span className="chip">Not priced</span>}
          {grey ? <span>{s.reason ?? "Pricing soon: the planner hasn’t read this yet."}</span> : null}
        </p>
      </div>
      {!grey && (
        <div className="act">
          {listed ? (
            <>
              <div className="est"><span className="pct num">{Math.round(s.claim!.price_yes_ppm / 1e4)}<i>%</i></span><span className="lab"><b>chance it’s true</b>already a live fact</span></div>
              <BetLinks id={s.claim!.id} quotes={s.claim!.status === "Open" ? quoteClaim(s.claim as never) : null} question={s.text} />
              <Link className="btn soft" href={`/c/${s.claim!.id}`}>Open the market<Icon name="arrow" /></Link>
            </>
          ) : (
            <>
              <div className="est"><span className="pct num">{Math.round((s.p0_ppm ?? 0) / 1e4)}<i>%</i></span><span className="lab"><b>chance it’s true</b>No bets yet · our AI’s starting estimate</span></div>
              <ClosestLive sentence={s.text} />
              <OpenItYourself s={s} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function PricedLines({ sentences, label }: { sentences: PlannedSentence[]; label: string }) {
  return <ol className="panel plines" aria-label={label}>{sentences.map((s) => <Line key={s.index} s={s} />)}</ol>;
}
