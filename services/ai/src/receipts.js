// Receipts: what a challenge's evidence cites, checked at its source before a model reads it.
//
// The jury reads the claim and the challenger's evidence and nothing else. Measured on the three
// real models (deployments/jury-test.json), a made-up receipt in our Checker's own format turned a
// true line FALSE 9 times in 10. So code checks the evidence first:
//
//   1. parse it: the URLs, the quoted words, and any corpus record it names
//   2. a corpus record must exist in corpus/ERRORS.json, with the same sha256 (over the record's
//      JSON as committed) and a sentence that is the claim. Quotes from it are checked against the
//      record's committed receipt, so our own Checker's evidence needs no live fetch
//   3. every other source is fetched now: HTTPS only, public addresses only (every address a name
//      resolves to is checked, and redirects are followed one hop at a time), a time limit and a
//      size cap; HTML, JSON, plain text and PDF are read as text
//   4. every quote must be at a source, compared after normalising whitespace, case, quote marks,
//      dashes and number formatting ("122,839,738,995" and "122 839 738 995" are the same)
//
// The result, with every source's URL, HTTP status, the sha256 of what was fetched and when:
//   verified         every quote is at its source, or the corpus record matches and holds them
//   quote_not_found  a quote is not at the sources fetched, or nothing quoted can be checked
//                    (a source with no quote from it, a quote with no source)
//   unfetchable      a source could not be read: an HTTP error, a time-out, too large, not
//                    HTTPS, a private address
//   record_mismatch  the corpus record named doesn't exist, has another hash, is about another
//                    sentence, or says the opposite of the challenge
//   no_receipt       no URL, no quote and no record: a bare accusation
//   unsupported      every quote is at its source, and the attested models reading that source
//                    found it does not support the challenge (support.js): a real quote, and a lie
//                    told around it
//
// Fetched text is untrusted: it is only searched here, or read by a model as data, never followed.

import { createHash } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import errors from "../../../corpus/ERRORS.json" with { type: "json" };
import committedReceipts from "./corpus-receipts.json" with { type: "json" };
import { normText } from "./evidence.js";

export const RESULTS = Object.freeze(["verified", "quote_not_found", "unfetchable", "record_mismatch", "no_receipt", "unsupported"]);
/** Results that mean the receipts failed: our jury runner stops, and the Sentinel disputes a ruling for the challenger. */
export const FAILED = Object.freeze(["quote_not_found", "unfetchable", "record_mismatch", "unsupported"]);

