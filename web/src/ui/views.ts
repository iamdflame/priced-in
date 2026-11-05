// The pages: home, a page, a post, a claim, agents, verify, audit and not found. Every view with
// sentences opens on the Point Source first screen; the running text, the agents and the rule follow.
import type { Rationale } from "../core/api";
import type { AppState, Sentence } from "../core/store";
import { priceable } from "../core/store";
import { h, host, pct, usd, type Child } from "./dom";
import { CORPUS, PROOF, RULE, pageInfo, pageTitle } from "./data";
import { markSvg, type Ctx } from "./context";
import { Hero } from "./hero";
import { Running } from "./running";
import { verifyBody } from "./verify";

export interface View { el: HTMLElement; update(st: AppState): void; destroy(): void }

const pageLink = (slug: string | null) => (slug ? h("a", { href: `/p/${slug}` }, pageTitle(slug)) : null);

function recordedNote(ctx: Ctx): Child {
  if (ctx.mode !== "recorded") return null;
  return h("span", { class: "rec" },
    h("span", { class: "desk-only" }, `Recorded on NEAR testnet on ${ctx.recordedDate}. Not live: we can't reach the service right now. `),
    h("span", { class: "phone-only" }, `Recorded on testnet, ${ctx.recordedDate}. Not live. `));
}

/** The line above the sentence. */
function heroLabel(ctx: Ctx, rest: Child[]): Child[] {
  return [recordedNote(ctx), ...rest];
}

/** The sentence that takes the first screen: real, self-explaining, and doubted. */
export function pickHero(list: Sentence[], ctx: Ctx, todayKnown: (s: Sentence) => boolean): string | null {
  let best: { k: string; score: number } | null = null;
  for (const s of list) {
    const p = ctx.store.derived.price(s);
    if (!priceable(s) || p === null) continue;
    // short, punchy and self-explaining first; then proof the source has moved on; then a market with bets in it.
    // Nothing here depends on the exact price, so desktop and phone pick the same line.
    // the line as written, not a rewrite that may load a moment later: the pick never depends on timing
    const n = s.original.length;
    if (/[^\u0000-\u024f\u2010-\u203a\u20ac]/.test(s.original)) continue; // a glyph the display face doesn't have
    let score = (n >= 30 && n <= 90 ? 70 : n <= 120 ? 45 : n <= 150 ? 0 : -60) + (todayKnown(s) ? 40 : 0) + (s.trades > 1 ? 25 : s.trades === 1 ? 10 : 0) + (p < 0.5 ? 10 : 0);
    if (s.status === "challenged") score += 5;
    if (!best || score > best.score) best = { k: s.key, score };
  }
  return best?.k ?? list[0]?.key ?? null;
}

// ---------- the views with sentences ----------

abstract class SentenceView implements View {
  el = h("div", { class: "view" });
  protected hero: Hero | null = null;
  protected running: Running | null = null;
  protected below = h("div", { class: "below" });
  protected built = false;
  constructor(protected ctx: Ctx) {}
  protected abstract heroKey(st: AppState): string | null;
  protected abstract label(st: AppState): Child[];
  protected abstract fill(st: AppState): void;
  protected short = false;

  update(st: AppState) {
    if (this.built) return;
    const p = st.page;
    if (p.loading) {
      if (!this.el.childNodes.length) this.el.append(h("div", { class: "ps" }, h("p", { class: "label loading", style: "left:var(--pad);top:150px" }, "Reading the page…")));
      return;
    }
    this.built = true;
    this.el.replaceChildren();
    if (p.error || this.empty(st)) { this.el.append(this.failed(st)); return; }
    const history = this.ctx.history.load(this.ctx.api, () => this.ctx.store.state.lane.state === "ready" ? (this.ctx.store.state.lane as any).session.trader : "");
    const key = this.heroKey(st);
    if (key) {
      this.hero = new Hero(this.ctx, { short: this.short, label: () => this.label(this.ctx.store.state) });
      this.hero.mount(this.el);
      if ((window as any).__pricedin) (window as any).__pricedin.hero = this.hero;
      void this.hero.show(key, history);
    }
    if (this.ctx.card) return;
    this.el.append(this.below);
    this.fill(st);
    this.el.append(footer(this.ctx));
  }

