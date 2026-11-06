import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {C, EASE, FONT, SHADOW} from '../brand/tokens';
import {Stage, lerp, prog, useT, useVertical} from '../components/core';

// Real verdicts on challenge 0 (market 18), seconds after the challenge opened, each signature
// checked on-chain by market.isitpriced.near (deployments/rehearsal/mainnet.json .steps[3]).
export const JUDGES = [
  {name: 'DeepSeek V4.1', model: 'deepseek-ai/DeepSeek-V4.1-Flash', at: 7.966, tx: '6HWB2E…a2dz'},
  {name: 'Qwen 3.8', model: 'Qwen/Qwen3.8-27B', at: 9.757, tx: '7MQF5C…67E'},
  {name: 'GLM 5.3', model: 'z-ai/glm-5.3-flash', at: 16.656, tx: '78KBg1…WhR'},
] as const;
const LAST = 16.7;

type Props = {
  tempo?: number;
  /** when the clock starts and how long it takes to show 0 → 16.7 s (film defaults land the stamps
   * on the voice's three "False"s at 5.0, 5.9 and 8.0 s into S07) */
  clockStart?: number;
  clockDur?: number;
};

/** S07 · The verdict stamp: three AI judges, FALSE at their real offsets, signatures checked by NEAR. */
export const VerdictStamp: React.FC<Props> = ({tempo = 1, clockStart = 2.24, clockDur = 5.76}) => {
  const t = useT() * tempo;
  const v = useVertical();
  const s = v ? 1.35 : 1;
  const clock = interpolate(t, [clockStart, clockStart + clockDur], [0, LAST], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const stampTime = (at: number) => clockStart + (at / LAST) * clockDur;
  const allDone = prog(t, stampTime(LAST) + 0.5, 0.6, EASE.out);

  return (
    <Stage glowAt="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: v ? '0 60px' : 0}}>
        <div
          style={{
            width: v ? '100%' : 1320,
            borderRadius: 32,
            background: SHADOW.panel,
            boxShadow: `${SHADOW.card}, ${SHADOW.lift}`,
            padding: `${44 * s}px ${52 * s}px`,
            opacity: prog(t, 0, 0.5),
            transform: `translateY(${(1 - prog(t, 0, 0.6)) * 30}px)`,
          }}
        >
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: v ? 'flex-start' : 'flex-end', flexDirection: v ? 'column' : 'row', gap: 20, marginBottom: 34 * s}}>
            <div>
              <div style={{font: `500 ${20 * s}px ${FONT.text}`, color: C.ink3, marginBottom: 8}}>Is it true? The AI judges decide</div>
              <div style={{font: `700 ${44 * s}px/1.05 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink}}>
                Three AI judges read the evidence
              </div>
            </div>
            <div style={{textAlign: v ? 'left' : 'right'}}>
              <div style={{font: `700 ${72 * s}px/0.9 ${FONT.disp}`, letterSpacing: '-0.04em', color: C.ink, fontFeatureSettings: "'tnum'"}}>
                {clock.toFixed(1)}
                <span style={{fontSize: '0.5em', marginLeft: 6}}>s</span>
              </div>
              <div style={{font: `500 ${17 * s}px ${FONT.text}`, color: C.ink3, marginTop: 6}}>after the challenge</div>
            </div>
          </div>
          {JUDGES.map((j, i) => {
            const st = stampTime(j.at);
            const k = prog(t, st, 0.45, EASE.spring);
            const hit = t >= st;
            const flash = hit ? Math.max(0, 1 - (t - st) / 0.5) : 0;
            const sig = prog(t, st + 0.35, 0.4, EASE.out);
            const rowIn = prog(t, 0.15 + i * 0.12, 0.5, EASE.out);
            return (
              <div
                key={j.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: v ? '1fr auto' : '1fr 300px 220px',
                  alignItems: 'center',
                  gap: 24,
                  padding: `${22 * s}px ${26 * s}px`,
                  marginTop: 12,
                  borderRadius: 20,
                  background: `linear-gradient(90deg, rgba(255,99,103,${0.22 * flash}), transparent), ${C.surface2}`,
                  opacity: rowIn,
                  transform: `translateX(${(1 - rowIn) * -30}px)`,
                }}
              >
                <div>
                  <div style={{font: `600 ${34 * s}px/1.1 ${FONT.disp}`, letterSpacing: '-0.02em', color: C.ink}}>{j.name}</div>
                  <div style={{font: `500 ${17 * s}px ${FONT.text}`, color: C.ink3, marginTop: 4}}>AI judge · {j.model}</div>
                  {v ? (
                    <div style={{font: `600 ${18 * s}px ${FONT.text}`, color: C.yes, marginTop: 8, opacity: sig}}>✓ Signature checked by NEAR · {j.at.toFixed(1)} s</div>
                  ) : null}
                </div>
                {!v ? (
                  <div style={{font: `600 ${19}px ${FONT.text}`, color: C.yes, opacity: sig, transform: `translateY(${(1 - sig) * 8}px)`}}>
                    ✓ Signature checked by NEAR
                    <div style={{font: `500 15px ${FONT.mono}`, color: C.ink3, marginTop: 4}}>{j.tx}</div>
                  </div>
                ) : null}
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, height: 70 * s}}>
                  {!v ? (
                    <span style={{font: `600 ${22}px ${FONT.text}`, color: C.ink2, fontFeatureSettings: "'tnum'", opacity: k, whiteSpace: 'nowrap'}}>{j.at.toFixed(1)} s</span>
                  ) : null}
                  <span
                    style={{
                      display: 'inline-block',
                      font: `700 ${40 * s}px/1 ${FONT.disp}`,
                      letterSpacing: '0.02em',
                      color: C.no,
                      border: `${3.5 * s}px solid ${C.no}`,
                      borderRadius: 12,
                      padding: `${8 * s}px ${16 * s}px ${10 * s}px`,
                      background: C.noBg,
                      opacity: hit ? Math.min(1, (t - st) / 0.08) : 0,
                      transform: `rotate(${lerp(-12, -4, k)}deg) scale(${lerp(2.4, 1, k)})`,
                      boxShadow: flash > 0 ? `0 0 ${40 * flash}px rgba(255,99,103,${0.6 * flash})` : 'none',
                    }}
                  >
                    FALSE
                  </span>
                </div>
              </div>
            );
          })}
          <div
            style={{
              marginTop: 26 * s,
              display: 'flex',
              justifyContent: 'space-between',
              font: `500 ${20 * s}px ${FONT.text}`,
              color: C.ink2,
              opacity: allDone,
            }}
          >
            <span>
              <b style={{color: C.ink, fontWeight: 600}}>All three: false</b>, in under 17 seconds
            </span>
            {!v ? <span style={{color: C.ink3}}>Anyone can object for 10 minutes</span> : null}
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
