// Public posts on X, read through the public oEmbed endpoint (no key, no login), so that
// changing x.com to our domain in any post's link opens that post as a priced page.
//
// The oEmbed HTML is untrusted data: it is never rendered or evaluated here. It is cut down
// to plain text (tags stripped, entities decoded, control and bidi-override characters
// removed), and only what the page needs is kept: the words, the author's name and handle,
// the date, the language and the link back to the original.

import { ApiError } from "./lane.mjs";

// hosts that serve X posts at /<user>/status/<id>; "www.", "mobile." and "m." are stripped first
export const POST_HOSTS = ["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com"];
const MAX_ID = 18446744073709551615n;
const USER_RE = /^[A-Za-z0-9_]{1,15}$/;
const ID_RE = /^\d{1,20}$/;
const MAX_TEXT = 25_000;

export const NOT_A_POST =
  "That isn't a link to a post. Use a post's link, like x.com/jack/status/20, or just its number.";

/** The page slug for a post. */
export const postSlug = (id) => `x-${id}`;

function validId(s) {
  if (!ID_RE.test(s)) return null;
  const n = BigInt(s);
  if (n <= 0n || n > MAX_ID) return null;
  return n.toString();
}

/**
 * Read a post id out of anything people paste: x.com, twitter.com, www./mobile. variants,
 * fxtwitter/vxtwitter, /i/status/<id>, /i/web/status/<id>, trailing /photo/1 and the like,
 * ?s=20&t=... tracking, #!/ legacy links, a bare path (jack/status/20), x-<id>, or a bare id.
 * @param {string} input
 * @param {{ selfHosts?: string[] }} [o] our own domains, so a rewritten link reads too
 * @returns {{ id: string, user: string | null }}
 */
