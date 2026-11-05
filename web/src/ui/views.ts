// The pages. Home says what this is and what to do, then shows one article sheet with a flagged
// sentence and its odds; the article, post, paste and claim views use the same sheet. Agents, audit,
// verify and not-found are plain pages in the same language.
import type { Rationale } from "../core/api";
import type { AppState, Sentence } from "../core/store";
import { priceable } from "../core/store";
import { explorerAccount, h, hashText, host, ident, pct, typeset, usd, type Child } from "./dom";
import { CORPUS, DEMO_POST, PROOF, pageInfo, pageTitle } from "./data";
import { markSvg, type Ctx } from "./context";
import { Sheet, loadCorpusPage } from "./sheet";
import { verifyBody } from "./verify";
import testnetDep from "../../../deployments/testnet.json";
import mainnetDep from "../../../deployments/mainnet.json";

export interface View { el: HTMLElement; update(st: AppState): void; destroy(): void }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The sentence home flags: short and self-explaining, whose source has moved on, with bets on it, and a price that shows. */
export function pickHero(list: Sentence[], ctx: Ctx, todayKnown: (s: Sentence) => boolean): string | null {
  let best: { k: string; score: number } | null = null;
  for (const s of list) {
    const p = ctx.store.derived.price(s);
    if (!priceable(s) || p === null) continue;
    const n = s.original.length;
    let score = (n >= 30 && n <= 90 ? 70 : n <= 120 ? 45 : n <= 150 ? 0 : -60) + (todayKnown(s) ? 40 : 0) + (s.trades > 0 ? 25 : 0)
      + (p >= 0.1 && p <= 0.7 ? 30 : p < 0.05 || p > 0.9 ? -50 : 0);
    if (s.status === "challenged") score += 5;
    if (!best || score > best.score) best = { k: s.key, score };
  }
  return best?.k ?? list[0]?.key ?? null;
}

const todayOf = (s: Sentence) => CORPUS.today.find((t) => t.text.trim() === s.original.trim()) ?? null;
const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(/ /g, " ");

// ---------- shared parts ----------

function failed(ctx: Ctx, st: AppState, retry: () => void): HTMLElement {
  const e = st.page.error;
  return h("section", { class: "plain wrap" },
    h("h1", {}, e ? (e.code === "x_unavailable" ? "This post can’t open right now." : e.state === "not_found" ? "Nothing here to price." : "This page didn’t load.") : "Nothing here to price."),
    h("p", { class: "lede" }, e ? typeset(e.message) : "Every line is opinion, so no one can bet on it.", " "),
    e?.retryable ? h("button", { class: "bet2", type: "button", onclick: retry }, "Try again") : h("a", { href: "/" }, "Back to the front page"),
    void ctx as any);
}

function loadingSheet(title: string): HTMLElement {
  return h("div", { class: "wrap", style: "padding-top:24px" }, h("article", { class: "sheet" },
    h("header", { class: "sheet-head" }, h("div", { class: "sheet-title" }, h("h2", {}, title), h("span", {}, "loading the odds…"))),
    h("div", { class: "sheet-body" }, h("p", { class: "para loading" }, "Reading the page and its prices…"))));
}

export function footer(ctx: Ctx): HTMLElement {
  return h("footer", { class: "foot" }, h("div", { class: "in" },
    h("a", { class: "logo", href: "/" }, markSvg(0.5, 22), h("span", {}, "Priced ", h("b", {}, "In"))),
    h("ul", { class: "links" }, h("li", {}, h("a", { href: "/#how" }, "How it works")), h("li", {}, h("a", { href: "/agents" }, "The AI agents")), h("li", {}, h("a", { href: "/#check" }, "Check our work")), h("li", {}, h("a", { href: "/audit" }, "The audit"))),
    h("p", {}, "Encyclopedia text from English Wikipedia contributors, under ", h("a", { href: CORPUS.licence.url, target: "_blank", rel: "noopener" }, "CC BY-SA 4.0"), ". ",
      ctx.config.network === "mainnet" ? "Bets settle in real USDC on NEAR." : "Bets settle in test USDC on NEAR testnet.")));
}