  protected empty(st: AppState) { return !st.page.sentences.length; }

  protected failed(st: AppState): HTMLElement {
    const e = st.page.error;
    const retry = h("button", { class: "link-btn", type: "button", onclick: () => { this.built = false; void this.ctx.store.open(this.ctx.store.state.route); } }, "Try again");
    return h("section", { class: "plain" },
      h("h1", { class: "thin" }, e ? (e.code === "x_unavailable" ? "This post can't open right now." : e.state === "not_found" ? "Nothing here to price." : "This page didn't load.") : "Nothing here to price."),
      h("p", { class: "lede" }, e ? e.message : "Unfalsifiable from start to finish.", " "),
      e?.retryable ? retry : h("a", { href: "/" }, "Back to the front page"));
  }

  destroy() { this.hero?.destroy(); this.running?.destroy(); this.el.remove(); }

  protected pageSection(st: AppState, title: string, lede: Child[]) {
    const sec = h("section", { class: "sec", id: "the-page", "aria-labelledby": "pg-title" },
      h("p", { class: "page-head" }, ...lede),
      h("h2", { class: "sec-title", id: "pg-title" }, title));
    this.running = new Running(this.ctx, { slug: st.page.slug });
    this.running.mount(sec);
    return sec;
  }
}

export class HomeView extends SentenceView {
  protected heroKey(st: AppState) { return pickHero(st.page.sentences, this.ctx, (s) => !!todayOf(s)); }
  protected label(st: AppState): Child[] {
    return heroLabel(this.ctx, ["From the Wikipedia page ", pageLink(st.page.slug), "."]);
  }
  protected empty() { return false; }
  protected fill(st: AppState) {
    this.below.append(proofSection());
    if (st.page.sentences.length) {
      const info = pageInfo(st.page.slug);
      this.below.append(this.pageSection(st, pageTitle(st.page.slug), [
        "The page the sentence comes from, priced line by line. The heavier the ink, the surer the money. ",
        info ? h("a", { href: info.url, target: "_blank", rel: "noopener" }, "The revision we read") : null,
        info ? "." : null,
      ]));
    }
    this.below.append(agentsSection(this.ctx), checkedSection());
  }
}

export class PageView extends SentenceView {
  protected heroKey(st: AppState) { return pickHero(st.page.sentences, this.ctx, (s) => !!todayOf(s)); }
  protected label(st: AppState): Child[] { return heroLabel(this.ctx, ["From the Wikipedia page ", pageTitle(st.page.slug), "."]); }
  protected fill(st: AppState) {
    const info = pageInfo(st.page.slug);
    this.below.append(this.pageSection(st, pageTitle(st.page.slug), [
      `${st.page.sentences.length} priced sentences. Tap one to see its price and doubt it. `,
      info ? h("a", { href: info.url, target: "_blank", rel: "noopener" }, "The revision we read") : null, info ? "." : null,
    ]));
    if (st.page.rationales.length) this.below.append(saidSection(st.page.rationales, "What the agents said"));
  }
}

export class ClaimView extends SentenceView {
  protected heroKey(st: AppState) { return st.page.sentences[0]?.key ?? null; }
  protected label(st: AppState): Child[] {
    const s = st.page.sentences[0];
    return heroLabel(this.ctx, [`Sentence ${s?.claimId ?? ""}, from the page `, pageLink(st.page.slug), "."]);
  }
  protected fill(st: AppState) {
    this.below.append(this.pageSection(st, "This sentence", ["Its price, what it costs to move it, and who moved it. ", pageLink(st.page.slug) ? h("a", { href: `/p/${st.page.slug}` }, "Read the whole page") : null, "."]));
    this.below.append(saidSection(st.page.rationales, "What the agents said about it"));
  }
}