export function parsePostLink(input, { selfHosts = [] } = {}) {
  const bad = () => new ApiError(400, "not_a_post_link", NOT_A_POST);
  if (typeof input !== "string") throw bad();
  let s = input.trim().replace(/^[<"'“‘(]+|[>"'”’).,;]+$/g, "");
  if (!s || s.length > 2048) throw bad();

  const bare = s.match(/^(?:x-)?(\d{1,20})$/i);
  if (bare) {
    const id = validId(bare[1]);
    if (!id) throw bad();
    return { id, user: null };
  }

  // a bare path: "/jack/status/20" or "jack/status/20"
  if (/^\/?[A-Za-z0-9_]{1,15}\/(?:status|statuses)\/|^\/?i\/(?:web\/)?status\//.test(s)) s = `https://x.com/${s.replace(/^\/+/, "")}`;
  // "https:/x.com/..." (a proxy collapsed the slashes) and links with no scheme
  s = s.replace(/^(https?):\/*/i, "$1://");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;

  let url;
  try { url = new URL(s); } catch { throw bad(); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw bad();
  if (url.username || url.password || url.port) throw bad();
  const host = url.hostname.toLowerCase().replace(/^(?:www|mobile|m)\./, "");
  const own = selfHosts.map((h) => h.toLowerCase().replace(/^www\./, ""));
  if (!POST_HOSTS.includes(host) && !own.includes(host)) throw bad();

  let path = url.pathname;
  if (url.hash.startsWith("#!/")) path = url.hash.slice(2);
  const seg = path.split("/").filter(Boolean);
  let user = null;
  let idSeg = null;
  if (seg[0] === "i" && seg[1] === "web" && seg[2] === "status") idSeg = seg[3];
  else if (seg[0] === "i" && seg[1] === "status") idSeg = seg[2];
  else if (seg.length >= 3 && USER_RE.test(seg[0]) && (seg[1] === "status" || seg[1] === "statuses")) { user = seg[0]; idSeg = seg[2]; }
  const id = idSeg ? validId(idSeg) : null;
  if (!id) throw bad();
  return { id, user };
}

// ---------- the oEmbed HTML, as untrusted data ----------

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", times: "×",
  divide: "÷", plusmn: "±", larr: "←", rarr: "→", uarr: "↑", darr: "↓", hearts: "♥", zwj: "‍", zwnj: "‌",
};

/** Decode HTML entities; never emits control characters (so a decoded entity can't forge structure). */
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,15});/gi, (m, e) => {
    let cp;
    if (e[0] === "#") cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    else return Object.hasOwn(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m;
    if (!Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "";
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return cp === 0x0a ? "\n" : cp === 0x09 ? " " : "";
    return String.fromCodePoint(cp);
  });
}

// characters that can reorder or hide text on screen: bidi overrides and isolates, zero-width space, BOM
const SPOOF = /[\u202a-\u202e\u2066-\u2069\u200b\ufeff]/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const MEDIA = "\u0001M\u0002";
const LINK_OPEN = "\u0001L";
const MARK_CLOSE = "\u0002";

const stripTags = (s) => s.replace(/<[^>]*>?/g, "");
const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? null;

/** Clean a short plain-text field (a name, a date): no tags, controls or bidi tricks, capped. */
function cleanField(s, max) {
  if (typeof s !== "string") return null;
  const t = decodeEntities(stripTags(s)).replace(CONTROL, " ").replace(SPOOF, "").normalize("NFC").replace(/\s+/g, " ").trim();
  return t ? [...t].slice(0, max).join("") : null;
}

const SPECIAL_LANG = new Set(["und", "zxx", "qme", "qht", "qam", "qct", "qst", "art", "mis", "mul"]);
let displayNames = null;
function languageName(code) {
  try {
    displayNames ||= new Intl.DisplayNames(["en"], { type: "language" });
    const n = displayNames.of(code);
    return n && n.toLowerCase() !== code.toLowerCase() ? n : null;
  } catch { return null; }
}

/** The posting time from a snowflake id (ids after November 2010 carry their own timestamp). */
export function snowflakeTime(id) {
  const n = BigInt(id);
  if (n < 100_000_000_000_000n) return null;
  return new Date(Number((n >> 22n) + 1288834974657n)).toISOString();
}

/**
 * Turn an oEmbed reply into the fields the page needs. Throws on a reply that isn't a post.
 * @param {any} json the parsed oEmbed JSON
 * @param {string} id the id we asked for
 */
export function parseOembed(json, id) {
  if (!json || typeof json !== "object" || typeof json.html !== "string" || json.html.length > 256 * 1024) throw new Error("not an oEmbed post");
  const gotId = String(json.url || "").match(/\/status(?:es)?\/(\d{1,20})/)?.[1];
  if (gotId && validId(gotId) !== id) throw new Error(`oEmbed answered for post ${gotId}, not ${id}`);
  // active content never carries the post's words: drop it whole, contents and all
  const html = json.html.replace(CONTROL, " ").replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
  const bq = html.match(/<blockquote\b[^>]*>([\s\S]*)<\/blockquote>/i)?.[1] ?? html;
  const pm = bq.match(/<p\b([^>]*)>([\s\S]*?)<\/p>/i);
  if (!pm) throw new Error("the oEmbed HTML has no post text");
  const lang = (attr(pm[1], "lang") || "").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 12) || null;
  const after = bq.slice(pm.index + pm[0].length);

  // body: line breaks become newlines; anchors become text, media markers or link markers
  let body = pm[2].replace(/\r?\n/g, " ").replace(/<br\s*\/?>/gi, "\n");
  body = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_, attrs, inner) => {
    const raw = stripTags(inner); // still entity-encoded: decoded once, with the rest of the body
    const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
    const href = attr(attrs, "href") || "";
    if (/^pic\.(?:twitter|x)\.com\/\S+$/i.test(text)) return ` ${MEDIA} `;
    if (/^https?:\/\/t\.co\//i.test(href) && !/^[@#$]/.test(text)) return ` ${LINK_OPEN}${raw.replace(/\s+/g, " ").trim()}${MARK_CLOSE} `;
    return raw; // a mention, hashtag or cashtag: its words
  });
  body = decodeEntities(stripTags(body));
  body = body.replace(/[\u2028\u2029]/g, "\n").replace(SPOOF, "").normalize("NFC");

  // drop trailing media and links, counting them; inner media go too, inner links keep their words
  let mediaCount = 0;
  let linkCount = 0;
  const TRAIL = new RegExp(`(?:\\s|${MEDIA}|${LINK_OPEN}[^${MARK_CLOSE}]*${MARK_CLOSE})+$`);
  const tail = body.match(TRAIL)?.[0] || "";
  body = body.slice(0, body.length - tail.length);
  mediaCount += tail.split(MEDIA).length - 1;
  linkCount += tail.split(LINK_OPEN).length - 1;
  body = body.replace(new RegExp(MEDIA, "g"), () => { mediaCount++; return " "; });
  body = body.replace(new RegExp(`${LINK_OPEN}([^${MARK_CLOSE}]*)${MARK_CLOSE}`, "g"), (_, t) => t);
  body = body.replace(/[\u0001\u0002]/g, "");

  const lines = body.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim());
  let text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

  // author: the JSON's fields first, then the blockquote's "— Name (@handle) Date"
  const tailText = cleanField(after, 300) || "";
  const handle = String(json.author_url || "").match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/)?.[1]
    || tailText.match(/\(@([A-Za-z0-9_]{1,15})\)/)?.[1] || null;
  const authorName = cleanField(json.author_name, 80) || tailText.match(/^—?\s*(.+?)\s*\(@/)?.[1] || handle;
  const anchors = [...after.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)];
  const date = cleanField(anchors.length ? anchors[anchors.length - 1][1] : "", 40);
  let postedAt = snowflakeTime(id);
  if (!postedAt && date) {
    const t = Date.parse(`${date} UTC`);
    if (Number.isFinite(t)) postedAt = new Date(t).toISOString();
  }

  const language = lang && !SPECIAL_LANG.has(lang) ? { code: lang, name: languageName(lang), english: lang === "en" || lang.startsWith("en-") } : null;
  return {
    id,
    url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
    authorName,
    handle,
    authorUrl: handle ? `https://x.com/${handle}` : null,
    date,
    postedAt,
    lang,
    language,
    text,
    mediaCount,
    linkCount,
    // X's embed cuts a long post with an ellipsis and a link to the rest
    truncated: /…$/.test(text) && linkCount > 0,
    thread: threadOf(text),
  };
}

