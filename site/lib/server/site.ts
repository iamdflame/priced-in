// One read of the live market per request, shared by the layout (the live strip) and the pages
// (React's cache dedupes it). Every number is the API's; nothing is filled in when a read fails.
import "server-only";
import { cache } from "react";
import { agentNames, api, type Ruling, type Rulings } from "./api";
import { toFact } from "./facts";
import { betsFrom, type Bet } from "../bets";
import type { ClaimView, Fact } from "../model";
import { correctionsOf, rulingRecord, settledRulings } from "../rulings";

export interface Site {
  ok: boolean;
  error: string | null;
  facts: Fact[];
  claims: ClaimView[];
  /** price paths by claim id: [t_ms, ppm] */
  history: Record<string, [number, number][]>;
  bets: Bet[];
  agents: Record<string, string>;
  /** null when the read failed: say so, never "nothing was ruled" */
  rulings: Rulings | null;
  /** settled rulings, newest first */
  settled: Ruling[];
  /** the corrected claims a ruling opened */
  reopened: number[];
  lane: { open: boolean; creditsLeft: number | null; paused: boolean } | null;
  totals: { facts: number; open: number; topics: number; trades: number; volumeUsd: number };
  asOf: number;
}

/** The real counts shown as proof: the home page's numbers and the small phone's live strip. */
export interface Proof { liveFacts: number; topics: number; bets: number; paidUsd: number; ruled: number }

export function proofOf(site: Site): Proof {
  const live = site.facts.filter((f) => f.status !== "settled");
  const record = rulingRecord(site.rulings?.rulings ?? []);
  return { liveFacts: live.length, topics: new Set(live.map((f) => f.topic)).size, bets: site.totals.trades, paidUsd: record.paidUsd, ruled: record.settled.length };
}

export const getSite = cache(async (): Promise<Site> => {
  const [claims, history, events, agents, rulings, health] = await Promise.all([api.claims(), api.historyAll(), api.events(), api.agents(), api.rulings(), api.health()]);
  const hist = history.ok ? history.value : {};
  const opens: Record<number, number> = Object.fromEntries(Object.entries(hist).map(([id, pts]) => [Number(id), pts[0]?.[1]]));
  const names = agents.ok ? agentNames(agents.value) : {};
  const list = claims.ok ? claims.value : [];
  const corrections = correctionsOf(rulings.ok ? rulings.value.rulings : []);
  const facts = list.map((c) => toFact(c, opens[c.id] ?? null, corrections.get(c.id) ?? null));
  const bets = events.ok ? betsFrom(events.value, names, opens) : [];
  const lane = health.ok ? health.value.checks?.lane : undefined;
  return {
    ok: claims.ok,
    error: claims.ok ? null : claims.error,
    facts,
    claims: list,
    history: hist,
    bets,
    agents: names,
    rulings: rulings.ok ? rulings.value : null,
    settled: rulings.ok ? settledRulings(rulings.value.rulings) : [],
    reopened: [...corrections.keys()],
    lane: lane ? { open: !!lane.open && !lane.paused, creditsLeft: typeof lane.creditsLeft === "number" ? lane.creditsLeft : null, paused: !!lane.paused } : null,
    totals: {
      facts: facts.length,
      open: facts.filter((f) => f.status === "open").length,
      topics: new Set(facts.map((f) => f.topic)).size,
      trades: list.reduce((n, c) => n + c.trades, 0),
      volumeUsd: list.reduce((n, c) => n + (c.volume_usd ?? 0), 0),
    },
    asOf: Date.now(),
  };
});
