// Display type whose ink is money: a TypeScript port of .apex/design/exec/shared/display.js.
// Measured on Amstelvar (exec/glyphtest): wght 1000 at opsz 144 is a black fat face, wght 100 a
// clean thread. wdth rises as wght falls (duplexed), so every weight sets to the same line length.
// Every glyph sits in a slot measured at the fat setting, centred, so any glyph can take any
// weight and nothing on the line moves or reflows. The element gets the plain text as its
// accessible name; the glyph spans are hidden from assistive tech.

export const WDTH: [number, number][] = [[100, 111.9], [250, 111.2], [400, 110.4], [600, 105], [800, 99.4], [1000, 80]];
export function wdthFor(w: number): number {
  for (let i = 1; i < WDTH.length; i++) if (w <= WDTH[i][0]) {
    const [a, x] = WDTH[i - 1], [c, y] = WDTH[i];
    return +(x + ((w - a) / (c - a)) * (y - x)).toFixed(1);
  }
  return WDTH[WDTH.length - 1][1];
}
export const FAT = '"opsz" 144,"wght" 1000,"wdth" 80';
export const THREAD = '"opsz" 144,"wght" 100,"wdth" 111.9';
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
/** price to display weight: never lighter than 100, never heavier than 1000 */
export const wght = (p: number) => Math.round(100 + 900 * Math.pow(clamp01(p), 1.15));
/** the weight at a price, with a floor that keeps thin strokes whole at smaller sizes */
export function displayInk(p: number, size = 144): string {
  const opsz = size < 64 ? 48 : 144;
  const floor = size < 44 ? 300 : size < 72 ? 210 : 100;
  const w = Math.max(floor, wght(p));
  return `"opsz" ${opsz},"wght" ${w},"wdth" ${wdthFor(w)}`;
}
export const greyInk = (size: number) => `"opsz" ${size < 64 ? 48 : 144},"wght" 420,"wdth" ${wdthFor(420)}`;

export const FAMILY = "Amstelvar";

// Spacing for display lines (review: never collapse word spaces or tighten the display serif):
// tracking opens about 1.5%, a word space never falls under a quarter em, and the pairs that the
// condensed black setting crowds (abbreviations like "U.S.", capitals like "EOS", apostrophes) get
// a little air, so they stay apart at every weight from thread to black.
export const TRACK = 0.015;
const WORD_MIN = 0.27;
const spaceCache = new Map<number, number>();
/** Extra px between two glyphs, by pair. */
export function pairExtra(prev: string | undefined, cur: string, size: number): number {
  if (!prev) return 0;
  const up = (c: string) => /[A-Z]/.test(c);
  let e = 0;
  if (prev === "." && /[A-Za-z]/.test(cur)) e += 0.07; // U.S, S.T
  if (up(prev) && cur === ".") e += 0.025;
  if (up(prev) && up(cur)) e += 0.03; // EOS, USDT
  if (cur === "'" || cur === "’") e += 0.035;
  if (prev === "'" || prev === "’") e += 0.035;
  if (prev === "$" || cur === "%") e += 0.02;
  return e * size;
}
const extrasOf = (t: string, size: number) => { let e = 0; for (let i = 1; i < t.length; i++) e += pairExtra(t[i - 1], t[i], size); return e; };

