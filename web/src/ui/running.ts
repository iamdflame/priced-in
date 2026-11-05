// A page in running text whose ink is the price (GRAD only, so nothing reflows), with a quiet
// price column in the margin, and the reading card that opens beside a sentence: its price, what
// it costs to move it 10 points, who moved it last, what the source says, and the doubt.
import type { AppState, Sentence } from "../core/store";
import { priceable } from "../core/store";
import { BEAT, countTo, h, host, onFrame, pct, reducedMotion, usd, wordDiff, type Child } from "./dom";
import { runningInk } from "./type/ink";
import { doubtButton, doubtWords, livingProof, markSvg, todayLine, type Ctx } from "./context";
import { sectionOf } from "./data";
import { chip } from "./hero";

interface Row { s: Sentence; span: HTMLSpanElement; txt: HTMLSpanElement; sr: HTMLSpanElement; mp: HTMLSpanElement; shown: string; p: number | null }

export class Running {
  readonly el: HTMLDivElement;
  private text = h("div", { class: "running" });
  private margin = h("div", { class: "margin", "aria-hidden": "true" });
  private card = h("div", { class: "card", role: "dialog", "aria-label": "This sentence's price", hidden: true, tabindex: "-1" });
  private rows = new Map<string, Row>();
  private keys = "";
  private open: string | null = null;
  private opener: HTMLElement | null = null;
  private ro: ResizeObserver;
  private unsub: (() => void) | null = null;
  private cardKey = "";
  private feet = new Map<number, HTMLElement>();

  constructor(private ctx: Ctx, private o: { slug: string | null; empty?: string } ) {
    this.el = h("div", { class: "page-wrap" }, this.text, this.margin, this.card);
    this.ro = new ResizeObserver(() => this.placeMargin());
    this.ro.observe(this.text);
    document.addEventListener("keydown", this.onKey);
    document.addEventListener("pointerdown", this.onOutside);
  }

  mount(parent: HTMLElement) {
    parent.append(this.el);
    this.unsub = onFrame(this.ctx.store, (st) => this.update(st));
    this.update(this.ctx.store.state);
  }

  destroy() {
    this.ro.disconnect();
    this.unsub?.();
    document.removeEventListener("keydown", this.onKey);
    document.removeEventListener("pointerdown", this.onOutside);
    this.el.remove();
  }

