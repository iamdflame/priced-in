// /status's rules, as plain functions the tests hold: when the market's NEAR nodes are a problem, and how
// the count of problems reads.

export type PartState = "ok" | "warn" | "down" | "unknown";

export interface RpcCheck { reachable: number; urls: { url?: string; ok: boolean; latencyMs?: number; height?: number }[] }

/** A host for a sentence: "rpc.intea.rs". */
const hostOf = (u: string | undefined) => {
  try { return u ? new URL(u).host : null; } catch { return null; }
};

/**
 * The market's NEAR nodes. Every read is raced across them, so a spare that doesn't answer while two or
 * more others do is not a problem: running, and the sentence says which spare is quiet. One left
 * answering is a warning (no spare); none is down.
 */
export function rpcState(rpc: RpcCheck | undefined): { state: PartState; note: string | null } {
  if (!rpc) return { state: "unknown", note: null };
  const quiet = rpc.urls.filter((u) => !u.ok).map((u) => hostOf(u.url) ?? "a node");
  const which = `${quiet.join(" and ")} ${quiet.length === 1 ? "doesn’t" : "don’t"} answer right now.`;
  if (rpc.reachable === 0) return { state: "down", note: "No node answers, so prices and bets can’t be read or sent." };
  if (!quiet.length) return { state: "ok", note: null };
  if (rpc.reachable === 1) return { state: "warn", note: `${which} Reads go to the one left, with no spare.` };
  return { state: "ok", note: `${which} ${quiet.length === 1 ? "It’s a spare" : "They’re spares"}: reads go to the others, so nothing is affected.` };
}

/** The problems tile: "0 problems reported", "1 problem reported", "3 problems reported". */
export const problemsKpi = (n: number) => ({ v: String(n), l: n === 1 ? "problem reported" : "problems reported" });

/** The page's title: down, a problem, problems, or all running. */
export function statusTitle(down: number, warn: number): string {
  if (down) return down === 1 ? "Part of Priced In is down." : "Parts of Priced In are down.";
  if (warn) return warn === 1 ? "Priced In is running, with one problem." : `Priced In is running, with ${warn} problems.`;
  return "Everything is running.";
}