const LEADING_MENTIONS = /^(?:@[A-Za-z0-9_]{1,15}[\s,]+)+/;

/** Is this one post of a thread? Replies open with mentions; thread posts carry 🧵 or n/m. */
export function threadOf(text) {
  if (LEADING_MENTIONS.test(text + " ")) return { kind: "reply", message: "This post is a reply in a thread. We priced this one post, not the thread." };
  if (/🧵/u.test(text) || /(?:^|\s|\()(\d{1,2})\s*\/\s*(\d{1,2}|n)\b\)?/i.test(text.slice(0, 12)) || /(?:^|\s|\()(\d{1,2})\s*\/\s*(\d{1,2}|n)\)?\s*$/i.test(text.slice(-12)) || /\bthread\s*(?:👇|⬇️|:)/iu.test(text)) {
    return { kind: "thread", message: "This post is part of a thread. We priced this one post, not the rest." };
  }
  return null;
}

/**
 * The text that gets priced: the leading @mentions of a reply dropped, and every line break
 * kept as a sentence boundary (each line becomes its own block for the splitter).
 */
export function pricedText(post) {
  const t = `${post.text} `.replace(LEADING_MENTIONS, "").trim();
  return t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n\n");
}

// ---------- the rest of a long post ----------

const squash = (s) => String(s).normalize("NFC").replace(SPOOF, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();

/** A full text fetched elsewhere, cleaned like the embed's: no controls or bidi tricks, line breaks kept, capped. */
function cleanText(s) {
  const t = String(s).replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n").replace(SPOOF, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ").normalize("NFC");
  const out = t.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out.length > MAX_TEXT ? out.slice(0, MAX_TEXT) : out;
}

