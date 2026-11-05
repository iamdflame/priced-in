// Point Source field: the drawing. One hand for every mark: ink ribbons whose width is the
// tone (a burin line swells in shade and vanishes in light), line weight by distance, light
// from the left, cast shadows on the ground, atmosphere toward the horizon. Nothing here is a
// sprite: every dish is drawn from its geometry and pose each time.

import {
  type Camera, type DishSpec, type Frame, type Pose, type V3,
  bowlPoint, clamp, depthOf, focusOf, frameOf, norm, pivotOf, rng,
} from "./geometry";
import { type RGB, css, mix } from "./color";

export interface Inks {
  paper: RGB; ink: RGB; night: RGB; haze: RGB; deep: RGB; red: RGB; rule: RGB; dust: RGB;
}

/** Toward the sun: low, from the left, slightly behind the viewer (dusk). */
export const SUN: V3 = norm([-0.6, 0.48, -0.64]);
const AMBIENT = 0.16;

// ---------- small 2D helpers ----------

const TAU = Math.PI * 2;

/** Scratch buffers reused for every polyline. */
let BX = new Float32Array(512), BY = new Float32Array(512), BW = new Float32Array(512);
function ensure(n: number) {
  if (BX.length < n) { BX = new Float32Array(n * 2); BY = new Float32Array(n * 2); BW = new Float32Array(n * 2); }
}

/**
 * Append a variable-width ribbon (an engraved line) for points [0, n) of the scratch buffers to
 * the current path. Runs below `min` width break the line; run ends taper like a burin's entry.
 */
