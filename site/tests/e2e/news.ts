// Which state the e2e run is testing: the API with today's news off (the default, and the live API today),
// or on, through the stand-in API (tests/mock/api.mjs) with E2E_NEWS=on. The site finds out at runtime
// either way; the tests only need to know what to expect.
import type { APIRequestContext, Page } from "@playwright/test";

export const NEWS = process.env.E2E_NEWS === "on";
/** The official pages (OFFICIAL_PAGES=1 on the API), on through the stand-in with MOCK_PAGES=on and E2E_PAGES=on. */
export const PAGES = process.env.E2E_PAGES === "on";
export const MOCK = process.env.E2E_MOCK ?? "http://127.0.0.1:3299/__mock";

/** The home grid of Wikipedia facts (today's claims have their own cards above it). */
export const FACT_CARDS = "#facts .grid .card";

/** Switch the stand-in's state, then ask until the server's page shows it (ISR and the fetch cache catch up). */
export async function scenario(request: APIRequestContext, page: Page | null, body: { news?: "on" | "off"; pages?: "on" | "off"; scenario?: string }, check?: { path: string; has?: string; lacks?: string }) {
  const r = await request.post(MOCK, { data: body });
  const state = await r.json();
  if (check) {
    for (let i = 0; i < 30; i++) {
      const html = await (await request.get(check.path)).text();
      if ((!check.has || html.includes(check.has)) && (!check.lacks || !html.includes(check.lacks))) break;
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
  void page;
  return state as { news: string; scenario: string; visitor: { key: string; secret: string } };
}
