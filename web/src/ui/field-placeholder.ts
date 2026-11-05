// A quiet stand-in for the illustrated dish field (web/src/ui/field/), behind the same API:
// a night ground band, dishes in perspective from horizon specks to cropped foreground bowls,
// each one turning toward the bowl. Canvas 2D, a few strokes per dish.
import type { CreateField, Field, FieldOpts } from "./field-port";

interface Dish { x: number; t: number; y: number; r: number; ang: number; face: number; target: number; delay: number; id: string | null; name: string | null; house: boolean; phase: number }
interface Beam { dish: Dish; side: "yes" | "no"; t0: number }

const BEAT = 400;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const createField: CreateField = (canvas: HTMLCanvasElement, opts: FieldOpts): Field => {
  const ctx = canvas.getContext("2d")!;
  const pal = opts.palette;
  let W = 0, H = 0, DPR = 1, G = 0;
  let dishes: Dish[] = [];
  let mine: Dish | null = null;
  let mineState: "hidden" | "construction" | "red" = "hidden";
  const named = new Map<string, { name: string; house: boolean }>();
  let aim = { x: 0, y: 0 }, staring = true;
  const beams: Beam[] = [];
  let raf = 0, visible = true, dead = false, flinchAt = -1e9;
  const RM = opts.reducedMotion;

  function build() {
    const r = rng(opts.seed);
    const n = Math.max(8, opts.dishes);
    dishes = [];
    for (let i = 0; i < n; i++) {
      const t = Math.pow(r(), 1.7); // most dishes far away
      const band = H - G;
      const y = G + band * (0.1 + 0.8 * Math.pow(t, 1.25));
      const rad = Math.max(2.5, (W < 720 ? 46 : 74) * Math.pow(t, 1.6) + 2.5);
      dishes.push({ x: r() * (W + rad) - rad / 2, t, y, r: rad, ang: -Math.PI / 2, face: 1, target: -Math.PI / 2, delay: r() * 2 * BEAT, id: null, name: null, house: false, phase: r() * Math.PI * 2 });
    }
    dishes.sort((a, b) => a.t - b.t);
    // the 65th dish, yours: a foreground spot left of centre, kept clear
    mine = { x: W * (W < 720 ? 0.2 : 0.36), t: 0.85, y: G + (H - G) * 0.7, r: W < 720 ? 26 : 40, ang: -Math.PI / 2, face: 1, target: -Math.PI / 2, delay: 0, id: "yours", name: null, house: false, phase: 0 };
    dishes = dishes.filter((d) => Math.hypot(d.x - mine!.x, d.y - mine!.y) > d.r + mine!.r + 6);
    let k = 0;
    for (const [id, v] of named) bind(id, v.name, v.house, k++);
  }

  function bind(id: string, name: string, house: boolean, k: number) {
    // named agents take mid-ground dishes, spread across the width
    const pool = dishes.filter((d) => d.t > 0.35 && d.t < 0.8 && !d.id).sort((a, b) => a.x - b.x);
    if (!pool.length) return;
    const d = pool[Math.floor(((k * 0.37 + 0.15) % 1) * pool.length)];
    Object.assign(d, { id, name, house });
  }

  function hub(d: Dish) { return { x: d.x, y: d.y - d.r * 0.95 }; }

  function draw(now: number) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = pal.night;
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = pal.ink;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, G, W, 1.5);
    ctx.globalAlpha = 1;
    const fl = Math.max(0, 1 - (now - flinchAt) / (2 * BEAT));
    for (const d of dishes) drawDish(d, now, fl, false);
    if (mine && mineState !== "hidden") drawDish(mine, now, fl, true);
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      const k = (now - b.t0) / (3 * BEAT);
      if (k >= 1) { beams.splice(i, 1); continue; }
      const p = hub(b.dish);
      ctx.strokeStyle = b.side === "no" ? pal.red : pal.paper;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = b.dish === mine ? 2 : 1.25;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(aim.x, aim.y); ctx.stroke();
      const q = Math.min(1, k * 1.6);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(p.x + (aim.x - p.x) * q, p.y + (aim.y - p.y) * q, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawDish(d: Dish, now: number, fl: number, isMine: boolean) {
    const p = hub(d);
    const breathe = RM ? 0 : Math.sin(now / (8 * BEAT) + d.phase) * (Math.PI / 180);
    const jolt = fl * Math.sin(d.phase * 3) * 0.12;
    const a = d.ang + breathe + jolt;
    const fade = 0.35 + 0.65 * Math.min(1, d.t * 1.4);
    ctx.globalAlpha = fade;
    // pedestal
    ctx.strokeStyle = pal.paper;
    ctx.lineWidth = Math.max(0.8, d.r * 0.09);
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    // bowl: an ellipse whose face turns toward the aim; a full circle when it stares at you
    const ry = d.r * (0.28 + 0.62 * d.face);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath(); ctx.ellipse(0, 0, d.r, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = isMine && mineState === "construction" ? "transparent" : pal.paper;
    ctx.fill();
    ctx.lineWidth = Math.max(0.6, d.r * 0.035);
    ctx.strokeStyle = isMine && mineState === "red" ? pal.red : pal.ink;
    if (isMine && mineState === "construction") { ctx.setLineDash([3, 4]); ctx.strokeStyle = pal.paper; }
    ctx.stroke();
    ctx.setLineDash([]);
    // the bowl's shaded half, light from the left
    if (d.r > 6 && !(isMine && mineState === "construction")) {
      ctx.beginPath(); ctx.ellipse(0, 0, d.r, ry, 0, 0, Math.PI);
      ctx.fillStyle = pal.ink;
      ctx.globalAlpha = fade * 0.12;
      ctx.fill();
      ctx.globalAlpha = fade;
    }
    ctx.restore();
    // feed
    if (d.r > 5) {
      const L = d.r * (0.55 + 0.25 * (1 - d.face));
      const fx = p.x + Math.cos(a) * L, fy = p.y + Math.sin(a) * L;
      ctx.strokeStyle = isMine && mineState === "red" ? pal.red : pal.ink;
      ctx.lineWidth = Math.max(0.6, d.r * 0.04);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(1, d.r * 0.06), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if ((d.name || isMine) && d.r > 9 && W >= 720) {
      ctx.fillStyle = isMine && mineState === "red" ? pal.red : pal.paper;
      ctx.font = `italic 15px Amstelvar, Georgia, serif`;
      ctx.textAlign = "center";
      ctx.fillText(isMine ? "yours" : (d.name || "") + (d.house ? ", house" : ""), d.x, d.y + 18);
    }
  }

  function step(now: number) {
    raf = 0;
    if (dead) return;
    for (const d of [...dishes, ...(mine ? [mine] : [])]) {
      const goal = staring ? -Math.PI / 2 : Math.atan2(aim.y - hub(d).y, aim.x - hub(d).x);
      const ready = now >= d.delay;
      if (ready || RM) {
        d.target = goal;
        const k = RM ? 1 : 0.06;
        let da = d.target - d.ang;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        d.ang += da * k;
        d.face += ((staring ? 1 : 0) - d.face) * k;
      }
    }
    draw(now);
    if (!RM && visible) raf = requestAnimationFrame(step);
  }
  const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(step); };

  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) kick(); }) : null;
  io?.observe(canvas);

  return {
    layout(v, groundTop) {
      W = v.w; H = v.h; DPR = Math.min(2, v.dpr || 1); G = groundTop;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      build();
      if (!staring) for (const d of dishes) { d.ang = Math.atan2(aim.y - hub(d).y, aim.x - hub(d).x); d.face = 0; }
      draw(performance.now());
      kick();
    },
    aimAt(x, y, o = {}) {
      aim = { x, y };
      const now = performance.now();
      const spread = (o.beats ?? 2) * BEAT;
      if (staring) for (const d of dishes) d.delay = now + (d.x / Math.max(1, W)) * spread;
      staring = false;
      kick();
    },
    lookAt() { staring = true; kick(); },
    assign(id, name, house) { if (named.has(id)) return; named.set(id, { name, house }); bind(id, name, house, named.size - 1); kick(); },
    pulse(id, side) {
      const d = id === "yours" ? mine : dishes.find((x) => x.id === id) ?? dishes.filter((x) => x.t > 0.3)[Math.abs(hash(id)) % Math.max(1, dishes.filter((x) => x.t > 0.3).length)];
      if (!d) return;
      beams.push({ dish: d, side, t0: performance.now() });
      kick();
    },
    yours(st) { mineState = st; kick(); draw(performance.now()); },
    flinch() { flinchAt = performance.now(); kick(); },
    still() {
      for (const d of dishes) { d.ang = staring ? -Math.PI / 2 : Math.atan2(aim.y - hub(d).y, aim.x - hub(d).x); d.face = staring ? 1 : 0; }
      draw(0);
    },
    destroy() { dead = true; if (raf) cancelAnimationFrame(raf); io?.disconnect(); },
  };
};

function hash(t: string) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
