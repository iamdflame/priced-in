// Point Source field: the dish array as one live illustration on a canvas.
//   const field = createField(canvas, { dishes: 64, seed: 7, palette, reducedMotion });
//   field.layout({ w, h, dpr }, groundTop); field.lookAt("viewer"); field.aimAt(bowlX, bowlY);
// Every duration is a whole number of beats (400 ms). No dependencies.

import {
  type Camera, type DishSpec, type Pose, type V3,
  aimPose, angDiff, bowlPoint, frameOf, makeCamera, pivotOf, placeDishes, project, screenTarget, viewerTarget,
} from "./geometry";
import { type Inks, anchors, dishBounds, drawDish, drawGround, facesEye, shadowPath, styleFor } from "./draw";
import { type RGB, css, mix, resolve } from "./color";

export const BEAT = 400;

export interface FieldPalette {
  paper?: string;   // the sky and the lit faces
  ink?: string;     // line work
  night?: string;   // the ground
  haze?: string;    // the horizon's air
  red?: string;     // the red pen
  redText?: string; // red at text sizes
}

export interface FieldOptions {
  dishes: number;
  seed: number;
  palette: FieldPalette;
  reducedMotion: boolean;
  /** Lettering for names; defaults to the display face's italic. */
  font?: string;
}

export interface Viewport { w: number; h: number; dpr: number }

export interface Field {
  layout(viewport: Viewport, groundTop: number): void;
  aimAt(x: number, y: number, opts?: { beats?: number }): void;
  lookAt(what: "viewer", opts?: { beats?: number }): void;
  assign(agentId: string, name: string, house: boolean): void;
  pulse(agentId: string, side: "yes" | "no"): void;
  yours(state: "hidden" | "construction" | "red"): void;
  flinch(): void;
  still(): ImageData | void;
  destroy(): void;
}

export const DEFAULT_PALETTE: Required<FieldPalette> = {
  paper: "oklch(0.975 0.004 255)",
  ink: "oklch(0.20 0.035 265)",
  night: "oklch(0.25 0.04 265)",
  haze: "oklch(0.74 0.03 265)",
  red: "oklch(0.62 0.21 32)",
  redText: "oklch(0.54 0.2 32)",
};

/** The id of the 65th dish, the visitor's own. pulse("yours", "no") fires its beam. */
export const YOURS = "yours";

// cubic-bezier easing, as in the design tokens
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const e = sx(t) - x; const d = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(d) < 1e-6) break; t -= e / d; }
    return ((ay * t + by) * t + cy) * t;
  };
}
const HEAVY = bezier(0.65, 0, 0.35, 1);
const EASE = bezier(0.22, 1, 0.36, 1);

interface DishState {
  spec: DishSpec;
  from: Pose; to: Pose; t0: number; dur: number;
  flinch: number;       // start time of a flinch, or -1
  flinchAmp: number;
  nod: number;          // start time of a trader's nod, or -1
}

interface Beam { dish: number; side: "yes" | "no"; t0: number }

interface Agent { id: string; name: string; house: boolean; dish: number }

