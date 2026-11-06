// Pulse tokens, copied from .apex/design/brand/pulse/tokens.json and assets/kit.css (dark theme).
// The kit wins on any disagreement: copy values, never retype them.
import {Easing} from 'remotion';

export const C = {
  bg: '#0B0F13',
  surface: '#13181D',
  surface2: '#1B2026',
  surface3: '#252B33',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.15)',
  ink: '#F5F7F9',
  ink2: '#B9BEC6',
  ink3: '#9399A1',
  brand: '#00ECFF', // Pulse Cyan: action only (buttons, needle, hub, live dot, focus)
  brandHover: '#81F2FF',
  brandInk: '#001926',
  brandSoft: 'rgba(0,236,255,0.14)',
  yes: '#4BDE81',
  yesBg: 'rgba(75,222,129,0.13)',
  yesFill: '#42D77B',
  yesInk: '#011C0A',
  no: '#FF7072',
  noBg: 'rgba(255,112,114,0.13)',
  noFill: '#FF6367',
  noInk: '#230707',
  warn: '#FAC053', // only for "Wikipedia may be wrong"
  warnBg: 'rgba(250,192,83,0.13)',
  // mark colours (logo/*-on-dark.svg)
  markInk: '#F4F6F9',
  markCyan: '#00E5F2',
} as const;

export const SHADOW = {
  card: 'inset 0 1px 0 oklch(1 0 0 / .05), 0 1px 0 oklch(0 0 0 / .4)',
  panel: 'linear-gradient(180deg, oklch(.225 .014 255), oklch(.2 .013 255))',
  lift: '0 18px 40px -18px oklch(0 0 0 / .8)',
  dial: '0 30px 60px -20px oklch(0 0 0 / .85)',
  // featured/slip backdrop: the glow sits behind the dial
  backdrop: 'radial-gradient(70% 110% at 84% 42%, oklch(.31 .035 225 / .55), transparent 70%)',
  stage: 'radial-gradient(60% 70% at 50% 40%, oklch(.24 .03 225 / .7), transparent 70%)',
  primary:
    'inset 0 1px 0 oklch(1 0 0/.45), inset 0 -1px 0 oklch(.5 .1 215/.35), 0 10px 26px -10px oklch(.86 .15 205/.55)',
} as const;

export const FONT = {
  disp: "'General Sans', Geist, system-ui, sans-serif",
  text: 'Geist, system-ui, sans-serif',
  mono: "'Geist Mono', ui-monospace, monospace",
  quote: 'Amstelvar, Georgia, serif', // quoted Wikipedia sentences only
} as const;

// Motion tokens (kit.css) as Remotion easings.
export const EASE = {
  out: Easing.bezier(0.22, 1, 0.36, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  spring: Easing.bezier(0.34, 1.56, 0.64, 1),
  // the needle: the signature clip's settle; the overshoot is the personality
  needle: Easing.bezier(0.3, 1.6, 0.45, 1),
  needleUi: Easing.bezier(0.3, 1.45, 0.5, 1),
  cubicOut: (k: number) => 1 - Math.pow(1 - k, 3), // count-ups (tween in core.js)
} as const;

// Durations in seconds (kit.css).
export const DUR = {micro: 0.14, color: 0.18, ui: 0.22, reveal: 0.7, tick: 0.9, needle: 1.25} as const;

// The dial mapping: 0 to 100% sweeps -120deg to +120deg. Always the real price.
export const needleAngle = (p: number) => -120 + 240 * p;