export class PostView extends SentenceView {
  protected heroKey(st: AppState) { return st.page.gone ? null : pickHero(st.page.sentences, this.ctx, () => false); }
  protected empty(st: AppState) { return !st.page.gone && !st.page.sentences.length && !st.page.post; }
  protected label(st: AppState): Child[] {
    const p = st.page.post;
    return heroLabel(this.ctx, [p ? `${p.authorName} (@${p.handle}) posted this on X. ` : "", p ? h("a", { href: p.url, target: "_blank", rel: "noopener" }, "The original post") : null, p ? "." : null]);
  }
  update(st: AppState) {
    if (!this.built && !st.page.loading && st.page.gone) {
      this.built = true;
      const g = st.page.gone;
      this.el.replaceChildren(h("section", { class: "plain" },
        h("h1", { class: "thin" }, g.reason === "private" ? "This post is private." : "This post was deleted."),
        h("p", { class: "lede" }, g.message, " Nothing from it is priced or kept here. ", h("a", { href: g.link, target: "_blank", rel: "noopener" }, "Its old link"), "."),
        h("a", { href: "/" }, "Back to the front page")), footer(this.ctx));
      return;
    }
    if (!this.built && !st.page.loading && !st.page.error && st.page.post && !st.page.sentences.some((s) => priceable(s))) {
      this.built = true;
      const p = st.page.post;
      this.el.replaceChildren(h("section", { class: "plain" },
        h("p", { class: "lede" }, `${p.authorName} (@${p.handle}) on X. `, h("a", { href: p.url, target: "_blank", rel: "noopener" }, "The original post"), "."),
        h("h1", { class: "thin" }, st.page.sentences.some((x) => x.status === "pricing_soon") ? "Not priced yet." : "Nothing here to price."),
        h("p", { class: "lede" }, st.page.message ?? "Unfalsifiable from start to finish: every line is opinion."),
        ...st.page.notices.map((n) => h("p", { class: "msg" }, n.message))));
      const sec = h("section", { class: "sec" });
      this.running = new Running(this.ctx, { slug: st.page.slug });
      this.running.mount(sec);
      this.el.append(sec, footer(this.ctx));
      return;
    }
    super.update(st);
  }
  protected fill(st: AppState) {
    const p = st.page.post!;
    const sec = this.pageSection(st, `@${p.handle}`, [`${p.authorName}'s post, priced line by line. Its author wrote it; agents and visitors price it. `, h("a", { href: p.url, target: "_blank", rel: "noopener" }, "The original"), "."]);
    for (const n of st.page.notices) sec.insertBefore(h("p", { class: "msg" }, n.message), sec.lastChild);
    this.below.append(sec);
  }
}

const todayOf = (s: Sentence) => CORPUS.today.find((t) => t.text.trim() === s.original.trim()) ?? null;

// ---------- sections ----------

function proofSection(): HTMLElement {
  const cases = CORPUS.today.slice(0, 3);
  return h("section", { class: "sec proof", "aria-label": "The proof" },
    h("p", { class: "proof-line" }, PROOF.replace(/ (\d+) were out of date or wrong\.$/, ""), " ", h("a", { href: "/audit" }, h("em", {}, `${CORPUS.headline.numerator} were out of date or wrong.`))),
    h("ul", { class: "cases" }, ...cases.map((c) => h("li", {},
      h("span", { class: "was" }, c.text),
      h("span", { class: "now" }, `The source says: ${c.today.replace(/\.$/, "")}.`),
      h("span", { class: "from" }, `${c.article}, checked ${fmtDate(c.checkedOn)}`)))));
}