const overlaps = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createField(canvas: HTMLCanvasElement, opts: FieldOptions): Field {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("field: no 2d context");
  const pal = { ...DEFAULT_PALETTE, ...opts.palette };
  const P: Record<keyof typeof DEFAULT_PALETTE, RGB> = {
    paper: resolve(pal.paper), ink: resolve(pal.ink), night: resolve(pal.night),
    haze: resolve(pal.haze), red: resolve(pal.red), redText: resolve(pal.redText),
  };
  const inks: Inks = {
    paper: P.paper, ink: P.ink, night: P.night, haze: P.haze, red: P.red,
    deep: mix(P.ink, [0, 0, 0], 0.45),
    rule: mix(P.night, P.paper, 0.42),
    dust: mix(P.night, P.haze, 0.3),
  };
  const font = opts.font || '"Amstelvar", Georgia, serif';
  const reduced = !!opts.reducedMotion;
  const count = Math.max(1, Math.floor(opts.dishes));

  let cam: Camera | null = null;
  let dpr = 1;
  let dishes: DishState[] = [];            // back to front
  let byIndex: DishState[] = [];           // by spec.i (count = yours)
  let ground: HTMLCanvasElement | null = null;
  let mode: { kind: "viewer" } | { kind: "point"; x: number; y: number } = { kind: "viewer" };
  let yoursState: "hidden" | "construction" | "red" = "hidden";
  const agents = new Map<string, Agent>();
  const beams: Beam[] = [];
  const lastTrade = new Map<string, number>();
  let raf = 0;
  let destroyed = false;
  let lastFlinch = -1;
  let visible = true;
  let frozen = false; // still(): draw the settled frame

  const targetPose = (d: DishSpec): Pose => {
    if (!cam) return { az: 0, el: 0 };
    const t: V3 = mode.kind === "viewer" ? viewerTarget(cam) : screenTarget(cam, d, mode.x, mode.y);
    return aimPose(d, t);
  };

  function poseAt(s: DishState, t: number, settled: boolean, breathe = true): Pose {
    if (settled || reduced) return { ...s.to };
    const k = s.dur <= 0 ? 1 : HEAVY(Math.min(1, Math.max(0, (t - s.t0) / s.dur)));
    let az = s.from.az + angDiff(s.from.az, s.to.az) * k;
    let el = s.from.el + (s.to.el - s.from.el) * k;
    if (!breathe) return { az, el };
    // idle breathing, within a degree, on whole-beat periods
    const b = s.spec.breath;
    const tb = t / BEAT;
    az += Math.sin((tb / b.ta) * Math.PI * 2 + b.pa) * b.aa;
    el += Math.sin((tb / b.te) * Math.PI * 2 + b.pe) * b.ae;
    // a flinch: a quick recoil and settle over two beats
    if (s.flinch >= 0) {
      const u = (t - s.flinch) / (2 * BEAT);
      if (u >= 0 && u < 1) el -= s.flinchAmp * Math.sin(Math.PI * Math.min(1, u * 2.2)) * Math.exp(-3 * u) * (u < 1 ? 1 : 0);
    }
    // the trader's nod: dips and comes back on the pulse
    if (s.nod >= 0) {
      const u = (t - s.nod) / (2 * BEAT);
      if (u >= 0 && u < 1) el -= (2.2 * Math.PI / 180) * Math.sin(Math.PI * u) * (1 - u);
    }
    return { az, el };
  }

  function retarget(beats: number, staggerFrom: number | null) {
    const t = now();
    const total = Math.max(0, beats) * BEAT;
    for (const s of dishes) {
      const cur = poseAt(s, t, false);
      s.from = cur;
      s.to = targetPose(s.spec);
      if (reduced || total === 0 || !cam) { s.from = { ...s.to }; s.dur = 0; s.t0 = t; continue; }
      const each = Math.min(total, 2 * BEAT);
      let frac = 0;
      if (staggerFrom !== null) {
        const a = anchors(cam, s.spec, s.to);
        frac = Math.min(1, Math.abs(a.foot[0] - staggerFrom) / cam.w);
      } else {
        frac = (s.spec.i * 0.618) % 1;
      }
      s.t0 = t + frac * (total - each);
      s.dur = each;
    }
    kick();
  }

  function build() {
    if (!cam) return;
    const specs = placeDishes(cam, count, opts.seed);
    const prev = new Map(byIndex.map((s) => [s.spec.i, s]));
    dishes = specs.map((spec) => {
      const old = prev.get(spec.i);
      const s: DishState = { spec, from: { az: 0, el: 0 }, to: { az: 0, el: 0 }, t0: 0, dur: 0, flinch: -1, flinchAmp: 0, nod: -1 };
      s.to = targetPose(spec);
      s.from = old ? { ...s.to } : { ...s.to };
      return s;
    });
    byIndex = [];
    for (const s of dishes) byIndex[s.spec.i] = s;
    sprites.clear();
    // ground layer
    ground = document.createElement("canvas");
    ground.width = Math.round(cam.w * dpr); ground.height = Math.round(cam.h * dpr);
    const g = ground.getContext("2d");
    if (g) { g.setTransform(dpr, 0, 0, dpr, 0, 0); drawGround(g, cam, specs, inks, opts.seed); }
    // re-seat agents on the new layout
    const list = [...agents.values()];
    agents.clear();
    for (const a of list) seat(a.id, a.name, a.house);
  }

  /** Pick a dish for a name: clear mid-ground, spread across the field, room for lettering. */
  /** Screen box of a dish's bowl and pedestal. */
  function boxOf(s: DishState): [number, number, number, number] {
    const a = anchors(cam!, s.spec, s.to);
    const cy = a.foot[1] - (s.spec.H * cam!.f) / s.spec.z;
    return [a.foot[0] - a.rpx * 1.05, cy - a.rpx * 1.05, a.foot[0] + a.rpx * 1.05, a.foot[1] + 2];
  }
  /** Is a label box over a bowl standing nearer than depth z? */
  function overNearer(box: number[], z: number): boolean {
    for (const o of dishes) {
      if (o.spec.z >= z) continue;
      if (o.spec.yours && yoursState === "hidden") continue;
      if (overlaps(box, boxOf(o))) return true;
    }
    return false;
  }

  function seat(id: string, name: string, house: boolean) {
    if (!cam) { agents.set(id, { id, name, house, dish: -1 }); return; }
    const used = new Set([...agents.values()].map((a) => a.dish));
    const taken = [...agents.values()].map((a) => byIndex[a.dish]).filter(Boolean).map((s) => anchors(cam!, s.spec, s.to).foot);
    const band = cam.h - cam.horizon;
    let best = -1, bestScore = -Infinity;
    for (const strict of [true, false]) {
      for (const s of dishes) {
        if (s.spec.yours || used.has(s.spec.i)) continue;
        const a = anchors(cam, s.spec, s.to);
        const fx = a.foot[0], fy = a.foot[1];
        if (strict) {
          if (a.rpx < (cam.w < 720 ? 9 : 12) || a.rpx > band * 0.3) continue;
          if (fx - a.rpx < 10 || fx + a.rpx > cam.w - 10 || fy > cam.h - 30) continue;
          // never a name over a nearer bowl
          const lw = Math.min(150, 9 * name.length + (house ? 45 : 0));
          if (overNearer([fx - lw / 2, fy + 4, fx + lw / 2, fy + 22], s.spec.z)) continue;
        } else if (a.rpx < 3 || fx < 0 || fx > cam.w) continue;
        let dmin = 1e9;
        for (const p of taken) dmin = Math.min(dmin, Math.hypot(p[0] - fx, (p[1] - fy) * 3));
        const score = Math.min(dmin, 400) + a.rpx * 0.6 - Math.abs(fy - (cam.horizon + band * 0.5)) * 0.15;
        if (score > bestScore) { bestScore = score; best = s.spec.i; }
      }
      if (best >= 0) break;
    }
    agents.set(id, { id, name, house, dish: best });
  }

  // ---------- render ----------

  /**
   * A near dish lives in two cached layers, mount and bowl, painted at one pose. Small turns
   * (breathing, a flinch, a nod) are shown by warping the bowl layer with the affine map that
   * carries three of its points to where the new pose puts them; only real slews repaint.
   */
  interface Sprite {
    mount: HTMLCanvasElement; bowl: HTMLCanvasElement;
    x: number; y: number; w: number; h: number;
    pose: Pose; key: string; fast: boolean; front: boolean;
    ref: number[]; // screen points of the three references at the painted pose
  }
  const sprites = new Map<number, Sprite>();
  const isSlewing = (s: DishState, t: number) => !reduced && t < s.t0 + s.dur;

  /** Screen positions of the bowl's centre and two rim points (for the warp). */
  function refs(d: DishSpec, pose: Pose): number[] {
    const fr = frameOf(pose), c = pivotOf(d);
    const out: number[] = [];
    for (const [r, t] of [[0, 0], [d.R, 0], [d.R, Math.PI / 2]] as const) {
      const p = project(cam!, bowlPoint(d, c, fr, r, t));
      out.push(p[0], p[1]);
    }
    return out;
  }

  function paintSprite(s: DishState, pose: Pose, key: string, fast: boolean, red: boolean): Sprite {
    const c = cam!;
    const b = dishBounds(c, s.spec, pose);
    const m = 8;
    const x0 = Math.max(0, Math.floor((b[0] - m) * dpr)), y0 = Math.max(0, Math.floor((b[1] - m) * dpr));
    const x1 = Math.min(Math.round(c.w * dpr), Math.ceil((b[2] + m) * dpr)), y1 = Math.min(Math.round(c.h * dpr), Math.ceil((b[3] + m) * dpr));
    const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
    let sp = sprites.get(s.spec.i);
    if (!sp) {
      sp = { mount: document.createElement("canvas"), bowl: document.createElement("canvas"), x: 0, y: 0, w: 0, h: 0, pose, key, fast, front: true, ref: [] };
      sprites.set(s.spec.i, sp);
    }
    for (const cv of [sp.mount, sp.bowl]) if (cv.width < w || cv.height < h) { cv.width = Math.max(cv.width, w); cv.height = Math.max(cv.height, h); }
    Object.assign(sp, { x: x0, y: y0, w, h, pose: { ...pose }, key, fast, front: facesEye(c, s.spec, pose), ref: refs(s.spec, pose) });
    if (w === 0 || h === 0) return sp;
    const mode = s.spec.yours ? (yoursState === "red" ? "red" : "construction") : "full";
    const st = styleFor(c, s.spec, inks, mode);
    if (red && !s.spec.yours) { st.line = css(inks.red); st.lineRGB = inks.red; }
    for (const part of ["mount", "bowl"] as const) {
      const g = (part === "mount" ? sp.mount : sp.bowl).getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      g.setTransform(dpr, 0, 0, dpr, -x0, -y0);
      drawDish(g, c, s.spec, pose, st, inks, fast, part);
    }
    return sp;
  }

  /** Composite a sprite, warping its bowl layer to the current pose. */
  function blit(ctx: CanvasRenderingContext2D, sp: Sprite, s: DishState, pose: Pose) {
    if (sp.w === 0 || sp.h === 0) return;
    const d = refs(s.spec, pose), r = sp.ref;
    const s1x = r[2] - r[0], s1y = r[3] - r[1], s2x = r[4] - r[0], s2y = r[5] - r[1];
    const d1x = d[2] - d[0], d1y = d[3] - d[1], d2x = d[4] - d[0], d2y = d[5] - d[1];
    const det = s1x * s2y - s2x * s1y;
    let A = 1, B = 0, C = 0, D = 1, tx = 0, ty = 0;
    if (Math.abs(det) > 1e-3) {
      // [A C; B D] * s_i = d_i
      A = (d1x * s2y - d2x * s1y) / det; C = (d2x * s1x - d1x * s2x) / det;
      B = (d1y * s2y - d2y * s1y) / det; D = (d2y * s1x - d1y * s2x) / det;
      tx = d[0] - (A * r[0] + C * r[1]); ty = d[1] - (B * r[0] + D * r[1]);
    }
    const drawBowl = () => {
      ctx.setTransform(A, B, C, D, tx * dpr, ty * dpr);
      ctx.drawImage(sp.bowl, 0, 0, sp.w, sp.h, sp.x, sp.y, sp.w, sp.h);
    };
    const drawMount = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(sp.mount, 0, 0, sp.w, sp.h, sp.x, sp.y, sp.w, sp.h);
    };
    if (sp.front) { drawMount(); drawBowl(); } else { drawBowl(); drawMount(); }
  }

  let farCache: HTMLCanvasElement | null = null;
  let farT = 0;
  let scene: HTMLCanvasElement | null = null;
  let sceneKey = "";
  /** Last frame's cost, for the review page's meter. */
  const stats = { far: 0, sprites: 0, painted: 0 };
  const shown = new Map<number, Pose>();
  let dirty = true;
  let farKey = "";
  const NEAR_PX = 10;

  function render(t: number) {
    if (!cam || !ctx) return;
    const settled = frozen;
    const W = Math.round(cam.w * dpr), H = Math.round(cam.h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    // the far layer (ground, every shadow, the small dishes) is rebuilt only when poses move
    // (flinches and nods are too small to see on the far dishes; only a wheel rebuilds them,
    // and then at most every other frame)
    let moving = false;
    for (const s of dishes) if (!settled && !reduced && t < s.t0 + s.dur) { moving = true; break; }
    const skip = moving && t - farT < 30 && farKey.startsWith("m");
    const key = skip ? farKey : moving ? `m${t}` : `rest|${yoursState}|${settled}`;
    const t0 = now();
    if (!farCache || farCache.width !== W || farCache.height !== H) { farCache = document.createElement("canvas"); farCache.width = W; farCache.height = H; farKey = ""; }
    if (key !== farKey) {
      const f = farCache.getContext("2d")!;
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.clearRect(0, 0, W, H);
      if (ground) f.drawImage(ground, 0, 0);
      f.setTransform(dpr, 0, 0, dpr, 0, 0);
      // every cast shadow, before any dish stands on the ground
      f.fillStyle = css(mix(inks.night, inks.deep, 0.55));
      f.beginPath();
      for (const s of dishes) {
        if (s.spec.yours && yoursState !== "red") continue;
        shadowPath(f, cam, s.spec, poseAt(s, t, settled, false));
      }
      f.fill();
      for (const s of dishes) {
        if (s.spec.yours) continue;
        if ((s.spec.R * cam.f) / s.spec.z >= NEAR_PX) continue;
        drawDish(f, cam, s.spec, poseAt(s, t, settled), styleFor(cam, s.spec, inks), inks, moving);
      }
      farKey = key;
      farT = t;
    }
    const t1 = now();
    let painted = 0;
    // Near dishes come from their own sprites, warped for small turns and repainted for real
    // ones. Dishes that are not moving are composited once into the scene layer; the moving
    // ones (and any nearer dish they pass behind) are drawn over it each frame.
    const near: { s: DishState; pose: Pose; active: boolean; box: number[] }[] = [];
    for (const s of dishes) {
      const isNear = (s.spec.R * cam.f) / s.spec.z >= NEAR_PX;
      if (s.spec.yours ? yoursState === "hidden" : !isNear) continue;
      const pose = poseAt(s, t, settled);
      const sp = sprites.get(s.spec.i);
      const active = !settled && !reduced && (t < s.t0 + s.dur || (s.flinch >= 0 && t < s.flinch + 2 * BEAT) || (s.nod >= 0 && t < s.nod + 2 * BEAT));
      near.push({ s, pose, active, box: sp ? [sp.x / dpr, sp.y / dpr, (sp.x + sp.w) / dpr, (sp.y + sp.h) / dpr] : [0, 0, cam.w, cam.h] });
    }
    // a still dish standing in front of a moving one has to be drawn after it
    for (let i = 0; i < near.length; i++) if (near[i].active) for (let j = i + 1; j < near.length; j++) if (!near[j].active && overlaps(near[i].box, near[j].box)) near[j].active = true;

    let budget = 1;             // quality upgrades per frame
    let slewBudget = 3;          // repaints per frame while the array wheels; the rest warp
    const order = near.map((n, i) => i);
    const prep = (n: (typeof near)[number]) => {
      const { s, pose } = n;
      const slew = !settled && isSlewing(s, t);
      const red = s.spec.yours ? yoursState === "red" : !settled && beams.some((x) => x.dish === s.spec.i && x.side === "no" && t - x.t0 < 3 * BEAT);
      const skey = s.spec.yours ? yoursState : red ? "red" : "ink";
      let sp = sprites.get(s.spec.i);
      const turn = sp ? Math.abs(angDiff(sp.pose.az, pose.az)) * Math.cos(pose.el) + Math.abs(pose.el - sp.pose.el) : Infinity;
      const deg = turn * (180 / Math.PI);
      const must = !sp || sp.key !== skey || settled || deg > (slew ? 3 : 5);
      const better = sp && sp.fast && !slew;
      if (must && sp && slew && sp.key === skey && deg < 14) {
        if (slewBudget <= 0) return sp;
        slewBudget--;
      }
      if (must || (better && budget > 0)) {
        if (!must) budget--;
        sp = paintSprite(s, pose, skey, slew, red);
        painted++;
      }
      return sp;
    };
    // the biggest turns get the repaints first
    order.sort((p, q) => {
      const a = near[p], b = near[q];
      const sa = sprites.get(a.s.spec.i), sb = sprites.get(b.s.spec.i);
      const da = sa ? Math.abs(angDiff(sa.pose.az, a.pose.az)) + Math.abs(a.pose.el - sa.pose.el) : 9;
      const db = sb ? Math.abs(angDiff(sb.pose.az, b.pose.az)) + Math.abs(b.pose.el - sb.pose.el) : 9;
      return db - da;
    });
    const sps: (Sprite | undefined)[] = [];
    for (const i of order) sps[i] = prep(near[i]);

    // the scene layer: far layer plus every still dish
    const activeKey = near.map((n) => (n.active ? "1" : "0")).join("");
    let rebuild = !scene || scene.width !== W || scene.height !== H || sceneKey !== `${farKey}|${activeKey}` || painted > 0;
    if (!rebuild) {
      for (let i = 0; i < near.length; i++) {
        const n = near[i];
        if (n.active) continue;
        const sh = shown.get(n.s.spec.i);
        const rpx = (n.s.spec.R * cam.f) / n.s.spec.z;
        if (!sh || (Math.abs(angDiff(sh.az, n.pose.az)) + Math.abs(n.pose.el - sh.el)) * rpx > 0.5) { rebuild = true; break; }
      }
    }
    if (rebuild) {
      if (!scene || scene.width !== W || scene.height !== H) { scene = document.createElement("canvas"); scene.width = W; scene.height = H; }
      const sc = scene.getContext("2d")!;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, W, H);
      sc.drawImage(farCache, 0, 0);
      for (let i = 0; i < near.length; i++) {
        const sp = sps[i];
        if (near[i].active || !sp) continue;
        blit(sc, sp, near[i].s, near[i].pose);
        shown.set(near[i].s.spec.i, near[i].pose);
      }
      sceneKey = `${farKey}|${activeKey}`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(scene!, 0, 0);
    for (let i = 0; i < near.length; i++) {
      const sp = sps[i];
      if (!near[i].active || !sp) continue;
      blit(ctx, sp, near[i].s, near[i].pose);
      shown.set(near[i].s.spec.i, near[i].pose);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    stats.far = t1 - t0; stats.sprites = now() - t1; stats.painted = painted;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!settled) drawBeams(t);
    drawLabels(t, settled);
  }

  function aimPoint(): [number, number] {
    if (!cam) return [0, 0];
    return mode.kind === "point" ? [mode.x, mode.y] : [cam.cx, cam.horizon - (cam.h - cam.horizon)];
  }

  function drawBeams(t: number) {
    if (!cam || !ctx) return;
    for (let i = beams.length - 1; i >= 0; i--) if (t - beams[i].t0 > 4 * BEAT) beams.splice(i, 1);
    const [tx, ty] = aimPoint();
    for (const b of beams) {
      const s = byIndex[b.dish];
      if (!s) continue;
      const a = anchors(cam, s.spec, poseAt(s, t, false));
      const u = (t - b.t0) / BEAT; // beats since the pulse
      // beat 0..1 the line is drawn from the dish to the bowl; holds a beat; fades over two
      const head = reduced ? 1 : EASE(Math.min(1, Math.max(0, u)));
      const alpha = reduced ? (u < 4 ? 1 : 0) : u < 2 ? 1 : Math.max(0, 1 - (u - 2) / 2);
      if (alpha <= 0 || head <= 0) continue;
      const col = b.side === "no" ? inks.red : inks.ink;
      const x0 = a.feed[0], y0 = a.feed[1];
      const x1 = x0 + (tx - x0) * head, y1 = y0 + (ty - y0) * head;
      const L = Math.hypot(tx - x0, ty - y0) || 1;
      const nx = -(ty - y0) / L, ny = (tx - x0) / L;
      // a ruled line that thickens towards the bowl, like a pen pressed as it lands
      const w0 = 0.7, w1 = 0.7 + 1.5 * head;
      ctx.fillStyle = css(col, alpha);
      ctx.beginPath();
      ctx.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2);
      ctx.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
      ctx.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
      ctx.lineTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2);
      ctx.closePath(); ctx.fill();
      // the pulse itself: a short heavier stroke riding the head while it travels
      if (!reduced && u < 1) {
        const back = Math.max(0, head - 0.06);
        const xb = x0 + (tx - x0) * back, yb = y0 + (ty - y0) * back;
        ctx.strokeStyle = css(col, alpha);
        ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(xb, yb); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
  }

  function drawLabels(_t: number, _settled: boolean) {
    if (!cam || !ctx) return;
    const phone = cam.w < 720;
    const size = phone ? 14 : 15;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const boxes: [number, number, number, number][] = [];
    const items: { x: number; y: number; name: string; house: boolean; red: boolean; pri: number; z: number }[] = [];
    // the visitor's dish first, then whoever traded last, then the house, then the rest
    const ys = byIndex[count];
    if (ys && yoursState !== "hidden") {
      const an = anchors(cam, ys.spec, ys.to);
      items.push({ x: an.foot[0], y: an.foot[1] + Math.max(5, an.rpx * 0.12), name: "yours", house: false, red: yoursState === "red", pri: 1e15, z: ys.spec.z });
    }
    for (const a of agents.values()) {
      const s = byIndex[a.dish];
      if (!s) continue;
      const an = anchors(cam, s.spec, s.to);
      items.push({ x: an.foot[0], y: an.foot[1] + Math.max(5, an.rpx * 0.12), name: a.name, house: a.house, red: false, pri: (lastTrade.get(a.id) || 0) + (a.house ? 1 : 0), z: s.spec.z });
    }
    items.sort((p, q) => q.pri - p.pri);
    for (const it of items) {
      ctx.font = `italic 400 ${size}px ${font}`;
      const main = it.name;
      const tail = it.house ? ", house" : "";
      const wMain = ctx.measureText(main).width;
      ctx.font = `italic 300 ${size}px ${font}`;
      const wTail = tail ? ctx.measureText(tail).width : 0;
      const wAll = wMain + wTail;
      const x = Math.min(cam.w - 8 - wAll / 2, Math.max(8 + wAll / 2, it.x));
      const y = Math.min(cam.h - size - 6, it.y);
      if (it.y > cam.h - size - 6 && it.name !== "yours") continue; // its foot is off the plate
      // a name that would crowd another is left off until its dish trades
      const pad = 10;
      if (boxes.some((b) => x + wAll / 2 + pad > b[0] && x - wAll / 2 - pad < b[2] && y + size + 4 > b[1] && y - 4 < b[3])) continue;
      if (overNearer([x - wAll / 2, y, x + wAll / 2, y + size], it.z)) continue;
      boxes.push([x - wAll / 2, y, x + wAll / 2, y + size]);
      const left = x - wAll / 2;
      // the engraver clears the ground around the lettering
      ctx.textAlign = "left";
      ctx.lineJoin = "round";
      ctx.strokeStyle = css(inks.night, 0.92);
      ctx.lineWidth = 5;
      ctx.font = `italic 400 ${size}px ${font}`;
      ctx.strokeText(main, left, y);
      ctx.fillStyle = it.red ? css(P.red) : css(mix(inks.paper, inks.haze, 0.08));
      ctx.fillText(main, left, y);
      if (tail) {
        ctx.font = `italic 300 ${size}px ${font}`;
        ctx.strokeText(tail, left + wMain, y);
        ctx.fillStyle = css(mix(inks.paper, inks.night, 0.38));
        ctx.fillText(tail, left + wMain, y);
      }
    }
  }

  // ---------- the clock ----------

  function busyUntil(): number {
    let u = 0;
    for (const s of dishes) u = Math.max(u, s.t0 + s.dur, s.flinch + 2 * BEAT, s.nod + 2 * BEAT);
    for (const b of beams) u = Math.max(u, b.t0 + 4 * BEAT);
    return u;
  }

  function frame() {
    raf = 0;
    if (destroyed || !cam) return;
    const t = now();
    // when only breathing is going on, paint a frame only once some dish has drifted a
    // third of a pixel from where it was last drawn
    if (dirty || t < busyUntil() || drifted(t)) { dirty = false; render(t); }
    // idle dishes keep breathing; reduced motion stops once nothing is pending
    const more = !reduced || t < busyUntil();
    if (more && visible) raf = requestAnimationFrame(frame);
    else if (reduced && beams.length) setTimeout(kick, BEAT);
  }

  function drifted(t: number): boolean {
    if (!cam || reduced) return false;
    for (const s of dishes) {
      const rpx = (s.spec.R * cam.f) / s.spec.z;
      if (rpx < NEAR_PX || (s.spec.yours && yoursState === "hidden")) continue;
      const sh = shown.get(s.spec.i);
      if (!sh) return true;
      const p = poseAt(s, t, false);
      if ((Math.abs(angDiff(sh.az, p.az)) + Math.abs(p.el - sh.el)) * rpx > 0.5) return true;
    }
    return false;
  }

  function kick() {
    dirty = true;
    if (destroyed || raf || !cam) return;
    raf = requestAnimationFrame(frame);
  }

  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick(); });
    io.observe(canvas);
  }

  // ---------- the API ----------

  const field: Field = {
    layout(viewport, groundTop) {
      dpr = Math.min(2, Math.max(1, viewport.dpr || 1));
      cam = makeCamera(viewport.w, viewport.h, groundTop);
      canvas.width = Math.round(viewport.w * dpr);
      canvas.height = Math.round(viewport.h * dpr);
      canvas.style.width = `${viewport.w}px`;
      canvas.style.height = `${viewport.h}px`;
      build();
      farKey = "";
      render(now());
      kick();
    },
    aimAt(x, y, o) {
      mode = { kind: "point", x, y };
      retarget(o?.beats ?? 3, x);
    },
    lookAt(_what, o) {
      mode = { kind: "viewer" };
      retarget(o?.beats ?? 2, null);
    },
    assign(agentId, name, house) {
      if (agentId === YOURS) return;
      seat(agentId, name, house);
      farKey = ""; kick();
    },
    pulse(agentId, side) {
      let idx: number;
      if (agentId === YOURS) idx = count;
      else {
        if (!agents.has(agentId)) seat(agentId, agentId, false);
        idx = agents.get(agentId)!.dish;
      }
      if (idx < 0 || !byIndex[idx]) return;
      const t = now();
      lastTrade.set(agentId, t);
      beams.push({ dish: idx, side, t0: t });
      if (!reduced) byIndex[idx].nod = t;
      kick();
    },
    yours(state) {
      yoursState = state;
      farKey = ""; kick();
      if (reduced) render(now());
    },
    flinch() {
      if (reduced || !cam) return;
      const t = now();
      if (t - lastFlinch < BEAT) return;
      lastFlinch = t;
      const [bx] = aimPoint();
      for (const s of dishes) {
        const a = anchors(cam, s.spec, s.to);
        // the wave runs out from under the bowl
        s.flinch = t + Math.min(1, Math.abs(a.foot[0] - bx) / cam.w) * BEAT;
        s.flinchAmp = (2 + (s.spec.i % 5) * 0.35) * (Math.PI / 180);
      }
      kick();
    },
    still() {
      if (!cam || !ctx) return;
      frozen = true;
      farKey = "";
      render(now());
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      frozen = false;
      farKey = "";
      kick();
      return img;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      agents.clear(); beams.length = 0; dishes = []; byIndex = [];
      ground = null; farCache = null; scene = null; sprites.clear();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
  Object.defineProperty(field, "stats", { value: stats, enumerable: false });
  return field;
}
