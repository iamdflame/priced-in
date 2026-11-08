import React, {createContext, useContext} from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, EASE, FONT} from '../brand/tokens';
import cutsJson from './cuts.json';
import flowJson from './flow.json';

export type Word = {w: string; s: number; e: number};
export type Cue = {id: string; at: number; text: string; words: Word[]};
export type Shot = {id: string; at: number; dur: number; tap?: number; chip?: number; rate?: number; fast?: boolean; written?: number; nocap?: boolean; src?: number; ev?: number; sure?: number; doubt?: number; paid?: number; pick?: number; lock?: number; ours?: number; honest?: number; judges?: boolean; k?: Record<string, number>};
export type Cut = {id: string; dur: number; w: number; h: number; shots: Shot[]; cues: Cue[]};

export const CUTS = cutsJson as unknown as Record<string, Cut>;
export const FPS = 30;

export const CutContext = createContext<Cut>(CUTS.main);
export const useCut = () => useContext(CutContext);

/** Film time in seconds (frame 0 of the composition is 0). */
export const useFilmTime = () => {
  const frame = useCurrentFrame();
  return frame / FPS;
};

export const useTall = () => {
  const {width, height} = useVideoConfig();
  return height > width;
};

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (t: number, start: number, dur: number, f: (k: number) => number = EASE.out) =>
  f(clamp01((t - start) / dur));
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** All the voice's words that start in [from, to) of film time. */
export const wordsIn = (cut: Cut, from: number, to: number): Word[] =>
  cut.cues.flatMap((c) => c.words).filter((w) => w.s >= from - 0.001 && w.s < to);

export const wordStart = (cut: Cut, cueId: string, prefix: string, fallback: number) => {
  const c = cut.cues.find((q) => q.id === cueId);
  const w = c?.words.find((x) => x.w.toLowerCase().startsWith(prefix.toLowerCase()));
  return w ? w.s : fallback;
};

// ----- Blender plates ----------------------------------------------------------------------------------
const FRAMES: Record<string, number> = {wake: 120, swing: 96, steps: 186, end: 240, stamps: 168, market: 310, decided: 130};
// the frames the light plates were rendered over (blender/render_light.sh): [first, last] per aspect
const RANGE: Record<string, [number, number]> = {
  'light-wide/stamps': [1, 168], 'light-wide/wake': [1, 92], 'light-wide/swing': [1, 72], 'light-wide/steps': [15, 156], 'light-wide/end': [1, 240],
  'light-tall/stamps': [1, 168], 'light-tall/swing': [1, 96], 'light-tall/steps': [5, 150], 'light-tall/end': [1, 110],
  'v6-wide/market': [1, 310], 'v6-wide/end': [1, 240], 'v6-tall/market': [1, 310], 'v6-tall/end': [1, 110],
};

const plateSrc = (shot: string, aspect: string, f: number) =>
  staticFile(`blender/${aspect}/${shot}/${String(f).padStart(4, '0')}.png`);

