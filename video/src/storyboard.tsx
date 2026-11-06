import React from 'react';
import {ChartSteps, Countdown, Payout, ProofStack, SiteCallout} from './pieces/Beats';
import {EndCard} from './pieces/Cards';
import {DeviceFrame} from './pieces/DeviceFrame';
import {DialSwing} from './pieces/DialSwing';
import {HookType} from './pieces/HookType';
import {PageFix} from './pieces/PageFix';
import {VerdictStamp} from './pieces/VerdictStamp';

/** One storyboard frame per shot of the main film (SCRIPT.md, cut a). `frame` is the still to render. */
export const BOARD: {id: string; component: React.FC<any>; props?: Record<string, unknown>; frame: number}[] = [
  {id: 'S01', component: HookType, frame: 92},
  {id: 'S02', component: SiteCallout, frame: 30, props: {src: 'footage/dark-replay-c18__desktop.png', url: 'isitpriced.com/c/18', tilt: 6}},
  {id: 'S03', component: DialSwing, frame: 105},
  {id: 'S04', component: ChartSteps, frame: 150},
  {
    id: 'S05',
    component: SiteCallout,
    frame: 30,
    props: {
      src: 'footage/dark-c18__desktop__full.png',
      url: 'isitpriced.com/c/18',
      top: 1480,
      box: {x: 30, y: 1730, w: 970, h: 170},
      callout: {
        chip: 'The Skeptic · AI trader · 20% chance it’s true',
        title: 'This one is out of date.',
        body: '“…the $72.6 billion figure appears only as an undated encyclopedia line”',
        at: 'right',
      },
    },
  },
  {
    id: 'S06',
    component: SiteCallout,
    frame: 30,
    props: {
      src: 'footage/dark-c18__desktop__full.png',
      url: 'isitpriced.com/c/18',
      top: 600,
      box: {x: 40, y: 718, w: 970, h: 70},
      callout: {chip: 'Challenged', tone: 'no', title: 'Our checking bot staked $1 that it’s wrong', body: 'Evidence: Tether’s report, 30 September 2026', at: 'right'},
    },
  },
  {id: 'S07', component: VerdictStamp, frame: 280},
  {id: 'S08', component: Countdown, frame: 125},
  {id: 'S09', component: PageFix, frame: 200},
  {id: 'S10', component: Payout, frame: 75},
  {
    id: 'S11',
    component: SiteCallout,
    frame: 30,
    props: {
      src: 'footage/dark-home__desktop.png',
      url: 'isitpriced.com',
      callout: {chip: 'Corrected and reopened · opened at 50%', tone: 'yes', title: 'Are most of Tether’s cash reserves U.S. T-Bills, at $122.84 billion on 30 Sep 2026?', at: 'bottom'},
    },
  },
  {id: 'S12', component: DeviceFrame, frame: 150, props: {move: 'pullback', dur: 6, src: 'footage/dark-home__desktop__full.png', url: 'isitpriced.com', scroll: 420}},
  {id: 'S13', component: ProofStack, frame: 110},
  {id: 'S14', component: EndCard, frame: 120},
];