export const USER_AGENT = "PricedInSentinel/1.0 (+https://isitpriced.com; checks the receipts a challenge cites)";
export const LIMITS = Object.freeze({ timeoutMs: 10_000, maxBytes: 6 * 1024 * 1024, maxRedirects: 5, maxSources: 6, concurrency: 3, retries: 1, minQuoteChars: 16, minQuoteWords: 3 });

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const iso = (ms) => new Date(ms).toISOString();
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}\u2026` : String(s));

// ---------- normalising ----------

const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const QUOTE_MARKS = /["'`\u00AB\u00BB\u2018-\u201F\u2032-\u2037\u2039\u203A\u275B-\u275E\u300C-\u300F\uFF02\uFF07]/g;
const DASHES = /[\u2010-\u2015\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]/g;
const MARKUP = /[*_#>|~]/g; // markdown and table syntax, on both sides
const GROUPED = /(?<![\d.,])\d{1,3}(?:[, ]\d{3})+(?!\d)/g; // a number written with thousands separators

/**
 * Text as it is compared: HTML character references decoded, NFKC (no-break and thin spaces,
 * full-width digits, ligatures, the ellipsis), lower case, no quote marks, one kind of dash, no
 * markdown, numbers without thousands separators, and no whitespace at all, so layout (a PDF's
 * columns, an HTML page's tags, a CSV's line breaks) never decides a match.
 */
export function normForMatch(s) {
  return decodeEntities(String(s ?? ""))
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(QUOTE_MARKS, "")
    .replace(DASHES, "-")
    .replace(MARKUP, "")
    .replace(GROUPED, (m) => m.replace(/\D/g, ""))
    .replace(/\s+/g, "");
}

/**
 * A quote's checkable parts: split at ellipses ("...", the ellipsis character, "[...]"), each
 * long enough to mean something. A character reference cut in half where an excerpt was cut
 * ("statements &#8") is dropped from the edges.
 */
export function fragmentsOf(quote) {
  const q = String(quote ?? "").normalize("NFKC").trim().replace(/&#?[a-z0-9]{0,10}$/i, "").replace(/^(?:#?x?[0-9a-f]{1,7}|[a-z]{2,10});/i, "");
  return q.split(/\[\s*\.{3,}\s*\]|\.{3,}/).map(normForMatch).filter((f) => f.length >= 8);
}

/** Is the quote in this normalised text? Every fragment, in order. */
export function quoteIn(quote, hay) {
  const frags = fragmentsOf(quote);
  if (!frags.length || !hay) return false;
  let at = 0;
  for (const f of frags) {
    const i = hay.indexOf(f, at);
    if (i < 0) return false;
    at = i + f.length;
  }
  return true;
}

// ---------- parsing the evidence ----------

const URL_RE = /\bhttps?:\/\/[^\s"'<>`{}|\\^[\]\u201C\u201D\u2018\u2019\u00AB\u00BB]+/gi;

function trimUrl(u) {
  for (;;) {
    const last = u.at(-1);
    if (".,;:!?".includes(last)) { u = u.slice(0, -1); continue; }
    if (last === ")" && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) { u = u.slice(0, -1); continue; }
    return u;
  }
}

/** Every http(s) URL in the evidence, once each, in order. */
export function urlsIn(evidence) {
  const out = [];
  for (const m of String(evidence ?? "").match(URL_RE) || []) {
    const u = trimUrl(m);
    if (u.length > 10 && !out.includes(u)) out.push(u);
  }
  return out;
}

const CLOSERS = "\"\u201D\u201C\u00BB";
const words = (s) => String(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * The quoted words in the evidence, long enough to check: at least 16 characters once
 * normalised, and three words (or 32 characters: a CSV or JSON excerpt has few spaces). A
 * receipt's labelled excerpt ("Receipt excerpt: "..."") runs to the last quote mark on its line,
 * because CSV and JSON receipts carry quote marks inside them; other quotes are the text between
 * matching quote marks, and markdown block quotes.
 */
export function quotesIn(evidence, { minChars = LIMITS.minQuoteChars, minWords = LIMITS.minQuoteWords } = {}) {
  const out = [];
  const add = (q) => {
    const t = String(q).trim();
    const n = fragmentsOf(t).join("").length;
    if (n >= minChars && (words(t) >= minWords || n >= 2 * minChars) && !out.includes(t)) out.push(t);
  };
  const rest = [];
  for (const line of String(evidence ?? "").split(/\r?\n/)) {
    // only a receipt's excerpt runs to the end of its line: elsewhere two quotes on a line stay two
    const labelled = /^(.*?\b(?:excerpt|receipt|verbatim|quot\w*)\b[^:\uFF1A]{0,40}[:\uFF1A])\s*(["\u201C\u201E\u00AB])(.*)$/i.exec(line);
    if (labelled) {
      const body = labelled[3].replace(/[\s.;,]+$/, "");
      const close = body.at(-1);
      if (close && CLOSERS.includes(close) && body.length > 1) { add(body.slice(0, -1)); rest.push(labelled[1]); continue; }
    }
    const block = /^\s*>\s?(.*)$/.exec(line);
    if (block) { add(block[1]); continue; }
    rest.push(line);
  }
  const text = rest.join("\n");
  for (const [open, close] of [["\u201C", "\u201D"], ["\u201E", "\u201C"], ["\u00AB", "\u00BB"]]) {
    for (const m of text.matchAll(new RegExp(`${open}([^${close}]{1,1500})${close}`, "g"))) add(m[1]);
  }
  for (const m of text.matchAll(/"([^"]{1,1500})"/g)) add(m[1]);
  return out;
}

/** The corpus record the evidence names, if any: { id, sha256 } (either may be null). */
export function recordIn(evidence) {
  const s = String(evidence ?? "");
  const id = /\bcorpus\s+record\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{4})\b/i.exec(s)?.[1] ?? /\brecord\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{4})\b/i.exec(s)?.[1] ?? null;
  const hash = /\bsha-?256\s*[:=]?\s*([0-9a-f]{64})\b/i.exec(s)?.[1] ?? null;
  if (!id && !/\bcorpus\s+record\b|\berrors\.json\b/i.test(s)) return null;
  return { id: id ? id.toLowerCase() : null, sha256: hash ? hash.toLowerCase() : null };
}

/** Everything receipt-like in the evidence. */
export function parseEvidence(evidence, o = {}) {
  return { urls: urlsIn(evidence), quotes: quotesIn(evidence, o), record: recordIn(evidence) };
}

// ---------- the corpus record ----------

const RECORDS = new Map((errors.items || []).map((x) => [x.id, x]));

/** A record's sha256: over its JSON as committed, the hash the Checker posts. */
export const recordHash = (item) => sha256(Buffer.from(JSON.stringify(item), "utf8"));

/** The corpus record behind a caught line, and its sha256. */
export function corpusRecord(id, records = RECORDS) {
  const item = records.get(id) || null;
  return item ? { item, sha256: recordHash(item) } : null;
}

/**
 * Does the named record exist, with this hash, about this sentence, and on this side?
 * @returns {{ ok: boolean, reason: string|null, view: object, item?: object }}
 */
export function checkRecord(named, { claim, claimed = null, records = RECORDS } = {}) {
  const view = { id: named.id, found: false, sha256_claimed: named.sha256, sha256_committed: null, hash_matches: false, sentence_matches: false };
  const fail = (reason) => ({ ok: false, reason, view });
  if (!named.id) return fail("The evidence names a corpus record but not which one.");
  const rec = corpusRecord(named.id, records);
  if (!rec) return fail(`There is no record ${named.id} in corpus/ERRORS.json.`);
  view.found = true;
  view.sha256_committed = rec.sha256;
  view.hash_matches = named.sha256 === rec.sha256;
  view.sentence_matches = normText(rec.item.sentence) === normText(claim);
  if (!named.sha256) return fail(`The evidence names record ${named.id} without its sha256 (the committed record's is ${rec.sha256}).`);
  if (!view.hash_matches) return fail(`Record ${named.id} in corpus/ERRORS.json has sha256 ${rec.sha256}; the evidence gives ${named.sha256}.`);
  if (!view.sentence_matches) return fail(`Record ${named.id} is about another sentence: "${clip(rec.item.sentence, 160)}"`);
  if (claimed === true) return fail(`Record ${named.id} finds this line ${rec.item.verdict === "wrong" ? "wrong" : "out of date"}, and the challenge says it is TRUE.`);
  return { ok: true, reason: null, view, item: rec.item };
}

// ---------- fetching: HTTPS, public addresses, a time limit and a size cap ----------

const BLOCKED = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) BLOCKED.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 127], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]]) BLOCKED.addSubnet(a, p, "ipv6");

