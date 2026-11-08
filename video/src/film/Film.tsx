import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {C} from '../brand/tokens';
import {CUTS, Captions, CutContext, FPS, Grade} from './lib';
import {SHOTS} from './shots';
import {Bug, SHOTS5} from './v5';
import {SHOTS6} from './v6';

const ALL = {...SHOTS, ...SHOTS5, ...SHOTS6};
import pending from './pending.json';

// Shots whose site footage waits for the site's final polish: marked on screen until it is recaptured.
const PENDING = new Set<string>(pending as string[]);

/** One cut of the film: shots hard-cut on the music's beat, the mixed audio, captions and the grade. */
export const Film: React.FC<{cut: string; audio?: boolean}> = ({cut, audio = true}) => {
  const c = CUTS[cut];
  const frame = useCurrentFrame();
  const T = frame / FPS;
  return (
    <CutContext.Provider value={c}>
      <AbsoluteFill style={{background: C.bg}}>
        {c.shots.map((s) => {
          const Comp = ALL[s.id];
          const from = Math.round(s.at * FPS);
          const len = Math.round((s.at + s.dur) * FPS) - from;
          return (
            <Sequence key={`${s.id}${s.at}`} from={from} durationInFrames={len} name={s.id} layout="none">
              <AbsoluteFill>
                <Comp shot={s} t={T - s.at} T={T} />
                {PENDING.has(s.id) && !s.id.startsWith('v6') ? (
                  <AbsoluteFill style={{alignItems: 'flex-start', justifyContent: 'flex-start', padding: 28, pointerEvents: 'none'}}>
                    <div style={{border: '4px dashed #C9222B', position: 'absolute', inset: 14, borderRadius: 18}} />
                    <span style={{background: '#C9222B', color: '#fff', font: "700 26px 'General Sans', sans-serif", padding: '8px 16px', borderRadius: 10}}>PLACEHOLDER · awaiting site final ({s.id})</span>
                  </AbsoluteFill>
                ) : null}
              </AbsoluteFill>
            </Sequence>
          );
        })}
        <Grade />
        {c.shots.some((s) => /^v[56]/.test(s.id)) && !c.shots.some((s) => /^v[56]end$/.test(s.id) && T >= s.at) && !c.shots.some((s) => s.id === 'v6market' && T >= s.at && T < s.at + s.dur) ? <Bug /> : null}
        <Captions />
        {audio ? <Audio src={staticFile(`audio/mix-${c.id}.wav`)} /> : null}
      </AbsoluteFill>
    </CutContext.Provider>
  );
};

export const durationOf = (cut: string) => Math.round(CUTS[cut].dur * FPS);
