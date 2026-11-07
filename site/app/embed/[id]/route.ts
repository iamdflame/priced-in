// The embed: "Is it true?" for one fact, as a self-contained HTML document any site can frame. A route
// handler rather than a page, so it carries none of the site's chrome. Yes and No open the fact on this
// site in a new tab: a bet never happens inside someone else's page.
import { shortDate } from "@/lib/news";
import { backUsd } from "@/lib/quote";
import { SITE_URL } from "@/lib/nav";
import { getSite } from "@/lib/server/site";

export const revalidate = 30;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const THEMES: Record<string, string> = {
  dark: "--bg:#13181D;--ink:#F5F7F9;--ink2:#B9BEC6;--yes:#4BDE81;--yesbg:#4BDE8121;--no:#FF7072;--nobg:#FF707221;--line:#FFFFFF26",
  light: "--bg:#FFFFFF;--ink:#131922;--ink2:#4C535D;--yes:#00783B;--yesbg:#DFFAE5;--no:#C51D28;--nobg:#FFEEED;--line:#1B222B2B",
};

function page(theme: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Is it true? Priced In</title><style>
:root{${THEMES[theme]}}*{box-sizing:border-box;margin:0}html,body{height:100%;background:transparent}
body{font:400 14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink)}
.c{height:100%;display:flex;flex-direction:column;gap:10px;padding:14px 16px;background:var(--bg);border-radius:18px;box-shadow:inset 0 0 0 1px var(--line)}
a{color:inherit;text-decoration:none}.q{font-weight:600;font-size:16px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.p{display:flex;align-items:baseline;gap:8px}.n{font-weight:700;font-size:34px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.m{color:var(--ink2);font-size:13px}
.b{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:auto}.b a{min-height:44px;padding:6px 12px;border-radius:12px;font-weight:600;display:flex;flex-direction:column;justify-content:center}.b small{font-weight:400;font-size:12px}
.y{background:var(--yesbg);color:var(--yes)}.x{background:var(--nobg);color:var(--no)}.f{display:flex;justify-content:space-between;font-size:12px;color:var(--ink2)}
</style></head><body>${body}</body></html>`;
}

const respond = (html: string, status = 200) => new Response(html, { status, headers: {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "frame-ancestors *",
  "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
} });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = new URL(req.url).searchParams.get("theme");
  const theme = raw === "dark" ? "dark" : "light"; // light by default, like the site
  const site = await getSite();
  const f = /^\d{1,9}$/.test(id) ? site.facts.find((x) => x.id === Number(id)) : undefined;
  if (!f) return respond(page(theme, `<div class="c"><p class="q">We couldn’t find that fact.</p><div class="f"><a href="${SITE_URL}" target="_blank" rel="noopener">Priced In</a></div></div>`), site.ok ? 404 : 503);
  const href = `${SITE_URL}/c/${f.id}`;
  const pct = Math.round(f.price * 100);
  const settled = f.status === "settled";
  // a claim from the news says when it settles: that's what a reader of the embedding page needs to know
  const whose = settled ? `Ruled ${f.outcome ? "true" : "false"} by 3 AI judges` : f.news ? `chance it’s true · settles by ${shortDate(f.news.settles.by)}` : f.trades ? "chance it’s true" : "chance it’s true · no bets yet";
  const bets = f.quotes
    ? `<div class="b"><a class="y" href="${href}?side=yes" target="_blank" rel="noopener">Yes, it’s true<small>Bet $1 → get ${esc(backUsd(f.quotes.yes))} back</small></a><a class="x" href="${href}?side=no" target="_blank" rel="noopener">No, it’s false<small>Bet $1 → get ${esc(backUsd(f.quotes.no))} back</small></a></div>`
    : "";
  return respond(page(theme, `<div class="c"><a class="q" href="${href}" target="_blank" rel="noopener">${esc(f.question)}</a><div class="p"><span class="n">${pct}%</span><span class="m">${esc(whose)}</span></div>${bets}<div class="f"><span>Is it true? Bet on it.</span><a href="${SITE_URL}" target="_blank" rel="noopener">Priced In</a></div></div>`));
}
