import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {C} from '../brand/tokens';
import {EndCard, TitleCard} from '../pieces/Cards';
import {DeviceFrame} from '../pieces/DeviceFrame';
import {DialSwing} from '../pieces/DialSwing';
import {HookType} from '../pieces/HookType';
import {PageFix} from '../pieces/PageFix';
import {VerdictStamp} from '../pieces/VerdictStamp';

/** 10 s at 30 fps: every piece of the motion system once, played faster than film timing
 * (tempo > 1) so the whole system fits. Hard cuts on motion; no dissolves. */
export const TEST_REEL_FRAMES = 300;

export const TestReel: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    <Sequence from={0} durationInFrames={27} name="Title card">
      <TitleCard tempo={1.5} />
    </Sequence>
    <Sequence from={27} durationInFrames={60} name="Hook · kinetic type">
      <HookType tempo={1.5} />
    </Sequence>
    <Sequence from={87} durationInFrames={51} name="Dial · needle swing 23% → 12%">
      <DialSwing tempo={1.8} />
    </Sequence>
    <Sequence from={138} durationInFrames={39} name="Device frame · 3D settle">
      <DeviceFrame tempo={1.9} move="settle" scroll={180} />
    </Sequence>
    <Sequence from={177} durationInFrames={48} name="Verdict stamp">
      <VerdictStamp tempo={1.1} clockStart={0.2} clockDur={1.0} />
    </Sequence>
    <Sequence from={225} durationInFrames={33} name="Page fixes itself">
      <PageFix tempo={2.4} />
    </Sequence>
    <Sequence from={258} durationInFrames={42} name="End card">
      <EndCard tempo={1.4} />
    </Sequence>
  </AbsoluteFill>
);
