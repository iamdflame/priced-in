// Are the official pages on? They exist only while the API runs with OFFICIAL_PAGES=1, and the site looks exactly
// as it did until then: no line, no switch, no record.
//
// The switch is read from /v1, which answers 200 either way and lists `pages` only while they are on. A 404 is
// never kept by the fetch cache, so probing /api/pages alone would leave its last 200 in place once the pages
// went off, and a page rendered per request (/p/<slug>) would keep showing the market's page after a rollback.
// A failed read keeps the last answer that worked a little while, so a blip never flips the site.
import "server-only";
import { cache } from "react";
import { API_ORIGIN, get } from "./api";
import type { OfficialPage, PagesIndex, RecordDoc } from "../pages";

export type Official = { on: false } | { on: true; index: PagesIndex };

const OFF: Official = { on: false };
/** How long an off answer is kept here before asking again (0 in the e2e). */
const OFF_MS = Number(process.env.PAGES_PROBE_MS ?? 30_000);
const KEEP_ON_MS = 5 * 60_000;
let last: { at: number; value: Official } | null = null;

const read = async (path: string) => {
  const r = await fetch(`${API_ORIGIN}/api${path}`, { headers: { accept: "application/json" }, next: { revalidate: 15 }, signal: AbortSignal.timeout(6000) });
  return r.ok ? r.json().catch(() => null) : null;
};

async function probe(): Promise<Official> {
  if (last && !last.value.on && Date.now() - last.at < OFF_MS) return last.value;
  try {
    const v1 = (await read("/v1")) as { pages?: unknown } | null;
    if (v1 && typeof v1.pages !== "string") { last = { at: Date.now(), value: OFF }; return OFF; }
    if (v1) {
      const index = (await read("/pages")) as PagesIndex | null;
      if (index && Array.isArray(index.pages)) { last = { at: Date.now(), value: { on: true, index } }; return last.value; }
    }
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
