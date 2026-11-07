// Are the official pages on? They exist only while the API runs with OFFICIAL_PAGES=1; until then its
// /pages routes answer 404, and the site looks exactly as it did: no line, no switch, no record. One read
// of /api/pages per request decides it, and a failed read keeps the last answer that worked a little while.
import "server-only";
import { cache } from "react";
import { API_ORIGIN, get } from "./api";
import type { OfficialPage, PagesIndex, RecordDoc } from "../pages";

export type Official = { on: false } | { on: true; index: PagesIndex };

const OFF: Official = { on: false };
/** A 404 isn't kept by the fetch cache, so the off answer is kept here a little while (0 in the e2e). */
const OFF_MS = Number(process.env.PAGES_PROBE_MS ?? 30_000);
const KEEP_ON_MS = 5 * 60_000;
let last: { at: number; value: Official } | null = null;

async function probe(): Promise<Official> {
  if (last && !last.value.on && Date.now() - last.at < OFF_MS) return last.value;
  try {
    const r = await fetch(`${API_ORIGIN}/api/pages`, { headers: { accept: "application/json" }, next: { revalidate: 15 }, signal: AbortSignal.timeout(6000) });
    if (r.status === 404) { last = { at: Date.now(), value: OFF }; return OFF; }
    const index = r.ok ? ((await r.json().catch(() => null)) as PagesIndex | null) : null;
    if (index && Array.isArray(index.pages)) { last = { at: Date.now(), value: { on: true, index } }; return last.value; }
  } catch { /* below */ }
  return last?.value.on && Date.now() - last.at < KEEP_ON_MS ? last.value : OFF;
}

export const getOfficial = cache(probe);

/** One page, or null when the pages are off or it didn't load: the article then shows as it always did. */
export const getOfficialPage = cache(async (slug: string): Promise<OfficialPage | null> => {
  if (!(await getOfficial()).on) return null;
  const r = await get<OfficialPage>(`/pages/${encodeURIComponent(slug)}`, 15);
  return r.ok && Array.isArray(r.value.paragraphs) ? r.value : null;
});

export const getRecord = cache(() => get<RecordDoc>("/record", 30));
