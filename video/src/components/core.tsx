import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, EASE, FONT, SHADOW} from '../brand/tokens';

/** Seconds since the start of the current Sequence. */
export const useT = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return frame / fps;
};

export const useVertical = () => {
  const {width, height} = useVideoConfig();
  return height > width;
};

/** 0..1 progress of a move that starts at `start` s and lasts `dur` s, with an easing. */
export const prog = (t: number, start: number, dur: number, ease: (k: number) => number = EASE.out) =>
  ease(interpolate(t, [start, start + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Graphite stage with the kit's soft cyan-grey glow behind the subject, plus a fine grain. */
export const Stage: React.FC<{children?: React.ReactNode; glowAt?: string; push?: number}> = ({
  children,
  glowAt = '50% 42%',
  push = 0,
}) => (
  <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
    <AbsoluteFill
      style={{background: `radial-gradient(60% 70% at ${glowAt}, oklch(.24 .03 225 / .7), transparent 70%)`}}
    />
    <AbsoluteFill style={{transform: `scale(${1 + push})`, transformOrigin: '50% 50%'}}>{children}</AbsoluteFill>
    <Grain />
  </AbsoluteFill>
);

/** Static film grain so flat graphite never bands in H.264. */
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const seed = frame % 4;
  return (
    <AbsoluteFill style={{opacity: 0.05, mixBlendMode: 'overlay', pointerEvents: 'none'}}>
      <svg width="100%" height="100%">
        <filter id={`g${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Chip: React.FC<{tone?: 'warn' | 'yes' | 'no' | 'plain'; size?: number; children: React.ReactNode}> = ({
  tone = 'plain',
  size = 1,
  children,
}) => {
  const map = {
    warn: [C.warnBg, C.warn],
    yes: [C.yesBg, C.yes],
    no: [C.noBg, C.no],
    plain: [C.surface2, C.ink2],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8 * size,
        height: 26 * size,
        padding: `0 ${12 * size}px`,
        borderRadius: 999,
        background: bg,
        color: fg,
        font: `500 ${12.5 * size}px ${FONT.text}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};

/** The % sign is <i> at 0.52em beside the digits (kit rule). */
export const Pct: React.FC<{value: number; size: number; color?: string}> = ({value, size, color = C.ink}) => (
  <span
    style={{
      font: `700 ${size}px/0.9 ${FONT.disp}`,
      letterSpacing: '-0.05em',
      color,
      fontFeatureSettings: "'tnum'",
    }}
  >
    {value}
    <i style={{fontStyle: 'normal', fontSize: '0.52em', marginLeft: '0.04em'}}>%</i>
  </span>
);

/** The mark plus the wordmark, as in logo/lockup-horizontal-on-dark.svg, with the needle on its pivot.
 * `sweep` 0..1 runs the one allowed animation: the needle swinging onto its 42 degree rest. */
export const Lockup: React.FC<{height: number; sweep?: number}> = ({height, sweep = 1}) => {
  const angle = (1 - sweep) * -150;
  return (
    <svg viewBox="0 0 171.28 48" height={height} width={(height * 171.28) / 48} style={{display: 'block'}}>
      <g transform="translate(-8 0)">
        <path
          fill={C.markInk}
          fillRule="evenodd"
          d="M10 40.25V19A14 14 0 1 1 15.5 30.12V40.25A2.75 2.75 0 0 1 10 40.25ZM24 10.5A8.5 8.5 0 1 0 24 27.5A8.5 8.5 0 1 0 24 10.5Z"
        />
        <g transform={`rotate(${angle} 24 19)`}>
          <path fill={C.markCyan} d="M25.41 20.27L29.14 14.34A0.7 0.7 0 0 0 28.1 13.4L22.59 17.73Z" />
        </g>
        <circle fill={C.markCyan} cx="24" cy="19" r="3" />
      </g>
      <image href={staticFile('brand/logo/wordmark-on-dark.svg')} x={46} y={6.6} width={117.3} height={29.25} />
    </svg>
  );
};

/** Primary cyan pill (action). */
export const PrimaryButton: React.FC<{children: React.ReactNode; size?: number; glow?: number}> = ({
  children,
  size = 1,
  glow = 1,
}) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 52 * size,
      padding: `0 ${28 * size}px`,
      borderRadius: 999,
      background: `linear-gradient(180deg, ${C.brandHover}, ${C.brand})`,
      color: C.brandInk,
      font: `600 ${17 * size}px ${FONT.disp}`,
      boxShadow: `inset 0 1px 0 oklch(1 0 0/.45), inset 0 -1px 0 oklch(.5 .1 215/.35), 0 ${10 * size}px ${
        26 * size
      }px -${10 * size}px oklch(.86 .15 205/${0.55 * glow})`,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </span>
);

export {SHADOW};
