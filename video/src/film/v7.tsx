// v7: the real product in use, and every number holds up (.apex/prompts/V7-film-real.md).
// Every product beat is a real recording (scripts/capture_v7.mjs): the Wikipedia article, Tether's attestation,
// the live replay of the free $1 (real taps), the transaction on a public NEAR explorer, the rulings, the decided
// market and the page. The camera only frames and pushes; kinetic type only where words need it.
import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile} from 'remotion';
import {C, EASE, FONT} from '../brand/tokens';
import {Lockup, PrimaryButton} from '../components/core';
import pending from './pending.json';
import wiki from '../../public/v7/wiki.json';
import wikiP from '../../public/v7/wiki-phone.json';
import replayP from '../../public/v7/replay-phone.json';
import replay from '../../public/v7/replay.json';
import explorer from '../../public/v7/explorer.json';
import explorerP from '../../public/v7/explorer-phone.json';
import att from '../../public/v7/att.json';
import rulings from '../../public/v7/rulings.json';
import rulingsP from '../../public/v7/rulings-phone.json';
import {Ground, Shot, clamp01, ease, mix, useTall} from './lib';

type P = {shot: Shot; t: number; T: number};
const PENDING = new Set<string>(pending as string[]);
const big = (size: number, color: string = C.ink): React.CSSProperties => ({font: `700 ${size}px/1.04 ${FONT.disp}`, letterSpacing: '-0.035em', color});
const io = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

type Key = [number, number, number, number]; // time, cx, cy (page CSS px), zoom (output px per CSS px)
const camAt = (keys: Key[], t: number) => {
  if (t <= keys[0][0]) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, b] = [keys[i], keys[i + 1]];
    if (t <= b[0]) {
      const k = io((t - a[0]) / Math.max(1e-6, b[0] - a[0]));
      return [t, mix(a[1], b[1], k), mix(a[2], b[2], k), mix(a[3], b[3], k)] as Key;
    }
  }
  return keys[keys.length - 1];
};
/** Maps a page point to the output frame through the camera. */
const toFrame = (cam: Key, W: number, H: number, x: number, y: number) => ({x: W / 2 + (x - cam[1]) * cam[3], y: H / 2 + (y - cam[2]) * cam[3]});

/** A page image (a recording frame or a still) placed by the camera. `vw` is the page width in CSS px. */
const Shotframe: React.FC<{src: string; cam: Key; vw: number; W: number; H: number; style?: React.CSSProperties}> = ({src, cam, vw, W, H, style}) => (
  <Img src={src} style={{position: 'absolute', width: vw * cam[3], left: W / 2 - cam[1] * cam[3], top: H / 2 - cam[2] * cam[3], maxWidth: 'none', ...style}} />
);
const frameOf = (dir: string, n: number, total: number) => staticFile(`v7/${dir}/${String(Math.max(1, Math.min(total, n))).padStart(4, '0')}.jpg`);
/** Piecewise-linear map from film time to recording time. */
const recAt = (map: [number, number][], T: number) => {
  if (T <= map[0][0]) return map[0][1];
  for (let i = 0; i < map.length - 1; i++) if (T <= map[i + 1][0]) return interpolate(T, [map[i][0], map[i + 1][0]], [map[i][1], map[i + 1][1]]);
  return map[map.length - 1][1] + (T - map[map.length - 1][0]);
};

/** A highlighter stroke over page boxes, swept left to right. */
const Mark: React.FC<{boxes: {x: number; y: number; w: number; h: number}[]; cam: Key; W: number; H: number; k: number; color: string; pad?: number}> = ({boxes, cam, W, H, k, color, pad = 3}) => (
  <>
    {boxes.map((b, i) => {
      const p = toFrame(cam, W, H, b.x - pad, b.y - pad);
      const w = (b.w + pad * 2) * cam[3];
      const h = (b.h + pad * 2) * cam[3];
      return <div key={i} style={{position: 'absolute', left: p.x, top: p.y, width: w * clamp01(k), height: h, background: color, mixBlendMode: 'multiply', borderRadius: 4 * cam[3] / 2}} />;
    })}
  </>
);

