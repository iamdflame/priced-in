import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile} from 'remotion';
import {C, EASE, FONT, SHADOW} from '../brand/tokens';
import {Chip, Stage, lerp, prog, useT, useVertical} from '../components/core';
import {Odometer} from '../components/Dial';

// ---------------------------------------------------------------------------------------------
// S04 · The chart: one step per real bet on market 18 (trade events seq 2, 4, 5, 10, 12, 14, 26).
export const STEPS = [
  {p: 50, who: 'Opened · our AI’s estimate', side: ''},
  {p: 25.1, who: 'A person · free $1', side: 'no'},
  {p: 28.0, who: 'The Quant, an AI trader', side: 'yes'},
  {p: 17.8, who: 'The Archivist, an AI trader', side: 'no'},
  {p: 14.0, who: 'A person · free $1', side: 'no'},
  {p: 23.2, who: 'The Quant, an AI trader', side: 'yes'},
  {p: 11.6, who: 'A person · free $1', side: 'no'},
  {p: 10.0, who: 'The Archivist, an AI trader', side: 'no'},
] as const;

export const ChartSteps: React.FC<{tempo?: number; stepDur?: number}> = ({tempo = 1, stepDur = 0.62}) => {
  const t = useT() * tempo;
  const v = useVertical();
  const W = v ? 920 : 1240;
  const H = v ? 620 : 520;
  const n = STEPS.length - 1;
  const x = (i: number) => (i / n) * W;
  const y = (p: number) => H - (p / 100) * H;
  const reveal = interpolate(t, [0.4, 0.4 + n * stepDur], [0, n], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const done = Math.floor(reveal);
  const frac = EASE.out(reveal - done);
  // build the step path up to the current reveal
  let d = `M0 ${y(STEPS[0].p)}`;
  for (let i = 1; i <= Math.min(n, done); i++) d += ` H${x(i)} V${y(STEPS[i].p)}`;
  if (done < n) d += ` H${lerp(x(done), x(done + 1), frac)}`;
  const cur = STEPS[Math.min(n, done)];
  const prevPct = Math.round(STEPS[Math.max(0, Math.min(n, done) - 1)].p);
  const s = v ? 1.3 : 1;
  return (
    <Stage glowAt="50% 50%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30 * s}}>
        <div style={{width: W, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'}}>
          <div>
            <div style={{font: `500 ${22 * s}px ${FONT.text}`, color: C.ink3}}>Chance it’s true, after each bet</div>
            <div style={{font: `700 ${54 * s}px/1.05 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink, marginTop: 6}}>
              7 bets · 50% → 10%
            </div>
          </div>
          <div style={{textAlign: 'right'}}>
            <Odometer from={prevPct} to={Math.round(cur.p)} k={done === 0 ? 1 : 1} size={96 * s} />
          </div>
        </div>
        <svg width={W + 80} height={H + 40} viewBox={`-10 -20 ${W + 80} ${H + 40}`}>
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={0} x2={W} y1={y(g)} y2={y(g)} stroke={C.line} strokeWidth={1.5} />
              <text x={W + 14} y={y(g) + 6} fill={C.ink3} style={{font: `500 ${16 * s}px ${FONT.text}`}}>
                {g}%
              </text>
            </g>
          ))}
          <path d={`${d} V${H} H0 Z`} fill="url(#area)" opacity={0.5} />
          <defs>
            <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#F5F7F9" stopOpacity="0.16" />
              <stop offset="1" stopColor="#F5F7F9" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={d} fill="none" stroke={C.ink} strokeWidth={3.5} strokeLinejoin="round" />
          <circle cx={done < n ? lerp(x(done), x(done + 1), frac) : x(n)} cy={y(cur.p)} r={9} fill={C.brand} />
        </svg>
        <div style={{width: W, display: 'flex', gap: 14, alignItems: 'center', minHeight: 40 * s}}>
          {done > 0 ? (
            <>
              <Chip tone={cur.side === 'yes' ? 'yes' : 'no'} size={1.5 * s}>
                {cur.side === 'yes' ? 'Yes, it’s true' : 'No, it’s false'}
              </Chip>
              <span style={{font: `500 ${24 * s}px ${FONT.text}`, color: C.ink2}}>{cur.who}</span>
            </>
          ) : (
            <span style={{font: `500 ${24 * s}px ${FONT.text}`, color: C.ink3}}>Opened at 50% · our AI’s estimate</span>
          )}
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

// ---------------------------------------------------------------------------------------------
// S08 · Ten minutes to object, swept in four seconds; nobody did (disputes: []).
export const Countdown: React.FC<{tempo?: number; dur?: number}> = ({tempo = 1, dur = 3.6}) => {
  const t = useT() * tempo;
  const k = prog(t, 0.3, dur, EASE.inOut);
  const secs = Math.round(600 * (1 - k));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const R = 230;
  const L = 2 * Math.PI * R;
  const end = prog(t, 0.3 + dur, 0.5, EASE.spring);
  return (
    <Stage glowAt="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 40}}>
        <div style={{position: 'relative', width: 2 * R + 40, height: 2 * R + 40}}>
          <svg width={2 * R + 40} height={2 * R + 40} style={{transform: 'rotate(-90deg)'}}>
            <circle cx={R + 20} cy={R + 20} r={R} fill="none" stroke={C.surface3} strokeWidth={10} />
            <circle cx={R + 20} cy={R + 20} r={R} fill="none" stroke={C.ink} strokeWidth={10} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * k} />
          </svg>
          <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
            <div style={{font: `700 128px/1 ${FONT.disp}`, letterSpacing: '-0.04em', color: C.ink, fontFeatureSettings: "'tnum'"}}>
              {mm}:{ss}
            </div>
            <div style={{font: `500 24px ${FONT.text}`, color: C.ink3, marginTop: 12}}>Anyone can object for 10 minutes</div>
          </div>
        </div>
        <div style={{opacity: end, transform: `scale(${lerp(0.9, 1, end)})`}}>
          <Chip tone="yes" size={2}>
            ✓ No objections · settled
          </Chip>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

// ---------------------------------------------------------------------------------------------
// S10 · The payout: 4,930,100 micro-USDC to the No side (settle tx 3KbCTq…8K1v).
export const Payout: React.FC<{tempo?: number}> = ({tempo = 1}) => {
  const t = useT() * tempo;
  const v = useVertical();
  const k = prog(t, 0.3, 1.6, EASE.cubicOut);
  const value = (4.93 * k).toFixed(2);
  const a = prog(t, 1.2, 0.6, EASE.out);
  return (
    <Stage glowAt="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26, textAlign: 'center', padding: v ? '0 60px' : 0}}>
        <Chip tone="no" size={1.8}>
          Decided: false
        </Chip>
        <div style={{font: `700 ${v ? 220 : 260}px/0.95 ${FONT.disp}`, letterSpacing: '-0.05em', color: C.ink, fontFeatureSettings: "'tnum'"}}>${value}</div>
        <div style={{font: `600 ${v ? 54 : 52}px/1.1 ${FONT.disp}`, letterSpacing: '-0.025em', color: C.ink, opacity: a}}>Paid to everyone who bet No</div>
        <div style={{font: `500 26px ${FONT.text}`, color: C.ink3, opacity: a}}>Wrong bets lose their stake</div>
        <div style={{display: 'flex', gap: 14, alignItems: 'center', marginTop: 20, opacity: a}}>
          <span style={{font: `500 22px ${FONT.text}`, color: C.ink2}}>Settled on NEAR</span>
          <span style={{font: `500 22px ${FONT.mono}`, color: C.ink2}}>3KbCTq…8K1v</span>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

// ---------------------------------------------------------------------------------------------
// S13 · Proof stack: every step of the moment is a public NEAR transaction.
export const PROOF = [
  ['The free $1 on No', 'FGFhi1…BBvc6'],
  ['The challenge, $1 staked', '5C2kye…SnxaQ'],
  ['DeepSeek V4.1: false', '6HWB2E…a2dz'],
  ['Qwen 3.8: false', '7MQF5C…67E'],
  ['GLM 5.3: false', '78KBg1…WhR'],
  ['Settled, $4.93 paid', '3KbCTq…8K1v'],
  ['The corrected sentence opens', '8dZz4D…8eyW'],
] as const;

export const ProofStack: React.FC<{tempo?: number}> = ({tempo = 1}) => {
  const t = useT() * tempo;
  const v = useVertical();
  return (
    <Stage glowAt="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34, padding: v ? '0 60px' : 0}}>
        <div style={{font: `700 ${v ? 72 : 64}px/1.05 ${FONT.disp}`, letterSpacing: '-0.035em', color: C.ink, opacity: prog(t, 0, 0.5), textAlign: 'center'}}>
          Check every step yourself.
        </div>
        <div style={{width: v ? '100%' : 1100, display: 'flex', flexDirection: 'column', gap: 10}}>
          {PROOF.map(([label, hash], i) => {
            const k = prog(t, 0.35 + i * 0.28, 0.45, EASE.spring);
            return (
              <div
                key={hash}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px 26px',
                  borderRadius: 16,
                  background: SHADOW.panel,
                  boxShadow: SHADOW.card,
                  opacity: k,
                  transform: `translateY(${(1 - k) * 26}px)`,
                }}
              >
                <span style={{font: `500 26px ${FONT.text}`, color: C.ink2}}>{label}</span>
                <span style={{font: `500 26px ${FONT.mono}`, color: C.ink}}>{hash}</span>
              </div>
            );
          })}
        </div>
        <div style={{font: `500 22px ${FONT.text}`, color: C.ink3, opacity: prog(t, 2.4, 0.5)}}>nearblocks.io · market.isitpriced.near</div>
      </AbsoluteFill>
    </Stage>
  );
};

// ---------------------------------------------------------------------------------------------
/** A site shot in a flat frame with an optional Kit callout card on top (storyboard and stage 2 overlays). */
export const SiteCallout: React.FC<{
  src: string;
  url: string;
  /** source-pixel offset of the top of the visible area */
  top?: number;
  /** a highlight box in source pixels */
  box?: {x: number; y: number; w: number; h: number};
  callout?: {title: string; body?: string; tone?: 'warn' | 'yes' | 'no' | 'plain'; chip?: string; at?: 'right' | 'left' | 'bottom'};
  tilt?: number;
}> = ({src, url, top = 0, box, callout, tilt = 0}) => {
  const t = useT();
  const v = useVertical();
  const W = v ? 900 : 1560;
  const H = v ? 1500 : 880;
  const scale = W / (v ? 780 : 1440);
  const k = prog(t, 0, 0.6, EASE.out);
  return (
    <Stage glowAt="50% 50%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', perspective: 2600}}>
        <div
          style={{
            width: W,
            height: H,
            borderRadius: 28,
            overflow: 'hidden',
            position: 'relative',
            background: C.surface,
            boxShadow: '0 60px 120px -40px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.15)',
            transform: `rotateX(${tilt * 0.6}deg) rotateY(${-tilt}deg)`,
          }}
        >
          <div style={{height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, borderBottom: `1px solid ${C.line}`}}>
            <span style={{display: 'inline-flex', alignItems: 'center', gap: 10, height: 30, padding: '0 16px', borderRadius: 999, background: C.surface2, font: `500 16px ${FONT.text}`, color: C.ink2}}>
              <span style={{width: 8, height: 8, borderRadius: 9, background: C.brand}} />
              {url}
            </span>
          </div>
          <div style={{position: 'absolute', top: 50, left: 0, right: 0, bottom: 0, overflow: 'hidden'}}>
            <Img src={staticFile(src)} style={{width: '100%', display: 'block', transform: `translateY(${-top * scale}px)`}} />
            {box ? (
              <div
                style={{
                  position: 'absolute',
                  left: box.x * scale,
                  top: (box.y - top) * scale,
                  width: box.w * scale,
                  height: box.h * scale,
                  borderRadius: 18,
                  boxShadow: `0 0 0 3px ${C.brand}, 0 0 0 9999px rgba(11,15,19,${0.55 * k})`,
                  opacity: k,
                }}
              />
            ) : null}
          </div>
        </div>
        {callout ? (
          <div
            style={{
              position: 'absolute',
              ...(callout.at === 'left' ? {left: 70} : callout.at === 'bottom' || v ? {bottom: 120} : {right: 70}),
              ...(v ? {left: 60, right: 60} : {}),
              ...(callout.at === 'bottom' && !v ? {left: '50%', transform: `translateX(-50%) translateY(${(1 - k) * 20}px)`} : {transform: `translateY(${(1 - k) * 20}px)`}),
              width: v ? undefined : 560,
              padding: '26px 30px',
              borderRadius: 24,
              background: SHADOW.panel,
              boxShadow: `${SHADOW.card}, ${SHADOW.lift}, 0 0 0 1px ${C.lineStrong}`,
              opacity: k,
            }}
          >
            {callout.chip ? (
              <div style={{marginBottom: 14}}>
                <Chip tone={callout.tone ?? 'plain'} size={1.4}>
                  {callout.chip}
                </Chip>
              </div>
            ) : null}
            <div style={{font: `700 36px/1.1 ${FONT.disp}`, letterSpacing: '-0.025em', color: C.ink}}>{callout.title}</div>
            {callout.body ? <div style={{font: `400 24px/1.4 ${FONT.quote}`, fontVariationSettings: "'opsz' 24", color: C.ink2, marginTop: 12}}>{callout.body}</div> : null}
          </div>
        ) : null}
      </AbsoluteFill>
    </Stage>
  );
};