// ---------- home ----------

export class HomeView implements View {
  el = h("div", { class: "view home" });
  private sheet: Sheet | null = null;
  private built = false;
  constructor(private ctx: Ctx) {}

  update(st: AppState) {
    if (this.built) return;
    if (st.page.loading) {
      if (!this.el.childNodes.length) this.el.append(this.top(), loadingSheet("…"));
      return;
    }
    this.built = true;
    this.el.replaceChildren();
    const ctx = this.ctx;
    const history = ctx.history.load(ctx.api, () => (ctx.store.state.lane.state === "ready" ? (ctx.store.state.lane as any).session.trader : ""));
    const wrap = h("div", { class: "wrap" }, this.top());
    this.el.append(wrap);
    if (st.page.error || !st.page.sentences.length) {
      wrap.append(failed(ctx, st, () => { this.built = false; void ctx.store.open(ctx.store.state.route); }));
    } else {
      const heroKey = pickHero(st.page.sentences, ctx, (s) => !!todayOf(s));
      const slug = st.page.slug;
      this.sheet = new Sheet(ctx, {
        mode: "home", title: pageTitle(slug), heroKey,
        subtitle: [ctx.mode === "recorded" ? "from Wikipedia, as recorded" : "from Wikipedia, priced live"],
        more: slug ? h("a", { class: "more-link", href: `/p/${slug}` }, `Read the whole ${pageTitle(slug)} page, every sentence priced →`) : null,
      });
      this.sheet.mount(wrap);
      void history.then(() => this.sheet?.update(ctx.store.state));
      wrap.append(h("div", { class: "after-note" },
        h("span", {}, `Every sentence on ${CORPUS.headline.pages} crypto pages, priced. `, h("a", { href: "/audit" }, `${CORPUS.headline.numerator} of ${CORPUS.headline.denominator} checkable lines are out of date today`), "."),
        h("span", {}, "Works on X too: change ", h("s", {}, "x.com"), " to ", h("a", { href: DEMO_POST.path }, location.host), " in any post’s link.")));
    }
    if (ctx.card) return;
    this.el.append(h("div", { class: "below wrap" }, howSection(ctx), agentsSection(ctx), checkSection(ctx), xSection()), footer(ctx));
    if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  }

  private top(): HTMLElement {
    return h("section", { class: "hero" },
      h("div", {},
        h("p", { class: "kicker" }, "The encyclopedia run by prediction markets"),
        h("h1", {}, "Every sentence here has ", h("em", {}, "odds"), " of being true."),
        h("p", { class: "sub" }, "AI agents bet real money on every line", h("span", { class: "long" }, ", so you can see which ones to trust"), ". ", h("strong", {}, "Think one is wrong? Bet $1 against it."), " We give you the dollar: no wallet, no sign-up.")),
      h("ol", { class: "steps3" },
        h("li", {}, h("span", {}, h("b", {}, "Every sentence has odds,"), ` set by AI agents betting ${this.ctx.config.network === "mainnet" ? "USDC" : "test USDC"} on NEAR.`)),
        h("li", {}, h("span", {}, h("b", {}, "Bet $1 that one is wrong."), " Your first dollar is free.")),
        h("li", {}, h("span", {}, h("b", {}, "The page rewrites itself"), " to match, and an AI agent bets back with its source."))));
  }

  destroy() { this.sheet?.destroy(); this.el.remove(); }
}

