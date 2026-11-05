// The Point Source first screen: one real sentence set enormous, printed only as heavily as the
// money believes it, ending in a question mark whose dot is an ink bowl filled to the price, while
// the dish field (the agents) listens from the ground. The price numeral and "Doubt it · $1" sit
// beside the bowl. When money moves, the new ink spreads out of the bowl as a ring.
import type { AppState, Sentence } from "../core/store";
import { priceable } from "../core/store";
import { BEAT, countTo, ease, h, nodes, onFrame, reducedMotion, s, wait, withoutStop, wordDiff, type Child, type DiffPart } from "./dom";
import { display, displayInk, fitFat, wrapFat, FAT, greyInk, baseline, type Display, type Fit } from "./type/display";
import { dishName, doubtButton, doubtWords, livingProof, todayLine, type Ctx } from "./context";
import { loadField, palette, safeField, type Field } from "./field-port";
import { PLAIN } from "./data";

const LEAD = 1.06; // display leading on desktop; phones open it to 1.12
const PHONE_LEAD = 1.12;

interface Layout { lead: number; clamped: boolean; W: number; H: number; phone: boolean; pad: number; groundTop: number; fit: Fit; box: { x: number; y: number; w: number }; beside: boolean; bowl: { cx: number; cy: number; r: number; u: number }; readout: { x: number; y: number; w: number } }

export class Hero {
  readonly el: HTMLElement;
  private canvas = h("canvas", { class: "field", "aria-hidden": "true" });
  private labelEl = h("p", { class: "label" });
  private srText = h("p", { class: "sr-text", "aria-live": "polite" });
  private poster = h("div", { class: "poster", "aria-hidden": "true" });
  private marks = s("svg", { class: "marks" });
  private bowl = s("svg", { class: "bowl", "aria-hidden": "true" });
  private fx = s("svg", { class: "fx", "aria-hidden": "true" });
  private readout = h("div", { class: "readout" });
  private priceEl = h("a", { class: "price none", href: "#the-page", "aria-label": "" });
  private pnum = h("span", { class: "pn" });
  private btn = h("button", { class: "doubt", type: "button", "data-doubt": "" }, "Doubt it · $1");
  private statusEl = h("p", { class: "status", "aria-live": "polite", id: "doubt-state" });
  private chipWrap = h("div", { class: "chipwrap" });
  private field: Field | null = null;
  private L: Layout | null = null;
  private d: Display | null = null;
  private key: string | null = null;
  private shownText = "";
  private shownP: number | null = null;
  private grey = false;
  private tok = 0;
  private settled = false;
  private ro: ResizeObserver | null = null;
  private lastSize = "";
  private rewriteSeen = "";
  private lastTradeKey = "";
  private unsub: (() => void) | null = null;
  private dead = false;
  private failedShown = false;
  /** the after-state of a rewrite: the old words struck and the new ones in, at hero size */
  private merged: DiffPart[] | null = null;
  private delSlots: number[] = [];
  private insSlots: number[] = [];
  /** a long line clamped on a phone, and whether the reader opened it */
  private expanded = false;
  private reveal = h("button", { class: "reveal link-btn", type: "button", hidden: true }, "Read the full line");
  private trick = h("p", { class: "trick" });
  /** on phones the one plain line sits under the image, on the ground */
  private plain = h("p", { class: "plainline phone-only-block" }, PLAIN);

