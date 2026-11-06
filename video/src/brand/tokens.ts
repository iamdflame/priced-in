// Pulse tokens, copied from .apex/design/brand/pulse/tokens.json and assets/kit.css (light theme: the default since 2026-11-06).
// The kit wins on any disagreement: copy values, never retype them.
import {Easing} from 'remotion';

export const C = {
  bg: '#F8F9FB',
  surface: '#FFFFFF',
  surface2: '#F0F3F6',
  surface3: '#E6EAEE',
  line: 'rgba(27,34,43,0.09)',
  lineStrong: 'rgba(27,34,43,0.17)',
  ink: '#11161E',
  ink2: '#474E57',
  ink3: '#5D646C',
  brand: '#00ECFF', // Pulse Cyan: action only (buttons, needle, hub, live dot, focus)
  brandHover: '#00E1F3',
  brandInk: '#001926',
  brandText: '#006E89', // cyan as text on white
  brandSoft: '#00B2C824',
  yes: '#007B3D',
  yesBg: '#00A1511F',
  yesFill: '#42D77B',
  yesInk: '#011C0A',
  no: '#C9222B',
  noBg: '#DE3B3D1A',
  noFill: '#FF6367',
  noInk: '#230707',
  warn: '#965800', // only for "Wikipedia may be wrong"
  warnBg: '#EDB34533',
  // mark colours (logo/mark.svg, for light grounds)
  markInk: '#14171C',
  markCyan: '#00B7C7',
} as const;

export const SHADOW = {
  card: '0 1px 2px oklch(.3 .03 255 / .06), 0 8px 24px -12px oklch(.3 .05 255 / .16)',
  panel: 'linear-gradient(180deg, oklch(1 0 0), oklch(.985 .003 255))',
  lift: '0 18px 40px -18px oklch(.3 .06 255 / .3)',
  dial: '0 30px 50px -22px oklch(.25 .05 255 / .55)',
  backdrop: 'radial-gradient(70% 110% at 84% 42%, oklch(.86 .07 210 / .4), transparent 70%)',
  stage: 'radial-gradient(60% 70% at 50% 40%, #FFFFFF, transparent 70%)',
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
