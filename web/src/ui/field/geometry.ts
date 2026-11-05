// Point Source field: pure geometry. A pinhole camera over a flat plateau, radio dishes built
// from their parts (paraboloid bowl, feed on a tripod or quadripod, yoke, pedestal), seeded
// placement, and the aiming law. No DOM here, so it can be unit tested in Node.

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** World: X right, Y up, Z away from the viewer. Ground is Y = 0. */
export interface Camera {
  w: number; h: number;          // CSS px
  f: number;                      // focal length in px
  cx: number;                     // principal point x
  horizon: number;                // screen y of the horizon (the ground band's top edge)
  camH: number;                   // eye height in metres
  pos: V3;                        // eye position
  zNear: number;                  // depth of the ground at the bottom edge
}

export function makeCamera(w: number, h: number, groundTop: number): Camera {
  const band = Math.max(60, h - groundTop);
  const phone = w < 720;
  // Phones get a longer lens so the field stays a field and not a row of specks.
  const f = phone ? w * 1.1 : Math.max(w * 0.86, 900);
  // Eye height chosen so the nearest visible ground (the bottom edge) is a set distance away.
  const zNear = phone ? 48 : 54;
  const camH = (zNear * band) / f;
  return { w, h, f, cx: w / 2, horizon: groundTop, camH, pos: [0, camH, 0], zNear };
}

/** Project a world point. Returns [sx, sy, z]. */
export function project(cam: Camera, p: V3): [number, number, number] {
  const z = Math.max(p[2], 0.01);
  return [cam.cx + (cam.f * p[0]) / z, cam.horizon - (cam.f * (p[1] - cam.camH)) / z, p[2]];
}

/** The world point on the eye ray through (sx, sy) at depth z. */
export function unproject(cam: Camera, sx: number, sy: number, z: number): V3 {
  return [((sx - cam.cx) * z) / cam.f, cam.camH + ((cam.horizon - sy) * z) / cam.f, z];
}

/** Ground point under a screen point (null at or above the horizon). */
export function groundAt(cam: Camera, sx: number, sy: number): V3 | null {
  if (sy <= cam.horizon + 0.5) return null;
  const z = (cam.f * cam.camH) / (sy - cam.horizon);
  return [((sx - cam.cx) * z) / cam.f, 0, z];
}

export interface Breath { pa: number; pe: number; ta: number; te: number; aa: number; ae: number }

export interface DishSpec {
  i: number;
  x: number; z: number;            // ground position (m)
  R: number;                       // rim radius (m)
  F: number;                       // focal length (m)
  H: number;                       // elevation-axis height (m)
  off: number;                     // vertex ahead of the elevation axis (m)
  yokeW: number;                   // half-span of the yoke (m)
  legs: 3 | 4;
  leg0: number;                    // angle of the first leg (rad)
  feed: "horn" | "sub";
  mount: "column" | "tower";
  pedR0: number; pedR1: number;    // pedestal radius at foot and top (m)
  pedTop: number;                  // height of the pedestal top (m)
  breath: Breath;
  yours?: boolean;
}

export interface Pose { az: number; el: number }
export interface Frame { a: V3; u: V3; v: V3 }

/** The bowl axis for a pose: az 0 faces the viewer (-Z), el up from the horizon. */
export function axisOf(p: Pose): V3 {
  const ce = Math.cos(p.el);
  return [ce * Math.sin(p.az), Math.sin(p.el), -ce * Math.cos(p.az)];
}

/** The dish's frame: a (bowl axis), u (elevation axis, horizontal), v = u x a ("up" on the bowl). */
export function frameOf(p: Pose): Frame {
  const a = axisOf(p);
  const u: V3 = [Math.cos(p.az), 0, Math.sin(p.az)];
  return { a, u, v: cross(u, a) };
}

export const pivotOf = (d: DishSpec): V3 => [d.x, d.H, d.z];

export const EL_MIN = -0.05;
export const EL_MAX = 1.5;

/** Pose that points the bowl axis, from the elevation axis, at a world target. */
export function aimPose(d: DishSpec, target: V3): Pose {
  const c = pivotOf(d);
  const dx = target[0] - c[0], dy = target[1] - c[1], dz = target[2] - c[2];
  return { az: Math.atan2(dx, -dz), el: clamp(Math.atan2(dy, Math.hypot(dx, dz)), EL_MIN, EL_MAX) };
}