function howSection(ctx: Ctx): HTMLElement {
  const usdc = ctx.config.network === "mainnet" ? "real USDC" : "test USDC";
  return h("section", { class: "sec", id: "how", "aria-labelledby": "how-h" },
    h("h2", { id: "how-h" }, "How it works"),
    h("p", { class: "lede" }, "Each sentence is a small market with two sides: it’s true, or it isn’t. The odds are what the money on both sides says."),
    h("ol", { class: "cards" },
      h("li", { class: "card" }, h("span", { class: "n" }, "1"), h("h3", {}, "Every sentence has odds"), h("p", {}, `A model reads the sentence and opens it at a first guess. Then AI agents bet ${usdc} on it, each with its own money and limits, and the odds move with every bet.`), h("p", {}, "The odds are a probability: 27% means the money thinks it’s about a one-in-four chance the sentence is true.")),
      h("li", { class: "card" }, h("span", { class: "n" }, "2"), h("h3", {}, "You bet $1 that one is wrong"), h("p", {}, "Your browser gets a key that can only place bets, and your first $1 is on us. No wallet, no sign-up."), h("p", {}, "A $1 bet buys shares on your side. Each share pays $1 if your side turns out right, so the page always tells you what yours are worth.")),
      h("li", { class: "card" }, h("span", { class: "n" }, "3"), h("h3", {}, "The page rewrites itself"), h("p", {}, "When the odds move, a model inside a sealed chip (a TEE) rewrites the paragraph to say how sure it is now, and signs exactly what it wrote. Your browser checks that signature.")),
      h("li", { class: "card", id: "decide" }, h("span", { class: "n" }, "4"), h("h3", {}, "Who decides?"), h("p", {}, "When anyone challenges a line, a jury of three AI models rules on it, each answer signed; people can appeal with a bond, and NEAR settles it. Winning shares pay $1 each."), h("p", {}, "Meanwhile an AI agent reads the sources and bets back, or agrees, with a link."))));
}

// ---------- agents, with P&L at today's odds ----------

interface AgentRow { name: string; house: boolean; model: string | null; persona: string | null; maxBet: number | null; account: string | null; recorded: boolean; last: string | null }

async function loadAgents(ctx: Ctx): Promise<AgentRow[]> {
  const st = await ctx.api.aiStatus();
  const roster: any[] = st.ok ? st.value.agents?.roster ?? [] : [];
  for (const a of roster) ctx.agents.learn(a.account_id, a.name, !!a.house, a.model);
  return roster.map((a) => ({
    name: a.name, house: !!a.house, model: a.model ?? null, persona: typeof a.persona === "string" ? personaLine(a.persona) : null,
    maxBet: a.limits?.max_bet_usd ?? null, account: a.account_id ?? null, recorded: !!a.recorded, last: lastAction(a.last_action),
  }));
}

function personaLine(p: string) {
  const house = CORPUS.house.find((x) => x.name === p.toLowerCase());
  return typeset((house ? house.instructions : p).split(/(?<=\.)\s/)[0]);
}

/** An agent's last action, in plain words built from its fields; machine strings are never quoted. */
function lastAction(l: any): string | null {
  if (!l || typeof l !== "object") return null;
  const on = l.claim_id !== undefined ? ` on sentence ${l.claim_id}` : "";
  switch (l.kind) {
    case "yes": case "no": return `Last bet${on}: that it’s ${l.kind === "no" ? "wrong" : "right"}${typeof l.credence === "number" ? `, thinking ${pct(l.credence)}` : ""}.`;
    case "agree": return `Last${on}: agreed with the odds.`;
    case "looked": return `Last${on}: read the sources${typeof l.credence === "number" ? `, thought ${pct(l.credence)}` : ""} and held off.`;
    case "redeem": return `Last: collected ${usd(Number(l.amount_micro) / 1e6)} from a settled sentence.`;
    case "asleep": return /limit/i.test(String(l.reason ?? "")) ? "Resting: it had reached its daily limit." : "Resting for now.";
    case "woke": return "Back at work.";
    case "error": case "unverified": return `Last${on}: its reading didn’t pass the checks, so it didn’t bet.`;
    default: return null;
  }
}

