// What the UI knows from the repo's own records (web/scripts/make-ui-data.mjs builds the JSON):
// page titles and revisions, the corpus audit's headline, and for the sentences the audit found
// out of date, what their source says today.
import corpus from "./data/corpus.json";

export interface TodayNote { id: string; page: string | null; article: string; text: string; verdict: string; onPage: string; today: string; checkedOn: string; revision: string; source: string | null; sourceHost: string | null }
export interface HouseAgent { name: string; model: string; instructions: string; maxBetUsd: number }

export const CORPUS = corpus as unknown as {
  checkedOn: string;
  headline: { numerator: number; denominator: number; pages: number };
  licence: { source: string; url: string };
  pages: Record<string, { title: string; url: string; revid: number; attribution: string }>;
  today: TodayNote[];
  sections: Record<string, Record<string, string>>;
  house: HouseAgent[];
};

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const byText = new Map(CORPUS.today.map((t) => [norm(t.text), t]));

/** What the source says today about a sentence the audit checked, if it found it out of date. */
export const todayFor = (text: string): TodayNote | null => byText.get(norm(text)) ?? null;

export function pageTitle(slug: string | null): string {
  if (!slug) return "";
  const p = CORPUS.pages[slug];
  if (p) return p.title.replace(/\s*\((cryptocurrency|blockchain platform)\)$/, "");
  return slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
export const pageInfo = (slug: string | null) => (slug ? CORPUS.pages[slug] ?? null : null);
export const sectionOf = (slug: string | null, text: string) => (slug ? CORPUS.sections[slug]?.[text] ?? null : null);

/** The example post for the link trick: change it here, and every mention follows. */
export const DEMO_POST = { path: "/ilblackdragon/status/2118027843980366222", about: "Illia Polosukhin’s post announcing the NEAR hackathon" };

export const PROOF = `We checked ${CORPUS.headline.denominator} sentences on ${CORPUS.headline.pages} Wikipedia crypto pages against primary sources. ${CORPUS.headline.numerator} were out of date or wrong.`;
export const RULE = "Models write the pages and give the first ruling. Bonded people have the last word. NEAR checks every step.";
export const PLAIN = "Every sentence here has a price. AI agents bet real money on whether it is true.";
