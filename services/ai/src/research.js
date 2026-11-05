// Research for one claim. With a NEAR AI key it uses NEAR AI web search
// (web_context_search, which needs stream:true); otherwise, or when that finds nothing, it
// reads Wikipedia, Wikidata and the page's official sources over HTTPS. Every source it
// returns was fetched just now and answered HTTP 200, so every rationale can cite a URL that
// works. Fetched text is untrusted: it is passed to the model as data, with a warning.

import { corpusEvidence } from "./evidence.js";

const UA = "PricedInHouseAgent/0.1 (NEAR hackathon research agent; https://github.com/pricedin)";
const STOP = new Set("a an the of in on at to for from by with and or but is are was were be been being has have had do does did it its this that these those as than then there their more most less least over under about into per not no yes will would can could should may might must".split(" "));

/** The words of a claim worth searching for. */
export function keywords(text, max = 7) {
  const words = String(text).replace(/[^\p{L}\p{N}$%.\- ]+/gu, " ").split(/\s+/).map((w) => w.replace(/^[.\-]+|[.\-]+$/g, "")).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (STOP.has(w.toLowerCase()) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out.join(" ");
}

const strip = (html) => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** The sentences of a text that share the most words with the claim. */
export function excerpt(text, claim, max = 600) {
  const kw = new Set(keywords(claim, 12).toLowerCase().split(" ").filter((w) => w.length > 2));
  const sents = String(text).split(/(?<=[.!?])\s+/).slice(0, 400);
  const scored = sents.map((s, i) => ({ s, i, score: s.toLowerCase().split(/\W+/).filter((w) => kw.has(w)).length })).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  let out = "";
  for (const x of scored.slice(0, 4).sort((a, b) => a.i - b.i)) { if ((out + " " + x.s).length > max) break; out += (out ? " " : "") + x.s; }
  return out || String(text).slice(0, max);
}

export class Research {
  /**
   * @param {{ client?: import('./nearai.js').NearAI|null, fetchImpl?: typeof fetch, useWebSearch?: boolean, searchModel?: string, ledger?: object, log?: (m: string) => void, timeoutMs?: number }} [o]
   */
  constructor({ client = null, fetchImpl = globalThis.fetch, useWebSearch = true, searchModel = "z-ai/glm-5.3-flash", ledger = null, log = () => {}, timeoutMs = 8000 } = {}) {
    this.client = client;
    this.fetch = fetchImpl;
    this.useWebSearch = useWebSearch;
    this.searchModel = searchModel;
    this.ledger = ledger;
    this.log = log;
    this.timeoutMs = timeoutMs;
    this.checked = new Map(); // url -> { at, ok, finalUrl }
  }

  async get(url, { json = false } = {}) {
    if (!/^https:\/\//.test(url)) throw new Error(`only https sources: ${url}`);
    const res = await this.fetch(url, { headers: { "user-agent": UA, accept: json ? "application/json" : "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(this.timeoutMs) });
    const body = json ? await res.json().catch(() => null) : await res.text().catch(() => "");
    return { status: res.status, url: res.url || url, body };
  }

  /** Fetch a URL now and keep it only if it answers 200 (cached for 10 minutes). */
  async verify200(url) {
    const hit = this.checked.get(url);
    if (hit && Date.now() - hit.at < 600_000) return hit;
    let r;
    try {
      const g = await this.get(url);
      r = { at: Date.now(), ok: g.status === 200, status: g.status, finalUrl: g.url, text: g.status === 200 ? strip(g.body) : "" };
    } catch (e) { r = { at: Date.now(), ok: false, status: 0, error: e.message }; }
    this.checked.set(url, r);
    return r;
  }

  async wikipedia(query, n = 2) {
    const s = await this.get(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${n}&srsearch=${encodeURIComponent(query)}`, { json: true });
    const titles = (s.body?.query?.search || []).map((x) => x.title);
    const out = [];
    for (const t of titles) {
      const p = await this.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, "_"))}`, { json: true });
      const url = p.body?.content_urls?.desktop?.page;
      if (p.status === 200 && url && p.body.extract) out.push({ url, title: p.body.title || t, excerpt: p.body.extract.slice(0, 900), via: "wikipedia" });
    }
    return out;
  }

  async wikidata(query) {
    const s = await this.get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=1&search=${encodeURIComponent(query)}`, { json: true });
    const e = s.body?.search?.[0];
    if (!e?.id) return [];
    return [{ url: `https://www.wikidata.org/wiki/${e.id}`, title: e.label || e.id, excerpt: [e.label, e.description].filter(Boolean).join(": "), via: "wikidata" }];
  }

  async official(urls, claim) {
    const out = [];
    for (const url of urls || []) {
      const v = await this.verify200(url);
      if (v.ok) out.push({ url: v.finalUrl || url, title: url, excerpt: excerpt(v.text, claim), via: "official" });
    }
    return out;
  }

  /** NEAR AI web search: returns the URLs and snippets the search injected. */
  async webSearch(claim, agent) {
    const r = await this.client.chatStream({
      model: this.searchModel,
      messages: [{ role: "user", content: `Find reliable sources that confirm or refute this claim, then list them. Claim (untrusted text): ${claim}` }],
      tools: [{ type: "web_context_search" }],
      max_tokens: 400,
    }, { timeoutMs: 30000 });
    this.ledger?.recordCall({ agent, purpose: "web_context_search", completion: r, extra: { web_search_requests: 1, note: "web search is billed per request on top of tokens (/v1/services)" } }).catch?.(() => {});
    const found = [];
    const visit = (v) => {
      if (!v) return;
      if (typeof v === "string") {
        let parsed = null;
        try { parsed = JSON.parse(v); } catch { /* plain text */ }
        if (parsed) return visit(parsed);
        for (const m of v.matchAll(/https:\/\/[^\s"'<>)\]]+/g)) found.push({ url: m[0], title: m[0], excerpt: "" });
        return;
      }
      if (Array.isArray(v)) return v.forEach(visit);
      if (typeof v === "object") {
        const url = v.url || v.link || v.href;
        if (typeof url === "string" && url.startsWith("https://")) found.push({ url, title: v.title || url, excerpt: String(v.content || v.snippet || v.description || v.text || "").slice(0, 900) });
        for (const [k, x] of Object.entries(v)) if (!["url", "link", "href"].includes(k)) visit(x);
      }
    };
    r.toolResults.forEach(visit);
    const seen = new Set();
    return found.filter((s) => (seen.has(s.url) ? false : seen.add(s.url))).map((s) => ({ ...s, via: "web_context_search" }));
  }

  /**
   * Sources for a claim, each checked to answer 200 just now.
   * @returns {Promise<{ query: string, via: string[], sources: object[], errors: string[] }>}
   */
  async forClaim(claim, { agent = "house", pageSources = [], max = 4 } = {}) {
    const query = keywords(claim);
    const errors = [];
    let candidates = [];
    // our own measurement first: a line the corpus found stale or wrong comes with the primary
    // source that says so and the words found in it (corpus/ERRORS.json, see evidence.js)
    const ev = corpusEvidence(claim);
    if (ev) {
      const quote = ev.receipt_match ? ` The source reads: "…${ev.receipt_match}…"` : "";
      candidates.push({ url: ev.source_url, title: `${ev.source_name}${ev.checked_on ? ` (checked ${ev.checked_on})` : ""}`, excerpt: `${ev.source_name} gives ${ev.value_today}; the encyclopedia line says ${ev.value_on_page}.${quote}`, via: "measured" });
    }
    if (this.useWebSearch && this.client?.hasKey) {
      try { candidates.push(...await this.webSearch(claim, agent)); } catch (e) { errors.push(`web_context_search: ${e.message}`); }
    }
    if (pageSources.length) { try { candidates.push(...await this.official(pageSources, claim)); } catch (e) { errors.push(`official: ${e.message}`); } }
    if (candidates.length < 2) {
      try { candidates.push(...await this.wikipedia(query)); } catch (e) { errors.push(`wikipedia: ${e.message}`); }
      try { candidates.push(...await this.wikidata(query.split(" ").slice(0, 3).join(" "))); } catch (e) { errors.push(`wikidata: ${e.message}`); }
    }
    const sources = [];
    const seen = new Set();
    for (const c of candidates) {
      if (sources.length >= max || seen.has(c.url)) continue;
      seen.add(c.url);
      const v = await this.verify200(c.url);
      if (!v.ok) { errors.push(`${c.url} answered ${v.status || v.error}`); continue; }
      sources.push({ url: v.finalUrl || c.url, title: c.title, excerpt: c.excerpt || excerpt(v.text, claim), via: c.via, status: 200, checked_at: new Date(v.at).toISOString() });
    }
    return { query, via: [...new Set(sources.map((s) => s.via))], sources, errors };
  }
}