let meas: HTMLSpanElement | null = null;
function measurer(size: number): HTMLSpanElement {
  if (!meas) {
    meas = document.createElement("span");
    meas.setAttribute("aria-hidden", "true");
    meas.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-family:${FAMILY};font-variation-settings:${FAT}`;
    document.body.append(meas);
  }
  meas.style.fontSize = size + "px";
  meas.style.letterSpacing = "0px";
  meas.style.wordSpacing = "0px";
  if (!spaceCache.has(size)) {
    meas.textContent = "n n"; const a = meas.getBoundingClientRect().width;
    meas.textContent = "nn"; const b = meas.getBoundingClientRect().width;
    spaceCache.set(size, a - b);
  }
  meas.style.letterSpacing = `${TRACK}em`;
  meas.style.wordSpacing = `${wordSpace(size)}px`;
  return meas;
}

/** The word spacing (px) that brings a space up to the minimum at the fat setting. */
export function wordSpace(size: number): number {
  const sp = spaceCache.get(size);
  return sp === undefined ? 0 : Math.max(0, WORD_MIN * size - sp - TRACK * size);
}

/** Break text into lines that fit a width at the fat setting. */
export function wrapFat(text: string, width: number, size: number): { lines: string[]; widths: number[] } {
  const m = measurer(size);
  const lines: string[] = [], widths: number[] = [];
  const w = (t: string) => { m.textContent = t; return m.getBoundingClientRect().width + extrasOf(t, size); };
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + " " + word : word;
    if (cur && w(t) > width) { widths.push(w(cur)); lines.push(cur); cur = word; } else cur = t;
  }
  widths.push(w(cur));
  lines.push(cur);
  return { lines, widths };
}

export interface Fit { size: number; lines: string[]; widths: number[]; room: boolean }

/** The largest size at which text fits a box, preferring sizes that leave room after the last line. */
export function fitFat(text: string, box: { w: number; h: number }, o: { max: number; min: number; leading: number; reserve?: (size: number) => number; step?: number }): Fit {
  let best: Fit | null = null;
  for (let size = o.max; size >= o.min; size -= o.step ?? 2) {
    const r = wrapFat(text, box.w, size);
    if (r.lines.length * size * o.leading > box.h) continue;
    if (Math.max(...r.widths) > box.w + 1) continue; // a single word wider than the box
    const room = r.widths[r.widths.length - 1] + (o.reserve ? o.reserve(size) : 0) <= box.w;
    if (!best) best = { size, ...r, room };
    if (room) return { size, ...r, room };
  }
  return best ?? { size: o.min, ...wrapFat(text, box.w, o.min), room: false };
}

const baseCache = new Map<string, number>();
/** The baseline's distance from the top of a line box, at a size and leading. */
export function baseline(size: number, leading: number): number {
  const k = `${size}:${leading}`;
  const hit = baseCache.get(k);
  if (hit !== undefined) return hit;
  const d = document.createElement("div");
  d.style.cssText = `position:absolute;left:-9999px;top:0;font-family:${FAMILY};font-size:${size}px;line-height:${leading};font-variation-settings:${FAT};white-space:pre`;
  d.append("Hx");
  const mark = document.createElement("span");
  mark.style.cssText = "display:inline-block;width:1px;height:0";
  d.append(mark);
  document.body.append(d);
  const b = mark.offsetTop;
  d.remove();
  baseCache.set(k, b);
  return b;
}

export interface Slot { line: number; ch: string; x: number; y: number; w: number }

export interface Display {
  base: HTMLDivElement;
  slots: Slot[];
  size: number;
  leading: number;
  layer(settings: string): HTMLDivElement;
  glyph(i: number, lay?: HTMLDivElement): HTMLElement;
  height(): number;
}

export function display(el: HTMLElement, lines: string[], { size = 128, leading = 1.04, ink = FAT, label }: { size?: number; leading?: number; ink?: string; label?: string } = {}): Display {
  el.replaceChildren();
  el.setAttribute("aria-label", label ?? lines.join(" "));
  el.setAttribute("role", "img");
  el.style.fontFamily = FAMILY;
  el.style.fontSize = size + "px";
  el.style.lineHeight = String(leading);
  el.style.fontVariantLigatures = "none";
  const slots: Slot[] = [];
  const box = document.createElement("div");
  measurer(size); // primes the space width for this size
  box.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font-variation-settings:${FAT};letter-spacing:${TRACK}em;word-spacing:${wordSpace(size)}px`;
  el.append(box);
  const o = el.getBoundingClientRect();
  lines.forEach((t, line) => {
    const l = document.createElement("div");
    l.textContent = t;
    l.style.height = size * leading + "px";
    box.append(l);
    const n = l.firstChild;
    if (!n) return;
    let extra = 0;
    for (let i = 0; i < t.length; i++) {
      extra += pairExtra(t[i - 1], t[i], size);
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect();
      // the range includes the tracking after the glyph: centre on the glyph itself
      const track = TRACK * size;
      slots.push({ line, ch: t[i], x: b.left - o.left + extra, w: Math.max(0, b.width - (t[i] === " " ? 0 : track)), y: line * size * leading });
    }
  });
  box.remove();
  el.style.height = lines.length * size * leading + "px";
  const build = (settings: string) => {
    const lay = document.createElement("div");
    lay.className = "glyphs";
    lay.setAttribute("aria-hidden", "true");
    lay.style.fontVariationSettings = settings;
    for (const sl of slots) {
      const g = document.createElement("span");
      g.textContent = sl.ch;
      g.style.left = `${(sl.x + sl.w / 2).toFixed(2)}px`;
      g.style.top = `${sl.y}px`;
      lay.append(g);
    }
    el.append(lay);
    return lay;
  };
  const base = build(ink);
  return {
    base, slots, size, leading,
    layer: build,
    glyph: (i, lay = base) => lay.children[i] as HTMLElement,
    height: () => lines.length * size * leading,
  };
}