  private onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && this.open) this.close(); };
  private onOutside = (e: PointerEvent) => {
    if (!this.open) return;
    const t = e.target as Node;
    if (this.card.contains(t) || (t as Element).closest?.(".s")) return;
    this.close();
  };

  private build(st: AppState) {
    this.text.replaceChildren();
    this.margin.replaceChildren();
    this.rows.clear();
    this.feet.clear();
    const list = st.page.sentences;
    if (!list.length) { this.text.append(h("p", { class: "loading" }, this.o.empty ?? "Nothing here to price. Unfalsifiable from start to finish.")); return; }
    for (const g of groups(list, this.o.slug)) {
      if (g.heading) this.text.append(h("span", { class: "sect" }, g.heading.split(" / ").pop()!));
      const p = h("p");
      g.sentences.forEach((sen, i) => {
        if (i) p.append(" ");
        p.append(this.row(sen).span);
      });
      this.text.append(p);
      const foot = h("span", { class: "para-foot" });
      this.text.append(foot);
      for (const sen of g.sentences) if (sen.claimId !== null) this.feet.set(sen.claimId, foot);
    }
  }

  private row(sen: Sentence): Row {
    const can = priceable(sen);
    const txt = h("span", { class: "t" }, sen.text);
    const sr = h("span", { class: "vh" });
    const span = h("span", { class: "s", "data-sentence": sen.key, "data-claim": sen.claimId ?? "", "data-status": sen.status }, txt, sr);
    if (can || sen.status === "settled") {
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.setAttribute("aria-haspopup", "dialog");
      const act = (e: Event) => { e.preventDefault(); this.toggle(sen.key, span); };
      span.addEventListener("click", act);
      span.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") act(e); });
    }
    const mp = h("span", { class: "mp" });
    this.margin.append(mp);
    const r: Row = { s: sen, span, txt, sr, mp, shown: sen.text, p: null };
    this.rows.set(sen.key, r);
    return r;
  }

  update(st: AppState) {
    const keys = st.page.sentences.map((x) => x.key).join(",");
    if (keys !== this.keys) { this.keys = keys; this.build(st); }
    const d = st.doubt;
    let moved = false;
    for (const sen of st.page.sentences) {
      const r = this.rows.get(sen.key);
      if (!r) continue;
      r.s = sen;
      const p = this.ctx.store.derived.price(sen);
      const grey = sen.status === "greyed" || sen.status === "unpriceable" || sen.status === "pricing_soon";
      r.span.classList.toggle("grey", grey);
      r.span.classList.toggle("settled", sen.status === "settled");
      r.span.classList.toggle("doubting", d.ctx?.key === sen.key && (d.stage === "quoting" || d.stage === "signing" || d.stage === "optimistic"));
      r.span.classList.toggle("on", this.open === sen.key);
      r.span.setAttribute("data-status", sen.status);
      r.span.setAttribute("data-price", p === null ? "" : String(p));
      r.span.setAttribute("data-ink", String(this.ctx.store.derived.ink(sen) ?? ""));
      if (!grey) r.span.style.fontVariationSettings = runningInk(p);
      r.sr.textContent = p === null ? ` (${sen.reason ?? "not priced"})` : ` (priced at ${Math.round(p * 100)}%)`;
      // the margin: a quiet price beside each line
      if (p !== r.p) {
        const from = r.p;
        r.p = p;
        r.mp.classList.toggle("moved", from !== null && p !== null && Math.abs(p - from) > 0.005);
        if (p === null) r.mp.textContent = sen.status === "greyed" ? "" : "";
        else if (from === null) r.mp.textContent = pct(p);
        else countTo(r.mp, from * 100, p * 100, 2, (v) => `${Math.round(v)}%`);
        if (from !== null) setTimeout(() => r.mp.classList.remove("moved"), 6 * BEAT);
      }
      r.mp.classList.toggle("on", this.open === sen.key);
      // a rewrite: the old words struck in red pen, the new ones in, then the new words alone
      if (sen.text !== r.shown) {
        const old = r.shown;
        r.shown = sen.text;
        moved = true;
        if (reducedMotion()) r.txt.replaceChildren(sen.text);
        else {
          r.txt.replaceChildren(...wordDiff(old, sen.text).map((x) => x.op === "eq" ? x.text : h(x.op === "del" ? "del" : "ins", {}, x.text)));
          setTimeout(() => { if (r.shown === sen.text) { r.txt.replaceChildren(sen.text); this.placeMargin(); } }, 10 * BEAT);
        }
      }
      if (sen.status === "settled" && !r.span.querySelector(".seal")) r.span.append(h("span", { class: "seal", title: sen.reason ?? "Settled" }, markSvg(sen.outcome ? 1 : 0, 12)));
    }
    // the provenance marks, at the end of each rewritten paragraph
    const page = st.page.slug;
    const done = new Set<string>();
    for (const sen of st.page.sentences) {
      if (!sen.rewrite || sen.claimId === null || !page) continue;
      const foot = this.feet.get(sen.claimId);
      if (!foot || done.has(sen.rewrite.id)) continue;
      done.add(sen.rewrite.id);
      const k = `${sen.rewrite.id}:${sen.rewrite.status}`;
      if (foot.dataset.k !== k) { foot.dataset.k = k; foot.replaceChildren(chip(sen.rewrite, page, this.ctx)); moved = true; }
    }
    if (moved || !this.placed) requestAnimationFrame(() => this.placeMargin());
    if (this.open) this.renderCard(st);
  }

  private placed = false;
  private placeMargin() {
    const top0 = this.text.getBoundingClientRect().top;
    let prev = -1e9;
    const lh = parseFloat(getComputedStyle(this.text).lineHeight) || 32;
    for (const r of this.rows.values()) {
      const rect = r.span.getClientRects()[0];
      if (!rect) continue;
      const y = Math.max(rect.top - top0 - (lh - rect.height) / 2, prev + lh * 0.9);
      r.mp.style.top = `${Math.round(y)}px`;
      prev = y;
    }
    this.placed = true;
    if (this.open) this.placeCard();
  }

  // ---------- the reading card ----------

  private toggle(key: string, span: HTMLElement) {
    if (this.open === key) { this.close(); return; }
    this.open = key;
    this.opener = span;
    this.ctx.store.select(key);
    this.cardKey = "";
    this.card.hidden = false;
    this.renderCard(this.ctx.store.state);
    this.placeCard();
    this.update(this.ctx.store.state);
    (this.card.querySelector("[data-doubt]") as HTMLElement | null ?? this.card).focus({ preventScroll: true });
  }

  private close() {
    this.open = null;
    this.card.hidden = true;
    this.ctx.store.select(null);
    this.update(this.ctx.store.state);
    this.opener?.focus({ preventScroll: true });
  }

  private placeCard() {
    const r = this.open ? this.rows.get(this.open) : null;
    if (!r) return;
    if (matchMedia("(max-width: 720px)").matches) return; // a sheet at the bottom on phones
    const wrap = this.el.getBoundingClientRect();
    const rect = r.span.getClientRects()[0] ?? r.span.getBoundingClientRect();
    const textW = this.text.getBoundingClientRect().width;
    const room = window.innerWidth - (wrap.left + textW + 40);
    if (room >= 380) {
      this.card.style.left = `${textW + 40}px`;
      this.card.style.top = `${Math.max(0, rect.top - wrap.top - 20)}px`;
    } else {
      const last = [...r.span.getClientRects()].pop() ?? rect;
      this.card.style.left = `${Math.min(Math.max(0, last.left - wrap.left), Math.max(0, textW - 360))}px`;
      this.card.style.top = `${last.bottom - wrap.top + 12}px`;
    }
  }

  private renderCard(st: AppState) {
    const r = this.open ? this.rows.get(this.open) : null;
    if (!r) return;
    const sen = r.s;
    const p = this.ctx.store.derived.price(sen);
    const can = priceable(sen) && p !== null;
    const d = st.doubt;
    const words = doubtWords(d, sen, this.ctx, () => { this.ctx.store.resetDoubt(); void this.ctx.store.doubt(sen.key); });
    const last = this.ctx.history.of(sen.claimId)[0];
    const cost = can ? this.ctx.store.derived.costToMove10(sen) : null;
    const b = doubtButton(st, sen, can, this.ctx.mode === "recorded");
    const k = JSON.stringify([sen.key, p, d.stage, d.ctx?.key, d.failure?.reason, b.label, last?.txHash, last?.priceAfter, sen.source?.url, sen.rewrite?.status, d.ctx?.answer?.agent]);
    if (k === this.cardKey) return;
    const focused = this.card.contains(document.activeElement);
    this.cardKey = k;
    const btn = h("button", { class: `doubt sm ${b.cls}`.trim(), type: "button", "data-doubt": sen.key, "aria-disabled": b.disabled ? "true" : "false" }, b.label);
    btn.addEventListener("click", () => { if (btn.getAttribute("aria-disabled") !== "true") void this.ctx.store.doubt(sen.key); });
    const kids: Child[] = [
      h("button", { class: "x", type: "button", "aria-label": "Close", onclick: () => this.close() }, "×"),
      p === null ? h("p", {}, sen.reason ?? "Not priced.") : h("div", { class: "cp", "aria-label": `Priced at ${Math.round(p * 100)} percent` }, String(Math.round(p * 100)), h("span", { class: "pc" }, "%")),
      cost ? h("p", {}, `It costs ${usd(cost.downUsd)} to move it 10 points down, ${usd(cost.upUsd)} up.`) : null,
      sen.status === "settled" ? h("p", {}, h("b", {}, sen.reason ?? "Settled.")) : null,
      can || last ? h("p", {}, ...livingProof(sen, this.ctx)) : null,
      sen.source ? h("p", {}, `${sen.source.agent} cites `, h("a", { href: sen.source.url, target: "_blank", rel: "noopener nofollow" }, sen.source.title || host(sen.source.url) || "a source"), ".") : null,
      todayLine(sen) ? h("p", {}, todayLine(sen)) : null,
      can || d.ctx?.key === sen.key ? h("div", { class: "acts" }, btn) : null,
      words ? h("p", { class: "status", "data-stage": d.stage, ...(d.failure ? { "data-failure": d.failure.reason } : {}) }, ...words) : null,
    ];
    this.card.replaceChildren(...(kids.filter(Boolean) as Node[]));
    if (focused) (this.card.querySelector("[data-doubt]") as HTMLElement | null ?? this.card).focus({ preventScroll: true });
  }
}

/** Paragraphs: the corpus's sections when known, else runs of four sentences. */
function groups(list: Sentence[], slug: string | null): { heading: string | null; sentences: Sentence[] }[] {
  const secs = list.map((s) => sectionOf(slug, s.original));
  if (secs.some(Boolean)) {
    const out: { heading: string | null; sentences: Sentence[] }[] = [];
    list.forEach((s, i) => {
      const sec = secs[i] ?? out[out.length - 1]?.heading ?? null;
      const last = out[out.length - 1];
      if (last && (last.heading === sec || (sec === "(lead)" && last.heading === null))) last.sentences.push(s);
      else out.push({ heading: sec === "(lead)" ? null : sec, sentences: [s] });
    });
    return out;
  }
  const out: { heading: string | null; sentences: Sentence[] }[] = [];
  for (let i = 0; i < list.length; i += 4) out.push({ heading: null, sentences: list.slice(i, i + 4) });
  return out;
}