/**
 * The whole of a long post, from FxTwitter's public reading of X (api.fxtwitter.com), which returns a
 * long post's full text where X's embed stops at "…". Taken only when it is the same post, by the same
 * author, and it begins with every word X's own embed showed. Never throws: null when any of that fails.
 * @returns {Promise<{ text: string, bio: string|null, from: string, url: string } | null>}
 */
export async function fetchFullText(post, { fullTextUrl, userAgent, timeoutMs = 2500, fetchImpl = globalThis.fetch }) {
  if (!fullTextUrl || !post?.handle) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${fullTextUrl.replace(/\/+$/, "")}/${post.handle}/status/${post.id}`, { headers: { "user-agent": userAgent, accept: "application/json" }, signal: ac.signal, redirect: "follow" });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const raw = await res.text();
    if (raw.length > 512 * 1024) return null;
    const t = JSON.parse(raw)?.tweet;
    if (!t || String(t.id) !== post.id || String(t.author?.screen_name || "").toLowerCase() !== post.handle.toLowerCase()) return null;
    const full = typeof t.raw_text?.text === "string" ? t.raw_text.text : typeof t.text === "string" ? t.text : null;
    if (!full) return null;
    const text = cleanText(full);
    const shown = squash(post.text.replace(/…$/, ""));
    if (!shown || !squash(text).startsWith(shown) || squash(text).length <= shown.length) return null;
    return { text, bio: cleanField(t.author?.description ?? "", 200), from: "FxTwitter", url: `https://fxtwitter.com/${post.handle}/status/${post.id}` };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A cut post with its full text in place, when a reliable copy gives it; else the post as it was. */
export async function withFullText(post, o) {
  if (!post?.truncated) return post;
  const full = await fetchFullText(post, o);
  if (!full) return post;
  // the trailing link was X's "show more": it is the rest of this post, not a link it shared
  return { ...post, text: full.text, truncated: false, linkCount: Math.max(0, post.linkCount - 1), authorBio: full.bio, fullText: { from: full.from, url: full.url }, thread: threadOf(full.text) };
}

/** The designed notes a page shows above a post. */
export function postNotices(post) {
  const out = [];
  if (post.truncated) out.push({ code: "cut", message: "This is a long post and X shows only its start, so we priced the part we can read. The rest continues on X." });
  if (post.fullText) out.push({ code: "full_text", message: `X shows only the start of this long post; the rest is from ${post.fullText.from}’s public copy of it.` });
  if (post.thread) out.push({ code: "thread", kind: post.thread.kind, message: post.thread.message });
  if (post.language && !post.language.english) {
    out.push({ code: "language", lang: post.language.code, message: `Written in ${post.language.name || post.language.code}. Priced as written.` });
  }
  const left = [];
  if (post.mediaCount) left.push(post.mediaCount === 1 ? "1 picture or video" : `${post.mediaCount} pictures or videos`);
  if (post.linkCount) left.push(post.linkCount === 1 ? "1 link" : `${post.linkCount} links`);
  if (left.length) out.push({ code: "left_out", message: `${left.join(" and ")} left out: we price the words.` });
  return out;
}

// ---------- fetching, with timeouts, retries and backoff ----------

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one post through oEmbed.
 * @returns {Promise<{ post: object } | { gone: "deleted" | "private" }>} throws ApiError on upstream failure
 */
export async function fetchPost(id, user, { oembedUrl, fullTextUrl = null, userAgent, timeoutMs = 5000, retries = 2, fetchImpl = globalThis.fetch, sleep = sleepMs, backoffMs = 300 }) {
  const target = `https://x.com/${user && USER_RE.test(user) ? user : "i"}/status/${id}`;
  const url = `${oembedUrl}?url=${encodeURIComponent(target)}&omit_script=true&dnt=true`;
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = last?.retryAfterS ? Math.min(2000, last.retryAfterS * 1000) : backoffMs * 3 ** (attempt - 1);
      await sleep(Math.round(wait * (0.8 + Math.random() * 0.4)));
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": userAgent, accept: "application/json" }, signal: ac.signal, redirect: "follow" });
      if (res.status === 404 || res.status === 410) { await res.body?.cancel(); return { gone: "deleted" }; }
      if (res.status === 401 || res.status === 403) { await res.body?.cancel(); return { gone: "private" }; }
      if (res.status === 429) {
        await res.body?.cancel();
        last = { kind: "rate_limited", retryAfterS: Math.min(3600, Number(res.headers.get("retry-after")) || 60) };
        continue;
      }
      if (!res.ok) { await res.body?.cancel(); last = { kind: "unavailable", detail: `HTTP ${res.status}` }; if (res.status < 500) break; continue; }
      const raw = await res.text();
      if (raw.length > 512 * 1024) throw new Error("oEmbed reply too large");
      let json;
      try { json = JSON.parse(raw); } catch { last = { kind: "unavailable", detail: "the reply is not JSON" }; continue; }
      return { post: await withFullText(parseOembed(json, id), { fullTextUrl, userAgent, fetchImpl }) };
    } catch (e) {
      last = { kind: "unavailable", detail: ac.signal.aborted ? `no answer within ${timeoutMs} ms` : e.message };
    } finally {
      clearTimeout(timer);
    }
  }
  if (last?.kind === "rate_limited") {
    throw new ApiError(503, "x_rate_limited", "X is limiting how fast we can read posts right now. Try this link again in a minute.", { retryAfterS: last.retryAfterS });
  }
  throw new ApiError(502, "x_unavailable", "X didn't answer when we asked for this post. Try the link again in a moment.", { detail: last?.detail });
}

