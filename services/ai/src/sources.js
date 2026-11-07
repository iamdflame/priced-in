// Whose page counts. A page anyone can write passes the word check and the support panel by
// construction, and the Sentinel never disputes a verified receipt, so what stands behind our
// Checker's bond is decided here, by host, in code.
//
//   readers' reports  trustedSource (api/_lib/picks.mjs): the line's own sources, an official site or an
//                     established outlet, and nothing else: a report is free, and the reader has a
//                     way to bring any other page, with their own bond
//   the settler       settlerBar, below: wider, because the contract can't void a line and a line whose
//                     receipts never pass waits for good. An official or primary source stands alone;
//                     any other page needs a second, independent host beside it

import { SOURCE_RULE } from "./scout.js";

// registries that sell only to governments and treaty bodies: nobody can buy a name under these
export const OFFICIAL = /(?:^|\.)(?:gov|mil|int|gov\.uk|gov\.au|gov\.ie|gov\.in|gov\.sg|govt\.nz|gc\.ca|canada\.ca|europa\.eu|gouv\.fr|bund\.de|go\.jp|gob\.es|gob\.mx|gov\.br)$/;
export const OUTLETS = Object.freeze(["reuters.com", "apnews.com", "afp.com", "bloomberg.com", "bbc.com", "bbc.co.uk", "ft.com", "wsj.com", "nytimes.com", "washingtonpost.com", "theguardian.com", "economist.com", "cnbc.com", "cnn.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com", "npr.org", "axios.com", "politico.com", "theverge.com", "techcrunch.com", "arstechnica.com", "wired.com", "espn.com", "skysports.com", "variety.com", "hollywoodreporter.com", "deadline.com", "coindesk.com", "theblock.co", "un.org", "imf.org", "worldbank.org"]);
// hosts anyone can post to: a page on one is never a host's word, and two of them are one voice
export const OPEN_HOSTS = Object.freeze(["x.com", "twitter.com", "facebook.com", "instagram.com", "threads.net", "tiktok.com", "youtube.com", "linkedin.com", "reddit.com", "medium.com", "substack.com", "github.com", "github.io", "githubusercontent.com", "gitlab.com", "bitbucket.org", "google.com", "googleapis.com", "amazonaws.com", "dropbox.com", "notion.so", "notion.site", "pastebin.com", "telegra.ph", "t.me", "discord.com", "wikipedia.org", "wordpress.com", "blogspot.com", "tumblr.com", "vercel.app", "netlify.app", "pages.dev", "web.app"]);
// the labels companies and bodies give the part of their site where they speak for themselves. The
// label alone proves nothing, since anyone can make ir.their-own-domain.com, so a host counts only
// when the rest of its name is a name the line itself uses (primarySource)
export const PRIMARY_LABELS = Object.freeze(["ir", "investor", "investors", "investorrelations", "newsroom", "newsrooms", "press", "pressroom", "presscenter", "media", "mediacenter", "mediaroom", "news", "corporate", "about", "stories", "blog"]);
// second-level suffixes under which a registrable name has three labels
const TWO_LEVEL = /\.(?:co|com|org|net|ac|gov|or|ne)\.[a-z]{2}$/;
const NOT_NAMES = new Set(["the", "sec", "by", "and", "or", "its", "their", "any", "reports", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);

export const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, ""); } catch { return null; } };
export const under = (host, domain) => host === domain || host.endsWith(`.${domain}`);
export const isOfficial = (host) => OFFICIAL.test(host);
export const isOutlet = (host, extra = []) => [...OUTLETS, ...extra].some((d) => under(host, d));
export const isOpenHost = (host) => OPEN_HOSTS.some((d) => under(host, d));
/** The part of a host someone registered: ir.doordash.com -> doordash.com, news.bbc.co.uk -> bbc.co.uk. */
export function registrable(host) {
  const parts = String(host).split(".");
  const open = OPEN_HOSTS.find((d) => under(host, d));
  if (open) return open;
  return parts.slice(TWO_LEVEL.test(host) ? -3 : -2).join(".");
}
const nameOf = (host) => registrable(host).split(".")[0].replace(/[^a-z0-9]/g, "");
const flat = (s) => s.toLowerCase().replace(/['’]s$/, "").replace(/[^\p{L}\p{N}]/gu, "");

/** The names a line uses: its capitalised words, alone and run together ("SK Hynix" gives sk, hynix and skhynix). */
export function namesIn(text) {
  const out = new Set();
  for (const m of String(text ?? "").matchAll(/\p{Lu}[\p{L}\p{N}&]*(?:['’]s)?(?:[ -]\p{Lu}[\p{L}\p{N}&]*(?:['’]s)?)*/gu)) {
    const words = m[0].split(/[ -]/).map(flat).filter(Boolean);
    for (const w of [...words, words.join("")]) if (w.length >= 3 && !NOT_NAMES.has(w)) out.add(w);
  }
  return out;
}

const lineNames = (line) => namesIn(`${line?.settles?.source ?? ""}. ${String(line?.claim ?? "").replace(SOURCE_RULE, "")}`);

/** Is this the part of a site where the line's named company or body speaks for itself? ir.doordash.com, on a line about DoorDash. */
export function primarySource(host, line, { tied = true } = {}) {
  const parts = String(host).split(".");
  if (parts.length < 3 || isOpenHost(host) || !PRIMARY_LABELS.includes(parts[0])) return false;
  return !tied || lineNames(line).has(nameOf(host));
}

/** Is this the line's own settling source, by the page the scout named or by the name it gave? */
export function namedSource(host, line) {
  if (isOpenHost(host)) return false;
  const own = hostOf(line?.settles?.source_url);
  if (own && !isOpenHost(own) && registrable(own) === registrable(host)) return true;
  return lineNames({ settles: line?.settles }).has(nameOf(host));
}

/**
 * May the Checker challenge on these receipts? `receipts` all back one outcome.
 *   stands alone   the line's named settling source, an official site, a listed outlet, or a primary
 *                  source: enough by itself, and it carries any other receipt beside it
 *   anything else  only with a second host of a different registrable domain carrying the same finding;
 *                  a host anyone can post to is never that second voice
 * @param {{ url: string, final_url?: string|null }[]} receipts
 * @param {object} line { claim, settles: { source, source_url } }
 * @param {{ tied?: boolean, extra?: string[] }} [o]
 * @returns {{ ok: boolean, why: "alone"|"corroborated"|"one_voice"|"no_receipt", alone: string[], hosts: string[] }}
 */
export function settlerBar(receipts, line, { tied = true, extra = [] } = {}) {
  // a redirect counts as where it landed, and both ends must pass
  const hostsOf = (r) => [hostOf(r.url), r.final_url ? hostOf(r.final_url) : null].filter(Boolean);
  const stands = (h) => namedSource(h, line) || isOfficial(h) || isOutlet(h, extra) || primarySource(h, line, { tied });
  const alone = [...new Set(receipts.filter((r) => { const h = hostsOf(r); return h.length > 0 && h.every(stands); }).map((r) => hostOf(r.url)))];
  const hosts = [...new Set(receipts.map((r) => hostOf(r.final_url || r.url)).filter(Boolean))];
  if (!hosts.length) return { ok: false, why: "no_receipt", alone, hosts };
  if (alone.length) return { ok: true, why: "alone", alone, hosts };
  const voices = new Set(hosts.filter((h) => !isOpenHost(h)).map(registrable));
  return { ok: voices.size >= 2, why: voices.size >= 2 ? "corroborated" : "one_voice", alone, hosts };
}