/** Is this a public unicast address (not loopback, private, link-local, reserved or a tunnel to one)? */
export function isPublicAddress(ip) {
  const v = net.isIP(String(ip));
  if (!v) return false;
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip) || /^::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^::ffff:/i.test(ip)) return false;
    return !BLOCKED.check(ip, "ipv6");
  }
  return !BLOCKED.check(ip, "ipv4");
}

const PRIVATE_HOST = /^(localhost|.*\.(localhost|local|internal|intranet|lan|home|corp|localdomain))$/i;

/** dns.lookup, refusing a name when any address it resolves to is not public (DNS rebinding included). */
export function guardedLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return callback(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) || 4 }];
      const bad = list.find((a) => !isPublicAddress(a.address));
      if (!list.length || bad) return callback(Object.assign(new Error(`${hostname} resolves to a private address (${bad?.address ?? "none"})`), { code: "EPRIVATE" }));
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

function describe(e, timeoutMs) {
  const code = e?.code || "";
  if (code === "EPRIVATE" || e?.private) return e.message;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "no such host";
  if (code === "ECONNREFUSED") return "the connection was refused";
  if (code === "ECONNRESET" || code === "EPIPE") return "the connection was reset";
  if (code === "ETIMEDOUT" || code === "TIMEOUT") return `no complete answer within ${Math.round(timeoutMs / 1000)} s`;
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return `its TLS certificate was refused (${code})`;
  return clip(e?.message || String(e), 160);
}