function ribbon(ctx: CanvasRenderingContext2D, n: number, closed: boolean, min = 0.1) {
  if (n < 2) return;
  let allOn = closed;
  if (closed) for (let i = 0; i < n; i++) if (BW[i] < min) { allOn = false; break; }
  if (allOn) {
    // a full loop: outer edge one way, inner edge the other (nonzero leaves a hole)
    for (let pass = 0; pass < 2; pass++) {
      const s = pass === 0 ? 1 : -1;
      for (let k = 0; k < n; k++) {
        const i = pass === 0 ? k : n - 1 - k;
        const a = (i - 1 + n) % n, b = (i + 1) % n;
        let tx = BX[b] - BX[a], ty = BY[b] - BY[a];
        const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        const h = (BW[i] * 0.5) * s;
        const x = BX[i] - ty * h, y = BY[i] + tx * h;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    return;
  }
  // find the runs; for closed rings start at a break so a run can wrap
  let start = 0;
  if (closed) { for (let i = 0; i < n; i++) if (BW[i] < min) { start = i; break; } }
  const total = closed ? n + 1 : n;
  let runS = -1;
  const idx = (k: number) => (closed ? (start + k) % n : k);
  for (let k = 0; k <= total; k++) {
    const on = k < total && BW[idx(k)] >= min;
    if (on && runS < 0) runS = k;
    if (!on && runS >= 0) { emitRun(ctx, runS, k - 1, idx, n, closed); runS = -1; }
  }
}

function emitRun(ctx: CanvasRenderingContext2D, s: number, e: number, idx: (k: number) => number, n: number, closed: boolean) {
  if (e <= s) return;
  const len = e - s;
  const side = (pass: number) => {
    for (let j = 0; j <= len; j++) {
      const k = pass === 0 ? s + j : e - j;
      const i = idx(k);
      const ia = closed ? idx(Math.max(s, k - 1)) : Math.max(0, i - 1);
      const ib = closed ? idx(Math.min(e, k + 1)) : Math.min(n - 1, i + 1);
      let tx = BX[ib] - BX[ia], ty = BY[ib] - BY[ia];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const end = k === s || k === e ? 0.25 : k === s + 1 || k === e - 1 ? 0.7 : 1;
      const h = BW[i] * 0.5 * end * (pass === 0 ? 1 : -1);
      const x = BX[i] - ty * h, y = BY[i] + tx * h;
      if (pass === 0 && j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  };
  side(0); side(1); ctx.closePath();
}

/** Convex hull (monotone chain) of flat [x0,y0,x1,y1,...]; returns flat hull points. */
export function hull(pts: number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const ids = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const crossZ = (o: number, a: number, b: number) =>
    (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const lo: number[] = [], up: number[] = [];
  for (const i of ids) { while (lo.length >= 2 && crossZ(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
  for (let k = ids.length - 1; k >= 0; k--) { const i = ids[k]; while (up.length >= 2 && crossZ(up[up.length - 2], up[up.length - 1], i) <= 0) up.pop(); up.push(i); }
  lo.pop(); up.pop();
  const out: number[] = [];
  for (const i of lo.concat(up)) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

function polyPath(ctx: CanvasRenderingContext2D, p: number[]) {
  if (p.length < 4) return;
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
}

// ---------- the drawing style for one dish ----------

export interface DishStyle {
  fog: number;           // 0 near .. 1 lost in the haze
  line: string;          // outline and hatching ink
  lineRGB: RGB;
  face: string;          // lit surface (paper, hazed)
  wOut: number;          // outline width px
  spacing: number;       // hatch spacing px
  mode: "full" | "construction" | "red";
}

export function styleFor(cam: Camera, d: DishSpec, inks: Inks, mode: DishStyle["mode"] = "full"): DishStyle {
  const rpx = (d.R * cam.f) / d.z;
  const fog = clamp(1 - Math.exp(-d.z / (cam.zNear * 26)), 0, 0.92);
  const lineRGB = mode === "red" ? inks.red : mix(inks.ink, inks.haze, fog * 0.62);
  const face = mode === "red" ? inks.paper : mix(inks.paper, inks.haze, fog * 0.4);
  return {
    fog,
    line: css(lineRGB), lineRGB,
    face: css(face),
    wOut: clamp(0.32 + 0.105 * Math.sqrt(rpx), 0.4, 2.1),
    spacing: clamp(2.9 + rpx * 0.006, 2.9, 4.3),
    mode,
  };
}

/** Tone to hatch width: light areas carry no line, shade swells towards solid. */
const hatchW = (dark: number, sp: number) => {
  const x = clamp((dark - 0.22) / 0.78, 0, 1);
  // nothing in the light; shade swells towards two thirds of the spacing
  return sp * 0.64 * Math.pow(x, 1.25);
};

const lambert = (n: V3) => Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);

// ---------- shadows on the ground ----------

/** Ground point where the sun's ray through P lands. */
function shadowPt(P: V3): V3 { const t = P[1] / SUN[1]; return [P[0] - SUN[0] * t, 0, P[2] - SUN[2] * t]; }

/** Append the dish's cast shadow (bowl, pedestal, yoke) to the current path. */
export function shadowPath(ctx: CanvasRenderingContext2D, cam: Camera, d: DishSpec, pose: Pose) {
  const fr = frameOf(pose), c = pivotOf(d);
  const pr = (P: V3, out: number[]) => { const s = shadowPt(P); out.push(cam.cx + (cam.f * s[0]) / Math.max(0.5, s[2]), cam.horizon + (cam.f * cam.camH) / Math.max(0.5, s[2])); };
  const rpx = (d.R * cam.f) / d.z;
  const m = rpx < 6 ? 8 : rpx < 30 ? 16 : 28;
  const bowl: number[] = [];
  for (let j = 0; j < m; j++) pr(bowlPoint(d, c, fr, d.R, (j / m) * TAU), bowl);
  pr(bowlPoint(d, c, fr, 0, 0), bowl);
  polyPath(ctx, hull(bowl));
  // pedestal: its foot circle and its top circle
  const ped: number[] = [];
  const rTop = d.pedR1 * 1.3;
  for (let j = 0; j < 10; j++) {
    const t = (j / 10) * TAU;
    pr([d.x + Math.cos(t) * d.pedR0, 0.01, d.z + Math.sin(t) * d.pedR0], ped);
    pr([d.x + Math.cos(t) * rTop, d.pedTop + 0.9, d.z + Math.sin(t) * rTop], ped);
  }
  polyPath(ctx, hull(ped));
  // yoke arms
  for (const s of [-1, 1]) {
    const arm: number[] = [];
    const b: V3 = [d.x + fr.u[0] * d.yokeW * s, d.pedTop + 0.9, d.z + fr.u[2] * d.yokeW * s];
    const t: V3 = [c[0] + fr.u[0] * d.yokeW * s, c[1], c[2] + fr.u[2] * d.yokeW * s];
    for (const dx of [-0.4, 0.4]) {
      pr([b[0] + dx, b[1], b[2] + dx], arm); pr([t[0] + dx, t[1], t[2] + dx], arm);
    }
    polyPath(ctx, hull(arm));
  }
}

/**
 * Where the sun's ray through Q lands on the bowl's inner surface (a quadratic in the dish's
 * own frame), or null if it misses. Light travels along -SUN.
 */
function hitBowl(d: DishSpec, c: V3, fr: Frame, Q: V3): V3 | null {
  const V: V3 = [c[0] + fr.a[0] * d.off, c[1] + fr.a[1] * d.off, c[2] + fr.a[2] * d.off];
  const q: V3 = [Q[0] - V[0], Q[1] - V[1], Q[2] - V[2]];
  const h0 = q[0] * fr.a[0] + q[1] * fr.a[1] + q[2] * fr.a[2];
  const x0 = q[0] * fr.u[0] + q[1] * fr.u[1] + q[2] * fr.u[2];
  const y0 = q[0] * fr.v[0] + q[1] * fr.v[1] + q[2] * fr.v[2];
  const dh = -(SUN[0] * fr.a[0] + SUN[1] * fr.a[1] + SUN[2] * fr.a[2]);
  const dx = -(SUN[0] * fr.u[0] + SUN[1] * fr.u[1] + SUN[2] * fr.u[2]);
  const dy = -(SUN[0] * fr.v[0] + SUN[1] * fr.v[1] + SUN[2] * fr.v[2]);
  const A = dx * dx + dy * dy, B = 2 * (x0 * dx + y0 * dy) - 4 * d.F * dh, C = x0 * x0 + y0 * y0 - 4 * d.F * h0;
  let s: number;
  if (A < 1e-9) { if (Math.abs(B) < 1e-9) return null; s = -C / B; }
  else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const s1 = (-B - sq) / (2 * A), s2 = (-B + sq) / (2 * A);
    s = s1 > 1e-4 ? s1 : s2;
  }
  if (!(s > 1e-4)) return null;
  const x = x0 + dx * s, y = y0 + dy * s;
  if (x * x + y * y > d.R * d.R) return null;
  return [Q[0] - SUN[0] * s, Q[1] - SUN[1] * s, Q[2] - SUN[2] * s];
}

/** Screen polygons of the feed legs' and subreflector's shadows on the bowl face. */
function feedShadowPath(d: DishSpec, c: V3, fr: Frame, Fp: V3, cam: Camera): number[][] | null {
  const out: number[][] = [];
  const legR = Math.max(0.2, d.R * 0.03);
  for (let k = 0; k < d.legs; k++) {
    const A = bowlPoint(d, c, fr, d.R * 0.97, d.leg0 + (k / d.legs) * TAU);
    const L = norm([Fp[0] - A[0], Fp[1] - A[1], Fp[2] - A[2]]);
    const side = norm([SUN[1] * L[2] - SUN[2] * L[1], SUN[2] * L[0] - SUN[0] * L[2], SUN[0] * L[1] - SUN[1] * L[0]]);
    const left: number[] = [], right: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const Q: V3 = [A[0] + (Fp[0] - A[0]) * t, A[1] + (Fp[1] - A[1]) * t, A[2] + (Fp[2] - A[2]) * t];
      const h1 = hitBowl(d, c, fr, [Q[0] + side[0] * legR, Q[1] + side[1] * legR, Q[2] + side[2] * legR]);
      const h2 = hitBowl(d, c, fr, [Q[0] - side[0] * legR, Q[1] - side[1] * legR, Q[2] - side[2] * legR]);
      if (!h1 || !h2) continue;
      const p1 = projectXY(cam, h1), p2 = projectXY(cam, h2);
      left.push(p1[0], p1[1]); right.unshift(p2[0], p2[1]);
    }
    if (left.length >= 4) out.push(left.concat(right));
  }
  const rs = d.feed === "sub" ? d.R * 0.12 : d.R * 0.065;
  const disc: number[] = [];
  for (let j = 0; j < 20; j++) {
    const t = (j / 20) * TAU;
    const ct = Math.cos(t) * rs, st = Math.sin(t) * rs;
    const Q: V3 = [Fp[0] + fr.u[0] * ct + fr.v[0] * st, Fp[1] + fr.u[1] * ct + fr.v[1] * st, Fp[2] + fr.u[2] * ct + fr.v[2] * st];
    const hh = hitBowl(d, c, fr, Q);
    if (hh) { const p = projectXY(cam, hh); disc.push(p[0], p[1]); }
  }
  if (disc.length >= 6) out.push(hull(disc));
  return out.length ? out : null;
}

// ---------- parts ----------

interface Ctx2 { ctx: CanvasRenderingContext2D; cam: Camera; st: DishStyle; eye: V3; inks: Inks; fast: boolean }


/** Orthonormal pair perpendicular to A. */
function perp(A: V3): [V3, V3] {
  const t: V3 = Math.abs(A[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const p = norm([A[1] * t[2] - A[2] * t[1], A[2] * t[0] - A[0] * t[2], A[0] * t[1] - A[1] * t[0]]);
  const q: V3 = [A[1] * p[2] - A[2] * p[1], A[2] * p[0] - A[0] * p[2], A[0] * p[1] - A[1] * p[0]];
  return [p, q];
}

/**
 * A frustum (pedestal, plinth, turret, hub, feed horn) from B along A for L metres, radius r0
 * to r1. Filled with the lit face, hatched along its generators by tone, outlined.
 */
function frustum(g: Ctx2, B: V3, A: V3, L: number, r0: number, r1: number, cap = false) {
  const { ctx, cam, st } = g;
  const [p, q] = perp(A);
  const T: V3 = [B[0] + A[0] * L, B[1] + A[1] * L, B[2] + A[2] * L];
  const zMid = (B[2] + T[2]) / 2;
  const rpx = (Math.max(r0, r1) * cam.f) / Math.max(0.5, zMid);
  if (rpx < 0.35) {
    // a thread
    const a = projectXY(cam, B), b = projectXY(cam, T);
    ctx.strokeStyle = st.face; ctx.lineWidth = Math.max(0.5, rpx * 2);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    return;
  }
  const m = clamp(Math.round((rpx * 4.4) / st.spacing), 8, 72);
  const pts: number[] = [];
  const slope = (r0 - r1) / Math.max(0.01, L);
  const gens: { x0: number; y0: number; x1: number; y1: number; w: number }[] = [];
  for (let j = 0; j < m; j++) {
    const t = (j / m) * TAU, ct = Math.cos(t), sn = Math.sin(t);
    const dirx = p[0] * ct + q[0] * sn, diry = p[1] * ct + q[1] * sn, dirz = p[2] * ct + q[2] * sn;
    const P0: V3 = [B[0] + dirx * r0, B[1] + diry * r0, B[2] + dirz * r0];
    const P1: V3 = [T[0] + dirx * r1, T[1] + diry * r1, T[2] + dirz * r1];
    const a = projectXY(cam, P0), b = projectXY(cam, P1);
    pts.push(a[0], a[1], b[0], b[1]);
    const n = norm([dirx + A[0] * slope, diry + A[1] * slope, dirz + A[2] * slope]);
    const mid: V3 = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2, (P0[2] + P1[2]) / 2];
    const vis = n[0] * (g.eye[0] - mid[0]) + n[1] * (g.eye[1] - mid[1]) + n[2] * (g.eye[2] - mid[2]);
    if (vis > 0) {
      const dark = 1 - (0.06 + 0.94 * lambert(n));
      const w = hatchW(dark, st.spacing);
      if (w > 0.1) gens.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], w });
    }
  }
  const h = hull(pts);
  ctx.fillStyle = st.face;
  ctx.beginPath(); polyPath(ctx, h); ctx.fill();
  if (st.mode === "construction") return;
  ctx.fillStyle = st.line;
  ctx.beginPath();
  for (const s of gens) {
    BX[0] = s.x0; BY[0] = s.y0; BW[0] = s.w;
    BX[1] = (s.x0 + s.x1) / 2; BY[1] = (s.y0 + s.y1) / 2; BW[1] = s.w;
    BX[2] = s.x1; BY[2] = s.y1; BW[2] = s.w * 0.9;
    ribbon(ctx, 3, false);
  }
  ctx.fill();
  ctx.strokeStyle = st.line; ctx.lineWidth = st.wOut * 0.8; ctx.lineJoin = "round";
  ctx.beginPath(); polyPath(ctx, h); ctx.stroke();
  if (cap && rpx > 4) {
    // the end facing us: its lip, and a crescent of shade on the side away from the sun
    const facing = A[0] * (g.eye[0] - T[0]) + A[1] * (g.eye[1] - T[1]) + A[2] * (g.eye[2] - T[2]) > 0;
    if (facing) {
      ctx.lineWidth = st.wOut * 0.5;
      ctx.beginPath();
      for (let j = 0; j <= 24; j++) {
        const t = (j / 24) * TAU, ct = Math.cos(t) * r1 * 0.78, sn = Math.sin(t) * r1 * 0.78;
        const pp = projectXY(cam, [T[0] + p[0] * ct + q[0] * sn, T[1] + p[1] * ct + q[1] * sn, T[2] + p[2] * ct + q[2] * sn]);
        if (j === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]);
      }
      ctx.stroke();
    }
  }
}

function projectXY(cam: Camera, P: V3): [number, number] {
  const z = Math.max(0.3, P[2]);
  return [cam.cx + (cam.f * P[0]) / z, cam.horizon - (cam.f * (P[1] - cam.camH)) / z];
}

/** A planar box face hatched along one edge direction. Corners in order; n is the outward normal. */
function face(g: Ctx2, C4: V3[], n: V3) {
  const { ctx, cam, st, eye } = g;
  const mid: V3 = [(C4[0][0] + C4[2][0]) / 2, (C4[0][1] + C4[2][1]) / 2, (C4[0][2] + C4[2][2]) / 2];
  if (n[0] * (eye[0] - mid[0]) + n[1] * (eye[1] - mid[1]) + n[2] * (eye[2] - mid[2]) <= 0) return;
  const P = C4.map((c) => projectXY(cam, c));
  ctx.fillStyle = st.face;
  ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = st.line; ctx.lineWidth = st.wOut * 0.75; ctx.stroke();
  if (st.mode === "construction") return;
  const dark = 1 - (AMBIENT + (1 - AMBIENT) * lambert(n));
  const w = hatchW(dark, st.spacing);
  if (w < 0.12) return;
  // lines run P0->P1, stepped across P0->P3
  const across = Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1]);
  const k = Math.max(1, Math.floor(across / st.spacing));
  ctx.fillStyle = st.line;
  ctx.beginPath();
  for (let i = 1; i < k; i++) {
    const t = i / k;
    const ax = P[0][0] + (P[3][0] - P[0][0]) * t, ay = P[0][1] + (P[3][1] - P[0][1]) * t;
    const bx = P[1][0] + (P[2][0] - P[1][0]) * t, by = P[1][1] + (P[2][1] - P[1][1]) * t;
    BX[0] = ax; BY[0] = ay; BW[0] = w; BX[1] = (ax + bx) / 2; BY[1] = (ay + by) / 2; BW[1] = w; BX[2] = bx; BY[2] = by; BW[2] = w;
    ribbon(ctx, 3, false);
  }
  ctx.fill();
}

/** A box between two points (yoke arm, tower member), width along `side`, depth across. */
function beam(g: Ctx2, A: V3, B: V3, side: V3, wSide: number, wDepth: number) {
  const dir = norm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
  const s = norm(side);
  const dep = norm([dir[1] * s[2] - dir[2] * s[1], dir[2] * s[0] - dir[0] * s[2], dir[0] * s[1] - dir[1] * s[0]]);
  const c = (P: V3, a: number, b: number): V3 => [P[0] + s[0] * a + dep[0] * b, P[1] + s[1] * a + dep[1] * b, P[2] + s[2] * a + dep[2] * b];
  const hs = wSide / 2, hd = wDepth / 2;
  const faces: [V3[], V3][] = [
    [[c(A, -hs, hd), c(B, -hs, hd), c(B, hs, hd), c(A, hs, hd)], dep],
    [[c(A, -hs, -hd), c(B, -hs, -hd), c(B, hs, -hd), c(A, hs, -hd)], [-dep[0], -dep[1], -dep[2]]],
    [[c(A, hs, -hd), c(B, hs, -hd), c(B, hs, hd), c(A, hs, hd)], s],
    [[c(A, -hs, -hd), c(B, -hs, -hd), c(B, -hs, hd), c(A, -hs, hd)], [-s[0], -s[1], -s[2]]],
  ];
  for (const [C4, n] of faces) face(g, C4, n);
}

/** A thin member (feed leg, tower strut) as a tapered ink ribbon. */
function strut(g: Ctx2, A: V3, B: V3, wm: number, color: string, core?: string) {
  const { ctx, cam } = g;
  const a = projectXY(cam, A), b = projectXY(cam, B);
  const wa = Math.max(0.45, (wm * cam.f) / Math.max(0.5, A[2])), wb = Math.max(0.45, (wm * cam.f) / Math.max(0.5, B[2]));
  ctx.fillStyle = color;
  ctx.beginPath();
  BX[0] = a[0]; BY[0] = a[1]; BW[0] = wa;
  BX[1] = (a[0] + b[0]) / 2; BY[1] = (a[1] + b[1]) / 2; BW[1] = (wa + wb) / 2;
  BX[2] = b[0]; BY[2] = b[1]; BW[2] = wb;
  ribbon(ctx, 3, false, 0.05);
  ctx.fill();
  if (core && wa > 1.6) {
    ctx.fillStyle = core;
    ctx.beginPath();
    BW[0] = wa * 0.38; BW[1] = (wa + wb) * 0.19; BW[2] = wb * 0.38;
    ribbon(ctx, 3, false, 0.05);
    ctx.fill();
  }
}

// ---------- the dish ----------

/** Screen box (CSS px) that holds everything drawn for a dish at a pose. */
export function dishBounds(cam: Camera, d: DishSpec, pose: Pose): [number, number, number, number] {
  const fr = frameOf(pose), c = pivotOf(d);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (P: V3) => { const p = projectXY(cam, P); if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  for (let j = 0; j < 16; j++) add(bowlPoint(d, c, fr, d.R * 1.02, (j / 16) * TAU));
  add(bowlPoint(d, c, fr, 0, 0));
  const F = focusOf(d, c, fr.a);
  add([F[0] + fr.a[0], F[1] + fr.a[1], F[2] + fr.a[2]]);
  const rb = Math.max(d.pedR0 * 1.5, d.yokeW * 1.1);
  for (const [dx, dz] of [[-rb, -rb], [rb, -rb], [-rb, rb], [rb, rb]]) { add([d.x + dx, 0, d.z + dz]); add([d.x + dx, d.H, d.z + dz]); }
  const pad = 4 + 2.2 * clamp(0.32 + 0.105 * Math.sqrt((d.R * cam.f) / d.z), 0.4, 2.1);
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** Screen anchor points a caller needs: the feed (beam origin) and the foot (label). */
export interface Anchors { feed: [number, number]; foot: [number, number]; rpx: number }

export function anchors(cam: Camera, d: DishSpec, pose: Pose): Anchors {
  const fr = frameOf(pose), c = pivotOf(d);
  return { feed: projectXY(cam, focusOf(d, c, fr.a)), foot: projectXY(cam, [d.x, 0, d.z]), rpx: (d.R * cam.f) / d.z };
}

/** Draw one dish completely: mount, bowl (back and face), feed. */
/** Does the eye look into the bowl (true) or at its back? */
export function facesEye(cam: Camera, d: DishSpec, pose: Pose): boolean {
  const a = frameOf(pose).a, c = pivotOf(d), depth = depthOf(d), eye = cam.pos;
  return (eye[0] - c[0] - a[0] * depth) * a[0] + (eye[1] - c[1] - a[1] * depth) * a[1] + (eye[2] - c[2] - a[2] * depth) * a[2] > 0;
}

/**
 * Draw one dish completely, or one of its two moving parts: "mount" (pedestal, turret, yoke)
 * or "bowl" (bowl, legs, feed). The caller composites the parts mount-first when the eye looks
 * into the bowl, bowl-first when it sees the back.
 */
export function drawDish(ctx: CanvasRenderingContext2D, cam: Camera, d: DishSpec, pose: Pose, st: DishStyle, inks: Inks, fast = false, part: "all" | "mount" | "bowl" = "all") {
  const fr = frameOf(pose), c = pivotOf(d), a = fr.a;
  const eye = cam.pos;
  const g: Ctx2 = { ctx, cam, st, eye, inks, fast };
  const rpx = (d.R * cam.f) / d.z;
  const front = facesEye(cam, d, pose);

  if (st.mode === "construction") { if (part !== "mount") construction(g, d, pose); return; }

  // specks: a bowl and a stalk
  if (rpx < 3.2) {
    const pts: number[] = [];
    for (let j = 0; j < 10; j++) { const p = projectXY(cam, bowlPoint(d, c, fr, d.R, (j / 10) * TAU)); pts.push(p[0], p[1]); }
    const ft = projectXY(cam, [d.x, 0, d.z]), tp = projectXY(cam, [d.x, d.pedTop, d.z]);
    ctx.strokeStyle = st.line; ctx.lineWidth = Math.max(0.6, rpx * 0.3);
    ctx.beginPath(); ctx.moveTo(ft[0], ft[1]); ctx.lineTo(tp[0], tp[1]); ctx.stroke();
    ctx.fillStyle = st.face; ctx.beginPath(); polyPath(ctx, hull(pts)); ctx.fill();
    ctx.lineWidth = 0.7; ctx.stroke();
    return;
  }

  const legs = () => {
    const F = focusOf(d, c, a);
    const wm = Math.max(0.12, d.R * 0.022);
    for (let k = 0; k < d.legs; k++) {
      const t = d.leg0 + (k / d.legs) * TAU;
      strut(g, bowlPoint(d, c, fr, d.R * 0.97, t), F, wm, st.line, st.face);
    }
    if (d.feed === "horn") frustum(g, [F[0] - a[0] * 0.9, F[1] - a[1] * 0.9, F[2] - a[2] * 0.9], a, 1.3, d.R * 0.06, d.R * 0.035);
    else {
      frustum(g, [F[0] - a[0] * 0.3, F[1] - a[1] * 0.3, F[2] - a[2] * 0.3], a, 0.45, d.R * 0.1, d.R * 0.12, true);
    }
  };

  if (part === "mount") { mount(g, d, fr); return; }
  if (!front) legs();
  if (front && part === "all") mount(g, d, fr);
  bowl(g, d, c, fr, front, rpx);
  if (!front && part === "all") mount(g, d, fr);
  if (front) legs();
}

function mount(g: Ctx2, d: DishSpec, fr: Frame) {
  const top = d.pedTop;
  if (d.mount === "column") {
    frustum(g, [d.x, 0, d.z], [0, 1, 0], 0.5, d.pedR0 * 1.45, d.pedR0 * 1.4);
    frustum(g, [d.x, 0.5, d.z], [0, 1, 0], top - 0.5, d.pedR0, d.pedR1);
  } else {
    // a lattice tower: four legs, cross-braced, lit like everything else
    const { cam } = g;
    const corner = (r: number, k: number, y: number): V3 => [d.x + Math.cos(Math.PI / 4 + (k * Math.PI) / 2) * r, y, d.z + Math.sin(Math.PI / 4 + (k * Math.PI) / 2) * r];
    const rpx = (d.pedR0 * cam.f) / d.z;
    const col = g.st.face;
    const lv = [0, 0.33, 0.66, 1];
    for (let k = 0; k < 4; k++) {
      strut(g, corner(d.pedR0, k, 0), corner(d.pedR1, k, top), 0.22, col);
      if (rpx > 4) for (let i = 0; i < 3; i++) {
        const y0 = top * lv[i], y1 = top * lv[i + 1];
        const r0 = d.pedR0 + (d.pedR1 - d.pedR0) * lv[i], r1 = d.pedR0 + (d.pedR1 - d.pedR0) * lv[i + 1];
        strut(g, corner(r0, k, y0), corner(r1, (k + 1) % 4, y1), 0.1, col);
        strut(g, corner(r0, (k + 1) % 4, y0), corner(r1, k, y1), 0.1, col);
      }
    }
  }
  // turret, then the yoke arms up to the elevation bearings
  frustum(g, [d.x, top, d.z], [0, 1, 0], 0.9, d.pedR1 * 1.35, d.pedR1 * 1.25);
  const c = pivotOf(d);
  const fwd = norm([fr.u[2], 0, -fr.u[0]]);
  for (const s of [-1, 1]) {
    const B: V3 = [d.x + fr.u[0] * d.yokeW * 0.55 * s, top + 0.9, d.z + fr.u[2] * d.yokeW * 0.55 * s];
    const T: V3 = [c[0] + fr.u[0] * d.yokeW * s, c[1], c[2] + fr.u[2] * d.yokeW * s];
    beam(g, B, T, fwd, d.R * 0.12, d.R * 0.07);
  }
  // the cradle: from each elevation bearing a strut into the bowl's back structure, and the
  // bearing housing itself, a short drum along u
  const big = (d.R * g.cam.f) / d.z > 12;
  for (const s of [-1, 1]) {
    const T: V3 = [c[0] + fr.u[0] * d.yokeW * s, c[1], c[2] + fr.u[2] * d.yokeW * s];
    const S = bowlPoint(d, c, fr, d.R * 0.6, s > 0 ? 0 : Math.PI);
    const back: V3 = [S[0] - fr.a[0] * 0.25, S[1] - fr.a[1] * 0.25, S[2] - fr.a[2] * 0.25];
    beam(g, T, back, fr.v, d.R * 0.1, d.R * 0.06);
    if (big) frustum(g, [T[0] - fr.u[0] * 0.25 * s, T[1], T[2] - fr.u[2] * 0.25 * s], [fr.u[0] * s, fr.u[1] * s, fr.u[2] * s], 0.4, d.R * 0.055, d.R * 0.055, true);
  }
}

// shared trig tables, one per sample count
const TRIG = new Map<number, [Float32Array, Float32Array]>();
function trig(M: number): [Float32Array, Float32Array] {
  let t = TRIG.get(M);
  if (!t) {
    const c = new Float32Array(M), s = new Float32Array(M);
    for (let j = 0; j < M; j++) { c[j] = Math.cos((j / M) * TAU); s[j] = Math.sin((j / M) * TAU); }
    t = [c, s]; TRIG.set(M, t);
  }
  return t;
}

// the bowl's sample grid, reused between dishes
let GX = new Float32Array(4096), GY = new Float32Array(4096), GF = new Uint8Array(4096);
let GD = new Float32Array(4096), GA = new Float32Array(4096), GB = new Float32Array(4096);
const F_FRONT = 1, F_BACK = 2, F_SUN = 4;

/**
 * The bowl: one pass computes every sample (screen position, which side the eye sees, sun
 * through the mouth, tone), then the layers are drawn from it. All in the dish's own frame,
 * with scalars only, so a field of them can be redrawn every frame.
 */
function bowl(g: Ctx2, d: DishSpec, c: V3, fr: Frame, front: boolean, rpx: number) {
  const { ctx, cam, st, eye } = g;
  const a = fr.a, u = fr.u, v = fr.v;
  const fast = g.fast;
  const N = clamp(Math.round(rpx / st.spacing / (fast ? 2.1 : 1.05)), 2, 56);
  const M = clamp(Math.round(rpx * (fast ? 0.32 : 0.55)), 18, 140);
  const total = (N + 1) * M;
  if (GX.length < total) {
    const n = total * 2;
    GX = new Float32Array(n); GY = new Float32Array(n); GF = new Uint8Array(n);
    GD = new Float32Array(n); GA = new Float32Array(n); GB = new Float32Array(n);
  }
  ensure(M + 2);
  const [CT, SN] = trig(M);
  const R = d.R, F4 = 4 * d.F, depth = d.off + (R * R) / F4;
  const Ex = eye[0] - c[0], Ey = eye[1] - c[1], Ez = eye[2] - c[2];
  const Ea = Ex * a[0] + Ey * a[1] + Ez * a[2], Eu = Ex * u[0] + Ey * u[1] + Ez * u[2], Ev = Ex * v[0] + Ey * v[1] + Ez * v[2];
  const sa = SUN[0] * a[0] + SUN[1] * a[1] + SUN[2] * a[2], su = SUN[0] * u[0] + SUN[1] * u[1] + SUN[2] * u[2], sv = SUN[0] * v[0] + SUN[1] * v[1] + SUN[2] * v[2];
  const f = cam.f, cx = cam.cx, hor = cam.horizon, camH = cam.camH, R2 = R * R * 1.0001;

  for (let i = 0; i <= N; i++) {
    const r = (R * i) / N, h = d.off + (r * r) / F4, k = r / (2 * d.F), inv = 1 / Math.sqrt(1 + k * k);
    const bx = c[0] + a[0] * h, by = c[1] + a[1] * h, bz = c[2] + a[2] * h;
    const occ = 1 - 0.3 * (1 - i / N); // the bowl's floor sees less sky than its lip
    const tS = sa > 1e-5 ? (depth - h) / sa : -1;
    for (let j = 0; j < M; j++) {
      const ox = r * CT[j], oy = r * SN[j];
      const Px = bx + u[0] * ox + v[0] * oy, Py = by + u[1] * ox + v[1] * oy, Pz = bz + u[2] * ox + v[2] * oy;
      const q = i * M + j;
      const zz = Pz > 0.3 ? Pz : 0.3;
      GX[q] = cx + (f * Px) / zz; GY[q] = hor - (f * (Py - camH)) / zz;
      // eye direction in the dish frame
      const ea = Ea - h, eu = Eu - ox, ev = Ev - oy;
      const el = Math.sqrt(ea * ea + eu * eu + ev * ev) || 1;
      const nDotE = (ea - k * (CT[j] * eu + SN[j] * ev)) * inv / el; // inner normal . eye dir
      let flags = 0;
      if (ea > 1e-6) {
        const t = (depth - h) / (ea / el);
        const qu = ox + t * (eu / el), qv = oy + t * (ev / el);
        if (qu * qu + qv * qv <= R2) flags |= F_FRONT;
      }
      if (nDotE < 0) flags |= F_BACK;
      const nSun = (sa - k * (CT[j] * su + SN[j] * sv)) * inv; // inner normal . sun
      if (tS >= 0) {
        const qu = ox + tS * su, qv = oy + tS * sv;
        if (qu * qu + qv * qv <= R2) flags |= F_SUN;
      }
      GF[q] = flags;
      const ny = (a[1] - k * (CT[j] * u[1] + SN[j] * v[1])) * inv;
      const sky = Math.pow(0.5 + 0.5 * ny, 1.5) * occ;
      const direct = flags & F_SUN && nSun > 0 ? nSun : 0;
      GD[q] = 1 - (0.04 + 0.66 * direct + 0.42 * sky);       // face tone
      GA[q] = 1 - (0.04 + 0.42 * sky);                       // face tone without the sun
      const back = -nSun > 0 ? -nSun : 0, graze = 1 - Math.abs(nDotE);
      GB[q] = 1 - (AMBIENT + (1 - AMBIENT) * back) + graze * graze * 0.35; // back tone
    }
  }

  // silhouette: the bowl is convex, so the hull of its samples
  const sil: number[] = [];
  const step = Math.max(1, Math.floor(M / 48));
  for (let i = 0; i <= N; i += Math.max(1, Math.floor(N / 4))) for (let j = 0; j < M; j += step) sil.push(GX[i * M + j], GY[i * M + j]);
  for (let j = 0; j < M; j++) sil.push(GX[N * M + j], GY[N * M + j]);
  const hl = hull(sil);
  ctx.fillStyle = st.face;
  ctx.beginPath(); polyPath(ctx, hl); ctx.fill();

  const ring = (i: number, w: (q: number) => number, min = 0.1) => {
    const o = i * M;
    let any = false;
    for (let j = 0; j < M; j++) { BX[j] = GX[o + j]; BY[j] = GY[o + j]; const ww = w(o + j); BW[j] = ww; if (ww >= min) any = true; }
    if (any) ribbon(ctx, M, true, min);
  };

  // the convex back, hatched in rings where it turns from the sun
  ctx.fillStyle = st.line;
  ctx.beginPath();
  for (let i = 1; i <= N; i++) ring(i, (q) => (GF[q] & F_BACK ? hatchW(GB[q], st.spacing) : 0));
  // radial ribs of the backing structure
  if (!front && rpx > 14 && !fast) {
    const ribs = rpx > 60 ? 16 : 10;
    for (let m = 0; m < ribs; m++) {
      const j = Math.floor((m / ribs) * M);
      let n = 0, any = false;
      for (let i = 1; i <= N; i++) {
        const q = i * M + j;
        BX[n] = GX[q]; BY[n] = GY[q]; BW[n] = GF[q] & F_BACK ? st.wOut * 0.7 : 0; any = any || BW[n] > 0; n++;
      }
      if (any) ribbon(ctx, n, false);
    }
  }
  ctx.fill();

  if (front) {
    // the face inside the rim
    const rim: number[] = [];
    for (let j = 0; j < M; j++) rim.push(GX[N * M + j], GY[N * M + j]);
    ctx.fillStyle = st.face;
    ctx.beginPath(); polyPath(ctx, rim); ctx.fill();
    // rings that swell in the shade, with a little burin pressure in them
    ctx.fillStyle = st.line;
    ctx.beginPath();
    for (let i = 1; i < N; i++) {
      ring(i, (q) => {
        if (!(GF[q] & F_FRONT)) return 0;
        const j = q - i * M;
        return hatchW(GD[q], st.spacing) * (0.85 + 0.3 * Math.sin(j * 0.37 + i * 2.1) * Math.sin(j * 0.11 + i));
      });
    }
    ctx.fill();

    // the feed's cast shadow on the face (legs and subreflector), hatched with a crisp edge
    if (rpx > 70 && !fast) {
      const sh = feedShadowPath(d, c, fr, focusOf(d, c, a), cam);
      if (sh) {
        ctx.save();
        ctx.beginPath(); polyPath(ctx, rim); ctx.clip();
        ctx.beginPath(); for (const poly of sh) polyPath(ctx, poly); ctx.clip("nonzero");
        ctx.fillStyle = st.line;
        ctx.beginPath();
        for (let i = 1; i < N; i++) ring(i, (q) => (GF[q] & F_FRONT ? hatchW(GA[q] + 0.06, st.spacing) : 0));
        ctx.fill();
        ctx.restore();
      }
    }

    // the panels: rows of surface panels, each row with its own seams (they never line up)
    if (rpx > 9) {
      ctx.fillStyle = st.line;
      ctx.beginPath();
      const rows = rpx > 70 ? [0.16, 0.34, 0.52, 0.69, 0.85, 1] : rpx > 30 ? [0.2, 0.45, 0.72, 1] : [0.35, 0.7, 1];
      const wl = Math.max(0.35, st.wOut * 0.36);
      const rowI = rows.map((x) => Math.max(1, Math.min(N, Math.round(x * N))));
      for (let k = 0; k < rowI.length - 1; k++) {
        if (rowI[k] >= N) continue;
        ring(rowI[k], (q) => (GF[q] & F_FRONT ? wl : 0), 0.05);
        if (rpx < 20 || fast) continue;
        const nSeams = Math.round((rpx > 70 ? 10 : 7) * (k + 1.5));
        const ph = (k * 0.37) % 1;
        for (let m = 0; m < nSeams; m++) {
          const j = Math.floor(((m + ph) / nSeams) * M) % M;
          let n = 0;
          for (let i = rowI[k]; i <= rowI[k + 1]; i++) {
            const q = i * M + j;
            // structure reads in the light; in the shade the hatching carries it
            const lit = GF[q] & F_FRONT && GF[q] & F_SUN && GD[q] < 0.55;
            BX[n] = GX[q]; BY[n] = GY[q]; BW[n] = lit ? wl * 0.85 : 0; n++;
          }
          if (n >= 2) ribbon(ctx, n, false, 0.05);
        }
      }
      ctx.fill();
    }
    // the rim's lip: weight swells on the shaded side
    ctx.beginPath();
    ring(N, (q) => st.wOut * (0.75 + 0.9 * Math.min(1, GB[q])), 0.05);
    ctx.fill();
    // the lip's inner edge: a thin lit band of metal
    if (rpx > 16 && N > 3) {
      ctx.strokeStyle = st.line; ctx.lineWidth = st.wOut * 0.45;
      ctx.beginPath();
      const i = N - 1, w = 1 - 0.035 * N; // just inside the rim, on the ring before it
      for (let j = 0; j <= M; j++) {
        const q = N * M + (j % M), p = i * M + (j % M);
        const x = GX[p] + (GX[q] - GX[p]) * w, y = GY[p] + (GY[q] - GY[p]) * w;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // the silhouette
  ctx.strokeStyle = st.line; ctx.lineWidth = st.wOut; ctx.lineJoin = "round";
  ctx.beginPath(); polyPath(ctx, hl); ctx.stroke();

  // back hub
  if (!front) frustum(g, c, a, d.off, d.R * 0.1, d.R * 0.14);
}

/** The 65th dish, unbuilt: an architect's construction lines in dotted ink. */
function construction(g: Ctx2, d: DishSpec, pose: Pose) {
  const { ctx, cam, st } = g;
  const fr = frameOf(pose), c = pivotOf(d), a = fr.a;
  const M = 64;
  ctx.save();
  // drawn in chalk, like a surveyor's mark on the night ground
  ctx.strokeStyle = css(mix(g.inks.paper, g.inks.haze, 0.15), 0.85);
  ctx.lineWidth = Math.max(0.8, st.wOut * 0.6);
  ctx.setLineDash([2.5, 3.5]);
  ctx.lineCap = "round";
  const ring = (r: number) => {
    ctx.beginPath();
    for (let j = 0; j <= M; j++) { const p = projectXY(cam, bowlPoint(d, c, fr, r, (j / M) * TAU)); if (j === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
  };
  ring(d.R); ring(d.R * 0.55);
  // meridians
  for (let k = 0; k < 4; k++) {
    const t = (k / 4) * TAU + Math.PI / 4;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) { const p = projectXY(cam, bowlPoint(d, c, fr, d.R * (i / 12), t)); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
  }
  // the axis, through the focus and on
  const F = focusOf(d, c, a);
  const A0 = projectXY(cam, c), A1 = projectXY(cam, [F[0] + a[0] * d.R * 0.6, F[1] + a[1] * d.R * 0.6, F[2] + a[2] * d.R * 0.6]);
  ctx.setLineDash([7, 3, 1.5, 3]);
  ctx.beginPath(); ctx.moveTo(A0[0], A0[1]); ctx.lineTo(A1[0], A1[1]); ctx.stroke();
  // plumb line and the pedestal's two edges
  const foot = projectXY(cam, [d.x, 0, d.z]);
  ctx.beginPath(); ctx.moveTo(A0[0], A0[1]); ctx.lineTo(foot[0], foot[1]); ctx.stroke();
  ctx.setLineDash([2.5, 3.5]);
  const rp = (d.pedR0 * cam.f) / d.z, rt = (d.pedR1 * cam.f) / d.z;
  const top = projectXY(cam, [d.x, d.pedTop, d.z]);
  ctx.beginPath();
  ctx.moveTo(foot[0] - rp, foot[1]); ctx.lineTo(top[0] - rt, top[1]);
  ctx.moveTo(foot[0] + rp, foot[1]); ctx.lineTo(top[0] + rt, top[1]);
  ctx.stroke();
  // ground circle for the pad
  ctx.beginPath();
  for (let j = 0; j <= 40; j++) {
    const t = (j / 40) * TAU;
    const p = projectXY(cam, [d.x + Math.cos(t) * d.pedR0 * 2.4, 0, d.z + Math.sin(t) * d.pedR0 * 2.4]);
    if (j === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  }
  ctx.stroke();
  // focus cross
  ctx.setLineDash([]);
  const fp = projectXY(cam, F), s = 4;
  ctx.beginPath(); ctx.moveTo(fp[0] - s, fp[1]); ctx.lineTo(fp[0] + s, fp[1]); ctx.moveTo(fp[0], fp[1] - s); ctx.lineTo(fp[0], fp[1] + s); ctx.stroke();
  ctx.restore();
}

// ---------- the ground (static per layout) ----------

/** Smooth value noise for the plateau's swells. */
function noise2(seed: number) {
  const at = (x: number, y: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c2 = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
  };
}

export function drawGround(ctx: CanvasRenderingContext2D, cam: Camera, dishes: DishSpec[], inks: Inks, seed: number) {
  const { w, h, horizon } = cam;
  const r = rng(seed ^ 0x5eed);
  const nz = noise2(seed ^ 0x77);
  const band = h - horizon;

  // the plateau
  ctx.fillStyle = css(inks.night);
  ctx.fillRect(0, horizon, w, band + 2);

  // terrain height (m) at a ground point: long low swells, a shallow drainage line
  const terr = (X: number, Z: number) => (nz(X / 140 + 3.1, Z / 140) - 0.5) * 3.2 + (nz(X / 34 + 9.7, Z / 40 + 4.2) - 0.5) * 0.9;
  const slopeLight = (X: number, Z: number) => {
    const e = 1.2;
    const dx = (terr(X + e, Z) - terr(X - e, Z)) / (2 * e), dz = (terr(X, Z + e) - terr(X, Z - e)) / (2 * e);
    const n = norm([-dx, 1, -dz]);
    return lambert(n);
  };
  const fogAt = (Z: number) => clamp(1 - Math.exp(-Z / (cam.zNear * 26)), 0, 1);

  // the far escarpment: a low line of flat-topped koppies, drawn as finely as the air allows
  {
    const Z = cam.zNear * 140;
    const span = (w * Z) / cam.f;
    const top: number[] = [];
    const steps = Math.ceil(w / 3);
    const hills = 2 + Math.floor(r() * 3);
    const hs: { c: number; half: number; hgt: number; sl: number }[] = [];
    for (let k = 0; k < hills; k++) hs.push({ c: (r() - 0.5) * span * 1.1, half: span * (0.03 + r() * 0.09), hgt: 30 + r() * 60, sl: span * (0.012 + r() * 0.02) });
    for (let i = 0; i <= steps; i++) {
      const sx = (i / steps) * w;
      const X = ((sx - cam.cx) * Z) / cam.f;
      let y = 0;
      for (const m of hs) {
        const dx = Math.abs(X - m.c) - m.half;
        const v = dx <= 0 ? m.hgt * (1 + (nz(X / 60, 9) - 0.5) * 0.06) : m.hgt * Math.max(0, 1 - dx / m.sl) ** 1.6;
        y = Math.max(y, v);
      }
      const p = projectXY(cam, [X, Math.max(0, y), Z]);
      top.push(p[0], Math.min(horizon, p[1]));
    }
    ctx.fillStyle = css(mix(inks.haze, inks.paper, 0.45));
    ctx.beginPath(); ctx.moveTo(0, horizon);
    for (let i = 0; i < top.length; i += 2) ctx.lineTo(top[i], top[i + 1]);
    ctx.lineTo(w, horizon); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = css(mix(inks.haze, inks.ink, 0.4)); ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 0; i < top.length; i += 2) { if (horizon - top[i + 1] < 0.5) { ctx.moveTo(top[i], top[i + 1]); continue; } ctx.lineTo(top[i], top[i + 1]); }
    ctx.stroke();
  }
  // the horizon itself: a firm ruled line, the land's edge
  ctx.fillStyle = css(mix(inks.night, inks.haze, 0.55));
  ctx.fillRect(0, horizon, w, 1);

  // ruling across the plateau, following its swells, broken where the ground turns from the sun
  ctx.fillStyle = css(inks.rule);
  let y = h + 2;
  const lines: number[] = [];
  while (y > horizon + 0.8) {
    lines.push(y);
    const t = (y - horizon) / band;
    y -= Math.max(1.35, 6.2 * Math.pow(t, 0.75));
  }
  const step = 5;
  ensure(Math.ceil(w / step) + 4);
  for (const yl of lines) {
    const Z = (cam.f * cam.camH) / (yl - horizon);
    const fog = fogAt(Z);
    const col = mix(inks.rule, inks.haze, fog * 0.8);
    ctx.fillStyle = css(col, 0.5 + 0.4 * fog);
    ctx.beginPath();
    let n = 0;
    const wBase = clamp(0.3 + 0.7 * (1 - fog), 0.3, 1.0);
    for (let sx = -step; sx <= w + step; sx += step) {
      const X = ((sx - cam.cx) * Z) / cam.f;
      const ht = terr(X, Z);
      BX[n] = sx;
      BY[n] = horizon + (cam.f * (cam.camH - ht)) / Z;
      const lit = slopeLight(X, Z);
      const grain = nz(X / 4.5 + 51, Z / 6);
      const v = clamp((lit - 0.25) * 2.4 + (grain - 0.5) * 1.5, 0, 1.2);
      BW[n] = v < 0.22 ? 0 : wBase * v;
      n++;
    }
    ribbon(ctx, n, false, 0.12);
    ctx.fill();
  }

  // concrete pads under each dish
  for (const d of dishes) {
    if (d.yours) continue;
    const rpad = d.pedR0 * 2.3;
    const pts: number[] = [];
    for (let j = 0; j < 24; j++) {
      const t = (j / 24) * TAU;
      const p = projectXY(cam, [d.x + Math.cos(t) * rpad, 0, d.z + Math.sin(t) * rpad]);
      pts.push(p[0], p[1]);
    }
    const fog = fogAt(d.z);
    ctx.fillStyle = css(mix(inks.dust, inks.haze, fog * 0.6));
    ctx.beginPath(); polyPath(ctx, pts); ctx.fill();
  }

  // Karoo scrub: low rounded bushes in loose clumps, lit on the left, each with a shadow
  const clumps = Math.round((w * band) / 60000);
  for (let k = 0; k < clumps; k++) {
    const cx0 = r() * w;
    const ct = Math.pow(r(), 1.3);
    const cy0 = horizon + 3 + ct * (band - 3);
    const n = 2 + Math.floor(r() * 6);
    for (let m = 0; m < n; m++) {
      const Z0 = (cam.f * cam.camH) / (cy0 - horizon);
      const X = ((cx0 - cam.cx) * Z0) / cam.f + (r() - 0.5) * 14;
      const Z = Z0 + (r() - 0.5) * 10;
      if (Z < cam.zNear * 0.9) continue;
      if (dishes.some((d) => Math.abs(d.x - X) < d.pedR0 * 3.2 && Math.abs(d.z - Z) < d.pedR0 * 3.2)) continue;
      const [sx, sy] = projectXY(cam, [X, 0, Z]);
      const size = ((0.25 + r() * 0.4) * cam.f) / Z;
      if (size < 0.7) continue;
      const fog = fogAt(Z);
      ctx.fillStyle = css(inks.deep, 0.9 * (1 - fog));
      ctx.beginPath(); ctx.ellipse(sx + size * 1.3, sy + size * 0.05, size * 1.7, size * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = css(mix(inks.night, inks.ink, 0.5));
      ctx.beginPath(); ctx.ellipse(sx, sy - size * 0.32, size, size * 0.62, 0, Math.PI, TAU); ctx.lineTo(sx + size, sy); ctx.lineTo(sx - size, sy); ctx.fill();
      ctx.strokeStyle = css(mix(inks.rule, inks.haze, fog * 0.7), 0.95);
      ctx.lineWidth = clamp(size * 0.22, 0.5, 1.7);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.ellipse(sx, sy - size * 0.32, size * 0.92, size * 0.55, 0, Math.PI * 1.02, Math.PI * 1.55); ctx.stroke();
    }
  }
}