/** A Blender shot played frame for frame: transparent, so the page's own white is the seamless. `local` is seconds into the plate. */
export const Plate: React.FC<{shot: string; local: number; style?: React.CSSProperties; set?: string}> = ({shot, local, style, set = 'light'}) => {
  const tall = useTall();
  const aspect = `${set}-${tall ? 'tall' : 'wide'}`;
  const [lo, hi] = RANGE[`${aspect}/${shot}`] ?? [1, FRAMES[shot]];
  const f = Math.max(lo, Math.min(hi, 1 + Math.floor(local * FPS)));
  const src = plateSrc(shot, aspect, f);
  return (
    <AbsoluteFill style={style}>
      <Img src={src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
    </AbsoluteFill>
  );
};

// ----- grade: a faint falloff and fine grain over everything, so the white never bands -----------------------
export const Grade: React.FC = () => {
  const frame = useCurrentFrame();
  const seed = frame % 5;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <AbsoluteFill style={{background: 'radial-gradient(90% 90% at 50% 46%, transparent 62%, rgba(40,52,66,0.05))'}} />
      <AbsoluteFill style={{opacity: 0.022, mixBlendMode: 'multiply'}}>
        <svg width="100%" height="100%">
          <filter id={`fg${seed}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed={seed + 3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#fg${seed})`} />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The white stage. */
export const Ground: React.FC<{glow?: string; children?: React.ReactNode}> = ({glow = '50% 45%', children}) => (
  <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
    <AbsoluteFill style={{background: `radial-gradient(60% 70% at ${glow}, #FFFFFF, transparent 72%)`}} />
    {children}
  </AbsoluteFill>
);

// ----- type ----------------------------------------------------------------------------------------------
/** One word sliding up out of a mask at its moment. */
export const WordIn: React.FC<{t: number; at: number; children: React.ReactNode; color?: string; dur?: number}> = ({t, at, children, color, dur = 0.42}) => {
  const k = ease(t, at, dur, EASE.out);
  return (
    <span style={{display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', paddingBottom: '0.14em', marginBottom: '-0.14em', paddingRight: '0.02em'}}>
      <span style={{display: 'inline-block', transform: `translateY(${(1 - k) * 112}%)`, opacity: k > 0 ? 1 : 0, color}}>{children}</span>
    </span>
  );
};

const red = /^(no\.?|wrong\.?|false\.?)$/i;

/** The voice's own words, revealed on the voice. */
export const Spoken: React.FC<{t: number; words: Word[]; size: number; lh?: number; weight?: number; color?: string; maxWidth?: number; paint?: boolean; lead?: number}> = ({t, words, size, lh = 1.04, weight = 700, color = C.ink, maxWidth, paint = true, lead = 0.04}) => (
  <div style={{font: `${weight} ${size}px/${lh} ${FONT.disp}`, letterSpacing: '-0.035em', color, maxWidth}}>
    {words.map((w, i) => (
      <React.Fragment key={`${w.s}${i}`}>
        <WordIn t={t} at={w.s - lead} color={paint && red.test(w.w) ? C.no : undefined}>
          {w.w}
        </WordIn>{' '}
      </React.Fragment>
    ))}
  </div>
);

// ----- captions ------------------------------------------------------------------------------------------
const SAY: [RegExp, string][] = [
  [/is it priced dot com/i, 'isitpriced.com'],
  [/Near records/, 'NEAR records'],
  [/One hundred twenty-two point eight four billion/i, '$122.84 billion'],
  [/Four dollars and ninety-three cents/i, '$4.93'],
  [/fifty billion dollars/i, '$50 billion'],
  [/seventeen seconds/i, '17 seconds'],
  [/four and a half seconds/i, '4.5 seconds'],
  [/fifty percent to ten/i, '50% to 10%'],
  [/ten minutes/i, '10 minutes'],
  [/Near blockchain/, 'NEAR blockchain'],
  [/seventy-two point six billion/i, '$72.6 billion'],
  [/one hundred twenty-two point eight four/i, '$122.84 billion'],
  [/a one-dollar/i, 'a $1'],
];

type Chunk = {text: string; s: number; e: number};

const chunksOf = (c: Cue): Chunk[] => {
  const out: Chunk[] = [];
  let cur: Word[] = [];
  // merge the words a spoken number covers into one token first, so a chunk break never splits "$122.84 billion"
  let words: Word[] = c.words.map((w) => ({...w}));
  for (const [a, b] of SAY) {
    const full = words.map((w) => w.w).join(' ');
    const m = full.match(a);
    if (!m || m.index === undefined) continue;
    let pos = 0;
    let i0 = -1;
    let i1 = -1;
    let at0 = 0;
    words.forEach((w, k) => {
      const s0 = pos;
      const s1 = pos + w.w.length;
      if (i0 < 0 && s1 > m.index!) {
        i0 = k;
        at0 = s0;
      }
      if (s0 < m.index! + m[0].length) i1 = k;
      pos = s1 + 1;
    });
    if (i0 < 0 || i1 < i0) continue;
    const span = words.slice(i0, i1 + 1);
    const joined = span.map((w) => w.w).join(' ');
    const off = m.index - at0;
    const text = joined.slice(0, off) + b + joined.slice(off + m[0].length);
    words = [...words.slice(0, i0), {...span[0], w: text, e: span[span.length - 1].e}, ...words.slice(i1 + 1)];
  }
  const flush = () => {
    if (!cur.length) return;
    let text = cur.map((w) => w.w).join(' ');
    out.push({text, s: cur[0].s, e: cur[cur.length - 1].e});
    cur = [];
  };
  words.forEach((w) => {
    cur.push(w);
    const chars = cur.map((x) => x.w).join(' ').length;
    if (/[.?!]$/.test(w.w) || (/,$/.test(w.w) && chars > 26) || chars > 52) flush();
  });
  flush();
  return out;
};

/** Burned-in captions in the brand style, following the voice. */
export const Captions: React.FC = () => {
  const cut = useCut();
  const t = useFilmTime();
  const tall = useTall();
  let cur: Chunk | null = null;
  for (const c of cut.cues) {
    for (const ch of chunksOf(c)) {
      if (t >= ch.s - 0.05 && t <= ch.e + 0.22) cur = ch;
    }
  }
  if (!cur) return null;
  // the end card already says every word on screen; shots marked nocap carry the line as their own kinetic type
  if (cut.shots.some((s) => /^(end|v[5678]end)$/.test(s.id) && t >= s.at)) return null;
  const here = cut.shots.find((s) => t >= s.at && t < s.at + s.dur);
  if (here?.nocap) return null;
  // a beat whose FALSE marks land on screen carries the spoken "False." itself
  if (here?.k?.marksFalse && /^False\.$/.test(cur.text)) return null;
  const k = ease(t, cur.s - 0.05, 0.14);
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: tall ? here?.k?.capBottom ?? 400 : 44, pointerEvents: 'none'}}>
      <span
        style={{
          font: `500 ${tall ? 42 : 32}px/1.25 ${FONT.text}`,
          color: C.ink,
          background: 'rgba(255,255,255,0.86)',
          boxShadow: `0 0 0 1px ${C.line}, 0 8px 24px -12px rgba(40,52,66,0.25)`,
          borderRadius: 14,
          padding: tall ? '10px 22px' : '8px 20px',
          opacity: k,
          maxWidth: tall ? 940 : 1400,
          textAlign: 'center',
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        }}
      >
        {cur.text}
      </span>
    </AbsoluteFill>
  );
};

// ----- real site footage in 3D -----------------------------------------------------------------------------
type Xform = {rx?: number; ry?: number; rz?: number; x?: number; y?: number; z?: number; s?: number};
const xf = ({rx = 0, ry = 0, rz = 0, x = 0, y = 0, z = 0, s = 1}: Xform) =>
  `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`;

/** The real replay as it ran: the phone's frames at their captured times, `ft` seconds into the capture. */
export const flowFrame = (name: 'p' | 'd', ft: number) => {
  const times = (flowJson as unknown as Record<string, number[]>)[name];
  let i = 0;
  for (let j = 0; j < times.length; j++) {
    if (times[j] <= ft) i = j;
    else break;
  }
  return `site/flow-${name}/${String(i).padStart(4, '0')}.jpg`;
};
export const FLOW_TAP = (flowJson as unknown as {tap: number}).tap;

/** A phone floating in space: real UI, a machined edge, a shadow that follows. Width in px; 390×844 screen. */
export const Phone3D: React.FC<{src: string; width?: number; pose: Xform; sheen?: number; children?: React.ReactNode; persp?: number}> = ({src, width = 440, pose, sheen = -1, children, persp = 2200}) => {
  const h = (width * 844) / 390;
  const pad = width * 0.028;
  const r = width * 0.135;
  return (
    <div style={{position: 'relative', width: width + pad * 2, height: h + pad * 2, perspective: persp}}>
      <div
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          bottom: '-7%',
          height: '12%',
          borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(40,52,66,0.32), transparent)',
          filter: 'blur(26px)',
          transform: `translateX(${(pose.ry ?? 0) * 2}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: xf(pose),
          transformStyle: 'preserve-3d',
          borderRadius: r + pad,
          background: 'linear-gradient(135deg, #F4F5F7, #C9CDD3 35%, #AEB3BA 60%, #E7E9EC)',
          boxShadow: '0 70px 120px -44px rgba(40,52,66,0.42), 0 0 0 1px rgba(27,34,43,0.1), inset 0 0 0 1.5px rgba(255,255,255,0.7)',
        }}
      >
        <div style={{position: 'absolute', inset: pad, borderRadius: r, overflow: 'hidden', background: '#FFF'}}>
          <Img src={staticFile(src)} style={{width: '100%', display: 'block'}} />
          {children}
          {sheen >= 0 ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(112deg, transparent ${mix(-40, 100, sheen)}%, rgba(255,255,255,0.28) ${mix(-30, 110, sheen)}%, transparent ${mix(-20, 120, sheen)}%)`,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

type Lift = {x: number; y: number; w: number; h: number; z: number; ring?: boolean};

/** A browser window floating in space, showing a real capture (2880 px wide) with depth of field at its far
 * and near edges and regions lifted off the page towards the camera. `top` is the scroll position in source px. */
export const Browser3D: React.FC<{src: string; url: string; width?: number; height?: number; pose: Xform; top: number; lifts?: Lift[]; dim?: number; persp?: number; dof?: number}> = ({src, url, width = 1500, height = 900, pose, top, lifts = [], dim = 0, persp = 2400, dof = 5}) => {
  const k = width / 2880;
  const bar = 46;
  const img = (blur: boolean) => (
    <Img
      src={staticFile(src)}
      style={{
        position: 'absolute',
        left: 0,
        top: -top * k,
        width,
        display: 'block',
        ...(blur
          ? {
              filter: `blur(${dof}px)`,
              WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 28%, transparent 66%, black 100%)',
              maskImage: 'linear-gradient(180deg, black 0%, transparent 28%, transparent 66%, black 100%)',
            }
          : {}),
      }}
    />
  );
  return (
    <div style={{position: 'relative', width, height, perspective: persp}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: xf(pose),
          transformStyle: 'preserve-3d',
          borderRadius: 22,
          boxShadow: '0 80px 140px -56px rgba(40,52,66,0.4), 0 0 0 1px rgba(27,34,43,0.1)',
          background: C.surface,
        }}
      >
        <div style={{position: 'absolute', inset: 0, borderRadius: 22, overflow: 'hidden'}}>
          <div style={{position: 'absolute', top: bar, left: 0, right: 0, bottom: 0, overflow: 'hidden', background: C.bg}}>
            {img(false)}
            {dof > 0 ? img(true) : null}
            {dim > 0 ? <div style={{position: 'absolute', inset: 0, background: `rgba(248,249,251,${dim})`}} /> : null}
            {lifts.map((l, i) => (
              // the place the lifted card came from, so it is never seen twice
              <div key={i} style={{position: 'absolute', left: l.x * k, top: (l.y - top) * k, width: l.w * k, height: l.h * k, borderRadius: 18, background: C.surface2, opacity: clamp01(l.z / 50)}} />
            ))}
          </div>
          <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: bar, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, borderBottom: `1px solid ${C.line}`}}>
            <span style={{display: 'inline-flex', alignItems: 'center', gap: 10, height: 28, padding: '0 16px', borderRadius: 999, background: C.surface2, font: `500 15px ${FONT.text}`, color: C.ink2}}>{url}</span>
          </div>
        </div>
        {lifts.map((l, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: l.x * k,
              top: bar + (l.y - top) * k,
              width: l.w * k,
              height: l.h * k,
              borderRadius: 18,
              overflow: 'hidden',
              transform: `translateZ(${l.z}px)`,
              boxShadow: `0 40px 70px -28px rgba(40,52,66,0.42), 0 0 0 1px ${l.ring ? 'rgba(27,34,43,0.2)' : 'rgba(27,34,43,0.1)'}`,
              background: C.surface,
            }}
          >
            <Img src={staticFile(src)} style={{position: 'absolute', left: -l.x * k, top: -l.y * k, width}} />
          </div>
        ))}
      </div>
    </div>
  );
};

export {interpolate};