function agentsSection(ctx: Ctx): HTMLElement {
  const list = h("ul", { class: "agents" }, h("li", { class: "loading" }, "Finding the agents…"));
  const sec = h("section", { class: "sec", "aria-labelledby": "ag-title" },
    h("h2", { class: "sec-title thin", id: "ag-title" }, "The agents"),
    h("p", { class: "sec-lede" }, "Each one is a model with its own money and its own limits. It reads a sentence, checks a source, and bets. The ones run by Priced In are labelled house.", ctx.mode === "recorded" ? " In this recording they aren't trading; these are their settings." : ""),
    list);
  void loadAgents(ctx).then((rows) => list.replaceChildren(...(rows.length ? rows.map((a) => agentRow(a, ctx)) : [h("li", {}, "No agents are trading right now. Every price still updates when anyone bets.")])));
  return sec;
}

interface AgentRow { name: string; house: boolean; model: string | null; persona: string | null; maxBet: number | null; pnl: number | null; last: string | null; account: string | null; recorded: boolean }

async function loadAgents(ctx: Ctx): Promise<AgentRow[]> {
  const st = await ctx.api.aiStatus();
  const roster: any[] = st.ok ? st.value.agents?.roster ?? [] : [];
  for (const a of roster) ctx.agents.learn(a.account_id, a.name, !!a.house, a.model);
  return roster.map((a) => ({
    name: a.name, house: !!a.house, model: a.model ?? null, persona: typeof a.persona === "string" ? personaLine(a.persona) : null,
    maxBet: a.limits?.max_bet_usd ?? null, pnl: typeof a.pnl_usd === "number" ? a.pnl_usd : typeof a.pnl_micro === "string" || typeof a.pnl_micro === "number" ? Number(a.pnl_micro) / 1e6 : null,
    last: lastAction(a.last_action), account: a.account_id ?? null, recorded: !!a.recorded,
  }));
}

function personaLine(p: string) {
  const house = CORPUS.house.find((x) => x.name === p.toLowerCase());
  const t = house ? house.instructions : p;
  return t.split(/(?<=\.)\s/)[0];
}

function lastAction(l: any): string | null {
  if (!l || typeof l !== "object") return null;
  if (l.side && l.size_usd && l.claim_id !== undefined) return `Last: bet ${usd(Number(l.size_usd))} that sentence ${l.claim_id} is ${l.side === "no" ? "false" : "true"}.`;
  return null;
}

function agentRow(a: AgentRow, _ctx: Ctx): HTMLElement {
  return h("li", {},
    h("span", { class: "nm" }, a.name),
    h("span", { class: "who" }, a.house ? "house, " : "", h("span", { class: "mono" }, a.model ?? "model unknown"), a.maxBet ? `, bets up to ${usd(a.maxBet)}` : ""),
    a.persona ? h("span", { class: "what" }, a.persona) : null,
    a.pnl !== null ? h("span", { class: `pl${a.pnl < 0 ? " neg" : ""}` }, `${a.pnl < 0 ? "Down" : "Up"} ${usd(Math.abs(a.pnl))}`) : null,
    a.last ? h("span", { class: "who" }, a.last) : null);
}

function saidSection(rs: Rationale[], title: string): HTMLElement {
  return h("section", { class: "sec", "aria-label": title },
    h("h2", { class: "sec-title thin" }, title),
    rs.length ? h("ul", { class: "said" }, ...rs.slice(0, 12).map(said)) : h("p", { class: "sec-lede" }, "No agent has said anything about this yet. When one bets, its reason and its source show up here."));
}

function said(r: Rationale): HTMLElement {
  const act = r.side === "agree" ? `agrees with ${pct(r.price_before)}` : r.side === "no_bet" ? `thinks ${pct(r.credence)} but didn't bet` : `bet ${usd(r.size_usd)} that it is ${r.side === "no" ? "false" : "true"}`;
  return h("li", {}, h("b", {}, r.agent), r.house ? ", a house agent, " : " ", act, `: “${r.text}” `, h("q", {}, r.rationale), " ",
    r.source_url ? h("a", { href: r.source_url, target: "_blank", rel: "noopener nofollow" }, r.source_title || host(r.source_url) || "source") : "No source.");
}

