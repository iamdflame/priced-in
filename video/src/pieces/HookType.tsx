import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, EASE, FONT} from '../brand/tokens';
import {Chip, Stage, lerp, prog, useT, useVertical} from '../components/core';

/** S01 · The hook. Kinetic type: the Wikipedia sentence, the amber mark under "$72.6 billion",
 * then Tether's own number. Film timing at tempo 1 (3.2 s shot). Sound off, it still lands by 1.8 s. */
export const HookType: React.FC<{tempo?: number}> = ({tempo = 1}) => {
  const t = useT() * tempo;
  const v = useVertical();
  return v ? <HookVertical t={t} /> : <HookWide t={t} />;
};

const words = ['“…are', 'U.S.', 'T-Bills,', 'accounting', 'for'];

const Reveal: React.FC<{t: number; at: number; children: React.ReactNode; dy?: number}> = ({t, at, children, dy = 28}) => {
  const k = prog(t, at, 0.55, EASE.out);
  return (
    <span
      style={{
        display: 'inline-block',
        opacity: k,
        transform: `translateY(${(1 - k) * dy}px)`,
        filter: `blur(${(1 - k) * 8}px)`,
      }}
    >
      {children}
    </span>
  );
};

const HookWide: React.FC<{t: number}> = ({t}) => {
  const mark = prog(t, 1.15, 0.5, EASE.inOut);
  const second = prog(t, 1.8, 0.5, EASE.out);
  const newNum = '$122.84 billion';
  const chars = Math.floor(interpolateChars(t, 1.95, 0.03, newNum.length));
  return (
    <Stage push={lerp(0, 0.03, Math.min(1, t / 3.2))} glowAt="40% 45%">
      <AbsoluteFill style={{padding: '0 180px', justifyContent: 'center'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 34, opacity: prog(t, 0, 0.5)}}>
          <span style={{font: `500 24px ${FONT.text}`, color: C.ink3}}>Wikipedia · Tether article</span>
          <span style={{opacity: prog(t, 1.4, 0.3), transform: `scale(${lerp(0.9, 1, prog(t, 1.4, 0.4, EASE.spring))})`}}>
            <Chip tone="warn" size={1.5}>
              ⚑ Wikipedia may be wrong
            </Chip>
          </span>
        </div>
        <div
          style={{
            font: `400 92px/1.12 ${FONT.quote}`,
            fontVariationSettings: "'opsz' 72",
            color: C.ink,
            letterSpacing: '-0.01em',
            maxWidth: 1560,
          }}
        >
          {words.map((w, i) => (
            <React.Fragment key={w}>
              <Reveal t={t} at={0.05 + i * 0.07}>
                {w}
              </Reveal>{' '}
            </React.Fragment>
          ))}
          <Reveal t={t} at={0.45}>
            <span style={{position: 'relative', display: 'inline-block', color: mark > 0.5 ? C.warn : C.ink}}>
              <span
                style={{
                  position: 'absolute',
                  left: -10,
                  right: -10,
                  top: '14%',
                  bottom: '4%',
                  background: C.warnBg,
                  borderRadius: 10,
                  transformOrigin: '0 50%',
                  transform: `scaleX(${mark})`,
                }}
              />
              <span style={{position: 'relative'}}>$72.6&nbsp;billion</span>
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: '2%',
                  height: 5,
                  width: '100%',
                  background: C.warn,
                  borderRadius: 3,
                  transformOrigin: '0 50%',
                  transform: `scaleX(${mark})`,
                }}
              />
            </span>
            .”
          </Reveal>
        </div>
        <div
          style={{
            marginTop: 44,
            display: 'flex',
            alignItems: 'baseline',
            gap: 22,
            opacity: second,
            transform: `translateY(${(1 - second) * 24}px)`,
          }}
        >
          <span style={{font: `500 38px ${FONT.text}`, color: C.ink2}}>Tether’s own report:</span>
          <span
            style={{
              font: `700 84px/1 ${FONT.disp}`,
              letterSpacing: '-0.04em',
              color: C.ink,
              fontFeatureSettings: "'tnum'",
              background: C.yesBg,
              borderRadius: 14,
              padding: '6px 18px 10px',
            }}
          >
            {newNum.slice(0, chars)}
            <span style={{opacity: 0}}>{newNum.slice(chars)}</span>
          </span>
        </div>
        <div style={{marginTop: 30, font: `500 22px ${FONT.text}`, color: C.ink3, opacity: prog(t, 2.3, 0.5)}}>
          T-Bills: U.S. Treasury bills, government debt
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

const HookVertical: React.FC<{t: number}> = ({t}) => {
  const a = prog(t, 0.1, 0.6, EASE.out);
  const b = prog(t, 1.2, 0.6, EASE.out);
  const gap = lerp(0, 120, prog(t, 1.6, 1.2, EASE.inOut));
  const Num: React.FC<{label: string; value: string; k: number; tone: 'warn' | 'yes'}> = ({label, value, k, tone}) => (
    <div style={{opacity: k, transform: `translateY(${(1 - k) * 40}px)`, filter: `blur(${(1 - k) * 8}px)`}}>
      <div style={{font: `500 46px ${FONT.text}`, color: C.ink2, marginBottom: 18}}>{label}</div>
      <div
        style={{
          display: 'inline-block',
          font: `700 104px/1 ${FONT.disp}`,
          whiteSpace: 'nowrap',
          letterSpacing: '-0.045em',
          color: tone === 'warn' ? C.warn : C.ink,
          background: tone === 'warn' ? C.warnBg : C.yesBg,
          borderRadius: 22,
          padding: '10px 26px 18px',
          fontFeatureSettings: "'tnum'",
        }}
      >
        {value}
      </div>
    </div>
  );
  return (
    <Stage push={lerp(0, 0.03, Math.min(1, t / 3))} glowAt="50% 35%">
      <AbsoluteFill style={{padding: '0 90px', paddingTop: 300}}>
        <div style={{opacity: prog(t, 0, 0.4), marginBottom: 60}}>
          <Chip tone="warn" size={2.2}>
            ⚑ Wikipedia may be wrong
          </Chip>
        </div>
        <Num label="Wikipedia says" value="$72.6 billion" k={a} tone="warn" />
        <div style={{height: 70 + gap}} />
        <Num label="Tether’s own report says" value="$122.84 billion" k={b} tone="yes" />
        <div style={{marginTop: 60, font: `500 34px ${FONT.text}`, color: C.ink3, opacity: prog(t, 2.0, 0.5)}}>
          Tether’s U.S. Treasury bills, in its own report
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

function interpolateChars(t: number, start: number, perChar: number, n: number) {
  if (t < start) return 0;
  return Math.min(n, (t - start) / perChar);
}
