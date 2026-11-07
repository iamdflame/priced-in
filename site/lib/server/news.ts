// Is today's news on? Today's claims, free picks, readers' reports and the leaderboard exist only while
// the API runs with NEWS_ENABLED=1; until then each of their routes answers 404, and the site shows none
// of them: no section, no link, no empty shell. One read of /api/today per request decides it.
import "server-only";
import { cache } from "react";
import { API_ORIGIN, get, type Res } from "./api";
import { boardScore, type Board, type Period, type Today } from "../news";

export type News = { on: false } | { on: true; today: Today };

const OFF: News = { on: false };
/** A 404 isn't kept by the fetch cache, so the off answer is kept here a little while (0 in the e2e). */
const OFF_MS = Number(process.env.NEWS_PROBE_MS ?? 30_000);
/** A failed read keeps the last answer that worked this long, so a blip never drops the section. */
const KEEP_ON_MS = 5 * 60_000;
let last: { at: number; value: News } | null = null;

async function probe(): Promise<News> {
  if (last && !last.value.on && Date.now() - last.at < OFF_MS) return last.value;
  try {
    const r = await fetch(`${API_ORIGIN}/api/today`, { headers: { accept: "application/json" }, next: { revalidate: 10 }, signal: AbortSignal.timeout(6000) });
    if (r.status === 404) { last = { at: Date.now(), value: OFF }; return OFF; }
    const today = r.ok ? ((await r.json().catch(() => null)) as Today | null) : null;
    if (today && Array.isArray(today.lines) && today.rules) { last = { at: Date.now(), value: { on: true, today } }; return last.value; }
  } catch { /* below */ }
  return last?.value.on && Date.now() - last.at < KEEP_ON_MS ? last.value : OFF;
}

export const getNews = cache(probe);

/**
 * Each person's free $1 score, for the board: what their free bet has grown to, from the portfolio of the same
 * key's lane identity. Null for a key that never bet its free $1, credited or not. Capped, cached a minute.
 */
export async function getScores(ids: string[]): Promise<Record<string, number | null>> {
  const rows = await Promise.all(ids.slice(0, 30).map(async (id) => {
    const r = await get<{ balance_usd: number | null; positions: { value_usd: number | null }[] }>(`/portfolio?trader=${encodeURIComponent(`lane:${id}`)}`, 60);
    return [id, r.ok ? boardScore(r.value) : null] as const;
  }));
  return Object.fromEntries(rows);
}

/** The board for a period: people and the three AI traders side by side. */
export const getBoard = cache((period: Period): Promise<Res<Board>> => get<Board>(`/leaderboard?period=${period}`, 15));