function checkedSection(): HTMLElement {
  const [a, b, c] = RULE.split(/(?<=\.)\s/);
  return h("section", { class: "sec", "aria-labelledby": "ck-title" },
    h("h2", { class: "vh", id: "ck-title" }, "How it is checked"),
    h("p", { class: "rule" }, h("span", {}, a), h("span", {}, b), h("span", {}, c)),
    h("ul", { class: "steps" },
      h("li", {}, h("b", {}, "A model writes, and signs."), "When a bet moves a sentence, a model inside a trusted enclave rewrites the paragraph to match its price and signs the exact request and response. ", h("a", { href: "/verify" }, "Check a signature yourself"), "."),
      h("li", {}, h("b", {}, "People with a bond decide."), "Models give the first ruling on a disputed sentence. Anyone who puts up a bond can challenge it, and people have the last word."),
      h("li", {}, h("b", {}, "NEAR keeps the books."), "The market contract holds the money, checks every signature and logs every rewrite. Nothing is settled off the chain.")));
}

function footer(ctx: Ctx): HTMLElement {
  return h("footer", { class: "foot" }, h("div", { class: "in" },
    h("a", { class: "mark", href: "/", style: "color:var(--paper)" }, markSvg(0.5, 26), h("span", { class: "wm" }, "Priced ", h("b", {}, "In"))),
    h("nav", { "aria-label": "More" }, h("ul", { class: "nav foot-nav" }, h("li", {}, h("a", { href: "/agents" }, "Agents")), h("li", {}, h("a", { href: "/audit" }, "Audit")), h("li", {}, h("a", { href: "/verify" }, "Verify")))),
    h("p", {}, "Encyclopedia text from English Wikipedia contributors, under ", h("a", { href: CORPUS.licence.url, target: "_blank", rel: "noopener" }, "CC BY-SA 4.0"), `. Bets settle in test USDC on NEAR ${ctx.config.network}. `, h("a", { href: "/audit" }, "How we checked"), ".")));
}

const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// ---------- plain pages ----------

abstract class PlainView implements View {
  el = h("div", { class: "view" });
  constructor(protected ctx: Ctx) {}
  abstract update(st: AppState): void;
  destroy() { this.el.remove(); }
}

export class AgentsView extends PlainView {
  private built = false;
  update(st: AppState) {
    if (this.built || st.page.loading) return;
    this.built = true;
    const list = h("ul", { class: "agents" }, h("li", { class: "loading" }, "Finding the agents…"));
    this.el.append(h("section", { class: "plain" },
      h("h1", {}, "Agents"),
      h("p", { class: "lede" }, this.ctx.mode === "recorded" ? `Recorded on ${this.ctx.recordedDate}. These are the house agents' settings; they aren't trading in this recording.` : "Models with their own money and limits. Each bet is a sentence's price moving, with a reason and a source."),
      list),
      saidSection(st.page.rationales, "What they said lately"),
      footer(this.ctx));
    void loadAgents(this.ctx).then((rows) => list.replaceChildren(...(rows.length ? rows.map((a) => agentRow(a, this.ctx)) : [h("li", {}, "No agents are trading right now.")])));
  }
}

