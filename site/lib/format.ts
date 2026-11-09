// Plain formatting. Every number on screen passes through here, so rounding is the same everywhere.

/** 0..1 to a whole percent. A live market is clamped to 1..99 so it never reads as certain. */
export const pctOf = (p: number, live = true) => {
  const n = Math.round(p * 100);
  return live ? Math.min(99, Math.max(1, n)) : n;
};

export const money = (usd: number, digits = 2) => `$${usd.toFixed(digits)}`;

/** +$0.20, −$0.27, and $0.00 for anything that rounds to nothing. */
export const signedMoney = (usd: number) => (Math.abs(usd) < 0.005 ? "$0.00" : `${usd > 0 ? "+" : "−"}${money(Math.abs(usd))}`);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** FGFhi1…BBvc6 */
export const shortHash = (h: string, a = 6, b = 5) => (h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);

/** 23:47 UTC */
export const clockUtc = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** 6 Nov, 23:47 UTC */
export const dayTimeUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}, ${clockUtc(ms)}`;
};

/** 12 November, 15:00 UTC: a day people plan around, spelled out */
export const longDayTimeUtc = (ms: number) => `${new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}, ${clockUtc(ms)}`;

/** "4 min ago", "3 h ago", "2 days ago", measured against `now`. */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** 8.0 s, 20 min, 1 h 5 min */
export function span(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** mm:ss (or h:mm:ss) for countdowns, never negative. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const DAY_MS = 86_400_000;

/** A wait on a clock: mm:ss or h:mm:ss under a day, days and hours ("3d 4h") from a day on, never negative. */
export function waitWords(ms: number): string {
  if (ms < DAY_MS) return mmss(ms);
  return `${Math.floor(ms / DAY_MS)}d ${Math.floor((ms % DAY_MS) / 3_600_000)}h`;
}

export const explorerTx =(tx: string) => `https://nearblocks.io/txns/${tx}`;
export const explorerAccount = (a: string) => `https://nearblocks.io/address/${a}`;

/** "z-ai/glm-5.3-flash" to "glm-5.3-flash". */
export const modelShort = (m: string | null | undefined) => (m ? m.split("/").pop()! : "an AI model");

/** A judge's short name: "deepseek-ai/DeepSeek-V4.1-Flash-1017" to "DeepSeek-V4.1-Flash". */
export const judgeName = (m: string) => modelShort(m).replace(/-\d{4}$/, "");

/** Personas of the house agents by account, for plain sentences. */
export type AgentNames = Record<string, string>;

/** Who a trader is, in plain words: an AI trader by persona, a free-bet key as "Someone". */
export function traderName(trader: string, agents: AgentNames): { name: string; kind: "agent" | "visitor" | "account" } {
  if (agents[trader]) return { name: `The ${agents[trader]}`, kind: "agent" };
  if (!trader || trader.startsWith("lane:")) return { name: "Someone", kind: "visitor" };
  return { name: trader.replace(/\.near$/, ""), kind: "account" };
}
