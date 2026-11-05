// The field: geometry (camera, aiming law, bowl optics, placement) and the API contract the
// rest of web/src/ui is built against, run in Node with a recording 2D context.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type DishSpec, type V3, aimPose, axisOf, bowlNormal, bowlPoint, frameOf, makeCamera, pivotOf,
  placeDishes, project, screenTarget, throughMouth, unproject, viewerTarget,
} from "../src/ui/field/geometry";
import { BEAT, YOURS, createField } from "../src/ui/field/index";

const cam = makeCamera(1440, 900, 600);
const phoneCam = makeCamera(390, 844, 582);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

describe("field geometry", () => {
  test("the ground's top edge is the horizon and projection inverts", () => {
    const far = project(cam, [0, 0, 1e7]);
    expect(far[1]).toBeCloseTo(600, 1);
    const P: V3 = [12.5, 3.2, 140];
    const [sx, sy] = project(cam, P);
    const Q = unproject(cam, sx, sy, 140);
    expect(len(sub(P, Q))).toBeLessThan(1e-9);
  });

  test("a pose points the bowl axis at its target", () => {
    const [d] = placeDishes(cam, 64, 7);
    const T: V3 = [d.x - 30, 40, d.z - 80];
    const a = axisOf(aimPose(d, T));
    const want = unit(sub(T, pivotOf(d)));
    expect(len(sub(a, want))).toBeLessThan(1e-9);
  });

  test("every dish listening to a screen point has its axis cross that point on screen", () => {
    for (const c of [cam, phoneCam]) {
      const dishes = placeDishes(c, c === cam ? 64 : 30, 3);
      const bowl: [number, number] = [c.w * 0.45, c.horizon - 230];
      for (const d of dishes) {
        const pose = aimPose(d, screenTarget(c, d, bowl[0], bowl[1]));
        const C = pivotOf(d), a = axisOf(pose);
        const p0 = project(c, C), p1 = project(c, [C[0] + a[0], C[1] + a[1], C[2] + a[2]]);
        // the screen line through p0 and p1 passes through the bowl
        const cross = (p1[0] - p0[0]) * (bowl[1] - p0[1]) - (p1[1] - p0[1]) * (bowl[0] - p0[0]);
        const dist = Math.abs(cross) / Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        expect(dist).toBeLessThan(0.5);
        // and it points towards the bowl, not away from it
        expect((p1[0] - p0[0]) * (bowl[0] - p0[0]) + (p1[1] - p0[1]) * (bowl[1] - p0[1])).toBeGreaterThan(0);
        // the array looks up: the bowl tilts above the line of sight
        expect(pose.el).toBeGreaterThan(Math.atan2(c.camH - d.H, d.z));
      }
    }
  });

  test("the stare faces the eye", () => {
    const [d] = placeDishes(cam, 64, 11);
    const a = axisOf(aimPose(d, viewerTarget(cam)));
    expect(len(sub(a, unit(sub(cam.pos, pivotOf(d)))))).toBeLessThan(1e-9);
  });

  test("the bowl is a paraboloid with its focus where the feed is", () => {
    const [d] = placeDishes(cam, 64, 5);
    const pose = { az: 0.4, el: 0.7 };
    const fr = frameOf(pose), c = pivotOf(d);
    // a ray along the axis reflects through the focus: check the normal bisects at a few points
    const F: V3 = [c[0] + fr.a[0] * (d.off + d.F), c[1] + fr.a[1] * (d.off + d.F), c[2] + fr.a[2] * (d.off + d.F)];
    for (const [r, t] of [[1, 0.3], [3.5, 2], [d.R * 0.9, 4.4]]) {
      const P = bowlPoint(d, c, fr, r, t), n = bowlNormal(d, fr, r, t);
      expect(len(n)).toBeCloseTo(1, 9);
      const toF = unit(sub(F, P));
      // incoming along -a, reflected r = i - 2(i.n)n should point at the focus
      const i: V3 = [-fr.a[0], -fr.a[1], -fr.a[2]];
      const k = 2 * (i[0] * n[0] + i[1] * n[1] + i[2] * n[2]);
      const refl: V3 = [i[0] - k * n[0], i[1] - k * n[1], i[2] - k * n[2]];
      expect(len(sub(refl, toF))).toBeLessThan(1e-6);
    }
  });

  test("the mouth test: the floor sees out along the axis, not sideways under the rim", () => {
    const [d] = placeDishes(cam, 64, 5);
    const pose = { az: 0, el: 0.9 };
    const fr = frameOf(pose), c = pivotOf(d);
    const V = bowlPoint(d, c, fr, 0, 0);
    expect(throughMouth(d, c, fr.a, V, fr.a)).toBe(true);
    expect(throughMouth(d, c, fr.a, V, fr.u)).toBe(false);
    expect(throughMouth(d, c, fr.a, V, [-fr.a[0], -fr.a[1], -fr.a[2]])).toBe(false);
  });

  test("placement is seeded, varied, and leaves room for yours", () => {
    const a = placeDishes(cam, 64, 42), b = placeDishes(cam, 64, 42), c = placeDishes(cam, 64, 43);
    expect(a.length).toBe(65);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(a.filter((d) => d.yours).length).toBe(1);
    expect(a.find((d) => d.yours)!.i).toBe(64);
    // back to front, and no two dishes share ground
    for (let i = 1; i < a.length; i++) expect(a[i].z).toBeLessThanOrEqual(a[i - 1].z);
    for (const p of a) for (const q of a) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(p.R + q.R);
    // drawn with variation, never one sprite: sizes, optics, feeds and mounts differ
    const uniq = (f: (d: DishSpec) => unknown) => new Set(a.map(f)).size;
    expect(uniq((d) => d.R.toFixed(2))).toBeGreaterThan(30);
    expect(uniq((d) => (d.F / d.R).toFixed(2))).toBeGreaterThan(10);
    expect(uniq((d) => d.feed)).toBe(2);
    expect(uniq((d) => d.legs)).toBe(2);
    expect(uniq((d) => d.mount)).toBe(2);
    // breathing periods are whole beats
    for (const d of a) { expect(Number.isInteger(d.breath.ta)).toBe(true); expect(d.breath.aa).toBeLessThan(Math.PI / 180); }
  });

  test("phones get about thirty dishes in their own composition", () => {
    const p = placeDishes(phoneCam, 30, 7);
    expect(p.length).toBe(31);
  });
});