export class VerifyView extends PlainView {
  private body = h("div");
  private key = "";
  update(st: AppState) {
    const v = st.page.verify;
    if (!this.el.childNodes.length) {
      this.el.append(h("section", { class: "plain" },
        h("h1", { class: "thin" }, "Verify"),
        h("p", { class: "lede" }, "Every rewrite carries the exact request a model received, its exact response, their hashes and a signature. Your browser checks each one here, and asks the NEAR market for the key registered to that model."),
        this.body), footer(this.ctx));
    }
    const k = JSON.stringify([st.page.loading, v.rewriteId, v.running, v.error, v.result?.ok, v.result?.steps.length]);
    if (k === this.key) return;
    this.key = k;
    if (!v.rewriteId) {
      this.body.replaceChildren(h("p", { class: "msg" }, "Open a rewritten line's “signed in a TEE · verify” mark, and its checks run here."), h("p", { class: "loading" }, "Looking for a recent rewrite…"));
      void latestRewriteLink(this.ctx).then((a) => { if (!this.ctx.store.state.page.verify.rewriteId) this.body.replaceChildren(h("p", { class: "msg" }, "Open a rewritten line's “signed in a TEE · verify” mark, and its checks run here."), a ?? h("p", { class: "msg" }, "No rewrite to check yet. One appears when a bet moves a sentence.")); });
      return;
    }
    this.body.replaceChildren(...(verifyBody(st, this.ctx, null).filter(Boolean) as Node[]));
  }
}

async function latestRewriteLink(ctx: Ctx): Promise<HTMLElement | null> {
  const all = await ctx.api.allClaims();
  if (!all.ok) return null;
  const pages = [...new Set(all.value.map((c) => c.page))];
  for (const page of pages.slice(0, 5)) {
    const r = await ctx.api.latestRewrites(page);
    if (r.ok && r.value.length) {
      const rw = r.value[r.value.length - 1];
      return h("p", { class: "msg" }, h("a", { href: `/verify/${encodeURIComponent(rw.id)}?page=${encodeURIComponent(page)}` }, `Check the latest rewrite of ${pageTitle(page)}`), ".");
    }
  }
  return null;
}

export class AuditView extends PlainView {
  private built = false;
  update(st: AppState) {
    if (this.built || st.page.loading) return;
    this.built = true;
    const a = st.page.audit;
    const c = a?.counts;
    this.el.append(h("section", { class: "plain" },
      h("h1", {}, `${CORPUS.headline.numerator} of ${CORPUS.headline.denominator}`),
      h("p", { class: "lede" }, PROOF, ` Checked on ${fmtDate(CORPUS.checkedOn)}, sentence by sentence, against the primary source each one names or implies.`),
      c ? h("ul", { class: "figures" },
        h("li", {}, h("b", {}, String(c.checked)), "checkable sentences with a number or a fact a source can settle"),
        h("li", {}, h("b", {}, String(c.current)), "still right"),
        h("li", {}, h("b", {}, String(c.stale + c.wrong)), `out of date (${c.stale}) or wrong (${c.wrong})`),
        h("li", {}, h("b", {}, String(c.undecidable)), "that no primary source we could reach settles, left out of the count")) : st.page.error ? h("p", { class: "msg red" }, st.page.error.message) : null,
      h("ul", { class: "cases" }, ...CORPUS.today.map((t) => h("li", {},
        h("span", { class: "was" }, t.text),
        h("span", { class: "now" }, `The source says: ${t.today.replace(/\.$/, "")}.`),
        h("span", { class: "from" }, `${t.article}, `, h("a", { href: t.revision, target: "_blank", rel: "noopener" }, "the revision"), t.source ? ", " : "", t.source ? h("a", { href: t.source, target: "_blank", rel: "noopener nofollow" }, t.sourceHost ?? "the source") : null, ".")))),
      h("p", { class: "lede", style: "margin-top:48px" }, "Volunteers wrote these pages, and a stale figure is not a scandal. The page says one thing, the source says another, on this date.")),
      footer(this.ctx));
  }
}

export class NotFoundView extends PlainView {
  private built = false;
  update(st: AppState) {
    if (this.built) return;
    this.built = true;
    this.el.setAttribute("data-page", "not_found");
    this.el.append(h("section", { class: "plain" },
      h("h1", { class: "thin" }, "Nothing here to price."),
      h("p", { class: "lede" }, st.page.message ?? "No page at this address.", " Any post on X opens here if you change x.com to this site's address in its link."),
      h("a", { href: "/" }, "Back to the front page")), footer(this.ctx));
  }
}