/** One GET, no redirect following: { status, location?, contentType, body }. */
function getOnce(u, { deadline, maxBytes, userAgent, lookup }) {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) return reject(Object.assign(new Error("timed out"), { code: "TIMEOUT" }));
    const mod = u.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const req = mod.request(u, {
      method: "GET", agent: false, lookup,
      headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/json,text/plain,text/csv,application/pdf;q=0.9,*/*;q=0.5", "accept-encoding": "gzip, deflate, br", "accept-language": "en" },
    });
    const timer = setTimeout(() => { req.destroy(Object.assign(new Error("timed out"), { code: "TIMEOUT" })); }, left);
    req.on("error", (e) => finish(reject, e));
    req.on("response", (res) => {
      const status = res.statusCode;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return finish(resolve, { status, location: String(res.headers.location) }); }
      const enc = String(res.headers["content-encoding"] || "").trim().toLowerCase();
      if (!enc && Number(res.headers["content-length"] || 0) > maxBytes) { req.destroy(); return finish(reject, Object.assign(new Error(`larger than ${maxBytes / 1048576} MB`), { code: "TOO_LARGE" })); }
      let stream = res;
      if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
      const parts = [];
      let n = 0;
      stream.on("data", (c) => {
        n += c.length;
        if (n > maxBytes) { req.destroy(); stream.destroy?.(); return finish(reject, Object.assign(new Error(`larger than ${maxBytes / 1048576} MB`), { code: "TOO_LARGE" })); }
        parts.push(c);
      });
      stream.on("end", () => finish(resolve, { status, contentType: res.headers["content-type"] || null, body: Buffer.concat(parts) }));
      stream.on("error", (e) => finish(reject, Object.assign(new Error(`the answer could not be decoded (${e.code || e.message})`), { code: "DECODE" })));
      res.on("error", (e) => finish(reject, e));
    });
    req.end();
  });
}

/** Where a redirect leads. One down to plain HTTP is asked again over HTTPS: nothing is ever read in the clear. */
export function redirectTarget(location, current, { allowHttp = false } = {}) {
  let next;
  try { next = new URL(location, current); } catch { return null; }
  if (next.protocol === "http:" && !allowHttp) next.protocol = "https:";
  return next.href;
}

/**
 * Fetch one source as the receipt check does. Never throws.
 * @returns {Promise<{ url: string, final_url: string, status: number|null, content_type: string|null, bytes: number,
 *   sha256: string|null, fetched_at: string, error: string|null, body: Buffer|null }>}
 */
export async function fetchSource(url, o = {}) {
  const { timeoutMs = LIMITS.timeoutMs, maxBytes = LIMITS.maxBytes, maxRedirects = LIMITS.maxRedirects, userAgent = USER_AGENT, allowHttp = false, allowPrivate = false, lookup = dns.lookup } = o;
  const deadline = Date.now() + timeoutMs;
  const out = { url, final_url: url, status: null, content_type: null, bytes: 0, sha256: null, fetched_at: null, error: null, body: null };
  const done = (patch) => Object.assign(out, patch, { fetched_at: iso(Date.now()) });
  let current = url;
  for (let hop = 0; ; hop++) {
    let u;
    try { u = new URL(current); } catch { return done({ error: "not a URL" }); }
    if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) return done({ final_url: current, error: `${u.protocol.replace(":", "")} is not HTTPS` });
    if (u.username || u.password) return done({ final_url: current, error: "a URL with a user name or password" });
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!allowPrivate) {
      if (u.port && u.port !== "443") return done({ final_url: current, error: `port ${u.port}: only 443 is fetched` });
      if (net.isIP(host) && !isPublicAddress(host)) return done({ final_url: current, error: `a private address (${host})` });
      if (PRIVATE_HOST.test(host)) return done({ final_url: current, error: `a private host name (${host})` });
    }
    let r;
    try { r = await getOnce(u, { deadline, maxBytes, userAgent, lookup: allowPrivate ? lookup : guardedLookup(lookup) }); }
    catch (e) { return done({ final_url: current, error: describe(e, timeoutMs) }); }
    if (r.location) {
      if (hop >= maxRedirects) return done({ final_url: current, status: r.status, error: `more than ${maxRedirects} redirects` });
      const next = redirectTarget(r.location, current, { allowHttp });
      if (!next) return done({ final_url: current, status: r.status, error: "a redirect to something that is not a URL" });
      current = next;
      continue;
    }
    const ok = r.status >= 200 && r.status < 300;
    return done({ final_url: current, status: r.status, content_type: r.contentType, bytes: r.body.length, sha256: sha256(r.body), body: r.body, error: ok ? null : `HTTP ${r.status}` });
  }
}

