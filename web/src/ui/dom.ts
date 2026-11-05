// Small DOM helpers. Text from the API is always set as text, never parsed as HTML.

export type Child = Node | string | number | null | undefined | false;
type Attr = string | number | boolean | null | undefined | ((e: any) => void);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el: Element, attrs: Record<string, Attr>) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

export function append(el: Element, children: Child[]) {
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "object" ? c : String(c));
}

/** Children with the empty ones dropped, numbers as text. */
export const nodes = (cs: Child[]): (Node | string)[] => cs.filter((c) => c !== null && c !== undefined && c !== false).map((c) => (typeof c === "object" ? c : String(c))) as (Node | string)[];

/** Subscribe to a store, but render at most once a frame: a burst of events (a replayed backlog) is one paint. */
export function onFrame<S>(store: { subscribe(fn: (s: S) => void): () => void; state: S }, fn: (s: S) => void): () => void {
  let raf = 0;
  const off = store.subscribe(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; fn(store.state); });
  });
  return () => { off(); if (raf) cancelAnimationFrame(raf); };
}

/** Every duration is a multiple of one beat. */
export const BEAT = 400;
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (beats: number) => new Promise<void>((r) => setTimeout(r, beats * BEAT));

export const pct = (p: number | null | undefined) => (p === null || p === undefined ? "" : `${Math.round(p * 100)}%`);
export const usd = (x: number) => (x >= 100 ? `$${Math.round(x).toLocaleString("en-US")}` : `$${x.toFixed(2)}`);
export const host = (u: string | null | undefined) => {
  if (!u) return null;
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; }
};

/** A trader's name, readable: agents by name, lane keys as "a visitor", long accounts shortened. */
export function traderName(t: string, mine = false): string {
  if (mine) return "You";
  if (!t) return "Someone";
  if (t.startsWith("lane:")) return "A visitor";
  return "A trader";
}

export const explorerTx = (network: string, tx: string) => `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${tx}`;
export const explorerAccount = (network: string, a: string) => `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/address/${a}`;

export const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

const COUNT = Symbol("count");
/** Count a numeral from one value to another over some beats. */
export function countTo(el: HTMLElement, from: number, to: number, beats: number, fmt: (v: number) => string = (v) => String(Math.round(v))) {
  const tok = ((el as any)[COUNT] = ((el as any)[COUNT] || 0) + 1);
  if (reducedMotion() || beats <= 0 || Math.round(from) === Math.round(to)) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = beats * BEAT;
  const step = (t: number) => {
    if ((el as any)[COUNT] !== tok) return;
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = fmt(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export type DiffPart = { op: "eq" | "del" | "ins"; text: string };

/** Words of two texts compared: the words kept, struck and added (a plain LCS on words). */
export function wordDiff(a: string, b: string): DiffPart[] {
  const A = a.split(/(\s+)/).filter((x) => x !== ""), B = b.split(/(\s+)/).filter((x) => x !== "");
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], t: string) => { const l = out[out.length - 1]; if (l && l.op === op) l.text += t; else out.push({ op, text: t }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("eq", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", A[i++]);
    else push("ins", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("ins", B[j++]);
  return out;
}

/** Ends a sentence's display text without its final full stop (the bowl takes its place). */
export function withoutStop(t: string): { text: string; stop: string } {
  const m = /^(.*?)([.!?]+)$/s.exec(t.trim());
  return m ? { text: m[1], stop: m[2] } : { text: t.trim(), stop: "" };
}