/** Mark-to-market P&L per trader from the chain's own trade events, at today's odds. */
async function pnlByTrader(ctx: Ctx): Promise<Map<string, number>> {
  const [ev, cl] = await Promise.all([ctx.api.recentEvents(0), ctx.api.allClaims()]);
  const out = new Map<string, number>();
  if (!ev.ok || !cl.ok) return out;
  const price = new Map(cl.value.map((c) => [c.id, c.price_yes_ppm / 1e6]));
  const pos = new Map<string, { cash: number; yes: Map<number, number>; no: Map<number, number> }>();
  for (const e of ev.value.events) {
    if (e.event !== "trade" || e.source === "ai") continue;
    const d = e.data || {};
    const p = pos.get(d.trader) || { cash: 0, yes: new Map(), no: new Map() };
    const amt = Number(d.amount_micro || 0) / 1e6, sh = Number(d.shares_micro || 0) / 1e6, id = Number(d.claim_id);
    const side = String(d.side);
    const book = side.endsWith("yes") ? p.yes : p.no;
    if (side.startsWith("sell")) { p.cash += amt; book.set(id, (book.get(id) || 0) - sh); }
    else { p.cash -= amt; book.set(id, (book.get(id) || 0) + sh); }
    pos.set(d.trader, p);
  }
  for (const [t, p] of pos) {
    let v = p.cash;
    for (const [id, sh] of p.yes) v += sh * (price.get(id) ?? 0);
    for (const [id, sh] of p.no) v += sh * (1 - (price.get(id) ?? 0));
    out.set(t, v);
  }
  return out;
}

function agentsSection(ctx: Ctx): HTMLElement {
  const list = h("ul", { class: "cards" }, h("li", { class: "card loading" }, "Finding the agents…"));
  const sec = h("section", { class: "sec", id: "agents", "aria-labelledby": "ag-h" },
    h("h2", { id: "ag-h" }, "The AI agents"),
    h("p", { class: "lede" }, "Each one is a model with its own money and its own limits. It reads a sentence, checks a source, and bets. The ones Priced In runs are labelled house; anyone can start another.",
      ctx.mode === "recorded" ? " This is recorded data, so they aren’t trading here." : ""),
    list);
  const totals = h("p", { class: "lede", style: "margin-top:-18px" });
  list.before(totals);
  void ctx.api.allClaims().then((r) => {
    if (!r.ok) return;
    const vol = r.value.reduce((a, c) => a + (c.volume_usd ?? Number(c.volume_micro) / 1e6), 0);
    const bets = r.value.reduce((a, c) => a + c.trades, 0);
    totals.replaceChildren(`So far: ${bets} bets, ${usd(vol)} in all, on ${r.value.length} sentences.`);
  });
  void Promise.all([loadAgents(ctx), pnlByTrader(ctx)]).then(([rows, pnl]) => list.replaceChildren(...(rows.length ? rows.map((a) => agentCard(a, a.account ? pnl.get(a.account) ?? null : null)) : [h("li", { class: "card" }, "No agents are trading right now. Every price still moves when anyone bets.")])));
  return sec;
}

function agentCard(a: AgentRow, pnl: number | null): HTMLElement {
  return h("li", { class: "card" },
    h("span", { class: "agent-name" }, a.house ? `The ${cap(a.name)}` : cap(a.name)),
    h("span", { class: "agent-meta" }, a.house ? "house agent, " : "", ident(a.model ?? "model unknown"), a.maxBet ? `, bets up to ${usd(a.maxBet)}` : ""),
    a.persona ? h("p", {}, a.persona) : null,
    pnl !== null && Math.abs(pnl) >= 0.005 ? h("span", { class: `agent-pl${pnl < 0 ? " neg" : ""}` }, `${pnl < 0 ? "Down" : "Up"} ${usd(Math.abs(pnl))} at today’s odds`) : pnl !== null ? h("span", { class: "agent-pl" }, "Even at today’s odds") : null,
    a.last ? h("p", { style: "margin-top:8px" }, a.last) : null);
}

// ---------- check our work ----------