/** The tap: a soft ring where the real click landed. */
const Tap: React.FC<{x: number; y: number; t: number}> = ({x, y, t}) => {
  if (t < -0.35 || t > 0.6) return null;
  const pre = clamp01((t + 0.35) / 0.35);
  const post = clamp01(t / 0.6);
  return (
    <>
      <div style={{position: 'absolute', left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 40, background: 'rgba(17,22,30,0.18)', boxShadow: '0 0 0 3px rgba(255,255,255,0.9)', opacity: t < 0 ? pre : 1 - post, transform: `scale(${t < 0 ? mix(1.3, 1, pre) : 0.9})`}} />
      {t >= 0 ? <div style={{position: 'absolute', left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 40, border: '4px solid rgba(17,22,30,0.5)', opacity: 1 - post, transform: `scale(${1 + post * 1.6})`}} /> : null}
    </>
  );
};

/** A small, legible source label in the corner of a real artifact. */
const Source: React.FC<{children: React.ReactNode; t: number; at?: number; style?: React.CSSProperties}> = ({children, t, at = 0, style}) => {
  const k = ease(t, at, 0.4);
  return (
    <div style={{position: 'absolute', left: 48, top: 40, display: 'inline-flex', alignItems: 'center', gap: 12, height: 56, padding: '0 22px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', boxShadow: `0 0 0 1px ${C.line}, 0 14px 30px -18px rgba(40,52,66,0.5)`, font: `600 30px ${FONT.text}`, color: C.ink2, opacity: k, transform: `translateY(${(1 - k) * -10}px)`, ...style}}>
      {children}
    </div>
  );
};

// ----- beat 1: the real Wikipedia article, the sentence, then Tether's own report ------------------------------
type Wk = {frames: number; viewport: {width: number; height: number}; sentence: {x: number; y: number; w: number; h: number}[]; number: {x: number; y: number; w: number; h: number}[]};
const WV = wiki as unknown as Wk;
const WVP = wikiP as unknown as Wk;
const bbox = (r: {x: number; y: number; w: number; h: number}[]) => {
  const x0 = Math.min(...r.map((q) => q.x));
  const y0 = Math.min(...r.map((q) => q.y));
  const x1 = Math.max(...r.map((q) => q.x + q.w));
  const y1 = Math.max(...r.map((q) => q.y + q.h));
  return {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2};
};
const AT = att as unknown as Record<string, number[][] | {w: number; h: number}>;