// ---------- the API against a recording canvas ----------

type Rec = { calls: string[] };
function fakeCanvas(rec: Rec) {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return (s: string) => ({ width: s.length * 7 });
      if (prop === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return (...args: unknown[]) => { rec.calls.push(prop); void args; };
    },
    set(target, prop: string, v) { target[prop] = v; return true; },
  });
  return { width: 300, height: 150, style: {} as Record<string, string>, getContext: () => ctx };
}

describe("field API", () => {
  const rec: Rec = { calls: [] };
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  beforeAll(() => {
    for (const k of ["document", "requestAnimationFrame", "cancelAnimationFrame"]) saved[k] = g[k];
    g.document = { createElement: () => fakeCanvas(rec) };
    g.requestAnimationFrame = (fn: (t: number) => void) => setTimeout(() => fn(performance.now()), 16) as unknown as number;
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  });
  afterAll(() => { for (const k of Object.keys(saved)) g[k] = saved[k]; });

  test("the contract: names, beat, every state, the settled frame", async () => {
    expect(BEAT).toBe(400);
    const canvas = fakeCanvas(rec) as unknown as HTMLCanvasElement;
    const field = createField(canvas, { dishes: 64, seed: 7, palette: { paper: "#f6f7f9", ink: "#10162a", night: "#1b2236" }, reducedMotion: false });
    for (const k of ["layout", "aimAt", "lookAt", "assign", "pulse", "yours", "flinch", "still", "destroy"]) expect(typeof (field as unknown as Record<string, unknown>)[k]).toBe("function");
    field.layout({ w: 1440, h: 900, dpr: 2 }, 600);
    expect(canvas.width).toBe(2880);
    expect(canvas.height).toBe(1800);
    expect(rec.calls.length).toBeGreaterThan(1000); // the field was drawn
    field.lookAt("viewer");
    field.aimAt(640, 340);
    field.aimAt(640, 340, { beats: 6 });
    field.assign("skeptic", "skeptic", true);
    field.assign("tide", "tide.near", false);
    field.pulse("skeptic", "no");
    field.pulse("never-assigned", "yes"); // seats itself
    field.yours("construction");
    field.yours("red");
    field.pulse(YOURS, "no");
    field.flinch();
    await new Promise((r) => setTimeout(r, 120));
    const img = field.still();
    expect(img && img.width).toBe(2880);
    expect(img && img.height).toBe(1800);
    field.yours("hidden");
    field.layout({ w: 390, h: 844, dpr: 3 }, 582); // dpr is capped at 2
    expect(canvas.width).toBe(780);
    field.destroy();
  });

  test("reduced motion settles at once and still renders", () => {
    const canvas = fakeCanvas(rec) as unknown as HTMLCanvasElement;
    const field = createField(canvas, { dishes: 30, seed: 2, palette: {}, reducedMotion: true });
    field.layout({ w: 390, h: 844, dpr: 1 }, 582);
    field.aimAt(200, 300);
    field.flinch();
    field.pulse("a", "yes");
    expect(field.still()).toBeTruthy();
    field.destroy();
  });
});
