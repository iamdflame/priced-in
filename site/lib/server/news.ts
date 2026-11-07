// Is today's news on? Today's claims, free picks, readers' reports and the leaderboard exist only while
// the API runs with NEWS_ENABLED=1; until then each of their routes answers 404, and the site shows none
// of them: no section, no link, no empty shell.
//
// The switch is read from /claims, which answers 200 either way: while news is on, every news line there carries
// its `news` field, and with it off none does. A 404 is never kept by the fetch cache, so probing /api/today alone
// would leave its last 200 in place once news went off, and a page rendered per request (a fact's page, and the
// footer on it) would keep showing today's claims after a rollback. /pages does the same from /v1 (pages.ts).
// When /claims doesn't say on (no news line yet, or its lines carry no `news` field), /api/today is read under an
// address that changes every 10 seconds, so no cached answer outlives the switch, and a blip in the API's store
// (which can drop the `news` fields for a moment) never switches the site off. Pages stay static: nothing here
// opts out of the cache.
import "server-only";
import { cache } from "react";
import { API_ORIGIN, get, type Res } from "./api";
import { boardScore, isNewsPage, type Board, type Period, type Today } from "../news";

export type News = { on: false } | { on: true; today: Today };

const OFF: News = { on: false };
/** How long an off answer is kept here before asking again (0 in the e2e). */
const OFF_MS = Number(process.env.NEWS_PROBE_MS ?? 30_000);
/** A failed read keeps the last answer that worked this long, so a blip never drops the section. */
const KEEP_ON_MS = 5 * 60_000;
let last: { at: number; value: News } | null = null;

/** /api/today, cached for 10 s; fresh, under an address of its own for each 10 s, so a stale 200 is never reused. */
const today = (fresh: boolean) =>
  fetch(`${API_ORIGIN}/api/today${fresh ? `?at=${Math.floor(Date.now() / 10_000)}` : ""}`, { headers: { accept: "application/json" }, next: { revalidate: 10 }, signal: AbortSignal.timeout(6000) });

/** What /claims says: "on" (a news line carries its news), "unsure" (no news line, or none carries it), or null (unread). */
async function fromClaims(): Promise<"on" | "unsure" | null> {
  const r = await get<{ claims: { page?: string | null; news?: unknown }[] }>("/claims", 10);
  if (!r.ok || !Array.isArray(r.value.claims)) return null;
  const lines = r.value.claims.filter((c) => isNewsPage(c.page));
  return lines.some((c) => c.news && typeof c.news === "object") ? "on" : "unsure";
}

async function probe(): Promise<News> {
  if (last && !last.value.on && Date.now() - last.at < OFF_MS) return last.value;
  try {
    const said = await fromClaims();
    // on by /claims: the cached /api/today is current enough; otherwise a fresh read of it decides
    const r = await today(said !== "on");
    if (r.status === 404) { last = { at: Date.now(), value: OFF }; return OFF; }
    const body = r.ok ? ((await r.json().catch(() => null)) as Today | null) : null;
    if (body && Array.isArray(body.lines) && body.rules) { last = { at: Date.now(), value: { on: true, today: body } }; return last.value; }
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
