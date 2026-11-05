// The Point Source first screen: one real sentence set enormous, printed only as heavily as the
// money believes it, ending in a question mark whose dot is an ink bowl filled to the price, while
// the dish field (the agents) listens from the ground. The price numeral and "Doubt it · $1" sit
// beside the bowl. When money moves, the new ink spreads out of the bowl as a ring.
import type { AppState, Sentence } from "../core/store";
import { priceable } from "../core/store";
import { BEAT, countTo, ease, h, nodes, reducedMotion, s, wait, withoutStop, wordDiff, type Child } from "./dom";
import { display, displayInk, fitFat, FAT, greyInk, baseline, type Display, type Fit } from "./type/display";
import { dishName, doubtButton, doubtWords, todayLine, tradeWords, type Ctx } from "./context";
import { loadField, palette, safeField, type Field } from "./field-port";

const LEAD = 1.04;

interface Layout { W: number; H: number; phone: boolean; pad: number; groundTop: number; fit: Fit; box: { x: number; y: number; w: number }; beside: boolean; bowl: { cx: number; cy: number; r: number; u: number }; readout: { x: number; y: number; w: number } }

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

  constructor(private ctx: Ctx, private o: { short?: boolean; label: () => Child[] }) {
    this.el = h("section", { class: `ps${o.short ? " short" : ""}`, "aria-label": "The sentence, its price and the doubt" },
      this.canvas, this.labelEl, this.srText, this.poster, this.bowl, this.fx, this.readout);
    this.poster.append(this.marks);
    this.priceEl.append(this.pnum, h("span", { class: "pc" }, "%"));
    this.readout.append(h("div", { class: "row" }, this.priceEl, this.btn), this.statusEl, this.chipWrap);
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
    this.unsub = this.ctx.store.subscribe((st) => this.update(st));
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
    const st = this.ctx.store.state;
    const sen = st.page.sentences.find((x) => x.key === key);
    if (!sen) return;
    this.key = key;
    this.btn.setAttribute("data-doubt", key);
    this.el.setAttribute("data-hero", key);
    this.labelEl.replaceChildren(...nodes(this.o.label()));
    await Promise.all([fontsReady(), Promise.race([ready, new Promise((r) => setTimeout(r, 1500))])]);
    if (this.dead) return;
    this.lastSize = `${this.el.clientWidth}x${this.el.clientHeight}`;
    const p = this.ctx.store.derived.price(sen);
    this.grey = !priceable(sen) || p === null;
    this.shownText = sen.text;
    this.render(sen.text);
    this.mountField();
    const quiet = reducedMotion() || this.ctx.card;
    if (quiet || this.grey) { this.settle(sen); return; }
    // the orchestrated moment, on one clock: black as written, then the ink falls to its price
    this.paint(FAT);
    this.setBowl(1, false);
    // the words of the latest trade are there from the first paint; the numeral and the action come in sequence
    this.updateReadout(this.ctx.store.state);
    for (const el of [this.priceEl, this.btn]) { el.style.transition = "none"; el.style.opacity = "0"; }
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
    if (last) this.pulse(last.trader, last.side);
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
    const labelTop = card ? 96 : phone ? 70 : 96;
    this.labelEl.style.left = pad + "px";
    this.labelEl.style.right = pad + "px";
    this.labelEl.style.top = labelTop + "px";
    const top = labelTop + (this.labelEl.offsetHeight || 24) + (phone ? 14 : 22);
    if (phone) {
      const r = 22, u = r * 0.46;
      const rowH = r * 2 + u * 6.7;
      const below = 20 + rowH + 18 + 52 + 12 + 50 + 44;
      const ground = H - 104;
      const clear = ground - 64; // the foreground dishes rise above the ground line
      const fit = fitFat(shown, { w: W - pad * 2, h: Math.max(120, clear - top - below) }, { max: 56, min: 24, leading: LEAD });
      const ph = fit.lines.length * fit.size * LEAD;
      const rowTop = top + ph + 20;
      const bowl = { cx: pad + r, cy: rowTop + rowH - r, r, u };
      return { W, H, phone, pad, groundTop: Math.max(ground, rowTop + rowH + 18 + 52 + 12 + 50 + 64), fit, box: { x: pad, y: top, w: W - pad * 2 }, beside: false, bowl, readout: { x: pad, y: rowTop, w: W - pad * 2 } };
    }
    const groundTop = Math.round(H * (card ? 0.86 : 0.78));
    // keep the sentence clear of the foreground dishes that rise at the edges; the readout's words sit lower, in the clear middle
    const clear = card ? Math.round(H * 0.6) : groundTop - Math.max(118, H * 0.15, W * 0.15);
    const hFull = clear - top;
    const readW = card ? 260 : 470;
    const max = card ? 112 : Math.min(150, Math.round(W / 9.6));
    const reserve = (size: number) => size * 0.17 * 2 + size * 0.32 + 40 + readW;
    const a = fitFat(shown, { w: W - pad * 2, h: hFull }, { max, min: 48, leading: LEAD, reserve });
    const b = card ? a : fitFat(shown, { w: W - pad * 2, h: hFull - 200 }, { max, min: 40, leading: LEAD });
    const beside = card || (a.room && a.size >= b.size * 0.86);
    const fit = beside ? a : b;
    return { W, H, phone, pad, groundTop, fit, box: { x: pad, y: top, w: W - pad * 2 }, beside, bowl: { cx: 0, cy: 0, r: 0, u: 0 }, readout: { x: 0, y: 0, w: readW } };
  }

  private render(text: string) {
    const L = (this.L = this.layout(text));
    const { fit, box } = L;
    this.poster.style.left = box.x + "px";
    this.poster.style.top = box.y + "px";
    this.poster.style.width = box.w + "px";
    this.d = display(this.poster, fit.lines, { size: fit.size, leading: LEAD, ink: FAT, label: text });
    this.poster.removeAttribute("role");
    this.poster.removeAttribute("aria-label");
    this.poster.append(this.marks);
    this.marks.replaceChildren();
    this.marks.setAttribute("width", String(box.w));
    this.marks.setAttribute("height", String(this.d.height() + fit.size));
    this.srText.textContent = `${text} ${this.priceWords()}`;
    // beside the last line the numeral stays inside that line's height; below the sentence it can be larger
    const priceSize = L.phone ? 76 : L.beside ? Math.round(Math.max(72, Math.min(150, fit.size * 1.12))) : 128;
    this.el.style.setProperty("--price", priceSize + "px");
    // the bowl takes the full stop's place, on the last line's baseline
    if (!L.phone) {
      const last = this.d.slots[this.d.slots.length - 1];
      const r = Math.max(9, fit.size * 0.17);
      const base = baseline(fit.size, LEAD);
      L.bowl = { cx: box.x + (last ? last.x + last.w : 0) + r * 1.15, cy: box.y + (last ? last.y : 0) + base - r, r, u: r * 0.78 };
      if (L.beside) {
        L.readout = { x: L.bowl.cx + r + Math.max(28, fit.size * 0.3), y: L.bowl.cy + r - priceSize * 0.82, w: L.readout.w };
      } else {
        L.readout = { x: box.x, y: box.y + this.d.height() + 22, w: Math.min(box.w, 760) };
      }
    }
    this.placeBowl();
    this.readout.style.left = L.readout.x + "px";
    this.readout.style.top = L.readout.y + "px";
    this.readout.style.width = L.beside ? Math.max(300, Math.min(620, L.W - L.pad - L.readout.x)) + "px" : L.readout.w + "px";
    if (L.phone) {
      // the row: the bowl, then the price beside it; the action and the words below
      this.priceEl.style.marginLeft = L.bowl.r * 2 + 18 + "px";
      this.priceEl.style.marginTop = (L.bowl.cy + L.bowl.r - L.readout.y - priceSize * 0.82) + "px";
    } else {
      this.priceEl.style.marginLeft = "";
      this.priceEl.style.marginTop = "";
    }
    this.layoutField();
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
    const pad = r * 9;
    const b = this.bowl;
    b.setAttribute("width", String(pad * 2));
    b.setAttribute("height", String(pad * 2));
    b.setAttribute("viewBox", `${-pad} ${-pad} ${pad * 2} ${pad * 2}`);
    b.style.left = cx - pad + "px";
    b.style.top = cy - pad + "px";
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

  private pulse(trader: string, side: string) {
    if (!this.field) return;
    const n = dishName(trader, this.ctx.agents);
    this.field.assign(trader, n.name, n.house);
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
    for (const t of fresh) if (!t.mine) this.pulse(t.trader, t.side);
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

  private async rewrite(text: string) {
    const d = this.d!;
    const L = this.L!;
    const old = withoutStop(this.shownText).text;
    const neu = withoutStop(text).text;
    const parts = wordDiff(old, neu);
    if (!reducedMotion()) {
      // strike the words that go, one beat
      let ci = 0;
      const struck: number[] = [];
      for (const prt of parts) {
        if (prt.op === "ins") continue;
        for (let k = 0; k < prt.text.length; k++) { if (prt.op === "del" && prt.text[k].trim()) struck.push(ci); ci++; }
      }
      const glyphIdx = mapToSlots(old, d, struck);
      const base = baseline(L.fit.size, LEAD);
      for (const [line, xs] of groupByLine(glyphIdx, d)) {
        const y = d.slots[xs[0]].y + base - L.fit.size * 0.28;
        const x1 = d.slots[xs[0]].x - 4, x2 = d.slots[xs[xs.length - 1]].x + d.slots[xs[xs.length - 1]].w + 4;
        const ln = s("line", { x1, y1: y, x2, y2: y, "stroke-width": Math.max(3, L.fit.size * 0.05) });
        const len = x2 - x1;
        ln.style.strokeDasharray = String(len);
        ln.style.strokeDashoffset = String(len);
        this.marks.append(ln);
        requestAnimationFrame(() => requestAnimationFrame(() => { ln.style.transition = `stroke-dashoffset ${BEAT}ms cubic-bezier(.65,0,.35,1)`; ln.style.strokeDashoffset = "0"; }));
        void line;
      }
      await wait(3);
    }
    if (this.dead) return;
    this.shownText = text;
    this.tok++;
    this.render(text);
    const sen = this.cur();
    if (sen) this.settle(sen);
    // the words that came in, underlined in red pen for a moment
    if (!reducedMotion()) {
      const ins: number[] = [];
      let ci = 0;
      for (const prt of parts) {
        if (prt.op === "del") continue;
        for (let k = 0; k < prt.text.length; k++) { if (prt.op === "ins" && prt.text[k].trim()) ins.push(ci); ci++; }
      }
      const idx = mapToSlots(neu, this.d!, ins);
      const base = baseline(this.L!.fit.size, LEAD);
      for (const [, xs] of groupByLine(idx, this.d!)) {
        const a = this.d!.slots[xs[0]], b = this.d!.slots[xs[xs.length - 1]];
        const y = a.y + base + this.L!.fit.size * 0.1;
        const ln = s("line", { class: "ins", x1: a.x, y1: y, x2: b.x + b.w, y2: y, "stroke-width": Math.max(2, this.L!.fit.size * 0.03) });
        ln.style.transition = `opacity ${4 * BEAT}ms var(--ease) ${4 * BEAT}ms`;
        this.marks.append(ln);
        requestAnimationFrame(() => requestAnimationFrame(() => { ln.style.opacity = "0"; }));
      }
    }
    void L;
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
      this.statusEl.replaceChildren(...nodes(words));
    } else if (!can) {
      this.statusEl.replaceChildren(sen.reason || "Nothing here to price. Unfalsifiable from start to finish.");
    } else {
      const last = this.ctx.history.of(sen.claimId)[0];
      const key = last ? `${last.txHash}:${last.priceAfter}` : "none";
      if (key !== this.lastTradeKey || !this.statusEl.childNodes.length || this.statusEl.dataset.mode !== "idle") {
        this.lastTradeKey = key;
        this.statusEl.replaceChildren(...nodes([last ? tradeWords(last, this.ctx.agents) : "No one has bet on this line yet.", " ", todayLine(sen)]));
      }
    }
    this.statusEl.dataset.mode = words ? "doubt" : "idle";
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

let fontsOk: Promise<void> | null = null;
export function fontsReady(): Promise<void> {
  if (!fontsOk) {
    fontsOk = (async () => {
      try {
        await Promise.race([
          Promise.all([document.fonts.load('1000 64px "Amstelvar"'), document.fonts.load('100 64px "Amstelvar"')]),
          new Promise((r) => setTimeout(r, 3000)),
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
