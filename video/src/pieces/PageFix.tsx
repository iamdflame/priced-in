import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, EASE, FONT, SHADOW} from '../brand/tokens';
import {Chip, Stage, lerp, prog, useT, useVertical} from '../components/core';

// The real rewrite tether:9:v3 (signed by z-ai/glm-5.3-flash, signature verified) and correction claim 32.
const AFTER =
  'The majority of Tether’s reserves held in cash and cash equivalents are U.S. T-Bills, which Tether’s attestation report, checked on 5 November 2026, puts at $122.84 billion at 30 September 2026.';

/** S09 · "The page fixes itself": $72.6 billion strikes through and morphs, character by character,
 * into $122.84 billion, then the real corrected sentence appears under it. Film timing: 8 s shot. */
export const PageFix: React.FC<{tempo?: number}> = ({tempo = 1}) => {
  const t = useT() * tempo;
  const v = useVertical();
  const s = v ? 1.2 : 1;
  const strike = prog(t, 0.35, 0.5, EASE.inOut);
  const out = prog(t, 0.95, 0.45, EASE.inOut);
  const pill = prog(t, 1.05, 0.6, EASE.out);
  const sub = prog(t, 1.8, 0.5, EASE.out);
  const full = prog(t, 2.3, 0.7, EASE.out);
  const oldText = '$72.6 billion';
  const newText = '$122.84 billion';
  const big = (v ? 128 : 150) * 1;

  return (
    <Stage glowAt="45% 45%">
      <AbsoluteFill style={{justifyContent: 'center', padding: v ? '0 70px' : '0 180px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 30 * s, opacity: prog(t, 0, 0.4), flexWrap: 'wrap'}}>
          <span style={{font: `600 ${30 * s}px ${FONT.disp}`, color: C.ink, letterSpacing: '-0.015em'}}>Wikipedia’s sentence, corrected</span>
          <span style={{font: `600 ${22 * s}px ${FONT.text}`, color: C.yes, opacity: sub}}>Signature ✓</span>
        </div>
        <div style={{font: `500 ${34 * s}px ${FONT.text}`, color: C.ink2, marginBottom: 14, opacity: prog(t, 0.05, 0.4)}}>Tether’s U.S. T-Bills:</div>
        <div style={{position: 'relative', height: big * 1.15}}>
          {/* before */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              font: `700 ${big}px/1.1 ${FONT.disp}`,
              letterSpacing: '-0.045em',
              color: lerp(1, 0, strike) > 0.5 ? C.ink : C.ink2,
              opacity: 1 - out,
              transform: `translateY(${-out * 60}px)`,
              filter: `blur(${out * 10}px)`,
              whiteSpace: 'nowrap',
            }}
          >
            {oldText}
            <span
              style={{
                position: 'absolute',
                left: -6,
                right: -6,
                top: '52%',
                height: 10,
                borderRadius: 5,
                background: C.no,
                transformOrigin: '0 50%',
                transform: `scaleX(${strike})`,
              }}
            />
          </div>
          {/* after */}
          <div style={{position: 'absolute', left: -24, top: 0, whiteSpace: 'nowrap'}}>
            <span
              style={{
                position: 'absolute',
                inset: '6% 0 -2% 0',
                borderRadius: 22,
                background: C.yesBg,
                transformOrigin: '0 50%',
                transform: `scaleX(${pill})`,
              }}
            />
            <span style={{position: 'relative', display: 'inline-flex', padding: '0 24px', font: `700 ${big}px/1.1 ${FONT.disp}`, letterSpacing: '-0.045em', color: C.ink}}>
              {[...newText].map((ch, i) => {
                const k = prog(t, 1.1 + i * 0.035, 0.5, EASE.spring);
                return (
                  <span
                    key={i}
                    style={{
                      display: 'inline-block',
                      whiteSpace: 'pre',
                      opacity: Math.min(1, k * 1.6),
                      transform: `translateY(${(1 - k) * 70}px)`,
                      filter: `blur(${(1 - Math.min(1, k)) * 6}px)`,
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          </div>
        </div>
        <div style={{display: 'flex', gap: 14, alignItems: 'center', marginTop: 26 * s, opacity: sub, transform: `translateY(${(1 - sub) * 14}px)`, flexWrap: 'wrap'}}>
          <span style={{font: `500 ${30 * s}px ${FONT.text}`, color: C.ink2}}>at 30 September 2026</span>
          <Chip size={1.5 * s}>Source: Tether’s attestation report</Chip>
        </div>
        <div
          style={{
            marginTop: 48 * s,
            maxWidth: 1400,
            padding: `${22 * s}px ${28 * s}px`,
            borderRadius: 20,
            background: SHADOW.panel,
            boxShadow: SHADOW.card,
            opacity: full,
            transform: `translateY(${(1 - full) * 20}px)`,
          }}
        >
          <div style={{font: `500 ${17 * s}px ${FONT.text}`, color: C.ink3, marginBottom: 10}}>After</div>
          <span
            style={{
              font: `400 ${30 * s}px/1.42 ${FONT.quote}`,
              fontVariationSettings: "'opsz' 24",
              color: C.ink,
              background: C.yesBg,
              borderRadius: 4,
              boxDecorationBreak: 'clone',
              WebkitBoxDecorationBreak: 'clone',
              padding: '0 4px',
            }}
          >
            {AFTER}
          </span>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