/**
 * Posts cached by id. A cached post is re-checked with oEmbed once it is older than
 * recheckMs, and a post that has since been deleted or made private keeps no text: the
 * cache holds only a tombstone. Concurrent reads of the same id share one fetch.
 */
export class PostStore {
  constructor({ config, fetchImpl, now = Date.now, log = () => {} }) {
    this.c = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.log = log;
    this.map = new Map();
    this.inflight = new Map();
    this.lastError = null;
    this.lastFetchMs = null;
    this.fetches = 0;
  }

  get size() { return this.map.size; }

  set(id, entry) {
    this.map.delete(id);
    this.map.set(id, entry);
    while (this.map.size > this.c.cacheMax) this.map.delete(this.map.keys().next().value);
  }

  /**
   * @param {string} id
   * @param {string | null} user
   * @param {{ take?: () => void, release?: () => void }} [charge] paid only by a request that fetches a post not yet cached
   * @returns {Promise<{ id, post, gone, fetchedAt, checkedAt, cached?: boolean, stale?: boolean }>}
   */
  async read(id, user, charge = {}) {
    const hit = this.map.get(id);
    if (hit && this.now() - hit.checkedAt < this.c.recheckMs) return { ...hit, cached: true };
    if (this.inflight.has(id)) return this.inflight.get(id);
    if (!hit) charge.take?.();
    const p = (async () => {
      const t0 = this.now();
      let r;
      try {
        this.fetches++;
        r = await fetchPost(id, user || hit?.post?.handle, { ...this.c, fetchImpl: this.fetchImpl });
        this.lastFetchMs = this.now() - t0;
        this.lastError = null;
      } catch (e) {
        this.lastError = `${e.code || "error"}: ${e.extra?.detail || e.message}`;
        this.log(`post x-${id}: ${this.lastError}`);
        if (hit) return { ...hit, stale: true, staleCode: e.code }; // X is down or limiting us: the copy we have, marked as such
        charge.release?.();
        throw e;
      }
      const at = this.now();
      const entry = r.gone
        ? { id, post: null, gone: r.gone, fetchedAt: hit?.fetchedAt ?? at, checkedAt: at }
        : { id, post: r.post, gone: null, fetchedAt: hit?.post && hit.post.text === r.post.text ? hit.fetchedAt : at, checkedAt: at };
      this.set(id, entry);
      if (hit?.post && r.gone) this.log(`post x-${id} is gone (${r.gone}): its text is dropped`);
      return entry;
    })().finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }
}