/**
 * Where a dish listens when it listens to a screen point. Each dish aims at a point of the eye
 * ray through (sx, sy), so every axis projects through the screen point exactly (the beam
 * always lands on the bowl). The depth along the ray is chosen per dish so the bowl tilts a set
 * angle above the line of sight: from any lens or eye height the array reads as looking up.
 * Pass k to fix the depth instead, as a fraction of the dish's own depth.
 */
export function screenTarget(cam: Camera, d: DishSpec, sx: number, sy: number, k?: number, tilt = 46): V3 {
  if (k !== undefined) return unproject(cam, sx, sy, Math.max(0.5, d.z * k));
  const want = Math.min(1.35, (tilt * Math.PI) / 180 + Math.atan2(cam.camH - d.H, d.z));
  let lo = 0.02, hi = 0.985;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    const el = aimPose(d, unproject(cam, sx, sy, d.z * mid)).el;
    if (el < want) lo = mid; else hi = mid;
  }
  return unproject(cam, sx, sy, Math.max(0.5, d.z * (lo + hi) / 2));
}

/** The stare: aim at the eye. */
export const viewerTarget = (cam: Camera): V3 => [cam.pos[0], cam.pos[1], cam.pos[2]];

/** A point on the bowl's surface at radius r, angle t. */
export function bowlPoint(d: DishSpec, c: V3, fr: Frame, r: number, t: number): V3 {
  const h = d.off + (r * r) / (4 * d.F);
  const ct = Math.cos(t) * r, st = Math.sin(t) * r;
  return [
    c[0] + fr.a[0] * h + fr.u[0] * ct + fr.v[0] * st,
    c[1] + fr.a[1] * h + fr.u[1] * ct + fr.v[1] * st,
    c[2] + fr.a[2] * h + fr.u[2] * ct + fr.v[2] * st,
  ];
}

/** Inner (concave-side) unit normal of the paraboloid at (r, t). */
export function bowlNormal(d: DishSpec, fr: Frame, r: number, t: number): V3 {
  const k = r / (2 * d.F), ct = Math.cos(t) * k, st = Math.sin(t) * k;
  return norm([
    fr.a[0] - fr.u[0] * ct - fr.v[0] * st,
    fr.a[1] - fr.u[1] * ct - fr.v[1] * st,
    fr.a[2] - fr.u[2] * ct - fr.v[2] * st,
  ]);
}

export const depthOf = (d: DishSpec) => d.off + (d.R * d.R) / (4 * d.F);

/** The focus (feed) point. */
export const focusOf = (d: DishSpec, c: V3, a: V3): V3 => add(c, mul(a, d.off + d.F));

/**
 * Does a ray from an inner-surface point P along dir leave through the bowl's mouth? The bowl
 * plus its aperture disc is convex, so a ray from P either exits through the aperture or hits
 * the bowl first. Used for the eye (visibility) and the sun (the rim's shadow inside the bowl).
 */
export function throughMouth(d: DishSpec, c: V3, a: V3, P: V3, dir: V3): boolean {
  const da = dot(dir, a);
  if (da <= 1e-5) return false;
  const depth = depthOf(d);
  const qx = P[0] - c[0], qy = P[1] - c[1], qz = P[2] - c[2];
  const hp = qx * a[0] + qy * a[1] + qz * a[2];
  const t = (depth - hp) / da;
  if (t < 0) return true;
  const rx = qx + dir[0] * t, ry = qy + dir[1] * t, rz = qz + dir[2] * t;
  const along = rx * a[0] + ry * a[1] + rz * a[2];
  return rx * rx + ry * ry + rz * rz - along * along <= d.R * d.R * 1.0001;
}

/** Shortest signed angular difference b - a. */
export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Dish screen radius in px at its depth. */
export const screenR = (cam: Camera, d: DishSpec) => (d.R * cam.f) / d.z;

/**
 * Seeded placement: a few cropped foreground bowls at the edges, a mid field, and specks to the
 * horizon. Rejection in screen space keeps bowls from piling up; the 65th ("yours") is placed
 * first so it has clear ground right of centre. Returned back to front.
 */
