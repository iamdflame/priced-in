// Everything the market page shows for one fact, from one read: the price path, the bets, the AI
// traders' reasons, the ruling, and the history as plain lines. In the replay, the same page as it stood
// just before the real free $1.
import "server-only";
import { api, type Ruling } from "./api";
import { toFact, wikiOf } from "./facts";
import { getSite, type Site } from "./site";
import type { Bet } from "../bets";
import type { Rationale } from "../core/api";
import { modelShort, money } from "../format";
import type { ClaimView, Fact } from "../model";
import { REPLAY } from "../replay/record";
import { decideTime, verdictOf } from "../rulings";
import type { Scheduled } from "./api";

export interface HistoryItem {
  at: number;
  icon: "pulse" | "flag" | "scale" | "coin" | "sparkle";
  text: string;
  tx?: string | null;
}

export interface Market {
  fact: Fact;
  points: [number, number][];
  bets: Bet[];
  rationales: Rationale[];
  history: HistoryItem[];
  /** the ruling on this fact, if any */
  ruling: Ruling | null;
  /** the ruling that opened this fact as a correction, if any */
  corrects: Ruling | null;
  correctedQuestion: string | null;
  wiki: ReturnType<typeof wikiOf>;
  lane: Site["lane"];
  /** the time the chart's last step is drawn at */
  nowAt: number;
  /** when the AI judges take this fact, if it is queued for them */
  decide: Scheduled | null;
}

function rulingLines(r: Ruling): HistoryItem[] {
  const lines: HistoryItem[] = [
    { at: r.opened_at, icon: "flag", text: `${r.challenger_name.replace(/^the /, "The ")} challenged it, saying it’s ${r.claimed.toLowerCase()}.`, tx: r.open_tx },
    ...r.verdicts.map((v): HistoryItem => ({ at: v.at, icon: "scale", text: `${modelShort(v.model)} ruled ${v.verdict}, signed on-chain.`, tx: v.tx })),
  ];
  if (r.settled_at) lines.push({ at: r.settled_at, icon: "coin", text: `Settled ${verdictOf(r)}${r.payout_usd ? `: ${money(r.payout_usd)} paid` : ""}.`, tx: r.settle_tx });
  if (r.correction) lines.push({ at: r.correction.at, icon: "sparkle", text: "Corrected: the rewritten sentence opened as its own market.", tx: r.correction.open_tx });
  return lines;
}

function historyOf(f: Fact, points: [number, number][], bets: Bet[], ruling: Ruling | null, corrects: Ruling | null): HistoryItem[] {
  const lines: HistoryItem[] = [];
  const open = points[0];
  if (open) {
    const pct = Math.round(open[1] / 1e4);
    lines.push({ at: open[0], icon: "pulse", text: corrects ? `Opened as the corrected sentence, at ${pct}% chance it’s true.` : `Opened for bets at ${pct}% chance it’s true: our AI’s starting estimate.`, tx: corrects?.correction?.open_tx });
  }
  if (f.caught) lines.push({ at: Date.parse(`${f.caught.checked}T12:00:00Z`), icon: "flag", text: `A newer source disagrees: checked against ${f.caught.label}.` });
  for (const b of bets) lines.push({ at: b.at, icon: "coin", text: `${b.who} bet ${b.free ? "a free $1" : money(b.usd)} on ${b.side === "yes" ? "Yes" : "No"}: now ${Math.round(b.priceAfter * 100)}%.`, tx: b.tx });
  if (ruling) lines.push(...rulingLines(ruling));
  return lines.sort((a, b) => b.at - a.at);
}

export async function getMarket(claim: ClaimView, recorded: boolean): Promise<Market> {
  const id = claim.id;
  const [site, history, reasons] = await Promise.all([getSite(), api.history(id), api.rationales(id)]);
  const before = (at: number) => !recorded || at < REPLAY.betAt;
  const points = (history.ok ? history.value : []).filter(([t]) => before(t));
  const rulings = site.rulings?.rulings ?? [];
  const ruling = rulings.find((r) => r.claim_id === id) ?? null;
  const corrects = rulings.find((r) => r.correction?.claim_id === id) ?? null;
  const fact = toFact(claim, points[0]?.[1] ?? null, corrects?.claim_id ?? null);
  const bets = site.bets.filter((b) => b.claimId === id && before(b.at)).reverse();
  return {
    fact,
    points,
    bets,
    rationales: (reasons.ok ? reasons.value : []).filter((r) => before(r.at)).sort((a, b) => b.at - a.at),
    history: historyOf(fact, points, bets, recorded ? null : ruling, corrects),
    ruling,
    corrects,
    correctedQuestion: ruling?.correction ? site.facts.find((f) => f.id === ruling.correction?.claim_id)?.question ?? null : null,
    wiki: wikiOf(fact.page),
    lane: site.lane,
    nowAt: recorded ? REPLAY.betAt - 1 : site.asOf,
    decide: recorded || fact.status !== "open" ? null : decideTime(site.rulings, id, site.asOf),
  };
}