/** A fetch that failed for a reason worth one more try: no answer, a reset, 403, 429 or a server error. */
const transient = (f) => f.error && !/private|not HTTPS|port|user name|not a URL|larger than|redirect|no such host|certificate/.test(f.error) && (f.status === null || f.status === 403 || f.status === 429 || f.status >= 500);

// ---------- reading what was fetched ----------

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", ndash: "\u2013", mdash: "\u2014", minus: "\u2212", hyphen: "-", dash: "\u2010", lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201A", ldquo: "\u201C", rdquo: "\u201D", bdquo: "\u201E", laquo: "\u00AB", raquo: "\u00BB", lsaquo: "\u2039", rsaquo: "\u203A", hellip: "\u2026", shy: "", zwj: "", zwnj: "", lrm: "", rlm: "", copy: "\u00A9", reg: "\u00AE", trade: "\u2122", euro: "\u20AC", pound: "\u00A3", yen: "\u00A5", cent: "\u00A2", dollar: "$", percnt: "%", deg: "\u00B0", middot: "\u00B7", bull: "\u2022", times: "\u00D7", divide: "\u00F7", plusmn: "\u00B1", frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE", sup1: "\u00B9", sup2: "\u00B2", sup3: "\u00B3", num: "#", sol: "/", colon: ":", comma: ",", period: ".", excl: "!", quest: "?", lpar: "(", rpar: ")", lsqb: "[", rsqb: "]", lbrack: "[", rbrack: "]", ast: "*", equals: "=", plus: "+", verbar: "|", vert: "|", grave: "`", prime: "\u2032", Prime: "\u2033", rarr: "\u2192", larr: "\u2190", le: "\u2264", ge: "\u2265", ne: "\u2260", asymp: "\u2248" };

/** HTML character references, named (the common ones) and numeric. */
export function decodeEntities(s) {
  return String(s).replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,10});/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