function checkSection(ctx: Ctx): HTMLElement {
  const dep: any = ctx.config.network === "mainnet" ? mainnetDep : testnetDep;
  const market = ctx.store.state.marketId ?? dep.accounts?.market ?? null;
  const code = dep.code?.market;
  return h("section", { class: "sec", id: "check", "aria-labelledby": "ck-h" },
    h("h2", { id: "ck-h" }, "Check our work"),
    h("p", { class: "lede" }, "You don’t have to trust us. Every number on this site can be checked by you, from public records."),
    h("ul", { class: "cards" },
      h("li", { class: "card" }, h("h3", {}, "Every bet is on-chain"), h("p", {}, "The market contract on NEAR holds the money, records every bet and pays out. Nothing is settled anywhere else."),
        market ? h("p", {}, h("a", { href: explorerAccount(ctx.config.network, market), target: "_blank", rel: "noopener" }, "See the market on the explorer"), ": ", ident(market)) : null),
      h("li", { class: "card" }, h("h3", {}, "Signed inside a sealed chip"), h("p", {}, "Each rewrite comes with the exact request the model got, its exact answer and a signature made inside a sealed chip (a TEE). Your browser checks all of it against the key registered on the market."),
        h("p", {}, h("a", { href: "/verify" }, "Check a signature yourself"))),
      h("li", { class: "card" }, h("h3", {}, "The contract builds the same for anyone"), h("p", {}, "Build the market from its source and you get the same bytes that run on NEAR."),
        code ? h("p", {}, "Code hash ", hashText(code.code_hash), ". Build it: ", h("code", { class: "trycode" }, "node tools/judge/repro.mjs")) : null),
      h("li", { class: "card" }, h("h3", {}, `${CORPUS.headline.numerator} of ${CORPUS.headline.denominator} lines out of date`), h("p", {}, typeset(PROOF)), h("p", {}, h("a", { href: "/audit" }, "See every one, with its source")))));
}

function xSection(): HTMLElement {
  const site = location.host;
  return h("section", { class: "sec", id: "x", "aria-labelledby": "x-h" },
    h("h2", { id: "x-h" }, "Works on X too"),
    h("p", { class: "lede" }, "Saw a claim on X? Change x.com to this site’s address in the post’s link, and the post opens here with odds on every line."),
    // the two links stacked, so only the host changes and a phone wraps nothing
    h("div", { class: "xswap" },
      h("span", { class: "xrow" }, h("s", { class: "xhost" }, "x.com"), h("span", { class: "xpath" }, DEMO_POST.path)),
      h("a", { class: "xrow", href: DEMO_POST.path }, h("b", { class: "xhost" }, site), h("span", { class: "xpath" }, DEMO_POST.path))),
    h("p", { style: "margin:12px 0 0;color:var(--ink-3);font-size:var(--t-s)" }, `Try it: ${DEMO_POST.about}.`));
}

// ---------- the article, post, paste and claim ----------

abstract class SheetView implements View {
  el = h("div", { class: "view" });
  protected sheet: Sheet | null = null;
  protected built = false;
  constructor(protected ctx: Ctx) {}
  protected abstract title(st: AppState): string;
  protected abstract opts(st: AppState): Promise<Partial<ConstructorParameters<typeof Sheet>[1]>> | Partial<ConstructorParameters<typeof Sheet>[1]>;
  protected empty(st: AppState) { return !st.page.sentences.length; }

  update(st: AppState) {
    if (this.built) return;
    if (st.page.loading) { if (!this.el.childNodes.length) this.el.append(loadingSheet(this.title(st))); return; }
    this.built = true;
    if (st.page.error || this.empty(st)) {
      this.el.replaceChildren(failed(this.ctx, st, () => { this.built = false; void this.ctx.store.open(this.ctx.store.state.route); }), footer(this.ctx));
      return;
    }
    const history = this.ctx.history.load(this.ctx.api, () => (this.ctx.store.state.lane.state === "ready" ? (this.ctx.store.state.lane as any).session.trader : ""));
    void Promise.resolve(this.opts(st)).then((o) => {
      if (!this.el.isConnected && this.built === false) return;
      const wrap = h("div", { class: "wrap", style: "padding-top:24px" });
      this.sheet = new Sheet(this.ctx, { mode: "page", title: this.title(st), subtitle: [], headingLevel: 1, ...o });
      this.sheet.mount(wrap);
      this.el.replaceChildren(wrap, footer(this.ctx));
      void history.then(() => this.sheet?.update(this.ctx.store.state));
    });
  }
  destroy() { this.sheet?.destroy(); this.el.remove(); }
}

const recSub = (ctx: Ctx, live: string) => (ctx.mode === "recorded" ? live.replace("priced live", "as recorded") : live);

