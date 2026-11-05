// The article sheet: a page of sentences, each followed by its odds; the callout that opens under the
// chosen sentence's paragraph (the odds, a plain reason, the two $1 bets); and, once a bet is placed,
// the four-step story wired to the store's doubt machine.
import type { AppState, Sentence } from "../core/store";
import { priceable } from "../core/store";
import { explorerTx, h, host, ident, nodes, onFrame, pct, reducedMotion, typeset, usd, wordDiff, type Child } from "./dom";
import { runningInk } from "./type/ink";
import { todayFor, sectionOf } from "./data";
import type { Ctx, Trade } from "./context";

export type SheetMode = "home" | "page" | "post" | "paste" | "claim";

interface Item { kind: "priced"; key: string }
interface Plain { kind: "plain"; text: string; grey: boolean; reason: string | null; priceable: boolean }
type Entry = Item | Plain;
interface Para { heading: string | null; entries: Entry[] }

export interface SheetOpts {
  mode: SheetMode;
  title: string;
  headingLevel?: 1 | 2;
  subtitle: Child[];
  /** the sentence the home page flags and opens */
  heroKey?: string | null;
  /** the whole article, from the corpus, for /p/<slug> */
  corpus?: { section: string; text: string; cls: string }[] | null;
  notices?: string[];
  more?: Child;
}