// a tag, with any ">" inside its quoted attribute values ("click->tracker#event")
const TAG = /<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
const BLOCK_TAG = /<\/?(?:p|div|li|ul|ol|tr|td|th|table|thead|tbody|h[1-6]|section|article|header|footer|main|nav|aside|blockquote|pre|br|hr|dt|dd|dl|figcaption)\b[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi;

/** The visible text of an HTML page. */
export function htmlText(html) {
  return decodeEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(BLOCK_TAG, "\n")
    .replace(TAG, " ")
    .replace(/<![^>]*>/g, " "))
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Text with JavaScript and JSON string escapes undone, for pages whose words live in a script's data. */
export function unescapeScript(s) {
  return decodeEntities(String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(["'\\/])/g, "$1"));
}

function charsetOf(contentType) {
  return /charset\s*=\s*"?([\w.:-]+)/i.exec(String(contentType || ""))?.[1]?.toLowerCase() || "utf-8";
}

function decodeBody(body, contentType) {
  let label = charsetOf(contentType);
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) label = "utf-8";
  try { return new TextDecoder(label).decode(body); } catch { return new TextDecoder("utf-8").decode(body); }
}

const mostlyText = (b) => {
  const head = b.subarray(0, 4096);
  let bad = 0;
  for (const c of head) if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) bad++;
  return head.length > 0 && bad / head.length < 0.02;
};

let pdfjs = null;
/** A PDF's text, with the pinned unpdf (a serverless build of PDF.js): no native tool, so it runs in a Vercel function. */
export async function pdfText(body) {
  pdfjs ||= import("unpdf");
  const { extractText, getDocumentProxy } = await pdfjs;
  const doc = await getDocumentProxy(new Uint8Array(body));
  try { return (await extractText(doc, { mergePages: true })).text; } finally { await doc.destroy?.().catch?.(() => {}); }
}

/**
 * What a fetched source says, as text: { kind: "pdf"|"html"|"json"|"text"|"binary"|"empty", text, raw, error? }.
 * `raw` is the body itself with script escapes undone, searched when the visible text misses: a
 * page that renders from data keeps its words there.
 */
export async function readSource({ body, content_type: contentType }) {
  if (!body?.length) return { kind: "empty", text: "", raw: "" };
  const ct = String(contentType || "").toLowerCase();
  const head = body.subarray(0, 1024).toString("latin1").trimStart();
  if (ct.includes("pdf") || head.startsWith("%PDF-")) {
    try { return { kind: "pdf", text: await pdfText(body), raw: "" }; }
    catch (e) { return { kind: "pdf", text: "", raw: "", error: `the PDF could not be read (${clip(e.message, 100)})` }; }
  }
  if (!ct.startsWith("text/") && !/json|xml|csv|javascript|markdown|application\/text/.test(ct) && !mostlyText(body)) return { kind: "binary", text: "", raw: "" };
  const raw = decodeBody(body, ct);
  if (ct.includes("html") || /^<(!doctype\s+html|html|head|body)\b/i.test(head)) return { kind: "html", text: htmlText(raw), raw: unescapeScript(raw) };
  if (ct.includes("json") || /^[[{]/.test(head)) return { kind: "json", text: unescapeScript(raw), raw: "" };
  return { kind: "text", text: raw, raw: "" };
}

// ---------- the check ----------

/** Run fn over items, `limit` at a time, keeping their order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const sourceView = (f, via) => ({ url: f.url, final_url: f.final_url ?? null, via, status: f.status ?? null, content_type: f.content_type ?? null, bytes: f.bytes ?? null, sha256: f.sha256 ?? null, fetched_at: f.fetched_at ?? null, error: f.error ?? null });
const at = (f) => `${f.status ? `HTTP ${f.status}, fetched` : "tried"} ${f.fetched_at ? f.fetched_at.replace(/\.\d+Z$/, "Z") : "just now"}`;

/**
 * Check a challenge's receipts.
 * @param {{ claim: string, evidence: string, claimed?: boolean|null, fetchSource?: typeof fetchSource|null, support?: Function|null,
 *   records?: Map<string, object>, committed?: object, now?: () => number, limits?: object, log?: (m: string) => void }} a
 *   fetchSource null means no live fetch is allowed (a source that needs one is reported unfetchable).
 *   support asks the attested models about a receipt verified at a live source (support.js); null asks nobody.
 * @returns {Promise<object>} { result, reason, checked_at, via, record, quotes: [{ text, found, url, via }], sources: [...], support }
 */
export async function checkReceipts({ claim, evidence, claimed = null, fetchSource: get = fetchSource, support = null, records = RECORDS, committed = committedReceipts.items, now = Date.now, limits = {}, log = () => {} }) {
  const L = { ...LIMITS, ...limits };
  const parsed = parseEvidence(evidence, { minChars: L.minQuoteChars, minWords: L.minQuoteWords });
  const out = { result: null, reason: null, checked_at: iso(now()), via: null, record: null, quotes: parsed.quotes.map((text) => ({ text, found: false, url: null, via: null })), sources: [], support: null };
  const finish = (result, reason, via) => Object.assign(out, { result, reason, via });

  if (!parsed.urls.length && !parsed.quotes.length && !parsed.record) return finish("no_receipt", "The evidence gives no source, no quoted words and no corpus record: a bare accusation.", null);

  // 1. a corpus record: it must be ours, as committed, about this line
  const corpus = [];
  if (parsed.record) {
    const r = checkRecord(parsed.record, { claim, claimed, records });
    out.record = r.view;
    if (!r.ok) return finish("record_mismatch", r.reason, "corpus");
    (r.item.receipts || []).forEach((x, i) => {
      const m = committed?.[r.item.id]?.[i];
      const meta = m && m.url === x.url ? m : {};
      corpus.push({ url: x.url, hay: normForMatch(x.match), view: { url: x.url, final_url: null, via: "corpus", status: meta.status ?? null, content_type: null, bytes: meta.bytes ?? null, sha256: meta.sha256 ?? null, fetched_at: meta.fetched_at ?? null, error: null } });
    });
    for (const q of out.quotes) {
      const s = corpus.find((c) => quoteIn(q.text, c.hay));
      if (s) Object.assign(q, { found: true, url: s.url, via: "corpus" });
    }
    if (out.quotes.every((q) => q.found)) {
      out.sources = corpus.filter((c) => /^https:\/\//.test(c.url) || out.quotes.some((q) => q.url === c.url)).map((c) => c.view);
      return finish("verified", out.quotes.length
        ? `Corpus record ${r.item.id} is ours as committed (same sha256, same sentence), and the quoted words are in its receipt.`
        : `Corpus record ${r.item.id} is ours as committed (same sha256, same sentence): our own measurement is the receipt.`, "corpus");
    }
    out.sources = corpus.map((c) => c.view);
  }

  // 2. every source the evidence names, fetched now
  const urls = parsed.urls.slice(0, L.maxSources);
  const skipped = parsed.urls.length - urls.length;
  const fetched = await mapLimit(urls, L.concurrency, async (url) => {
    if (!get) return { url, final_url: url, status: null, fetched_at: iso(now()), error: "no live fetch here", hay: [] };
    let f = await get(url, { timeoutMs: L.timeoutMs, maxBytes: L.maxBytes, maxRedirects: L.maxRedirects });
    for (let i = 0; i < L.retries && transient(f); i++) {
      await new Promise((r) => setTimeout(r, 600));
      f = await get(url, { timeoutMs: L.timeoutMs, maxBytes: L.maxBytes, maxRedirects: L.maxRedirects });
    }
    const hay = [];
    let text = "";
    if (!f.error && f.body) {
      const read = await readSource(f);
      text = read.text || read.raw;
      if (read.error) f = { ...f, error: read.error };
      else if (!read.text && !read.raw) f = { ...f, error: `nothing readable in it (${read.kind})` };
      else for (const t of [read.text, read.raw]) if (t) hay.push(normForMatch(t));
    }
    log(`receipts: ${url} ${f.status ?? "-"} ${f.error ?? "read"}`);
    return { ...f, hay, text };
  });
  out.sources.push(...fetched.map((f) => sourceView(f, "source")));
  for (const q of out.quotes.filter((x) => !x.found)) {
    const s = fetched.find((f) => !f.error && f.hay.some((h) => quoteIn(q.text, h)));
    if (s) Object.assign(q, { found: true, url: s.url, via: "source" });
  }

  const read = fetched.filter((f) => !f.error);
  const unread = fetched.filter((f) => f.error);
  const missing = out.quotes.filter((q) => !q.found);
  const via = fetched.length ? "source" : "corpus";
  const more = skipped > 0 ? ` (${skipped} more ${skipped === 1 ? "source was" : "sources were"} not fetched: at most ${L.maxSources})` : "";
  if (!out.quotes.length) {
    if (!read.length && unread.length) return finish("unfetchable", `${unread[0].url} could not be read (${unread[0].error}${unread[0].status ? "" : `, ${at(unread[0])}`}), and the evidence quotes nothing from it.`, via);
    return finish("quote_not_found", `The evidence names ${urls.length === 1 ? "a source" : "sources"} but quotes nothing from ${urls.length === 1 ? "it" : "them"}, so nothing in it can be checked: ${read.map((f) => `${f.url} (${at(f)})`).join("; ")}.`, via);
  }
  if (!missing.length) {
    const urls2 = [...new Set(out.quotes.map((q) => q.url))];
    const live = out.quotes.find((q) => q.via === "source");
    // the words are there. Do they say what the challenge needs? Our own corpus records aren't asked
    if (support && live) {
      const from = fetched.find((f) => f.url === live.url);
      out.support = await support({ claim, claimed, evidence, url: live.url, text: from.text, quotes: out.quotes }).catch((e) => ({ verdict: "unanswered", unanimous: false, asked_at: iso(now()), url: live.url, answers: [], error: e.message }));
      if (out.support.verdict === "unsupported") return finish("unsupported", `The quoted words are at ${live.url}, but the attested models that read that source found it does not support the challenge.`, "source");
    }
    return finish("verified", `Every quoted passage is at its source: ${urls2.join(", ")}.`, out.quotes.every((q) => q.via === "corpus") ? "corpus" : "source");
  }
  const words0 = `"${clip(missing[0].text, 140)}"`;
  if (!urls.length) return finish("quote_not_found", `The quoted words ${words0} ${parsed.record ? "are not in the corpus record's receipt, and" : ""} the evidence names no source to find them in.`.replace(/\s+/g, " "), via);
  if (unread.length) return finish("unfetchable", `${unread[0].url} could not be read (${unread[0].error}${unread[0].status ? "" : `, ${at(unread[0])}`}), and the quoted words ${words0} are not at any source that could be read${more}.`, via);
  return finish("quote_not_found", `The quoted words ${words0} are not at ${read.map((f) => `${f.url} (${at(f)})`).join("; ")}${more}.`, via);
}

/** The check, kept short for a run record or a log line. */
export const checkSummary = (c) => (c ? { result: c.result, reason: c.reason, checked_at: c.checked_at, via: c.via } : null);

// ---------- the gate in front of our jury runner ----------

/** A check whose answer can still change: a source that couldn't be read, or models that didn't answer. */
export const unsettled = (c) => c?.result === "unfetchable" || c?.support?.verdict === "unanswered";

/** An in-memory store of checks, by challenge id (the self-hosted server's; the hosted runtime keeps them in its store). */
export function memoryChecks() {
  const m = new Map();
  return { get: async (id) => m.get(id) ?? null, put: async (id, c) => { m.set(id, c); } };
}

/**
 * Our jury runner calls the models only for a challenge whose receipts verified. A check is
 * reused; one that could not read a source, or whose support question went unanswered, is tried
 * again after `recheckMs`.
 */
export class ReceiptGate {
  /** @param {{ store?: { get: (id: number) => Promise<object|null>, put: (id: number, c: object) => Promise<void> }, fetchSource?: Function|null, support?: Function|null, check?: typeof checkReceipts, recheckMs?: number, now?: () => number, log?: (m: string) => void }} [o] */
  constructor({ store = memoryChecks(), fetchSource: get = fetchSource, support = null, check = checkReceipts, recheckMs = 10 * 60_000, now = Date.now, log = () => {} } = {}) {
    Object.assign(this, { store, get, support, check, recheckMs, now, log });
  }

  /** The check for one challenge: the stored one, or a new one, stored. */
  async checkFor({ challenge_id: id, challenge: ch, claim }) {
    const known = await this.store.get(id).catch(() => null);
    if (known?.result && (!unsettled(known) || this.now() - Date.parse(known.checked_at) < this.recheckMs)) return known;
    const c = await this.check({ claim: claim?.text ?? "", evidence: ch?.evidence ?? "", claimed: typeof ch?.claimed_outcome === "boolean" ? ch.claimed_outcome : null, fetchSource: this.get, support: this.support, now: this.now, log: this.log });
    await this.store.put(id, c).catch((e) => this.log(`receipts: store ${id}: ${e.message}`));
    return c;
  }

  /** { ok, check }: ok only when the receipts verified. Any error refuses. */
  async verdict(a) {
    try {
      const check = await this.checkFor(a);
      // a jury needs the same models the support question does: unanswered waits, like the jury would
      return { ok: check.result === "verified" && check.support?.verdict !== "unanswered", check };
    } catch (e) {
      return { ok: false, check: null, error: `the receipt check failed: ${e.message}` };
    }
  }
}