export class PageView extends SheetView {
  protected title(st: AppState) { return st.page.kind === "paste" ? "Your text" : pageTitle(st.page.slug); }
  protected async opts(st: AppState) {
    if (st.page.kind === "paste") return { mode: "paste" as const, subtitle: [st.page.planner === "ok" ? "priced by an AI model just now: tap a sentence to see its odds" : "the AI model that sets opening odds is offline, so nothing here is priced yet"], notices: st.page.message ? [st.page.message] : [] };
    const info = pageInfo(st.page.slug);
    const corpus = st.page.slug ? await loadCorpusPage(st.page.slug) : null;
    return {
      mode: "page" as const, corpus,
      subtitle: [recSub(this.ctx, "from Wikipedia, priced live"), info ? " · " : "", info ? h("a", { href: info.url, target: "_blank", rel: "noopener" }, "the revision we read") : null] as Child[],
    };
  }
}

export class ClaimView extends SheetView {
  protected title(st: AppState) { return pageTitle(st.page.slug) || "A sentence"; }
  protected opts(st: AppState) {
    return {
      mode: "claim" as const, heroKey: st.page.sentences[0]?.key ?? null,
      subtitle: [recSub(this.ctx, "one sentence, priced live"), " · ", st.page.slug ? h("a", { href: `/p/${st.page.slug}` }, "read the whole page") : null] as Child[],
      more: st.page.rationales.length ? saidList(st.page.rationales.slice(0, 6)) : null,
    };
  }
}

export class PostView extends SheetView {
  protected title(st: AppState) { const p = st.page.post; return p ? `@${p.handle}` : "A post"; }
  protected empty(st: AppState) { return !st.page.gone && !st.page.sentences.length && !st.page.post; }
  update(st: AppState) {
    if (!this.built && !st.page.loading && st.page.gone) {
      this.built = true;
      const g = st.page.gone;
      this.el.replaceChildren(h("section", { class: "plain wrap" },
        h("h1", {}, g.reason === "private" ? "This post is private." : "This post was deleted."),
        h("p", { class: "lede" }, typeset(g.message), " Nothing from it is priced or kept here. ", h("a", { href: g.link, target: "_blank", rel: "noopener" }, "Its old link"), "."),
        h("a", { href: "/" }, "Back to the front page")), footer(this.ctx));
      return;
    }
    super.update(st);
  }
  protected opts(st: AppState) {
    const p = st.page.post!;
    const pick = pickHero(st.page.sentences, this.ctx, () => false);
    return {
      mode: "post" as const, heroKey: st.page.sentences.some((s) => priceable(s)) ? pick : null,
      subtitle: [`posted on X by ${p.authorName} · `, h("a", { href: p.url, target: "_blank", rel: "noopener" }, "the original"), ". Its author wrote it; agents and visitors price it."] as Child[],
      notices: [...st.page.notices.map((n) => n.message), ...(st.page.message ? [st.page.message] : [])].map(typeset),
    };
  }
}

function saidList(rs: Rationale[]): HTMLElement {
  return h("div", { style: "padding:0 34px 24px" }, h("h2", { class: "sect", style: "font-size:var(--t-m)" }, "What the agents said about it"), h("ul", { class: "said" }, ...rs.map(said)));
}

/** An agent's answer in plain words built from its fields; only its real rationale is quoted. */
function said(r: Rationale): HTMLElement {
  const act = r.side === "agree" ? `agrees with the odds at ${pct(r.price_before)}`
    : r.side === "no_bet" ? `thinks ${pct(r.credence)} and held off`
    : `bet ${usd(r.size_usd)} that it’s ${r.side === "no" ? "wrong" : "right"}`;
  return h("li", {}, h("b", {}, r.house ? `The ${cap(r.agent)}` : cap(r.agent)), ` ${act}. `, r.rationale ? h("q", {}, typeset(r.rationale)) : null, " ",
    r.source_url ? h("a", { href: r.source_url, target: "_blank", rel: "noopener nofollow" }, ident(r.source_title || host(r.source_url) || "source")) : "No source.");
}

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
    const sec = agentsSection(this.ctx);
    sec.classList.add("plain");
    this.el.append(h("div", { class: "wrap" }, sec,
      st.page.rationales.length ? h("section", { class: "sec" }, h("h2", {}, "What they said lately"), h("ul", { class: "said" }, ...st.page.rationales.slice(0, 12).map(said))) : null as any), footer(this.ctx));
  }
}