const SIDE_WORD = { no: "wrong", yes: "right" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const norm = (t: string) => t.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
const money = (x: number) => (Math.abs(x - Math.round(x)) < 0.005 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`);

/** "Only a 27% chance this is true." and its siblings: the headline agrees with the big number. */
export function oddsHeadline(p: number): string {
  const n = Math.round(p * 100);
  if (p < 0.4) return `Only a ${n}% chance this is true.`;
  if (p <= 0.6) return `A coin flip: ${n}% chance this is true.`;
  return `${n}% chance this is true.`;
}

/** An agent or trader, named for a reader. */
export function who(trader: string, ctx: Ctx, mine = false): string {
  if (mine) return "You";
  const a = ctx.agents.of(trader);
  if (a) return a.house ? `The ${cap(a.name)}, an AI agent,` : `${cap(a.name)}, an AI agent,`;
  if (trader.startsWith("lane:")) return "A visitor";
  return "A trader";
}

let roster: Promise<{ n: number; house: string | null }> | null = null;
/** How many AI agents trade, and a house agent's name for "is reading the sources". */
export function agentRoster(ctx: Ctx) {
  if (!roster) {
    roster = ctx.api.aiStatus().then((r) => {
      const list: any[] = r.ok ? r.value.agents?.roster ?? [] : [];
      for (const a of list) ctx.agents.learn(a.account_id, a.name, !!a.house, a.model);
      const house = list.find((a) => a.house && /archivist/i.test(a.name)) ?? list.find((a) => a.house);
      return { n: list.length, house: house ? cap(house.name) : null };
    });
  }
  return roster;
}

export class Sheet {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private statsEl = h("p", { class: "stats" });
  private body = h("div", { class: "sheet-body" });
  private open: string | null;
  private keys = "";
  private rows = new Map<string, { span: HTMLElement; text: HTMLElement; chip: HTMLButtonElement; mark: HTMLElement; para: HTMLElement; shown: string; p: number | null }>();
  private slot = h("div", { class: "slot" });
  private slotKey = "";
  private before = new Map<string, string>(); // the words a sentence had when the visitor bet
  private verified = new Set<string>();
  private unsub: (() => void) | null = null;
  private houseName: string | null = null;
  private agentsN: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  constructor(private ctx: Ctx, private o: SheetOpts) {
    this.open = o.heroKey ?? null;
    const H = o.headingLevel === 1 ? "h1" : "h2";
    this.head = h("header", { class: "sheet-head" },
      h("div", { class: "sheet-title" }, h(H, {}, o.title), h("span", {}, ...nodes(o.subtitle))),
      this.statsEl);
    this.el = h("article", { class: `sheet ${o.mode}`, id: "sheet", "aria-label": o.title }, this.head, ...(o.notices ?? []).map((n) => h("p", { class: "notice" }, n)), this.body);
    if (o.more) this.el.append(h("div", {}, o.more));
    void agentRoster(ctx).then((r) => { this.houseName = r.house; this.agentsN = r.n; this.renderStats(this.ctx.store.state); this.slotKey = ""; this.renderSlot(this.ctx.store.state); });
  }

  mount(parent: HTMLElement) {
    parent.append(this.el);
    this.unsub = onFrame(this.ctx.store, (st) => this.update(st));
    this.update(this.ctx.store.state);
    // waiting lines say more after a while: re-render the story once a second while a step waits
    this.tick = setInterval(() => { if (!this.el.isConnected) { clearInterval(this.tick!); return; } if (this.ctx.store.state.doubt.ctx?.key === this.open) { this.slotKey = ""; this.renderSlot(this.ctx.store.state); } }, 1000);
  }

  destroy() { this.unsub?.(); if (this.tick) clearInterval(this.tick); this.el.remove(); }

  // ---------- structure ----------

  private paragraphs(st: AppState): Para[] {
    const list = st.page.sentences;
    const slug = st.page.slug;
    if (this.o.mode === "home") {
      const i = list.findIndex((s) => s.key === this.o.heroKey);
      if (i < 0) return [{ heading: null, entries: list.slice(0, 4).map((s) => ({ kind: "priced", key: s.key })) }];
      const sec = sectionOf(slug, list[i].original);
      const lead = list.slice(0, i).filter((s) => priceable(s) && (!sec || sectionOf(slug, s.original) === sec)).slice(-3);
      return [{ heading: null, entries: [...lead.map((s) => ({ kind: "priced" as const, key: s.key })), { kind: "priced", key: list[i].key }] }];
    }
    if (this.o.mode === "page" && this.o.corpus?.length) {
      const byText = new Map(list.map((s) => [norm(s.original), s]));
      const used = new Set<string>();
      const paras: Para[] = [];
      for (const c of this.o.corpus) {
        const heading = c.section === "(lead)" ? null : c.section.split(" / ").pop()!;
        let last = paras[paras.length - 1];
        if (!last || last.heading !== heading) { last = { heading, entries: [] }; paras.push(last); }
        const s = byText.get(norm(c.text));
        if (s) { used.add(s.key); last.entries.push({ kind: "priced", key: s.key }); }
        else last.entries.push({ kind: "plain", text: c.text, grey: c.cls === "opinion", reason: c.cls === "opinion" ? "Opinion: nothing a source can settle, so it isn’t priced." : null, priceable: c.cls !== "opinion" });
      }
      const rest = list.filter((s) => !used.has(s.key));
      if (rest.length) paras.push({ heading: "Also priced on this page", entries: rest.map((s) => ({ kind: "priced", key: s.key })) });
      return paras;
    }
    const entries: Entry[] = list.map((s) => (priceable(s) || s.status === "settled"
      ? { kind: "priced", key: s.key }
      : { kind: "plain", text: s.text, grey: true, reason: greyWhy(s), priceable: false }));
    // a post or a paste reads line by line; other lists in runs of four sentences
    const per = this.o.mode === "post" || this.o.mode === "paste" ? 1 : 4;
    const paras: Para[] = [];
    for (let i = 0; i < entries.length; i += per) paras.push({ heading: null, entries: entries.slice(i, i + per) });
    return paras;
  }

  private build(st: AppState) {
    this.body.replaceChildren();
    this.rows.clear();
    const paras = this.paragraphs(st);
    if (!paras.some((p) => p.entries.length)) {
      this.body.append(h("p", { class: "para" }, "Nothing here to price: every line is opinion, so no one can bet on it."));
      return;
    }
    for (const p of paras) {
      if (p.heading) this.body.append(h("span", { class: "sect" }, typeset(p.heading)));
      const para = h("p", { class: "para" });
      p.entries.forEach((e, i) => {
        if (i) para.append(" ");
        if (e.kind === "plain") { para.append(this.plain(e)); return; }
        const s = st.page.sentences.find((x) => x.key === e.key)!;
        const lead = this.o.mode === "home" && e.key !== this.o.heroKey;
        const text = h("span", { class: "t" });
        const span = h("span", { class: `s${lead ? " lead" : ""}`, "data-sentence": s.key, "data-claim": s.claimId ?? "", tabindex: "0", role: "button", "aria-expanded": "false" }, text);
        const chip = h("button", { class: `odds${lead ? " lead" : ""}`, type: "button", "data-chip-for": s.key }) as HTMLButtonElement;
        const mark = h("span", { class: lead ? "lead" : "" });
        const act = (ev: Event) => { ev.preventDefault(); this.toggle(s.key); };
        span.addEventListener("click", act);
        span.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") act(ev); });
        chip.addEventListener("click", act);
        para.append(span, chip, mark);
        this.rows.set(s.key, { span, text, chip, mark, para, shown: "", p: null });
      });
      this.body.append(para);
    }
  }

  private plain(e: Plain): HTMLElement {
    const span = h("span", { class: `s plain${e.grey ? " grey" : ""}`, title: e.reason ?? undefined }, typeset(e.text));
    // on a post or a paste, a grey line says why in plain words; an article's many opinion lines keep it to a tooltip
    if (e.grey && e.reason && this.o.mode !== "page") return h("span", {}, span, " ", h("span", { class: "greywhy" }, `(${e.reason})`));
    if (!e.priceable || this.ctx.mode === "recorded") return span;
    const btn = h("button", { class: "priceit", type: "button", "aria-label": `Price this sentence: ${e.text.slice(0, 60)}` }, "price it");
    btn.addEventListener("click", () => { btn.textContent = "pricing…"; void this.ctx.store.paste(e.text); });
    return h("span", {}, span, btn);
  }

  // ---------- updates ----------

  update(st: AppState) {
    const keys = st.page.sentences.map((s) => s.key).join(",") + `|${this.o.corpus?.length ?? 0}`;
    if (keys !== this.keys) { this.keys = keys; this.build(st); this.slotKey = ""; }
    const d = st.doubt;
    for (const [key, r] of this.rows) {
      const s = st.page.sentences.find((x) => x.key === key);
      if (!s) continue;
      const p = this.ctx.store.derived.price(s);
      const words = this.display(s, st);
      if (words !== r.shown) { r.shown = words; r.text.replaceChildren(typeset(words)); }
      r.span.classList.toggle("on", this.open === key);
      r.span.classList.toggle("flag", this.o.mode === "home" && key === this.o.heroKey);
      r.span.setAttribute("aria-expanded", String(this.open === key));
      r.span.setAttribute("data-price", p === null ? "" : String(p));
      r.span.setAttribute("data-status", s.status);
      // the quiet second signal: the ink follows the price on the GRAD axis, so nothing reflows
      r.span.style.fontVariationSettings = runningInk(p, 14);
      if (p !== r.p || r.chip.dataset.st !== s.status) {
        r.p = p;
        r.chip.dataset.st = s.status;
        if (s.status === "settled") {
          r.chip.className = "odds settled";
          r.chip.replaceChildren(s.outcome ? "true ✓" : "false");
          r.chip.setAttribute("aria-label", `Settled ${s.outcome ? "true" : "false"}`);
        } else {
          const n = p === null ? null : Math.round(p * 100);
          r.chip.className = `odds${p !== null && p < 0.4 ? " low" : ""}${r.chip.classList.contains("lead") ? " lead" : ""}`;
          r.chip.style.setProperty("--p", `${n ?? 0}%`);
          r.chip.replaceChildren(n === null ? "?" : `${n}%`, h("i"));
          r.chip.setAttribute("aria-label", n === null ? "Not priced yet" : `${n}% chance this is true. Show the odds and bet`);
        }
      }
      const rw = s.rewrite;
      const mk = rw?.signed && words === s.text && s.text !== s.original ? rw.id : "";
      if (r.mark.dataset.k !== mk) {
        r.mark.dataset.k = mk;
        r.mark.replaceChildren();
        if (mk && st.page.slug) {
          const page = st.page.slug;
          const b = h("button", { class: "priceit", type: "button", title: "The page rewrote this sentence to match its odds" }, "rewritten ✓");
          b.addEventListener("click", () => this.ctx.openVerify(page, rw!.id, b));
          r.mark.append(b);
        }
      }
    }
    this.renderStats(st);
    this.renderSlot(st);
    void d;
  }

  /** The words a sentence shows: as written, unless a signed rewrite replaced them or the visitor's bet did. */
  private display(s: Sentence, st: AppState): string {
    const d = st.doubt;
    const mine = d.ctx?.key === s.key && (d.stage === "rewritten" || d.stage === "answered");
    if (mine) return d.ctx!.rewrite?.sentences.find((x) => x.claim_id === s.claimId)?.text ?? s.text;
    if (s.rewrite?.signed && this.o.mode !== "home") return s.text;
    return s.original;
  }

  private statsKey = "";
  private renderStats(st: AppState) {
    const list = st.page.sentences;
    const priced = list.filter((s) => priceable(s) || s.status === "settled").length;
    let last: Trade | null = null;
    for (const s of list) { const t = this.ctx.history.of(s.claimId)[0]; if (t && (!last || t.at > last.at)) last = t; }
    const ago = last ? agoWords(last.at) : null;
    const k = `${priced}|${this.agentsN}|${last?.txHash}|${ago}`;
    if (k === this.statsKey) return;
    this.statsKey = k;
    this.statsEl.replaceChildren(
      h("span", {}, h("b", {}, String(priced)), ` ${priced === 1 ? "sentence" : "sentences"} priced`),
      this.agentsN ? h("span", { class: "agents-stat" }, h("b", {}, String(this.agentsN)), ` AI ${this.agentsN === 1 ? "agent" : "agents"} trading`) : null as any,
      last && ago ? h("span", {}, "last bet ", h("b", {}, ago), " ", last.txHash ? h("a", { href: explorerTx(this.ctx.config.network, last.txHash), target: "_blank", rel: "noopener", "aria-label": "See the latest bet on the explorer", class: "tx" }, "↗") : null) : null as any,
    );
    for (const c of [...this.statsEl.childNodes]) if (!(c as HTMLElement).tagName) c.remove();
  }

  private toggle(key: string) {
    if (this.o.mode !== "home" && this.open === key && this.ctx.store.state.doubt.ctx?.key !== key) this.open = null;
    else this.open = key;
    this.ctx.store.select(this.open);
    this.slotKey = "";
    this.update(this.ctx.store.state);
    const r = this.open ? this.rows.get(this.open) : null;
    (r ? this.slot.querySelector<HTMLElement>("[data-bet='no']") : null)?.focus({ preventScroll: true });
    if (r) this.slot.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
  }

  // ---------- the callout and the story ----------

  private renderSlot(st: AppState) {
    const key = this.open;
    const r = key ? this.rows.get(key) : null;
    const s = key ? st.page.sentences.find((x) => x.key === key) : null;
    if (!r || !s) { if (this.slot.isConnected) this.slot.remove(); this.slotKey = ""; return; }
    if (this.slot.previousElementSibling !== r.para) r.para.after(this.slot);
    const d = st.doubt;
    const story = d.ctx?.key === key && d.stage !== "idle";
    const sk = JSON.stringify(story ? this.storyKey(st, s) : ["c", s.key, this.ctx.store.derived.price(s), s.status, this.ctx.history.of(s.claimId)[0]?.txHash ?? null, this.ctx.history.count(s.claimId).n, s.trades]);
    if (sk === this.slotKey) return;
    const focused = this.slot.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focus ?? null : null;
    this.slotKey = sk;
    this.slot.replaceChildren(story ? this.story(st, s) : this.callout(st, s));
    if (focused) this.slot.querySelector<HTMLElement>(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
  }

  private reason(s: Sentence): Child[] {
    const t = this.ctx.history.of(s.claimId)[0];
    const today = todayFor(s.original);
    const tail: Child[] = today ? [h("span", { class: "more" }, ", and ", today.source ? h("a", { href: today.source, target: "_blank", rel: "noopener nofollow" }, "the source") : "the source", ` now says ${typeset(today.today.replace(/\.$/, ""))}`)] : [];
    if (t) {
      const side = t.side === "no" || t.side === "sell_yes" ? (today ? "out of date" : "wrong") : "right";
      const verb = t.side.startsWith("sell") ? `sold ${money(t.amountUsd)} of “${t.side === "sell_yes" ? "right" : "wrong"}” shares` : `bet ${money(t.amountUsd)} that it’s ${side}`;
      return [`${who(t.trader, this.ctx, t.mine)} ${verb}`, ...tail, "."];
    }
    if (s.trades > 0) return [`${s.trades} ${s.trades === 1 ? "bet has" : "bets have"} set these odds`, ...tail, "."];
    if (s.status === "unopened") return ["No one has bet yet; the opening odds are an AI model’s first read", ...tail, "."];
    return ["No one has bet yet; the opening odds are an AI model’s first read", ...tail, "."];
  }

  private callout(st: AppState, s: Sentence): HTMLElement {
    const p = this.ctx.store.derived.price(s);
    if (s.status === "settled") {
      return h("div", { class: "callout closed high", "data-callout": s.key },
        h("div", { class: "big" }, s.outcome ? "✓" : "✗"),
        h("div", { class: "why" }, h("b", {}, `Settled ${s.outcome ? "true" : "false"}.`), s.reason ?? "The market has ruled; no more bets on this line."));
    }
    if (!priceable(s) || p === null) {
      return h("div", { class: "callout closed high", "data-callout": s.key }, h("div", { class: "big" }, "–"), h("div", { class: "why" }, h("b", {}, "Not priced."), s.reason ?? "Nothing a source can settle."));
    }
    const busy = st.doubt.stage === "quoting" || st.doubt.stage === "signing" || st.doubt.stage === "optimistic";
    const no = h("button", { class: "bet", type: "button", "data-bet": "no", "data-focus": "no", "aria-disabled": busy ? "true" : "false" }, "Bet $1 it’s wrong ", h("span", {}, "· free"));
    const yes = h("button", { class: "bet2", type: "button", "data-bet": "yes", "data-focus": "yes", "aria-disabled": busy ? "true" : "false" }, "No, it’s right: bet $1 for it · free");
    // what a $1 wins, from the contract's own pricing (the shares $1 buys, each paying $1)
    const win = (side: "yes" | "no") => { const q = this.ctx.store.derived.quote(s, side); return q && !q.overflow && q.shares > 0 ? q.shares : null; };
    const wNo = win("no"), wYes = win("yes");
    no.addEventListener("click", () => this.bet(s, "no"));
    yes.addEventListener("click", () => this.bet(s, "yes"));
    const fine = this.ctx.mode === "recorded"
      ? "This is recorded data: a bet here is a rehearsal, and nothing is sent."
      : this.ctx.config.network === "mainnet"
        ? "We give every visitor one free $1 bet in real USDC on NEAR, for either button. Win, and you can withdraw it to any NEAR wallet."
        : "We give every visitor one free $1 bet in test USDC on NEAR testnet, for either button. Win, and you can withdraw it to any NEAR testnet wallet.";
    return h("div", { class: `callout${p >= 0.6 ? " high" : ""}`, "data-callout": s.key },
      h("div", { class: "why" }, h("p", { class: "headline" }, oddsHeadline(p)), h("p", {}, ...nodes(this.reason(s))),
        h("p", { class: "who-decides" }, h("a", { href: "/#decide" }, "Who decides?"))),
      h("div", { class: "acts" },
        no, wNo ? h("p", { class: "wins" }, `If it’s ruled wrong, you win ${usd(wNo)}. If not, you lose the free dollar.`) : null,
        yes, wYes ? h("p", { class: "wins" }, `If it’s ruled right, you win ${usd(wYes)}.`) : null,
        h("p", { class: "fine" }, fine)));
  }

  private bet(s: Sentence, side: "yes" | "no") {
    const st = this.ctx.store.state;
    if (st.doubt.stage === "quoting" || st.doubt.stage === "signing" || st.doubt.stage === "optimistic") return;
    this.before.set(s.key, this.display(s, st));
    if (st.doubt.stage !== "idle") this.ctx.store.resetDoubt();
    void this.ctx.store.doubt(s.key, side);
    const target = this.o.mode === "home" ? this.el : this.slot;
    requestAnimationFrame(() => target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: this.o.mode === "home" ? "start" : "nearest" }));
  }

  private storyKey(st: AppState, s: Sentence) {
    const d = st.doubt, c = d.ctx!;
    const rw = c.rewrite;
    const v = st.page.verify;
    const waitBucket = Math.floor((Date.now() - c.startedAt) / 10000);
    return ["s", s.key, d.stage, c.waitingFor, d.failure?.reason, c.txHash, c.finalNote, rw?.id, rw?.status, c.answer?.agent, c.answer?.at, v.rewriteId, v.running, v.result?.ok, this.ctx.store.derived.price(s), this.houseName, waitBucket];
  }

  private story(st: AppState, s: Sentence): HTMLElement {
    const d = st.doubt, c = d.ctx!;
    const side = c.side as "yes" | "no";
    const rec = this.ctx.mode === "recorded";
    const order = ["quoting", "signing", "optimistic", "final", "rewritten", "answered"];
    const at = order.indexOf(d.stage === "failed" ? (d.failure?.at ?? "quoting") : d.stage);
    const failed = d.stage === "failed";
    const secs = (t?: number) => (t === undefined ? "" : `${((t - c.startedAt) / 1000).toFixed(1)} s`);
    const waited = (Date.now() - c.startedAt) / 1000;

    // 1. the bet
    let s1: Child[];
    let t1: "done" | "wait" | "fail" = "wait";
    if (failed) {
      t1 = "fail";
      const f = d.failure!;
      const retry = f.retryable ? h("button", { class: "linkbtn", type: "button", "data-focus": "retry", onclick: () => this.bet(s, side) }, "Try again") : null;
      s1 = [h("p", { class: "red" }, typeset(f.message)), h("p", {}, f.readOnly ? "Every price on the page still updates live. " : "", retry ? "Nothing was spent. " : "", retry)];
    } else if (at >= 3) {
      t1 = "done";
      s1 = rec
        ? [h("p", {}, `You bet $1 that this sentence is ${SIDE_WORD[side]}. This is recorded data, so it was a rehearsal on the recorded market: nothing was sent.`)]
        : [h("p", {}, `You bet $1 that this sentence is ${SIDE_WORD[side]}. It settled on NEAR in ${((c.t.final! - c.startedAt) / 1000).toFixed(1)} seconds. `, c.txHash ? h("a", { href: explorerTx(this.ctx.config.network, c.txHash), target: "_blank", rel: "noopener" }, "See it on the explorer") : null)];
    } else if (d.stage === "optimistic") {
      s1 = [h("p", {}, c.finalNote ?? "NEAR ran your bet. Waiting a moment for it to be final…")];
    } else if (c.waitingFor === "lane") {
      s1 = [h("p", {}, "Setting up your free $1 in this browser…")];
    } else {
      s1 = [h("p", {}, rec ? "Rehearsing your $1 on the recorded market…" : "Sending your $1 to NEAR…")];
    }

    // 2. the odds
    const now = this.ctx.store.derived.price(s);
    let s2: Child[] = [h("p", {}, "The new odds show as soon as NEAR confirms the bet.")];
    let t2: "done" | "wait" | "idle" = failed ? "idle" : "wait";
    if (!failed && at >= 2 && c.priceBefore !== null && now !== null) {
      t2 = "done";
      const shares = c.trade ? Number(c.trade.shares_micro) / 1e6 : c.quote ? c.quote.shares : 0;
      const sideP = side === "no" ? 1 - now : now;
      const word = SIDE_WORD[side];
      s2 = [
        h("div", { class: "move" }, h("s", {}, pct(c.priceBefore)), "→", h("span", { class: `to${now > c.priceBefore ? " up" : ""}` }, pct(now))),
        h("p", {}, `Now ${now < 0.4 ? "only " : ""}a ${Math.round(now * 100)}% chance it’s true. `,
          shares > 0 ? `You hold ${shares.toFixed(2)} “${word}” shares. If the line is ruled ${word}, each pays $1: you’d get ${usd(shares)}. Sold now, they’d fetch about ${usd(shares * sideP)}.` : ""),
      ];
    }

    // 3. the rewrite
    const rw = c.rewrite;
    let t3: "done" | "wait" | "idle" = failed ? "idle" : at >= 3 ? "wait" : "idle";
    let s3: Child[] = [h("p", {}, at >= 3 ? `A model is rewriting the paragraph to match the new odds…${waited > 20 ? " It can take up to a minute when the model is busy." : ""}` : "Once the bet is final, the page rewrites the sentence to match its new odds.")];
    if (rec && !rw && at >= 3) {
      t3 = "idle";
      s3 = [h("p", {}, "This recording has no rewrite for this line. On the live site the page rewrites it within seconds; the recorded rewrite is on the full page, in the 2015–2016 paragraph.")];
    }
    if (!failed && rw) {
      t3 = "done";
      const old = this.before.get(s.key) ?? s.original;
      const neu = rw.sentences.find((x) => x.claim_id === s.claimId)?.text ?? rw.text;
      const parts = wordDiff(typeset(old), typeset(neu));
      const page = st.page.slug;
      const model = rw.provenance?.model ?? null;
      let sig: Child[];
      if (rw.status === "signed" && page) {
        const v = st.page.verify;
        if (!this.verified.has(rw.id)) { this.verified.add(rw.id); void this.ctx.store.verify(page, rw.id); }
        const mine = v.rewriteId === rw.id;
        const verifyBtn = h("button", { class: "linkbtn", type: "button", "data-chip": "signed", "data-focus": "verify" }, "verify it yourself");
        verifyBtn.addEventListener("click", () => this.ctx.openVerify(page, rw.id, verifyBtn));
        const status: Child = !mine || v.running ? h("span", {}, "Checking the signature in your browser…") : v.result?.ok ? h("b", {}, "Signature checks out ✓") : h("span", { class: "bad" }, `The signature didn’t check out: ${v.result?.steps.find((x) => x.status === "fail")?.label.toLowerCase() ?? v.error ?? "unknown"}.`);
        sig = [h("span", {}, "Written by ", h("b", {}, ident(modelName(model))), ", an AI model running on a sealed chip that proves which model wrote it."), status, h("span", {}, "·"), verifyBtn];
      } else {
        sig = [h("span", {}, rw.status === "template" ? "Written from a template while the model is busy; the signed version follows." : "Written by the model; its signature hasn’t arrived yet.")];
      }
      s3 = [h("div", { class: "diff" }, ...parts.map((x) => (x.op === "eq" ? x.text : h(x.op === "del" ? "del" : "ins", {}, x.text)))), h("div", { class: "sig" }, ...nodes(sig))];
    }

    // 4. an agent answers
    const a = c.answer;
    const reader = this.houseName ? `The ${this.houseName}` : "An AI agent";
    let t4: "done" | "wait" | "idle" = failed ? "idle" : at >= 3 ? "wait" : "idle";
    let h4 = "An AI agent is answering";
    let s4: Child[] = [h("p", {}, at >= 3 ? `${reader} is reading the sources…` : "Then an AI agent reads the sources and bets back, or agrees.")];
    if (rec && at >= 3 && !a) { t4 = "idle"; s4 = [h("p", {}, "No agent is trading in this recording. On the live site one answers within a minute.")]; }
    if (!failed && a) {
      t4 = "done";
      h4 = "An AI agent answered";
      const name = a.house ? `The ${cap(a.agent)}` : cap(a.agent);
      const src = a.source_url ? h("a", { href: a.source_url, target: "_blank", rel: "noopener nofollow" }, ident(a.source_title || host(a.source_url) || "its source")) : null;
      const act = a.side === "agree" ? `agrees with the odds at ${pct(a.price_before)}`
        : a.side === "no_bet" ? `thinks ${pct(a.credence)} and held off`
        : `bet ${money(a.size_usd)} that the line is ${a.side === "no" ? "wrong" : "right"}`;
      s4 = [h("p", {}, `${name} ${act}`, src ? ", citing " : ".", src, src ? "." : null), a.rationale ? h("p", {}, h("q", {}, typeset(a.rationale))) : null];
    }

    const step = (state: string, title: string, body: Child[], meta: string, id: string) => h("div", { class: `step${state === "idle" ? " later" : ""}`, "data-step-id": id, "data-state": state },
      h("div", { class: `tick ${state === "done" ? "" : state}`, "aria-hidden": "true" }, state === "done" ? "✓" : state === "fail" ? "!" : state === "wait" ? "…" : ""),
      h("div", {}, h("h3", {}, title), ...nodes(body)),
      h("div", { class: "meta" }, meta));
    const el = h("div", { class: "story", id: "doubt-state", "data-stage": d.stage, "aria-live": "polite", ...(d.failure ? { "data-failure": d.failure.reason } : {}) },
      step(t1, failed ? "Your $1 bet didn’t go through" : t1 === "done" ? "Your $1 bet is in" : "Placing your $1 bet", s1, t1 === "done" ? secs(c.t.final) : "", "bet"),
      step(t2, "The odds moved", s2, t2 === "done" ? `+${secs(c.t.optimistic ?? c.t.final)}` : "", "odds"),
      step(t3, t3 === "done" ? "The page rewrote the sentence" : "The page rewrites the sentence", s3, t3 === "done" ? `+${secs(c.t.rewritten)}` : "", "rewrite"),
      step(t4, h4, s4, t4 === "done" ? `+${secs(c.t.answered)}` : "", "answer"),
      h("div", { class: "story-foot" }, h("button", { class: "linkbtn", type: "button", "data-focus": "back", onclick: () => { if (st.doubt.stage === "failed" || at >= 3) this.ctx.store.resetDoubt(); } }, "Back to the odds")));
    return el;
  }
}

/** Why a line has no odds, in plain words. */
function greyWhy(s: Sentence): string {
  const r = `${s.reason ?? ""} ${s.kind ?? ""}`;
  if (s.status === "pricing_soon") return "not priced yet: the model that opens the odds is offline";
  if (/person/i.test(r)) return "about a person: we don’t price people";
  if (/too long/i.test(r)) return "too long to price as one line";
  return "an opinion: nothing to check";
}

/** "GLM-5.3 Flash" from "z-ai/glm-5.3-flash"; other ids keep their own spelling. */
export function modelName(id: string | null): string {
  if (!id) return "the model";
  const last = id.split("/").pop()!;
  return /^[a-z]+-\d/.test(last) ? last.replace(/^([a-z]+)-/, (_m, a: string) => `${a.toUpperCase()}-`).replace(/-([a-z])([a-z]+)$/, (_m, a: string, b: string) => ` ${a.toUpperCase()}${b}`) : last;
}

/** "4 min ago", "3 h ago", or a date. */
function agoWords(at: number): string | null {
  if (!at) return null;
  const s = (Date.now() - at) / 1000;
  if (s < 0) return "just now";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}\u00a0min ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)}\u00a0h ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).replace(/ /g, "\u00a0");
}

/** The whole article from the corpus, loaded on demand (one small chunk per page). */
const pages = import.meta.glob("../../../corpus/pages/*.json");
export async function loadCorpusPage(slug: string): Promise<{ section: string; text: string; cls: string }[] | null> {
  const load = pages[`../../../corpus/pages/${slug}.json`];
  if (!load) return null;
  try {
    const m: any = await load();
    const j = m.default ?? m;
    return (j.sentences as any[]).map((x) => ({ section: x.section, text: x.text, cls: x.class }));
  } catch { return null; }
}

export type { Trade };
