import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, DUR, EASE, FONT, SHADOW} from '../brand/tokens';
import {Chip, Stage, lerp, prog, useT, useVertical} from '../components/core';
import {Dial} from '../components/Dial';

// Real numbers: the free $1 on No (tx FGFhi1W9mLtCvQ44SzDvpbKVCCPiDtkmMRpM15MBBvc6)
// moved market 18 from 0.231763 to 0.116287. Quotes at 23%: Yes $1 wins $2.41, No $1 wins $1.20.
export const P_BEFORE = 0.231763;
export const P_AFTER = 0.116287;

/** S03 · The money moment, from the kit's motion signature: the No button presses, the needle swings
 * 23% to 12% on its spring, the digits roll, a pulse leaves the hub, and NEAR's receipt lands. */
export const DialSwing: React.FC<{tempo?: number}> = ({tempo = 1}) => {
  const t = useT() * tempo;
  const v = useVertical();

  const enter = prog(t, 0, 0.6, EASE.out);
  const tapAt = 0.7;
  const press = t >= tapAt && t < tapAt + 0.3;
  const selected = t >= tapAt;
  const swing = prog(t, tapAt + 0.3, DUR.needle, EASE.needle);
  const roll = prog(t, tapAt + 0.3, 1.0, EASE.out);
  const ring = t > tapAt + 0.65 ? Math.min(1, (t - tapAt - 0.65) / 1.3) : 0;
  const tap = t > tapAt ? Math.min(1, (t - tapAt) / 0.5) : 0;
  const receipt = prog(t, 2.35, 0.55, EASE.spring);
  const p = lerp(P_BEFORE, P_AFTER, swing);

  const dialSize = v ? 520 : 600;
  const s = v ? 1.35 : 1; // type scale (vertical keeps the bottom 20% clear)

  const Bet: React.FC<{side: 'yes' | 'no'}> = ({side}) => {
    const isNo = side === 'no';
    const fill = isNo && selected;
    return (
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 92 * s,
          padding: `${14 * s}px ${22 * s}px`,
          borderRadius: 18 * s,
          background: fill ? C.noFill : isNo ? C.noBg : C.yesBg,
          color: fill ? C.noInk : isNo ? C.no : C.yes,
          transform: `scale(${isNo && press ? 0.95 : 1})`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 6 * s,
          overflow: 'hidden',
        }}
      >
        <div style={{display: 'flex', justifyContent: 'space-between', font: `600 ${26 * s}px ${FONT.disp}`}}>
          <span>{isNo ? 'No, it’s false' : 'Yes, it’s true'}</span>
          <span style={{fontFeatureSettings: "'tnum'"}}>{isNo ? '77¢' : '23¢'}</span>
        </div>
        <div style={{font: `500 ${19 * s}px ${FONT.text}`, opacity: 0.92}}>{isNo ? '$1 wins $1.20' : '$1 wins $2.41'}</div>
        {isNo && tap > 0 && tap < 1 ? (
          <div
            style={{
              position: 'absolute',
              left: '62%',
              top: '50%',
              width: 60 * s,
              height: 60 * s,
              margin: `-${30 * s}px 0 0 -${30 * s}px`,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.35)',
              opacity: 1 - tap,
              transform: `scale(${1 + tap * 5})`,
            }}
          />
        ) : null}
      </div>
    );
  };

  const fromLine =
    swing > 0.35 ? (
      <>
        chance it’s true, down from <b style={{color: C.no, fontWeight: 600}}>23%</b> after your $1 on No
      </>
    ) : (
      'chance it’s true'
    );

  const text = (
    <div style={{display: 'flex', flexDirection: 'column', gap: 22 * s, width: v ? '100%' : 760}}>
      <div>
        <Chip tone="warn" size={1.4 * s}>
          ⚑ Wikipedia may be wrong
        </Chip>
      </div>
      <div style={{font: `700 ${52 * s}px/1.06 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink}}>
        Are most of Tether’s cash reserves U.S. T-Bills, accounting for $72.6&nbsp;billion?
      </div>
      <div style={{font: `500 ${22 * s}px ${FONT.text}`, color: C.ink3}}>{fromLine}</div>
      <div style={{display: 'flex', gap: 12 * s, marginTop: 8 * s}}>
        <Bet side="yes" />
        <Bet side="no" />
      </div>
      <div style={{font: `500 ${19 * s}px ${FONT.text}`, color: C.ink3}}>Your first $1 is free · no sign-up, no wallet</div>
      <div
        style={{
          opacity: receipt,
          transform: `translateY(${(1 - receipt) * 18}px) scale(${lerp(0.92, 1, receipt)})`,
          transformOrigin: '0 50%',
          display: 'flex',
          alignItems: 'center',
          gap: 16 * s,
          marginTop: 6 * s,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10 * s,
            height: 52 * s,
            padding: `0 ${20 * s}px`,
            borderRadius: 999,
            background: C.yesBg,
            color: C.yes,
            font: `600 ${24 * s}px ${FONT.disp}`,
          }}
        >
          ✓ Recorded on NEAR · 4.5 s
        </span>
        <span style={{font: `500 ${20 * s}px ${FONT.mono}`, color: C.ink2}}>FGFhi1…BBvc6</span>
      </div>
      <div style={{opacity: receipt, font: `500 ${16 * s}px ${FONT.text}`, color: C.ink3, marginTop: -8 * s}}>
        NEAR: a public blockchain
      </div>
    </div>
  );

  return (
    <Stage glowAt={v ? '50% 30%' : '30% 50%'}>
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: v ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: v ? 'flex-start' : 'center',
          gap: v ? 50 : 90,
          padding: v ? '130px 80px 0' : '0 140px',
          opacity: enter,
          transform: `translateY(${(1 - enter) * 30}px)`,
        }}
      >
        <div
          style={{
            padding: v ? 0 : 40,
            borderRadius: 40,
            background: v ? 'transparent' : `${SHADOW.backdrop}, ${SHADOW.panel}`,
            flex: 'none',
          }}
        >
          <Dial size={dialSize} p={p} from={23} to={12} roll={roll} ring={ring} />
        </div>
        {text}
      </AbsoluteFill>
    </Stage>
  );
};
