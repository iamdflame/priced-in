import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, DUR, EASE, FONT} from '../brand/tokens';
import {Lockup, PrimaryButton, Stage, lerp, prog, useT, useVertical} from '../components/core';
import {Dial} from '../components/Dial';

/** Title card: the lockup, the needle's single pivot sweep (the one animation the mark allows),
 * then the brand line with cyan on the second sentence (graphite ground only). */
export const TitleCard: React.FC<{tempo?: number}> = ({tempo = 1}) => {
  const t = useT() * tempo;
  const v = useVertical();
  const inK = prog(t, 0, 0.7, EASE.out);
  const sweep = prog(t, 0.15, DUR.needle, EASE.needle);
  const line = prog(t, 0.75, 0.6, EASE.out);
  return (
    <Stage glowAt="50% 46%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: v ? 70 : 54}}>
        <div style={{opacity: inK, transform: `scale(${lerp(0.94, 1, inK)})`}}>
          <Lockup height={v ? 150 : 150} sweep={sweep} />
        </div>
        <div
          style={{
            font: `500 ${v ? 64 : 54}px ${FONT.text}`,
            color: C.ink,
            letterSpacing: '-0.01em',
            opacity: line,
            transform: `translateY(${(1 - line) * 18}px)`,
          }}
        >
          Is it true? <span style={{color: C.brand}}>Bet on it.</span>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

/** End card: the dial swings from the opening 50% to the real last price, 10%; the lockup,
 * the brand line and the next step. The URL holds as a still for the last seconds. */
export const EndCard: React.FC<{tempo?: number}> = ({tempo = 1}) => {
  const t = useT() * tempo;
  const v = useVertical();
  const inK = prog(t, 0, 0.6, EASE.out);
  const swing = prog(t, 0.3, DUR.needle, EASE.needle);
  const roll = prog(t, 0.3, 1.0, EASE.out);
  const a = prog(t, 0.5, 0.6, EASE.out);
  const b = prog(t, 0.85, 0.6, EASE.out);
  const c = prog(t, 1.15, 0.6, EASE.spring);
  const p = lerp(0.5, 0.099804, swing);
  const ring = t > 0.75 ? Math.min(1, (t - 0.75) / 1.3) : 0;
  const s = v ? 1.25 : 1;
  return (
    <Stage glowAt={v ? '50% 30%' : '30% 50%'}>
      <AbsoluteFill
        style={{
          flexDirection: v ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: v ? 80 : 120,
          padding: v ? '0 80px 260px' : 0,
        }}
      >
        <div style={{position: 'relative', opacity: inK, transform: `scale(${lerp(0.92, 1, inK)})`}}>
          <div style={{position: 'absolute', inset: '-30%', borderRadius: '50%', background: 'radial-gradient(closest-side, oklch(.31 .035 225 / .55), transparent)'}} />
          <Dial size={v ? 640 : 560} p={p} from={50} to={10} roll={roll} ring={ring} />
        </div>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: v ? 'center' : 'flex-start', gap: 30 * s, textAlign: v ? 'center' : 'left'}}>
          <div style={{opacity: a, transform: `translateY(${(1 - a) * 16}px)`}}>
            <Lockup height={84 * s} />
          </div>
          <div style={{font: `700 ${72 * s}px/1.04 ${FONT.disp}`, letterSpacing: '-0.035em', color: C.ink, opacity: a, transform: `translateY(${(1 - a) * 16}px)`}}>
            Is it true?
            <br />
            <span style={{color: C.brand}}>Bet on it.</span>
          </div>
          <div style={{font: `500 ${30 * s}px ${FONT.text}`, color: C.ink2, opacity: b, transform: `translateY(${(1 - b) * 14}px)`}}>
            Your first $1 is free · no wallet, nothing to lose
          </div>
          <div style={{opacity: c, transform: `scale(${lerp(0.9, 1, c)})`, transformOrigin: v ? '50% 50%' : '0 50%'}}>
            <PrimaryButton size={1.5 * s}>isitpriced.com</PrimaryButton>
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