const Hook: React.FC<P> = ({shot, t}) => {
  const tall = useTall();
  const W = tall ? 1080 : 1920;
  const H = tall ? 1920 : 1080;
  const fast = !!shot.fast;
  const D = tall ? WVP : WV;
  const dirW = tall ? 'wiki-phone' : 'wiki';
  const vw = tall ? 390 : 1600;
  const {cx, cy} = bbox(D.sentence);
  // scroll the real article (66 frames) in 1.1 s, then push into the sentence
  const scrollEnd = fast ? 0.8 : 1.1;
  const f = 1 + Math.floor(clamp01(t / scrollEnd) * (D.frames - 1));
  const cam = camAt(tall ? [[0, 195, 347, 2.77], [0.6, 195, 347, 2.77], [1.6, cx, cy, 2.95]] : [[0, 800, 450, 1.2], [0.6, 800, 450, 1.2], [1.6, cx, cy, 2.3]], t);
  const hl = ease(t, 1.55, 0.5, EASE.inOut);
  const num = ease(t, 2.05, 0.3);
  // the split: the sentence rises to the upper half, Tether's report comes up under it
  const sp = ease(t, 2.7, 0.6, EASE.inOut);
  const up = sp * (tall ? -(H / 2 - 620) : -(H / 2 - 270));
  const row = (AT['U.S. Treasury Bills'] as number[][])[0];
  const val = (AT['122,839,738,995'] as number[][])[0];
  // attestation crop: page px (4x of points); wide shows x 250–2050, y 600–1100
  const crop = tall ? {x0: 520, x1: 1985, y0: 885, y1: 1240} : {x0: 250, x1: 2050, y0: 760, y1: 1080};
  const strip = tall ? 150 : 120;
  const ak = W / (crop.x1 - crop.x0);
  const bandH = (crop.y1 - crop.y0) * ak + strip;
  const rowK = ease(t, 3.05, 0.5, EASE.inOut);
  const chip = ease(t, 3.25, 0.45, EASE.spring);
  return (
    <AbsoluteFill style={{background: '#fff', overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: `translateY(${up}px)`}}>
        <Shotframe src={frameOf(dirW, f, D.frames)} cam={cam} vw={vw} W={W} H={H} />
        <Mark boxes={D.sentence} cam={cam} W={W} H={H} k={hl} color="rgba(237,179,69,0.32)" />
        <Mark boxes={D.number} cam={cam} W={W} H={H} k={num} color="rgba(237,179,69,0.55)" />
      </AbsoluteFill>
      <Source t={t} at={0.15}>
        <span style={{font: `700 30px 'Linux Libertine','Georgia',serif`, color: C.ink}}>W</span> {tall ? 'en.wikipedia.org' : 'en.wikipedia.org · Tether (cryptocurrency)'}
      </Source>
      {/* Tether's report, from the real PDF (BDO's ISAE 3000R report, page 4) */}
      <div style={{position: 'absolute', left: 0, width: W, top: H - bandH * sp, height: bandH, overflow: 'hidden', background: '#fff', boxShadow: '0 -30px 60px -30px rgba(40,52,66,0.35)', borderTop: `1px solid ${C.line}`}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: strip, bottom: 0, overflow: 'hidden'}}>
          <Img src={staticFile('v7/att_p8.png')} style={{position: 'absolute', width: (AT.p8 as {w: number}).w * ak, left: -crop.x0 * ak, top: -crop.y0 * ak, maxWidth: 'none'}} />
        <div style={{position: 'absolute', left: (row[0] - 20 - crop.x0) * ak, top: (row[1] - 10 - crop.y0) * ak, width: (val[2] - row[0] + 40) * ak * rowK, height: (row[3] - row[1] + 20) * ak, background: 'rgba(0,161,81,0.16)', borderRadius: 8}} />
        <div style={{position: 'absolute', left: (val[0] - 14 - crop.x0) * ak, top: (val[1] - 10 - crop.y0) * ak, width: (val[2] - val[0] + 28) * ak, height: (val[3] - val[1] + 20) * ak, border: `4px solid ${C.yes}`, borderRadius: 10, opacity: rowK}} />
        </div>
        <div style={{position: 'absolute', left: 48, right: 48, top: 0, height: strip, display: 'flex', flexWrap: tall ? 'wrap' : 'nowrap', alignItems: 'center', alignContent: 'center', columnGap: 18, opacity: clamp01(chip * 1.4), transform: `translateY(${(1 - chip) * 16}px)`}}>
          <span style={{font: `600 34px ${FONT.text}`, color: C.ink2}}>Tether’s own report, 30 Sep 2026:</span>
          <span style={{...big(tall ? 64 : 68, C.yes), background: 'rgba(0,161,81,0.12)', borderRadius: 14, padding: '2px 16px 8px'}}>$122.84 billion</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ----- beats 2 and 3: the live market, then the replay of the real free $1, with real taps -----------------------
type Rec = {frames: number; marks: Record<string, {t: number; box?: {x: number; y: number; w: number; h: number}}>};
const RP = replay as unknown as Rec;
const RPP = replayP as unknown as Rec;

const Market: React.FC<P> = ({shot, T}) => {
  const tall = useTall();
  const W = tall ? 1080 : 1920;
  const H = tall ? 1920 : 1080;
  const tap = shot.k?.tap ?? shot.at + 4;
  const R = tall ? RPP : RP;
  const m = R.marks;
  const t0 = m.tapNo.t;
  const tC = m.confirm.t;
  const tR = m.receipt.t;
  // film time to recording time: hold before the tap, then a little quicker through the confirm to the receipt
  const confirmAt = tap + (tC - t0) / 1.6;
  const receiptAt = confirmAt + (tR - tC) / 1.6;
  const rec = recAt([[shot.at, 0], [tap - 1.3, 0], [tap, t0], [confirmAt, tC], [receiptAt, tR]], T);
  const f = 1 + Math.floor(rec * 30);
  const hash = m.hash.box!;
  const keys: Key[] = tall
    ? [[shot.at, 195, 347, 2.77], [tap - 1.3, 195, 347, 2.77], [tap - 0.5, 195, 497, 2.77], [receiptAt - 0.1, 195, 497, 2.77], [receiptAt + 0.25, 195, 347, 2.77], [receiptAt + 1.2, 195, 352, 2.8]]
    : [[shot.at, 600, 300, 1.85], [tap - 1.2, 600, 310, 1.95], [tap - 0.4, 1205, 292, 2.45], [receiptAt - 0.1, 1205, 292, 2.45], [receiptAt + 0.3, 500, 372, 2.2], [receiptAt + 1.2, 510, 382, 2.24]];
  const cam = camAt(keys, T);
  const pNo = toFrame(cam, W, H, m.tapNo.box!.x + m.tapNo.box!.w / 2, m.tapNo.box!.y + m.tapNo.box!.h / 2);
  const pOk = toFrame(cam, W, H, m.confirm.box!.x + m.confirm.box!.w / 2, m.confirm.box!.y + m.confirm.box!.h / 2);
  const hk = ease(T, receiptAt + 0.6, 0.35, EASE.inOut);
  return (
    <AbsoluteFill style={{background: '#fff', overflow: 'hidden'}}>
      <Shotframe src={frameOf(tall ? 'replay-phone' : 'replay', f, R.frames)} cam={cam} vw={tall ? 390 : 1600} W={W} H={H} />
      <Tap x={pNo.x} y={pNo.y} t={T - tap} />
      <Tap x={pOk.x} y={pOk.y} t={T - confirmAt} />
      <Mark boxes={[hash]} cam={cam} W={W} H={H} k={hk} color="rgba(0,236,255,0.28)" pad={4} />
    </AbsoluteFill>
  );
};

// ----- beat 3b: the same transaction on a public NEAR explorer ------------------------------------------------------
type Ex = {boxes: Record<string, {x: number; y: number; w: number; h: number}[]>};
const EX = explorer as unknown as Ex;
const EXP = explorerP as unknown as Ex;
const Explorer: React.FC<P> = ({t}) => {
  const tall = useTall();
  const W = tall ? 1080 : 1920;
  const H = tall ? 1920 : 1080;
  const b = (tall ? EXP : EX).boxes;
  const cam = camAt(tall ? [[0, 195, 347, 2.77], [2.4, 195, 352, 2.82]] : [[0, 455, 330, 2.12], [2.4, 470, 330, 2.22]], t);
  const hk = ease(t, 0.25, 0.5, EASE.inOut);
  const sk = ease(t, 0.75, 0.35, EASE.inOut);
  return (
    <AbsoluteFill style={{background: '#fff', overflow: 'hidden'}}>
      <Shotframe src={staticFile(tall ? 'v7/explorer-phone/view.png' : 'v7/explorer/view.png')} cam={cam} vw={tall ? 390 : 1600} W={W} H={H} />
      <Mark boxes={b.hash} cam={cam} W={W} H={H} k={hk} color="rgba(0,236,255,0.3)" pad={4} />
      <Mark boxes={[...b.block, ...b.time]} cam={cam} W={W} H={H} k={sk} color="rgba(0,236,255,0.2)" pad={3} />
      {tall ? null : <Source t={t} at={0.05}>pikespeak.ai · a public NEAR explorer</Source>}
    </AbsoluteFill>
  );
};

// ----- placeholders for the beats that wait for "site live" (rulings, the decided market, the new page header) ----
const Pending: React.FC<{id: string; what: string; children?: React.ReactNode}> = ({id, what, children}) => (
  <Ground>
    {children}
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
      {children ? null : <div style={{font: `600 44px ${FONT.text}`, color: C.ink3, maxWidth: 1200, textAlign: 'center'}}>{what}</div>}
    </AbsoluteFill>
    {PENDING.has(id) ? (
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        <div style={{position: 'absolute', inset: 14, border: '4px dashed #C9222B', borderRadius: 18}} />
        <span style={{position: 'absolute', left: 28, bottom: 28, background: '#C9222B', color: '#fff', font: "700 26px 'General Sans', sans-serif", padding: '8px 16px', borderRadius: 10}}>PLACEHOLDER · waiting for "site live" ({id})</span>
      </AbsoluteFill>
    ) : null}
  </Ground>
);

type Rl = Rec & {cards: {button: {x: number; y: number; w: number; h: number}}[]; tags: {x: number; y: number; w: number; h: number}[]};
const RL = rulings as unknown as Rl;
const RLP = rulingsP as unknown as Rl;
const JUDGES = ['DeepSeek', 'Qwen', 'GLM'];

/** The designed FALSE: a red pill that lands with weight, anchored to the card's own FALSE tag. */
const FalseMark: React.FC<{x: number; y: number; t: number; size?: number}> = ({x, y, t, size = 54}) => {
  if (t < 0) return null;
  const k = ease(t, 0, 0.32, EASE.spring);
  const flash = clamp01(1 - t / 0.5);
  return (
    <div style={{position: 'absolute', left: x, top: y, transform: `translate(-100%, -50%) scale(${mix(1.5, 1, k)})`, transformOrigin: '100% 50%', opacity: clamp01(t / 0.08)}}>
      <div style={{display: 'inline-flex', alignItems: 'center', gap: 12, height: size * 1.55, padding: `0 ${size * 0.5}px`, borderRadius: 999, background: C.no, color: '#fff', font: `700 ${size}px ${FONT.disp}`, letterSpacing: '0.04em', boxShadow: `0 0 0 ${8 * flash}px rgba(201,34,43,${0.25 * flash}), 0 24px 50px -20px rgba(201,34,43,0.6)`}}>
        FALSE
      </div>
    </div>
  );
};

const Verdict: React.FC<P> = ({shot, T}) => {
  const tall = useTall();
  const W = tall ? 1080 : 1920;
  const H = tall ? 1920 : 1080;
  const R = tall ? RLP : RL;
  const k = shot.k ?? {};
  const f = [k.f1 ?? shot.at + 2, k.f2 ?? shot.at + 3, k.f3 ?? shot.at + 5];
  const m = R.marks;
  const v = [m.verify1.t, m.verify2.t, m.verify3.t];
  const lead = shot.rate && shot.rate > 1.3 ? 0.25 : 1.2;
  const rec = recAt([[shot.at, Math.max(0, v[0] - 0.9)], [f[0] - lead, v[0]], [f[1] - lead, v[1]], [f[2] - lead, v[2]]], T);
  const fr = 1 + Math.floor(rec * 30);
  const end = shot.at + shot.dur;
  const short = shot.dur < 5;
  const keys: Key[] = tall
    ? [[shot.at, 195, 422, 2.77], [end, 195, 422, 2.8]]
    : short
      ? [[shot.at, 800, 420, 1.3], [end, 800, 422, 1.33]]
      : [[shot.at, 800, 420, 1.3], [shot.at + 2.2, 800, 420, 1.34], [f[0] - 1.6, 568, 372, 2.06], [f[1] + 0.4, 568, 372, 2.06], [f[2] - 0.5, 1032, 372, 2.06], [end, 1034, 374, 2.08]];
  const cam = camAt(keys, T);
  const taps = [0, 1, 2].map((i) => {
    const b = R.cards[i]?.button;
    return b ? toFrame(cam, W, H, b.x + b.w / 2, b.y + b.h / 2) : null;
  });
  return (
    <AbsoluteFill style={{background: '#fff', overflow: 'hidden'}}>
      <Shotframe src={frameOf(tall ? 'rulings-phone' : 'rulings', fr, R.frames)} cam={cam} vw={tall ? 390 : 1600} W={W} H={H} />
      {!tall ? taps.map((p, i) => (p ? <Tap key={i} x={p.x} y={p.y} t={T - (f[i] - lead)} /> : null)) : null}
      {!tall
        ? [0, 1, 2].map((i) => {
            const tag = RL.tags[i];
            const p = toFrame(cam, W, H, tag.x + tag.w + 6, tag.y + tag.h / 2);
            return <FalseMark key={i} x={p.x} y={p.y} t={T - f[i]} size={short ? 40 : 50} />;
          })
        : (
          <>
          <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 420, background: 'linear-gradient(rgba(255,255,255,0.97) 70%, rgba(255,255,255,0))'}} />
          <div style={{position: 'absolute', left: 0, right: 0, top: 160, display: 'flex', justifyContent: 'center', gap: 22}}>
            {[0, 1, 2].map((i) => {
              const tt = T - f[i];
              const kk = ease(tt, 0, 0.32, EASE.spring);
              return (
                <div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: tt < 0 ? 0.0 : 1, transform: `scale(${tt < 0 ? 1 : mix(1.4, 1, kk)})`}}>
                  <div style={{height: 84, padding: '0 26px', borderRadius: 999, background: C.no, color: '#fff', font: `700 46px/84px ${FONT.disp}`, letterSpacing: '0.04em', boxShadow: '0 24px 50px -20px rgba(201,34,43,0.6)'}}>FALSE</div>
                  <div style={{font: `600 30px ${FONT.text}`, color: C.ink, background: 'rgba(255,255,255,0.92)', borderRadius: 10, padding: '2px 10px'}}>{JUDGES[i]}</div>
                </div>
              );
            })}
          </div>
          </>
        )}
      {tall ? (
        <div style={{position: 'absolute', left: 0, right: 0, top: 40, display: 'flex', justifyContent: 'center'}}>
          <span style={{display: 'inline-flex', alignItems: 'center', height: 76, padding: '0 28px', borderRadius: 999, background: 'rgba(255,255,255,0.96)', boxShadow: `0 0 0 1px ${C.line}, 0 14px 30px -18px rgba(40,52,66,0.5)`, font: `600 36px ${FONT.text}`, color: C.ink}}>Three AI models on NEAR AI Cloud</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
const Decided: React.FC<P> = ({shot}) => <Pending id={shot.id} what="The decided market: “0% chance it’s true · Decided false by three AI judges”" />;

// ----- beat 6: the real Wikipedia sentence beside the page's corrected line ------------------------------------------
const Payoff: React.FC<P> = ({shot, t}) => {
  const tall = useTall();
  const W = tall ? 1080 : 1920;
  const H = tall ? 1920 : 1080;
  const D = tall ? WVP : WV;
  const {cx, cy} = bbox(D.sentence);
  const half = tall ? {w: W, h: H / 2} : {w: W / 2, h: H};
  const z = tall ? 2.77 : 1.1;
  const cam: Key = [0, tall ? 195 : cx, cy, z];
  return (
    <Pending id={shot.id} what="">
      <div style={{position: 'absolute', left: 0, top: 0, width: half.w, height: half.h, overflow: 'hidden', background: '#fff', borderRight: tall ? 'none' : `1px solid ${C.line}`}}>
        <Shotframe src={frameOf(tall ? 'wiki-phone' : 'wiki', D.frames, D.frames)} cam={cam} vw={tall ? 390 : 1600} W={half.w} H={half.h} />
        <Mark boxes={D.sentence} cam={cam} W={half.w} H={half.h} k={1} color="rgba(237,179,69,0.32)" />
        <Mark boxes={D.number} cam={cam} W={half.w} H={half.h} k={1} color="rgba(237,179,69,0.55)" />
        <Source t={t}>Wikipedia, today</Source>
      </div>
      <div style={{position: 'absolute', left: tall ? 0 : W / 2, top: tall ? H / 2 : 0, width: half.w, height: half.h, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 36px ${FONT.text}`, color: C.ink3, textAlign: 'center', padding: 60}}>
        isitpriced.com/p/tether: the corrected line, its source and the signed “What changed” proof (after “site live”)
      </div>
    </Pending>
  );
};

// ----- beat 7: the end card: the mark, the line and the address; no dial -------------------------------------------------
const End: React.FC<P> = ({shot, t}) => {
  const tall = useTall();
  const fast = !!shot.fast;
  const lock = ease(t, 0.05, 0.5);
  const q = ease(t, fast ? 0.25 : 0.7, 0.5);
  const free = ease(t, fast ? 0.6 : 2.2, 0.45);
  const url = ease(t, fast ? 0.9 : 2.9, 0.5, EASE.spring);
  return (
    <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
      {/* the live page behind, softened: the product, not a blank slide */}
      <Img src={frameOf('replay', 30, RP.frames)} style={{position: 'absolute', width: tall ? 3400 : 2400, left: tall ? -1000 : -240, top: tall ? 120 : -120, filter: 'blur(18px) saturate(0.9)', opacity: 0.55, maxWidth: 'none', transform: `scale(${mix(1.06, 1.0, clamp01(t / 6))})`}} />
      <AbsoluteFill style={{background: 'radial-gradient(70% 70% at 50% 50%, rgba(248,249,251,0.92), rgba(248,249,251,0.78))'}} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: tall ? '0 60px 200px' : '0 0 40px'}}>
        <div style={{opacity: lock, transform: `translateY(${(1 - lock) * 14}px)`, marginBottom: 46}}>
          <Lockup height={tall ? 120 : 132} />
        </div>
        <div style={{...big(tall ? 120 : 132), opacity: q, transform: `translateY(${(1 - q) * 14}px)`}}>Is it true? Bet on it.</div>
        <div style={{font: `500 ${tall ? 42 : 40}px/1.3 ${FONT.text}`, color: C.ink2, marginTop: 34, opacity: free}}>Your first $1 is free · no wallet</div>
        <div style={{marginTop: 40, opacity: clamp01(url), transform: `scale(${mix(0.9, 1, url)})`}}>
          <PrimaryButton size={tall ? 2.0 : 1.9}>isitpriced.com</PrimaryButton>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const SHOTS7: Record<string, React.FC<P>> = {
  v7hook: Hook,
  v7market: Market,
  v7explorer: Explorer,
  v7verdict: Verdict,
  v7decided: Decided,
  v7payoff: Payoff,
  v7end: End,
};
