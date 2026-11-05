// The dish field behind the first screen. The illustrated field is its own module
// (web/src/ui/field/, built by the field stream) behind this API; until it lands, or if it fails
// to load, a quiet placeholder with the same API stands in. The field module is loaded lazily, so
// the sentence paints first.

export interface FieldPalette { paper: string; ink: string; night: string; red: string; [k: string]: string }
export interface FieldOpts { dishes: number; seed: number; palette: FieldPalette; reducedMotion: boolean }
export interface Field {
  layout(viewport: { w: number; h: number; dpr: number }, groundTop: number): void;
  aimAt(x: number, y: number, opts?: { beats?: number }): void;
  lookAt(target: "viewer"): void;
  assign(agentId: string, name: string, house: boolean): void;
  pulse(agentId: string, side: "yes" | "no"): void;
  yours(state: "hidden" | "construction" | "red"): void;
  flinch(): void;
  still(): ImageData | void;
  destroy(): void;
}
export type CreateField = (canvas: HTMLCanvasElement, opts: FieldOpts) => Field;

// Vite resolves this at build time: an empty object when the field module isn't there yet.
const illustrated = import.meta.glob("./field/index.ts");

let loading: Promise<CreateField> | null = null;
export function loadField(): Promise<CreateField> {
  if (loading) return loading;
  loading = (async () => {
    const load = illustrated["./field/index.ts"];
    if (load) {
      try {
        const m: any = await load();
        if (typeof m.createField === "function") return m.createField as CreateField;
      } catch { /* fall through to the placeholder */ }
    }
    return (await import("./field-placeholder")).createField;
  })();
  return loading;
}

/** The field never takes the page down: a method that throws is reported once and skipped. */
export function safeField(f: Field): Field {
  let warned = false;
  const guard = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R | undefined => {
    try { return fn.apply(f, a); } catch (e) {
      if (!warned) { warned = true; console.warn(`dish field: ${name} failed`, e); }
      return undefined;
    }
  };
  return {
    layout: guard("layout", f.layout), aimAt: guard("aimAt", f.aimAt), lookAt: guard("lookAt", f.lookAt), assign: guard("assign", f.assign),
    pulse: guard("pulse", f.pulse), yours: guard("yours", f.yours), flinch: guard("flinch", f.flinch),
    still: guard("still", f.still) as Field["still"], destroy: guard("destroy", f.destroy),
  } as Field;
}

export function palette(): FieldPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { paper: v("--paper", "#f6f7f9"), ink: v("--ink-9", "#1a2236"), night: v("--night", "#262d40"), red: v("--red", "#e4492a"), ink3: v("--ink-3", "#aab"), ink6: v("--ink-6", "#556") };
}
