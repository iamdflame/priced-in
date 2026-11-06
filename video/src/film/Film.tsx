import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {C} from '../brand/tokens';
import {CUTS, Captions, CutContext, FPS, Grade} from './lib';
import {SHOTS} from './shots';

/** One cut of the film: shots hard-cut on the music's beat, the mixed audio, captions and the grade. */
export const Film: React.FC<{cut: string; audio?: boolean}> = ({cut, audio = true}) => {
  const c = CUTS[cut];
  const frame = useCurrentFrame();
  const T = frame / FPS;
  return (
    <CutContext.Provider value={c}>
      <AbsoluteFill style={{background: C.bg}}>
        {c.shots.map((s) => {
          const Comp = SHOTS[s.id];
          const from = Math.round(s.at * FPS);
          const len = Math.round((s.at + s.dur) * FPS) - from;
          return (
            <Sequence key={`${s.id}${s.at}`} from={from} durationInFrames={len} name={s.id} layout="none">
              <AbsoluteFill>
                <Comp shot={s} t={T - s.at} T={T} />
              </AbsoluteFill>
            </Sequence>
          );
        })}
        <Grade />
        <Captions />
        {audio ? <Audio src={staticFile(`audio/mix-${c.id}.wav`)} /> : null}
      </AbsoluteFill>
    </CutContext.Provider>
  );
};

export const durationOf = (cut: string) => Math.round(CUTS[cut].dur * FPS);
