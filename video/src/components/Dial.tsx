import React from 'react';
import {Img, staticFile} from 'remotion';
import {C, FONT, SHADOW, needleAngle} from '../brand/tokens';

/** Odometer digits in fixed-width cells: each column holds 0-9 twice so a digit can roll through the wrap.
 * `k` is the roll progress from `from` to `to` (already eased by the caller). */
export const Odometer: React.FC<{from: number; to: number; k: number; size: number; color?: string; pct?: boolean}> = ({
  from,
  to,
  k,
  size,
  color = C.ink,
  pct = true,
}) => {
  const a = String(Math.round(from)).padStart(2, '0');
  const b = String(Math.round(to)).padStart(2, '0');
  const cell = size * 0.9;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        font: `700 ${size}px/0.9 ${FONT.disp}`,
        letterSpacing: '-0.05em',
        color,
        height: cell,
      }}
    >
      {[0, 1].map((i) => {
        const idx = Number(a[i]) + 10 + (Number(b[i]) - Number(a[i])) * k;
        // a leading zero is hidden (10%, not 010%), and a tens column of 0 collapses when settled
        const hidden = i === 0 && a[0] === '0' && b[0] === '0';
        if (hidden) return null;
        return (
          <span key={i} style={{display: 'inline-block', width: '0.6em', height: cell, overflow: 'hidden', textAlign: 'center'}}>
            <span style={{display: 'block', transform: `translateY(${-idx * cell}px)`}}>
              {[...'01234567890123456789'].map((d, j) => (
                <span key={j} style={{display: 'block', height: cell, lineHeight: `${cell}px`}}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        );
      })}
      {pct ? <i style={{fontStyle: 'normal', fontSize: '0.52em', marginLeft: '0.04em'}}>%</i> : null}
    </span>
  );
};

type DialProps = {
  size: number;
  /** needle price, 0..1 (the real price; never set for effect) */
  p: number;
  /** read-out roll: from and to whole percentages and progress */
  from: number;
  to: number;
  roll: number;
  /** pulse ring leaving the hub, 0..1 (0 = none) */
  ring?: number;
  label?: string;
  glow?: number;
};

/** The Pulse dial: the Blender face (dial.webp) with the live SVG needle, hub and read-out on top.
 * Geometry is the kit's, in percent of the dial width. */
export const Dial: React.FC<DialProps> = ({size, p, from, to, roll, ring = 0, label = 'chance it’s true', glow = 1}) => {
  const u = size / 100; // 1% of the width
  return (
    <div style={{position: 'relative', width: size, height: size, borderRadius: '50%', boxShadow: SHADOW.dial}}>
      <Img src={staticFile('brand/dial.webp')} style={{width: size, height: size, display: 'block', borderRadius: '50%'}} />
      {/* scale labels */}
      <span style={{position: 'absolute', left: '21%', bottom: '13.5%', font: `500 ${Math.max(10, 3.6 * u)}px ${FONT.text}`, color: 'oklch(.72 .012 255)'}}>0</span>
      <span style={{position: 'absolute', right: '19%', bottom: '13.5%', font: `500 ${Math.max(10, 3.6 * u)}px ${FONT.text}`, color: 'oklch(.72 .012 255)'}}>100</span>
      {/* needle */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '8.4%',
          height: '40.5%',
          marginLeft: '-4.2%',
          marginTop: '-40.5%',
          transformOrigin: '50% 100%',
          transform: `rotate(${needleAngle(p)}deg)`,
          filter: `drop-shadow(0 0 ${6 * (size / 430)}px oklch(.86 .15 205 / ${0.75 * glow})) drop-shadow(0 3px 5px oklch(0 0 0 / .6))`,
        }}
      >
        <svg viewBox="0 0 20 100" preserveAspectRatio="none" width="100%" height="100%" style={{display: 'block'}}>
          <path d="M10 0C10.9 0 11.5.6 11.7 1.5L16 100H4L8.3 1.5C8.5.6 9.1 0 10 0Z" fill="oklch(.86 .15 205)" />
        </svg>
      </div>
      {/* pulse ring */}
      {ring > 0 && ring < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '12%',
            height: '12%',
            margin: '-6% 0 0 -6%',
            borderRadius: '50%',
            border: `${Math.max(2, 2 * (size / 430))}px solid oklch(.86 .15 205)`,
            opacity: 0.9 * (1 - ring),
            transform: `scale(${1 + 8 * ring})`,
          }}
        />
      ) : null}
      {/* hub */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '12%',
          height: '12%',
          margin: '-6% 0 0 -6%',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 36% 30%, oklch(.72 .012 255), oklch(.34 .012 255) 48%, oklch(.2 .01 255))',
          boxShadow: '0 3px 8px oklch(0 0 0 / .7), inset 0 1px 0 oklch(1 0 0 / .35)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '34%',
            borderRadius: '50%',
            background: 'oklch(.86 .15 205)',
            boxShadow: '0 0 10px oklch(.86 .15 205 / .9)',
          }}
        />
      </div>
      {/* read-out */}
      <div style={{position: 'absolute', left: 0, right: 0, top: '60%', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <Odometer from={from} to={to} k={roll} size={25 * u} />
        <span style={{font: `500 ${Math.max(11, 4.1 * u)}px ${FONT.text}`, color: 'oklch(.8 .012 255)', marginTop: 4 * u}}>{label}</span>
      </div>
    </div>
  );
};
