// What the home page leads with. data/lead.json is the curated order of general interest: the lead is
// the first open fact in it, preferring any with real bets, and the grid's first row is one fact per
// topic in that same order, with the lead's own topic last.
import leadJson from "@/data/lead.json";
import type { Fact } from "./model";

export const LEAD_ORDER: number[] = leadJson.order;

const curated = (id: number) => {
  const i = LEAD_ORDER.indexOf(id);
  return i < 0 ? Infinity : i;
};
const byInterest = (a: Fact, b: Fact) => (curated(a.id) === curated(b.id) ? 0 : curated(a.id) < curated(b.id) ? -1 : 1) || b.trades - a.trades || Number(!!b.caught) - Number(!!a.caught) || a.id - b.id;

/** The fact to lead with. Outside the curated list, the open fact with the most real bets. */
export function leadFact(facts: Fact[]): Fact | null {
  const open = facts.filter((f) => f.status === "open" && f.quotes);
  const listed = open.filter((f) => curated(f.id) !== Infinity).sort(byInterest);
  return listed.find((f) => f.trades > 0) ?? listed[0] ?? [...open].sort(byInterest)[0] ?? null;
}

/** One fact per topic in turn, so a page of mostly one topic still reads as varied. Results go last. */
export function feedOrder(facts: Fact[], lead: Fact | null): Fact[] {
  const live = facts.filter((f) => f.status !== "settled" && f.id !== lead?.id).sort(byInterest);
  const byTopic = new Map<string, Fact[]>();
  for (const f of live) byTopic.set(f.topic, [...(byTopic.get(f.topic) ?? []), f]);
  const lists = [...byTopic.values()].sort((a, b) => Number(a[0].topic === lead?.topic) - Number(b[0].topic === lead?.topic));
  const out: Fact[] = [];
  for (let i = 0; out.length < live.length; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return [...out, ...facts.filter((f) => f.status === "settled")];
}
