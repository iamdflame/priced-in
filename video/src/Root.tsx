import React from 'react';
import {Composition, Folder} from 'remotion';
import {loadBrandFonts} from './brand/fonts';
import {EndCard, TitleCard} from './pieces/Cards';
import {DeviceFrame} from './pieces/DeviceFrame';
import {DialSwing} from './pieces/DialSwing';
import {HookType} from './pieces/HookType';
import {PageFix} from './pieces/PageFix';
import {VerdictStamp} from './pieces/VerdictStamp';
import {AskIllia} from './pieces/AskIllia';
import {TEST_REEL_FRAMES, TestReel} from './reels/TestReel';
import {ChartSteps, Countdown, Payout, ProofStack} from './pieces/Beats';
import {BOARD} from './storyboard';
import {Film, durationOf} from './film/Film';

loadBrandFonts();

const FPS = 30;
const WIDE = {width: 1920, height: 1080};
const TALL = {width: 1080, height: 1920};

// Each piece at film timing (tempo 1), in both formats. Durations follow SCRIPT.md.
const pieces: {id: string; component: React.FC<any>; seconds: number; props?: Record<string, unknown>}[] = [
  {id: 'TitleCard', component: TitleCard, seconds: 3},
  {id: 'HookType', component: HookType, seconds: 3.2},
  {id: 'DialSwing', component: DialSwing, seconds: 5},
  {id: 'VerdictStamp', component: VerdictStamp, seconds: 13},
  {id: 'PageFix', component: PageFix, seconds: 8},
  {id: 'DeviceSettle', component: DeviceFrame, seconds: 3, props: {move: 'settle'}},
  {id: 'DevicePullback', component: DeviceFrame, seconds: 7, props: {move: 'pullback', dur: 6, src: 'footage/dark-home__desktop__full.png', url: 'isitpriced.com', scroll: 420}},
  {id: 'EndCard', component: EndCard, seconds: 8},
  {id: 'ChartSteps', component: ChartSteps, seconds: 6},
  {id: 'Countdown', component: Countdown, seconds: 5},
  {id: 'Payout', component: Payout, seconds: 6.5},
  {id: 'ProofStack', component: ProofStack, seconds: 5},
];

export const Root: React.FC = () => (
  <>
    <Composition id="TestReel" component={TestReel} durationInFrames={TEST_REEL_FRAMES} fps={FPS} {...WIDE} />
    <Composition id="TestReelVertical" component={TestReel} durationInFrames={TEST_REEL_FRAMES} fps={FPS} {...TALL} />
    <Composition id="AskIllia-1x1" component={AskIllia} defaultProps={{pct: 66}} durationInFrames={300} fps={FPS} width={1080} height={1080} />
    <Folder name="Film">
      <Composition id="FilmMain" component={Film} defaultProps={{cut: 'main'}} durationInFrames={durationOf('main')} fps={FPS} {...WIDE} />
      <Composition id="Film15s" component={Film} defaultProps={{cut: 'c15'}} durationInFrames={durationOf('c15')} fps={FPS} {...WIDE} />
      <Composition id="FilmVertical" component={Film} defaultProps={{cut: 'v30'}} durationInFrames={durationOf('v30')} fps={FPS} {...TALL} />
    </Folder>
    <Folder name="Wide">
      {pieces.map((p) => (
        <Composition key={p.id} id={`${p.id}-16x9`} component={p.component} defaultProps={p.props ?? {}} durationInFrames={Math.round(p.seconds * FPS)} fps={FPS} {...WIDE} />
      ))}
    </Folder>
    <Folder name="Storyboard">
      {BOARD.map((b) => (
        <Composition key={b.id} id={`SB-${b.id}`} component={b.component} defaultProps={b.props ?? {}} durationInFrames={Math.max(b.frame + 1, 60)} fps={FPS} {...WIDE} />
      ))}
    </Folder>
    <Folder name="Vertical">
      {pieces.map((p) => (
        <Composition key={p.id} id={`${p.id}-9x16`} component={p.component} defaultProps={p.props ?? {}} durationInFrames={Math.round(p.seconds * FPS)} fps={FPS} {...TALL} />
      ))}
    </Folder>
  </>
);