  constructor(private ctx: Ctx, private o: { short?: boolean; label: () => Child[] }) {
    this.el = h("section", { class: `ps${o.short ? " short" : ""}`, "aria-label": "The sentence, its price and the doubt" },
      this.canvas, this.labelEl, this.srText, this.poster, this.reveal, this.bowl, this.fx, this.readout, this.plain);
    this.reveal.addEventListener("click", () => { this.expanded = !this.expanded; this.reveal.textContent = this.expanded ? "Set it large again" : "Read the full line"; this.relayout(); });
    this.poster.append(this.marks);
    this.priceEl.append(h("span", { class: "pa" }, "priced at"), this.pnum, h("span", { class: "pc" }, "%"));
    this.trick.append("Any post on X opens priced here: change x.com to ", h("b", {}, typeof location !== "undefined" ? location.host : "this site"), " in its link.");
    this.readout.append(h("div", { class: "row" }, this.priceEl, this.btn), this.statusEl, this.chipWrap, this.trick);
    // nothing shows until it has its place: no shift on first paint
    for (const el of [this.labelEl, this.readout, this.bowl]) el.style.visibility = "hidden";
    this.btn.addEventListener("click", () => this.onDoubt());
    this.priceEl.addEventListener("click", (e) => { e.preventDefault(); document.getElementById("the-page")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" }); });
  }

  mount(parent: HTMLElement) {
    parent.append(this.el);
    this.ro = new ResizeObserver(() => {
      const k = `${this.el.clientWidth}x${this.el.clientHeight}`;
      if (k !== this.lastSize && this.key) { this.lastSize = k; this.relayout(); }
    });
    this.ro.observe(this.el);
    this.unsub = onFrame(this.ctx.store, (st) => this.update(st));
  }

  destroy() {
    this.dead = true;
    this.tok++;
    this.ro?.disconnect();
    this.unsub?.();
    this.field?.destroy();
    this.el.remove();
  }

  /** Set the sentence this screen is about. */
  async show(key: string, ready: Promise<unknown> = Promise.resolve()) {
    if (!this.ctx.store.state.page.sentences.some((x) => x.key === key)) return;
    this.key = key;
    this.btn.setAttribute("data-doubt", key);
    this.el.setAttribute("data-hero", key);
    this.labelEl.replaceChildren(...nodes(this.o.label()));
    await Promise.all([fontsReady(), Promise.race([ready, new Promise((r) => setTimeout(r, 1500))])]);
    if (this.dead) return;
    // read it now: a rewrite may have landed while the face loaded
    const sen = this.cur();
    if (!sen) return;
    this.lastSize = `${this.el.clientWidth}x${this.el.clientHeight}`;
    const p = this.ctx.store.derived.price(sen);
    this.grey = !priceable(sen) || p === null;
    this.shownText = sen.text;
    this.render(sen.text);
    this.deferField();
    if (!document.fonts.check('1000 64px "Amstelvar"')) void document.fonts.load('1000 64px "Amstelvar"').then(() => { if (!this.dead) this.relayout(); });
    const quiet = reducedMotion() || this.ctx.card;
    if (quiet || this.grey) { this.settle(sen); return; }
    // the orchestrated moment, on one clock: black as written, then the ink falls to its price
    this.paint(FAT);
    this.setBowl(1, false);
    // the words of the latest trade are there from the first paint; the numeral and the action come in sequence
    this.updateReadout(this.ctx.store.state);
    for (const el of [this.priceEl, this.btn]) { el.style.transition = "none"; el.style.opacity = "0"; }
    this.pnum.textContent = "99"; // holds the numeral's height, so nothing below it moves when it appears
    const tok = ++this.tok;
    await wait(2);
    if (tok !== this.tok) return;
    const target = this.ctx.store.derived.price(this.cur()!) ?? 0.5;
    this.priceEl.classList.remove("none");
    this.priceEl.style.transition = `opacity ${BEAT}ms var(--ease)`;
    this.priceEl.style.opacity = "1";
    countTo(this.pnum, 99, target * 100, 2);
    this.setBowl(target, true);
    await this.reprice(target, false);
    if (tok !== this.tok) return;
    this.shownP = target;
    this.settled = true;
    this.updateReadout(this.ctx.store.state);
    await wait(2);
    if (tok !== this.tok) return;
    this.hook(target < 0.5);
    this.btn.style.transition = `opacity ${2 * BEAT}ms var(--ease)`;
    this.btn.style.opacity = "1";
    this.aim();
    await wait(6);
    if (tok !== this.tok) return;
    // beat 10: the latest trade arrives along its beam
    const last = this.ctx.history.of(this.cur()?.claimId ?? null)[0];
    if (last) this.pulse(last.trader, last.side, last.amountUsd);
  }

  private cur(): Sentence | null {
    return this.ctx.store.state.page.sentences.find((x) => x.key === this.key) || null;
  }

  private settle(sen: Sentence) {
    for (const el of [this.btn, this.priceEl]) el.style.opacity = "1";
    const p = this.ctx.store.derived.price(sen);
    this.shownP = p;
    this.settled = true;
    this.paint(this.grey || p === null ? greyInk(this.L!.fit.size) : displayInk(p, this.L!.fit.size));
    this.setBowl(p ?? 0, false);
    this.priceEl.classList.toggle("none", p === null);
    this.pnum.textContent = p === null ? "" : String(Math.round(p * 100));
    this.hook(!this.grey && p !== null && p < 0.5, true);
    this.aim(true);
    this.updateReadout(this.ctx.store.state);
  }

  // ---------- layout ----------

  private layout(text: string): Layout {
    const card = this.ctx.card;
    const W = card ? 1200 : this.el.clientWidth, H = card ? 630 : this.el.clientHeight;
    const phone = W < 720 && !card;
    const pad = card ? 56 : phone ? 20 : W >= 1280 ? 64 : W >= 960 ? 44 : 32;
    const shown = withoutStop(text).text;
    // the label sits under the header; the sentence starts under the label
    const labelTop = card ? 96 : phone ? 74 : 96;
    this.labelEl.style.left = pad + "px";
    this.labelEl.style.right = pad + "px";
    this.labelEl.style.top = labelTop + "px";
    const top = labelTop + (this.labelEl.offsetHeight || 24) + (phone ? 12 : 22);
    if (phone) {
      // the claim at display size, then the bowl, the price and the action in one row, then the trade;
      // the engraved field takes the bottom 190 px or more of the first 844
      const lead = PHONE_LEAD;
      const r = 22, u = r * 0.46;
      const rowH = r * 2 + u * 6.7;
      const below = 18 + rowH + 14 + 84; // the row, then up to three lines of words
      const ground = Math.min(H - 236, 610);
      const clear = ground - 40;
      const boxH = Math.max(120, clear - top - below);
      let fit = fitFat(shown, { w: W - pad * 2, h: boxH }, { max: 58, min: this.expanded ? 22 : 38, leading: lead });
      let clamped = false;
      if (!this.expanded && fit.lines.length * fit.size * lead > boxH - 40) {
        // too long to set large: the first lines large, and the whole line one tap away
        const size = 40;
        const all = wrapFat(shown, W - pad * 2, size);
        const n = Math.max(2, Math.floor((boxH - 40) / (size * lead)));
        if (all.lines.length > n) {
          const lines = all.lines.slice(0, n);
          lines[n - 1] = lines[n - 1].replace(/\s*\S+$/, "") + "\u2026";
          fit = { size, lines, widths: all.widths.slice(0, n), room: false };
          clamped = true;
        } else fit = { size, ...all, room: false };
      }
      const ph = fit.lines.length * fit.size * lead + (clamped || this.expanded ? 40 : 0);
      const rowTop = top + ph + 18;
      const bowl = { cx: pad + r, cy: rowTop + rowH - r, r, u };
      return { lead, clamped, W, H, phone, pad, groundTop: Math.max(ground, rowTop + rowH + 14 + 84 + 40), fit, box: { x: pad, y: top, w: W - pad * 2 }, beside: false, bowl, readout: { x: pad, y: rowTop, w: W - pad * 2 } };
    }
    const lead = LEAD;
    const groundTop = Math.round(H * (card ? 0.86 : 0.8));
    // keep the sentence clear of the foreground dishes that rise at the edges; the readout's words sit lower, in the clear middle
    const clear = card ? Math.round(H * 0.64) : groundTop - Math.max(118, H * 0.15, W * 0.19);
    // the card's foreground dishes stand at its edges: the sentence keeps to the middle
    const bx = card ? 210 : pad, bw = card ? W - 420 : W - pad * 2;
    const hFull = clear - top;
    const readW = card ? 180 : 480;
    const max = card ? 112 : Math.min(150, Math.round(W / 9.6));
    const reserve = (size: number) => size * 0.17 * 2 + size * 0.42 + 40 + readW;
    const a = fitFat(shown, { w: bw, h: hFull }, { max, min: card ? 30 : 48, leading: lead, reserve });
    // below the sentence: the numeral, the action, two lines of words and the mark must stand clear of the ground
    const belowH = card ? 110 : (W < 1200 ? 96 : 128) * 0.82 + 22 + 18 + 92 + 56;
    const b = fitFat(shown, { w: bw, h: Math.min(hFull, groundTop - 8 - top - belowH) }, { max, min: card ? 30 : 36, leading: lead });
    // beside the last line only when the numeral (72 px at least) fits inside that line's height
    const beside = !card && a.room && a.size >= 68 && a.size >= b.size * 0.86;
    const fit = beside ? a : b;
    return { lead, clamped: false, W, H, phone, pad, groundTop, fit, box: { x: bx, y: top, w: bw }, beside, bowl: { cx: 0, cy: 0, r: 0, u: 0 }, readout: { x: 0, y: 0, w: readW } };
  }

  private render(text: string) {
    // a rewrite's after-state sets the old and the new words together
    const merged = this.merged;
    const setText = merged ? merged.map((x) => x.text).join("") + (withoutStop(text).stop || "") : text;
    const L = (this.L = this.layout(setText));
    const { fit, box } = L;
    this.poster.style.left = box.x + "px";
    this.poster.style.top = box.y + "px";
    this.poster.style.width = box.w + "px";
    this.d = display(this.poster, fit.lines, { size: fit.size, leading: L.lead, ink: FAT, label: text });
    this.poster.removeAttribute("role");
    this.poster.removeAttribute("aria-label");
    this.poster.append(this.marks);
    this.marks.replaceChildren();
    this.marks.setAttribute("width", String(box.w));
    this.marks.setAttribute("height", String(this.d.height() + fit.size));
    this.srText.textContent = `${text} ${this.priceWords()}`;
    // beside the last line the numeral stays inside that line's height; below the sentence it can be larger
    const priceSize = L.phone ? 64 : L.beside ? Math.round(Math.max(72, Math.min(150, fit.size * 1.05))) : this.ctx.card || L.W < 1200 ? 96 : 128;
    this.el.style.setProperty("--price", priceSize + "px");
    // the bowl takes the full stop's place, on the last line's baseline
    if (!L.phone) {
      const last = this.d.slots[this.d.slots.length - 1];
      const r = Math.max(9, fit.size * 0.17);
      const base = baseline(fit.size, L.lead);
      // the hook stays inside its own line, clear of the line above
      const u = Math.min(r * 0.78, (base - r - fit.size * 0.06) / 6.7);
      // a proper sidebearing: the gauge never touches the last word, at any weight
      L.bowl = { cx: box.x + (last ? last.x + last.w : 0) + r + fit.size * 0.16, cy: box.y + (last ? last.y : 0) + base - r, r, u };
      if (L.beside) {
        L.readout = { x: L.bowl.cx + r + Math.max(28, fit.size * 0.3), y: L.bowl.cy + r - priceSize * 0.82 + priceSize * 0.085, w: L.readout.w };
      } else {
        // below the sentence, kept right of the foreground dish that rises at the left edge
        const x = this.ctx.card ? box.x : Math.max(box.x, Math.round(L.W * 0.22));
        L.readout = { x, y: box.y + this.d.height() + 22, w: Math.min(L.W - L.pad - x, 760) };
      }
    }
    this.placeBowl();
    for (const el of [this.labelEl, this.readout, this.bowl]) el.style.visibility = "";
    this.readout.style.left = L.readout.x + "px";
    this.readout.style.top = L.readout.y + "px";
    this.readout.style.width = L.beside ? Math.max(300, Math.min(620, L.W - L.pad - L.readout.x)) + "px" : L.readout.w + "px";
    if (L.phone) {
      // the row: the bowl, then the price beside it; the action and the words below
      // one row: the bowl, the price on the bowl's baseline, the action on the same line
      this.readout.style.top = L.bowl.cy + L.bowl.r - priceSize * 0.82 + priceSize * 0.085 + "px";
      this.priceEl.style.marginLeft = L.bowl.r * 2 + 14 + "px";
      this.priceEl.style.marginTop = "";
    } else {
      this.priceEl.style.marginLeft = "";
      this.priceEl.style.marginTop = "";
    }
    // the clamp's reveal sits under the clamped line
    this.reveal.hidden = !(L.clamped || (L.phone && this.expanded));
    if (!this.reveal.hidden) { this.reveal.style.left = L.box.x + "px"; this.reveal.style.top = L.box.y + this.d.height() + 2 + "px"; }
    this.markDiff(setText);
    if (L.phone) { this.plain.style.top = L.groundTop - 58 + "px"; this.plain.style.bottom = "auto"; }
    this.layoutField();
    requestAnimationFrame(() => this.fitReadout());
  }

  /** The quiet lines under the action give way, last first, before anything reaches the ground. */
  private fitReadout() {
    const L = this.L;
    if (!L || L.phone) return;
    const limit = L.groundTop - 24;
    for (const el of [this.trick, this.chipWrap]) el.style.display = "";
    for (const el of [this.trick, this.chipWrap]) {
      const r = this.readout.getBoundingClientRect(), host = this.el.getBoundingClientRect();
      if (r.bottom - host.top <= limit) break;
      el.style.display = "none";
    }
  }

  /** Strike the outgoing words (thread weight, red pen) and mark the incoming ones, in the set line. */
  private markDiff(setText: string) {
    this.delSlots = [];
    this.insSlots = [];
    const parts = this.merged;
    const d = this.d!;
    if (!parts) return;
    const del: number[] = [], ins: number[] = [];
    let ci = 0;
    for (const prt of parts) for (let k = 0; k < prt.text.length; k++) { if (prt.text[k].trim()) { if (prt.op === "del") del.push(ci); if (prt.op === "ins") ins.push(ci); } ci++; }
    const shown = withoutStop(setText).text;
    this.delSlots = mapToSlots(shown, d, del);
    this.insSlots = mapToSlots(shown, d, ins);
    const size = this.L!.fit.size;
    const base = baseline(size, this.L!.lead);
    for (const i of this.delSlots) { const g = d.glyph(i); g.style.fontVariationSettings = displayInk(0.02, size); g.style.color = "var(--red-text)"; }
    for (const [, xs] of groupByLine(this.delSlots, d)) {
      const a = d.slots[xs[0]], b = d.slots[xs[xs.length - 1]];
      const y = a.y + base - size * 0.28;
      this.marks.append(s("line", { x1: a.x - 3, y1: y, x2: b.x + b.w + 3, y2: y, "stroke-width": Math.max(2, size * 0.035) }));
    }
    for (const [, xs] of groupByLine(this.insSlots, d)) {
      const a = d.slots[xs[0]], b = d.slots[xs[xs.length - 1]];
      const y = a.y + base + size * 0.1;
      this.marks.append(s("line", { class: "ins", x1: a.x, y1: y, x2: b.x + b.w, y2: y, "stroke-width": Math.max(1.5, size * 0.02) }));
    }
  }



  private fieldKey = "";
  /** Lay the field out only when its viewport or ground line changed. */
  private layoutField() {
    const L = this.L;
    if (!this.field || !L) return;
    const k = `${L.W}x${L.H}@${L.groundTop}`;
    if (k === this.fieldKey) return;
    this.fieldKey = k;
    this.field.layout({ w: L.W, h: L.H, dpr: devicePixelRatio || 1 }, L.groundTop);
  }

  private relayout() {
    const sen = this.cur();
    if (!sen || !this.L) return;
    this.tok++;
    this.render(this.shownText);
    this.settle(sen);
  }

  private placeBowl() {
    const { cx, cy, r, u } = this.L!.bowl;
    // a tight box: the bowl and its hook, nothing more
    const x0 = -Math.max(r, 2.4 * u) - 4, x1 = Math.max(r, 2.1 * u) + 4, y0 = -7 * u - 4, y1 = r + 4;
    const b = this.bowl;
    b.setAttribute("width", String(x1 - x0));
    b.setAttribute("height", String(y1 - y0));
    b.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    b.style.left = cx + x0 + "px";
    b.style.top = cy + y0 + "px";
    const sw = Math.max(1.5, r * 0.075);
    const id = "bowlclip";
    b.innerHTML = "";
    b.append(
      s("defs", {}, s("clipPath", { id }, s("circle", { cx: 0, cy: 0, r: r - sw / 2 }))),
      s("circle", { class: "ring", cx: 0, cy: 0, r: r - sw / 2, "stroke-width": sw }),
      s("rect", { class: "fill", x: -r, y: -r, width: r * 2, height: r * 2, "clip-path": `url(#${id})` }),
      s("circle", { class: "rim", cx: 0, cy: 0, r: r - sw / 2, fill: "none", stroke: "var(--ink-9)", "stroke-width": sw }),
      s("path", { class: "hook", d: `M0 ${-1.55 * u} L0 ${-2.5 * u} C0 ${-3.3 * u} ${1.75 * u} ${-3.55 * u} ${1.75 * u} ${-4.85 * u} C${1.75 * u} ${-6.1 * u} ${0.5 * u} ${-6.7 * u} ${-0.55 * u} ${-6.55 * u} C${-1.6 * u} ${-6.4 * u} ${-2.05 * u} ${-5.6 * u} ${-2.05 * u} ${-4.9 * u}`, "stroke-width": Math.max(3, u * 0.5) }),
    );
    const hook = b.querySelector(".hook") as SVGPathElement;
    const len = hook.getTotalLength();
    hook.style.strokeDasharray = String(len);
    hook.style.strokeDashoffset = String(len);
    hook.dataset.len = String(len);
    b.classList.toggle("grey", this.grey);
  }

  private setBowl(p: number, animate: boolean) {
    const fill = this.bowl.querySelector(".fill") as SVGRectElement | null;
    if (!fill) return;
    const { r } = this.L!.bowl;
    const k = Math.max(0.02, Math.min(1, p));
    const target = r - 2 * r * k;
    if (!animate || reducedMotion()) { fill.setAttribute("y", String(target)); return; }
    const from = Number(fill.getAttribute("y"));
    const t0 = performance.now(), dur = 2 * BEAT;
    const step = (t: number) => {
      const e = ease(Math.min(1, (t - t0) / dur));
      fill.setAttribute("y", String(from + (target - from) * e));
      if (e < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private hook(on: boolean, instant = false) {
    const hk = this.bowl.querySelector(".hook") as SVGPathElement | null;
    if (!hk) return;
    hk.style.transition = instant || reducedMotion() ? "none" : `stroke-dashoffset ${BEAT}ms cubic-bezier(.65,0,.35,1)`;
    hk.style.strokeDashoffset = on ? "0" : hk.dataset.len || "0";
  }

  private paint(fvs: string) {
    if (!this.d) return;
    this.d.base.style.fontVariationSettings = fvs;
    this.d.base.classList.toggle("grey", this.grey);
  }

  private inkFor(p: number) { return displayInk(p, this.L!.fit.size); }

  /** The new ink spreads out of the bowl as a ring, cutting letters in two at its edge. */
  private reprice(p: number, red: boolean): Promise<void> {
    const d = this.d!;
    const next = this.inkFor(p);
    if (reducedMotion() || this.ctx.card) { this.paint(next); return Promise.resolve(); }
    const tok = this.tok;
    const top = d.layer(next);
    const L = this.L!;
    const Wp = L.box.w, Hp = d.height() + L.fit.size * 0.4;
    const cx = L.bowl.cx - L.box.x, cy = L.bowl.cy - L.box.y;
    const maxR = Math.hypot(Math.max(cx, Wp - cx) + 40, Math.max(cy, Hp - cy) + 40);
    const ring = s("circle", { cx: L.bowl.cx, cy: L.bowl.cy, r: 0, fill: "none", stroke: red ? "var(--red)" : "var(--ink-9)", "stroke-width": 1.5 });
    this.fx.append(ring);
    const t0 = performance.now(), dur = 2 * BEAT;
    return new Promise((res) => {
      const step = (t: number) => {
        const k = Math.max(0, Math.min(1, (t - t0) / dur));
        const r = ease(k) * maxR;
        if (tok !== this.tok || k >= 1) {
          this.paint(next);
          d.base.style.clipPath = "";
          top.remove();
          ring.remove();
          return res();
        }
        top.style.clipPath = `circle(${r}px at ${cx}px ${cy}px)`;
        d.base.style.clipPath = `path(evenodd, "M-400 -400H${Wp + 400}V${Hp + 400}H-400Z M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z")`;
        ring.setAttribute("r", String(r));
        ring.setAttribute("opacity", String(1 - k));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // ---------- the field ----------

  /** The field is the heaviest thing on the page: it starts once the sentence has painted and the page is idle. */
  private deferField() {
    if (this.ctx.card) { void this.mountField(); return; }
    const go = () => {
      const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
      if (ric) ric(() => void this.mountField(), { timeout: 2 * BEAT }); else setTimeout(() => void this.mountField(), BEAT);
    };
    if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
  }

  private async mountField() {
    if (this.field) { this.layoutField(); return; }
    const create = await loadField();
    if (this.dead || this.field) return;
    const L = this.L!;
    try {
      this.field = safeField(create(this.canvas, { dishes: L.phone ? 30 : 64, seed: 1851, palette: palette(), reducedMotion: reducedMotion() || this.ctx.card }));
    } catch (e) {
      console.warn("dish field: could not start", e);
      return;
    }
    this.layoutField();
    for (const a of this.ctx.agents.all()) this.field.assign(a.account, a.name, a.house);
    this.field.yours("construction");
    if (this.settled) this.aim(true); else this.field.lookAt("viewer");
    if (this.ctx.card) this.field.still();
  }

  private pulse(trader: string, side: string, amountUsd?: number) {
    if (!this.field) return;
    const n = dishName(trader, this.ctx.agents);
    // the dish carries its agent's name and its bet, in the illustration's own lettering
    const bet = amountUsd ? `, $${amountUsd.toFixed(amountUsd % 1 ? 2 : 0)} ${side === "no" || side === "sell_yes" ? "against" : "for"}` : "";
    this.field.assign(trader, n.name + bet, n.house);
    this.field.pulse(trader, side === "no" || side === "sell_yes" ? "no" : "yes");
  }

  private aim(instant = false) {
    if (!this.field || !this.L) return;
    this.field.aimAt(this.L.bowl.cx, this.L.bowl.cy, { beats: instant ? 0 : 2 });
  }

  // ---------- live ----------

  private priceWords() {
    const sen = this.cur();
    const p = sen ? this.ctx.store.derived.price(sen) : null;
    return p === null ? "Not priced." : `Priced at ${Math.round(p * 100)} percent.`;
  }

  private onDoubt() {
    if (!this.key || this.btn.getAttribute("aria-disabled") === "true") return;
    this.btn.classList.add("stamp");
    setTimeout(() => this.btn.classList.remove("stamp"), BEAT);
    this.field?.yours("red");
    this.field?.pulse("yours", "no");
    void this.ctx.store.doubt(this.key);
  }

  update(st: AppState) {
    const sen = this.cur();
    if (!sen || !this.L || this.dead) return;
    for (const a of this.ctx.agents.all()) this.field?.assign(a.account, a.name, a.house);
    const fresh = this.ctx.history.absorb(st.page.sentences);
    for (const t of fresh) if (!t.mine) this.pulse(t.trader, t.side, t.amountUsd);
    if (!this.settled) return;
    const d = st.doubt;
    const mine = d.ctx?.key === sen.key;
    // a rewrite: struck in red pen, then the new words at their own weight
    const rewriteHere = mine && (d.stage === "rewritten" || d.stage === "answered") ? d.ctx!.rewrite?.sentences.find((x) => x.claim_id === sen.claimId)?.text ?? null : null;
    const otherRewrite = !mine || d.stage === "idle" || d.stage === "failed" ? (sen.text !== this.shownText ? sen.text : null) : null;
    const nextText = rewriteHere ?? otherRewrite;
    const rkey = `${sen.rewrite?.id}:${nextText}`;
    if (nextText && nextText !== this.shownText && rkey !== this.rewriteSeen) {
      this.rewriteSeen = rkey;
      void this.rewrite(nextText);
    }
    // a doubt that failed hands the red dish back
    if (mine && d.stage === "failed" && !this.failedShown) { this.failedShown = true; this.field?.yours("construction"); }
    if (d.stage !== "failed") this.failedShown = false;
    // the price moved: the ring, the bowl and the numeral follow
    const p = this.ctx.store.derived.price(sen);
    if (p !== null && this.shownP !== null && Math.abs(p - this.shownP) > 0.0005) {
      const from = this.shownP;
      this.shownP = p;
      const red = mine && d.stage !== "failed";
      void this.reprice(p, red);
      this.setBowl(p, true);
      countTo(this.pnum, from * 100, p * 100, 2);
      this.hook(p < 0.5);
      if (Math.abs(p - from) >= 0.1) this.field?.flinch();
      if (d.stage === "failed" && mine) this.field?.yours("construction");
    }
    this.updateReadout(st);
  }

  /** A rewrite in about 1.2 s: the outgoing words struck in one beat, then the new words print in with a hard
   * ease-out; the after-state holds both at hero size. */
  private async rewrite(text: string) {
    const d = this.d!;
    const L = this.L!;
    const old = withoutStop(this.merged ? this.merged.filter((x) => x.op !== "del").map((x) => x.text).join("") : this.shownText).text;
    const neu = withoutStop(text).text;
    const parts = wordDiff(old, neu);
    const motion = !reducedMotion() && !this.ctx.card;
    if (motion && !this.merged) {
      let ci = 0;
      const struck: number[] = [];
      for (const prt of parts) { if (prt.op === "ins") continue; for (let k = 0; k < prt.text.length; k++) { if (prt.op === "del" && prt.text[k].trim()) struck.push(ci); ci++; } }
      const base = baseline(L.fit.size, L.lead);
      for (const [, xs] of groupByLine(mapToSlots(old, d, struck), d)) {
        const y = d.slots[xs[0]].y + base - L.fit.size * 0.28;
        const x1 = d.slots[xs[0]].x - 3, x2 = d.slots[xs[xs.length - 1]].x + d.slots[xs[xs.length - 1]].w + 3;
        const ln = s("line", { x1, y1: y, x2, y2: y, "stroke-width": Math.max(2, L.fit.size * 0.035) });
        ln.style.strokeDasharray = String(x2 - x1);
        ln.style.strokeDashoffset = String(x2 - x1);
        this.marks.append(ln);
        requestAnimationFrame(() => requestAnimationFrame(() => { ln.style.transition = `stroke-dashoffset ${BEAT}ms cubic-bezier(.16,1,.3,1)`; ln.style.strokeDashoffset = "0"; }));
      }
      await wait(1);
    }
    if (this.dead) return;
    this.shownText = text;
    // struck and inserted words side by side keep a word space between them
    const spaced = parts.map((x, i) => (x.op === "del" && parts[i + 1]?.op === "ins" && !/\s$/.test(x.text) && !/^\s/.test(parts[i + 1].text) ? { ...x, text: x.text + " " } : x));
    this.merged = parts.some((x) => x.op !== "eq") ? spaced : null;
    this.tok++;
    this.render(text);
    const sen = this.cur();
    if (sen) this.settle(sen);
    if (motion && this.insSlots.length) {
      // the new words print in over two beats, hard ease-out, in reading order
      const n = this.insSlots.length;
      this.insSlots.forEach((i, k) => {
        const g = this.d!.glyph(i);
        g.style.opacity = "0";
        g.style.transition = `opacity ${2 * BEAT}ms cubic-bezier(.16,1,.3,1) ${Math.round((k / n) * BEAT)}ms`;
        requestAnimationFrame(() => requestAnimationFrame(() => { g.style.opacity = "1"; }));
      });
    }
  }

  private updateReadout(st: AppState) {
    const sen = this.cur();
    if (!sen) return;
    const p = this.ctx.store.derived.price(sen);
    const can = priceable(sen) && p !== null;
    const b = doubtButton(st, sen, can, this.ctx.mode === "recorded");
    this.btn.textContent = b.label;
    this.btn.className = `doubt ${b.cls}`.trim();
    this.btn.setAttribute("aria-disabled", b.disabled ? "true" : "false");
    this.priceEl.setAttribute("aria-label", p === null ? "Not priced" : `Priced at ${Math.round(p * 100)} percent. Read the page`);
    if (!this.ctx.card) this.srText.textContent = `${this.shownText} ${this.priceWords()}`;
    const words = doubtWords(st.doubt, sen, this.ctx, () => { this.ctx.store.resetDoubt(); this.onDoubt(); });
    this.statusEl.setAttribute("data-stage", st.doubt.ctx?.key === sen.key ? st.doubt.stage : "idle");
    if (st.doubt.failure && st.doubt.ctx?.key === sen.key) this.statusEl.setAttribute("data-failure", st.doubt.failure.reason); else this.statusEl.removeAttribute("data-failure");
    if (words) {
      swap(this.statusEl, nodes(words));
    } else if (!can) {
      this.statusEl.replaceChildren(sen.reason || "Nothing here to price. Unfalsifiable from start to finish.");
    } else {
      const last = this.ctx.history.of(sen.claimId)[0];
      const key = last ? `${last.txHash}:${last.priceAfter}` : "none";
      if (key !== this.lastTradeKey || !this.statusEl.childNodes.length || this.statusEl.dataset.mode !== "idle") {
        this.lastTradeKey = key;
        swap(this.statusEl, nodes([...livingProof(sen, this.ctx), " ", todayLine(sen)]));
      }
    }
    this.statusEl.dataset.mode = words ? "doubt" : "idle";
    requestAnimationFrame(() => this.fitReadout());
    // the provenance mark for a rewritten line
    const rw = sen.rewrite;
    const page = st.page.slug;
    const chipKey = rw ? `${rw.id}:${rw.status}` : "";
    if (this.chipWrap.dataset.k !== chipKey) {
      this.chipWrap.dataset.k = chipKey;
      this.chipWrap.replaceChildren();
      if (rw && page) this.chipWrap.append(chip(rw, page, this.ctx));
    }
  }
}

/** "signed in a TEE · verify" opens each check; unsigned and template rewrites say so. */
export function chip(rw: NonNullable<Sentence["rewrite"]>, page: string, ctx: Ctx): HTMLElement {
  if (!rw.signed) {
    return h("span", { class: "chip unsigned", "data-chip": rw.status }, rw.status === "template" ? "Rewritten from a template, unsigned. The signed version follows." : rw.status === "unverified" ? "Rewritten; the signature didn't verify." : "Rewritten, not signed yet.");
  }
  const a = h("a", { class: "chip", "data-chip": "signed", href: `/verify/${encodeURIComponent(rw.id)}?page=${encodeURIComponent(page)}` },
    shield(), "signed in a TEE · verify", h("span", { class: "vh" }, `, by ${rw.model ?? "the writer"}`));
  a.title = `Signed by ${rw.model ?? "the writer"}`;
  a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); ctx.openVerify(page, rw.id, a); });
  return a;
}

function shield() {
  const svg = s("svg", { viewBox: "0 0 18 18", "aria-hidden": "true" });
  svg.innerHTML = '<circle cx="9" cy="9" r="7.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.6 9.2l2.3 2.3 4.6-4.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

/** Replace an element's children only when what they say changed: no repaint, no new paint candidate. */
function swap(el: HTMLElement, kids: (Node | string)[]) {
  const probe = document.createElement("div");
  probe.append(...kids);
  if (probe.innerHTML === el.innerHTML) return;
  el.replaceChildren(...probe.childNodes);
}

let fontsOk: Promise<void> | null = null;
export function fontsReady(): Promise<void> {
  if (!fontsOk) {
    fontsOk = (async () => {
      try {
        await Promise.race([
          Promise.all([document.fonts.load('1000 64px "Amstelvar"'), document.fonts.load('100 64px "Amstelvar"')]),
          new Promise((r) => setTimeout(r, 6000)),
        ]);
      } catch { /* the fallback face still measures */ }
    })();
  }
  return fontsOk;
}

/** Character positions in a text (spaces included) to glyph slots of a display set from it. */
function mapToSlots(text: string, d: Display, chars: number[]): number[] {
  // the display drops the space at each line break: walk both together
  const out: number[] = [];
  const want = new Set(chars);
  let si = 0;
  for (let ci = 0; ci < text.length && si < d.slots.length; ci++) {
    if (d.slots[si].ch === text[ci]) { if (want.has(ci)) out.push(si); si++; }
  }
  return out;
}

function groupByLine(idx: number[], d: Display): [number, number[]][] {
  const m = new Map<number, number[]>();
  for (const i of idx) { const l = d.slots[i].line; (m.get(l) || m.set(l, []).get(l)!).push(i); }
  // split runs that are far apart on the same line into separate strokes
  const out: [number, number[]][] = [];
  for (const [line, xs] of m) {
    xs.sort((a, b) => a - b);
    let run: number[] = [xs[0]];
    for (let k = 1; k < xs.length; k++) {
      if (xs[k] - xs[k - 1] > 2) { out.push([line, run]); run = []; }
      run.push(xs[k]);
    }
    out.push([line, run]);
  }
  return out;
}
