import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {C, EASE, FONT} from '../brand/tokens';
import {Stage, lerp, prog, useT, useVertical} from '../components/core';

type Props = {
  tempo?: number;
  /** footage under public/ (synced by scripts/sync-footage.mjs; stage 2 swaps in recorded video) */
  src?: string;
  /** footage used when the composition is vertical (phone shot, full-bleed feel) */
  srcTall?: string;
  url?: string;
  /** how far the page scrolls inside the frame, px of the source image */
  scroll?: number;
  /** the camera move: 'settle' tilts in and lands flat; 'pullback' dollies back with a yaw */
  move?: 'settle' | 'pullback';
  dur?: number;
};

/** A browser-less device frame for site footage, with a 3D camera move (perspective, tilt, dolly, yaw)
 * and a glass highlight that sweeps once. The frame is quiet on purpose: no fake window chrome. */
export const DeviceFrame: React.FC<Props> = ({
  tempo = 1,
  src = 'footage/dark-c18__desktop__full.png',
  srcTall = 'footage/dark-c18__phone.png',
  url = 'isitpriced.com/c/18',
  scroll = 260,
  move = 'settle',
  dur = 2.4,
}) => {
  const t = useT() * tempo;
  const v = useVertical();
  const k = prog(t, 0, dur, EASE.inOut);
  const settle = move === 'settle';
  const rx = settle ? lerp(22, 0, k) : lerp(0, 10, k);
  const ry = settle ? lerp(-26, 0, k) : lerp(0, -12, k);
  const rz = settle ? lerp(3, 0, k) : 0;
  const z = settle ? lerp(-520, 0, k) : lerp(0, -620, k);
  const y = settle ? lerp(120, 0, k) : lerp(0, 40, k);
  const sc = prog(t, 0.3, dur + 1.2, EASE.inOut);
  const sweep = prog(t, dur * 0.35, 1.4, EASE.inOut);
  const w = v ? 860 : 1500;
  const h = v ? 1640 : 860;

  return (
    <Stage glowAt="50% 55%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', perspective: 2600, opacity: prog(t, 0, 0.35)}}>
        <div
          style={{
            width: w,
            height: h,
            transformStyle: 'preserve-3d',
            transform: `translate3d(0, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
            borderRadius: 28,
            background: C.surface,
            boxShadow: '0 60px 120px -40px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.15), inset 0 1px 0 rgba(255,255,255,.08)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: 54,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: `1px solid ${C.line}`,
              background: C.bg,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                height: 32,
                padding: '0 18px',
                borderRadius: 999,
                background: C.surface2,
                font: `500 17px ${FONT.text}`,
                color: C.ink2,
              }}
            >
              <span style={{width: 8, height: 8, borderRadius: 9, background: C.brand, boxShadow: `0 0 8px ${C.brand}`}} />
              {url}
            </span>
          </div>
          <div style={{position: 'absolute', top: 54, left: 0, right: 0, bottom: 0, overflow: 'hidden'}}>
            <Img
              src={staticFile(v ? srcTall : src)}
              style={{width: '100%', display: 'block', transform: `translateY(${-scroll * sc}px)`}}
            />
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(105deg, transparent ${lerp(-30, 100, sweep)}%, rgba(255,255,255,0.07) ${lerp(
                -20,
                110,
                sweep,
              )}%, transparent ${lerp(-10, 120, sweep)}%)`,
              pointerEvents: 'none',
            }}
          />
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