export function placeDishes(cam: Camera, count: number, seed: number): DishSpec[] {
  const r = rng(seed);
  const phone = cam.w < 720;
  const out: DishSpec[] = [];
  const zNear = cam.zNear;
  const zFar = Math.min(3200, (cam.f * 6.6) / 1.3); // about a 1.3 px bowl
  const make = (i: number, x: number, z: number): DishSpec => {
    const R = 6.1 + r() * 1.3;
    const fd = 0.34 + r() * 0.1;
    const tower = r() < 0.14;
    const H = R * (1.1 + r() * 0.2);
    return {
      i, x, z, R, F: fd * 2 * R, H,
      off: R * (0.1 + r() * 0.05),
      yokeW: R * (0.4 + r() * 0.1),
      legs: r() < 0.55 ? 4 : 3,
      leg0: r() < 0.5 ? Math.PI / 2 : Math.PI / 4,
      feed: r() < 0.5 ? "sub" : "horn",
      mount: tower ? "tower" : "column",
      pedR0: R * (tower ? 0.36 : 0.17 + r() * 0.05),
      pedR1: R * (0.12 + r() * 0.03),
      pedTop: H - R * (0.5 + r() * 0.06),
      breath: {
        pa: r() * Math.PI * 2, pe: r() * Math.PI * 2,
        // periods in whole beats, so breathing runs on the same clock
        ta: 14 + Math.floor(r() * 10), te: 11 + Math.floor(r() * 9),
        aa: (0.35 + r() * 0.55) * (Math.PI / 180), ae: (0.3 + r() * 0.5) * (Math.PI / 180),
      },
    };
  };
  const sxOf = (x: number, z: number) => cam.cx + (cam.f * x) / z;
  const syOf = (z: number) => cam.horizon - (cam.f * (7.6 - cam.camH)) / z; // bowl centre, roughly
  const fits = (x: number, z: number, R: number) => {
    const sx = sxOf(x, z), sy = syOf(z), sr = (R * cam.f) / z;
    for (const d of out) {
      const dsr = (d.R * cam.f) / d.z;
      const dist = Math.hypot(sxOf(d.x, d.z) - sx, syOf(d.z) - sy);
      // a small dish may peek past a big one's edge, never sit behind its face
      const ratio = Math.max(sr, dsr) / Math.min(sr, dsr);
      const need = ratio > 2.5 ? Math.max(sr, dsr) * 1.05 : (sr + dsr) * 0.92;
      if (dist < need) return false;
      if (Math.hypot(d.x - x, d.z - z) < (d.R + R) * 1.2) return false;
    }
    return true;
  };

  // yours: right of centre, clear mid-ground
  const zy = zNear * (phone ? 1.5 : 1.6);
  const xy = ((cam.w * (phone ? 0.72 : 0.62) - cam.cx) * zy) / cam.f;
  const yours = make(count, xy, zy);
  yours.yours = true; yours.legs = 4; yours.feed = "sub"; yours.mount = "column";
  out.push(yours);

  let tries = 0;
  const nEdge = 2;
  while (out.length < count + 1 && tries < 40000) {
    tries++;
    const k = out.length - 1;
    let z: number, sxN: number;
    if (k < nEdge && tries < 400 * (k + 1)) {
      // foreground bowls, cropped at the frame edges
      z = zNear * (0.72 + r() * 0.1);
      sxN = (k % 2 === 0 ? -1 : 1) * (0.9 + r() * 0.1);
    } else {
      // depth: feet spread down the band, denser towards the horizon
      const band = cam.h - cam.horizon;
      const t = Math.pow(r(), 1.3);
      const footY = cam.horizon + 1.2 + t * (band + 30);
      z = Math.min(zFar, (cam.f * cam.camH) / (footY - cam.horizon));
      if (z < zNear * 0.75) continue;
      sxN = (r() * 2 - 1) * 1.04;
    }
    const x = (sxN * (cam.w / 2) * z) / cam.f;
    if (!fits(x, z, 6.8)) continue;
    out.push(make(k, x, z));
  }
  return out.sort((p, q) => q.z - p.z);
}