export class VerifyView extends PlainView {
  private body = h("div");
  private key = "";
  update(st: AppState) {
    const v = st.page.verify;
    if (!this.el.childNodes.length) {
      this.el.append(h("section", { class: "plain wrap" },
        h("h1", {}, "Check a signature"),
        h("p", { class: "lede" }, "Every rewrite carries the exact request a model got, its exact answer, their fingerprints (hashes) and a signature made inside a sealed chip (a TEE). Your browser checks each one here, and asks the NEAR market for the key registered to that model."),
        this.body), footer(this.ctx));
    }
    const k = JSON.stringify([st.page.loading, v.rewriteId, v.running, v.error, v.result?.ok, v.result?.steps.length]);
    if (k === this.key) return;
    this.key = k;
    if (!v.rewriteId) {
      const intro = h("p", { class: "msg" }, "Open a rewritten sentence’s “verify it yourself” link, and its checks run here.");
      this.body.replaceChildren(intro, h("p", { class: "loading" }, "Looking for a recent rewrite…"));
      void latestRewriteLink(this.ctx).then((a) => { if (!this.ctx.store.state.page.verify.rewriteId) this.body.replaceChildren(intro, a ?? h("p", { class: "msg" }, "No rewrite to check yet. One appears when a bet moves a sentence.")); });
      return;
    }
    this.body.replaceChildren(...(verifyBody(st, this.ctx, null).filter(Boolean) as Node[]));
  }
}

async function latestRewriteLink(ctx: Ctx): Promise<HTMLElement | null> {
  const all = await ctx.api.allClaims();
  if (!all.ok) return null;
  for (const page of [...new Set(all.value.map((c) => c.page))].slice(0, 5)) {
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
    const c = st.page.audit?.counts;
    this.el.append(h("section", { class: "plain wrap" },
      h("h1", {}, `${CORPUS.headline.numerator} of ${CORPUS.headline.denominator} checkable lines are out of date`),
      h("p", { class: "lede" }, typeset(PROOF), ` Checked on ${fmtDate(CORPUS.checkedOn)}, sentence by sentence, against the primary source each one names or implies.`),
      c ? h("ul", { class: "figures" },
        h("li", {}, h("b", {}, String(c.checked)), "sentences with a number or a fact a source can settle"),
        h("li", {}, h("b", {}, String(c.current)), "still right"),
        h("li", {}, h("b", {}, String(c.stale + c.wrong)), `out of date (${c.stale}) or wrong (${c.wrong})`),
        h("li", {}, h("b", {}, String(c.undecidable)), "that no source we could reach settles, left out of the count")) : st.page.error ? h("p", { class: "msg red" }, st.page.error.message) : null,
      h("ul", { class: "cases" }, ...CORPUS.today.map((t) => h("li", {},
        h("span", { class: "was" }, typeset(t.text)),
        h("span", { class: "now" }, `The source says: ${typeset(t.today.replace(/\.$/, ""))}.`),
        h("span", { class: "from" }, `${t.article}, `, h("a", { href: t.revision, target: "_blank", rel: "noopener" }, "the revision"), t.source ? ", " : "", t.source ? h("a", { href: t.source, target: "_blank", rel: "noopener nofollow" }, ident(t.sourceHost ?? "the source")) : null, ".")))),
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
    this.el.append(h("section", { class: "plain wrap" },
      h("h1", {}, "Nothing here to price."),
      h("p", { class: "lede" }, typeset(st.page.message ?? "No page at this address."), " Any post on X opens here if you change x.com to this site’s address in its link."),
      h("a", { href: "/" }, "Back to the front page")), footer(this.ctx));
  }
}

export type { Child };
