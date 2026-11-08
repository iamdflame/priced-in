import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {C, EASE, FONT, SHADOW} from '../brand/tokens';
import {Chip, Lockup, PrimaryButton} from '../components/core';
import {PageFix} from '../pieces/PageFix';
import live from './live.json';
import boxes from './boxes.json';
import {
  Browser3D,
  FLOW_TAP,
  Ground,
  Phone3D,
  Plate,
  Shot,
  Spoken,
  Word,
  WordIn,
  clamp01,
  ease,
  flowFrame,
  mix,
  useCut,
  useTall,
  wordStart,
  wordsIn,
} from './lib';

type P = {shot: Shot; t: number; T: number}; // t: seconds into the shot; T: film time

const big = (size: number, color: string = C.ink): React.CSSProperties => ({font: `700 ${size}px/1 ${FONT.disp}`, letterSpacing: '-0.04em', color});

// The record, from deployments/rehearsal/mainnet.json and the event log.
const LEDGER = [
  {at: 0.9, p: 25, who: 'A person, free $1', yes: false},
  {at: 1.5, p: 28, who: 'The Quant, AI trader', yes: true},
  {at: 2.1, p: 18, who: 'The Archivist, AI trader', yes: false},
  {at: 2.7, p: 14, who: 'A person, free $1', yes: false},
  {at: 3.3, p: 23, who: 'The Quant, AI trader', yes: true},
  {at: 3.9, p: 12, who: 'A person, free $1', yes: false},
  {at: 4.5, p: 10, who: 'The Archivist, AI trader', yes: false},
];
// the moments the three stamps land on the plate (HITS in blender/dial_film.py)
const HIT = [0.6, 1.6, 3.7];
const JUDGES = [
  {name: 'DeepSeek V4.1', tx: '6HWB2E…a2dz', at: '8.0 s'},
  {name: 'Qwen 3.8', tx: '7MQF5C…67E', at: '9.8 s'},
  {name: 'GLM 5.3', tx: '78KBg1…WhR', at: '16.7 s'},
];
const NAMES = JUDGES;
// the home's facts grid (Trending) and where the encyclopedia's facts begin, measured by the capture
const FEED_Y = Math.max(0, ((boxes as Record<string, {y: number}>).trending?.y ?? 3000) - 120);
const FACTS_Y = Math.max(0, ((boxes as Record<string, {y: number}>).facts?.y ?? 2280) - 160);
const PROOF = [
  ['The free $1 on No', 'FGFhi1…BBvc6'],
  ['The challenge, $1 staked', '5C2kye…SnxaQ'],
  ['DeepSeek V4.1: false', '6HWB2E…a2dz'],
  ['Qwen 3.8: false', '7MQF5C…67E'],
  ['GLM 5.3: false', '78KBg1…WhR'],
  ['Settled, $4.93 paid', '3KbCTq…8K1v'],
  ['The corrected sentence opens', '8dZz4D…8eyW'],
];

// ----- the hook ------------------------------------------------------------------------------------------
const Hook: React.FC<P> = ({t, T}) => {
  const tall = useTall();
  const cut = useCut();
  const fifty = wordStart(cut, 'L01', 'fifty', 1.5);
  const out = wordStart(cut, 'L01', 'out', 2.9);
  const push = 1 + 0.035 * clamp01(t / 3.75);
  const mark = ease(T, 0.62, 0.45, EASE.inOut);
  const rep = ease(T, 1.0, 0.4);
  const slam = ease(T, fifty - 0.05, 0.32, EASE.spring);
  const quote = {font: `400 ${tall ? 74 : 92}px/1.12 ${FONT.quote}`, fontVariationSettings: "'opsz' 72", color: C.ink, letterSpacing: '-0.01em'} as React.CSSProperties;
  return (
    <Ground glow="35% 40%">
      <AbsoluteFill style={{transform: `scale(${push})`, transformOrigin: '30% 40%', padding: tall ? '230px 76px 0' : '96px 130px 0'}}>
        <div style={{font: `500 ${tall ? 30 : 24}px ${FONT.text}`, color: C.ink3, marginBottom: 20, opacity: ease(T, 0, 0.3)}}>
          Wikipedia · Tether article · T-Bills: U.S. government debt
        </div>
        <div style={quote}>
          {['“…are', 'U.S.', 'T-Bills,', 'accounting', 'for'].map((w, i) => (
            <React.Fragment key={w}>
              <WordIn t={T} at={0.02 + i * 0.05}>
                {w}
              </WordIn>{' '}
            </React.Fragment>
          ))}
          <WordIn t={T} at={0.3}>
            <span style={{position: 'relative', display: 'inline-block', color: mark > 0.4 ? C.warn : C.ink}}>
              <span style={{position: 'absolute', left: -8, right: -8, top: '12%', bottom: '2%', borderRadius: 10, background: C.warnBg, transformOrigin: '0 50%', transform: `scaleX(${mark})`}} />
              <span style={{position: 'relative'}}>$72.6&nbsp;billion</span>
            </span>
            .”
          </WordIn>
        </div>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 22, opacity: rep, transform: `translateY(${(1 - rep) * 16}px)`, flexWrap: 'wrap'}}>
          <span style={{font: `500 ${tall ? 38 : 36}px ${FONT.text}`, color: C.ink2}}>Tether’s own report:</span>
          <span style={{font: `700 ${tall ? 54 : 52}px/1.1 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink}}>$122.84&nbsp;billion</span>
        </div>
        <div style={{...big(tall ? 186 : 236), marginTop: tall ? 110 : 52, transformOrigin: '0 100%', transform: `scale(${mix(1.1, 1, slam)})`, opacity: T >= fifty - 0.05 ? 1 : 0}}>$50&nbsp;billion</div>
        <div style={{...big(tall ? 120 : 132, C.ink2), marginTop: 12}}>
          {['out', 'of', 'date.'].map((w, i) => (
            <React.Fragment key={w}>
              <WordIn t={T} at={out + i * 0.08}>
                {w}
              </WordIn>{' '}
            </React.Fragment>
          ))}
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- the dial wakes ------------------------------------------------------------------------------------
const Wake: React.FC<P> = ({t, T}) => {
  const cut = useCut();
  const c = cut.cues.find((q) => q.id === 'L02');
  const w = c ? c.words : [];
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="wake" local={t} />
      <AbsoluteFill style={{padding: '84px 120px'}}>
        <Spoken t={T} words={w.slice(0, 5)} size={62} color={C.ink2} paint={false} />
        <div style={{height: 14}} />
        <Spoken t={T} words={w.slice(5)} size={196} paint={false} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- the tap, on the real site ---------------------------------------------------------------------------
const Tap: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const tall = useTall();
  const tap = shot.tap ?? shot.at + 1;
  const ft = FLOW_TAP + (T - tap);
  const src = flowFrame('p', Math.max(0.02, ft));
  const k = ease(t, 0, 1.4, EASE.out);
  const words: Word[] = wordsIn(cut, shot.at - 0.15, tap + 0.3).filter((w) => !/^(the|near)$/i.test(w.w));
  const ripple = T >= tap ? clamp01((T - tap) / 0.5) : 0;
  const chip = shot.chip ? ease(T, shot.chip, 0.4, EASE.spring) : 0;
  const pose = tall ? {ry: mix(-16, -6, k), rx: mix(10, 3, k), rz: 1.5, s: mix(0.94, 1.02, k)} : {ry: mix(-30, -17, k), rx: mix(14, 6, k), rz: mix(5, 2.5, k), s: mix(0.92, 1.0, k)};
  return (
    <Ground glow={tall ? '50% 60%' : '68% 50%'}>
      <AbsoluteFill style={{flexDirection: tall ? 'column' : 'row', alignItems: 'center', justifyContent: tall ? 'flex-start' : 'space-between', padding: tall ? '110px 70px 0' : '0 150px 40px 130px', gap: tall ? 30 : 40}}>
        <div style={{flex: tall ? 'none' : 1, alignSelf: tall ? 'flex-start' : 'center'}}>
          <Spoken t={T} words={words} size={tall ? 78 : 118} />
          <div style={{marginTop: 34, opacity: ease(t, 0.3, 0.4)}}>
            <Chip size={tall ? 1.7 : 1.7}>Your first $1 is free · no sign-up, no wallet</Chip>
          </div>
          {shot.chip ? (
            <div style={{marginTop: 22, opacity: chip, transform: `scale(${mix(0.9, 1, chip)})`, transformOrigin: '0 50%'}}>
              <Chip tone="yes" size={2.1}>
                ✓ Recorded on NEAR · 4.5 s
              </Chip>
            </div>
          ) : null}
        </div>
        <div style={{flex: 'none'}}>
          <Phone3D src={src} width={tall ? 450 : 400} pose={pose} sheen={clamp01(t / 1.6)}>
            {ripple > 0 && ripple < 1 ? (
              <div style={{position: 'absolute', left: '74%', top: '86%', width: 70, height: 70, margin: '-35px 0 0 -35px', borderRadius: '50%', background: 'rgba(17,22,30,0.16)', opacity: 1 - ripple, transform: `scale(${1 + ripple * 3})`}} />
            ) : null}
          </Phone3D>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- the free dollar lands: macro on the needle ---------------------------------------------------------
const Swing: React.FC<P> = ({t}) => {
  const tall = useTall();
  const k = ease(t, 0.78, 0.45, EASE.spring);
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="swing" local={t} />
      <AbsoluteFill style={{justifyContent: tall ? 'flex-end' : 'flex-end', alignItems: 'flex-start', padding: tall ? '0 70px 560px' : '0 110px 130px'}}>
        <div style={{opacity: k, transform: `translateY(${(1 - k) * 22}px) scale(${mix(0.93, 1, k)})`, transformOrigin: '0 100%', padding: tall ? '26px 30px' : '22px 30px', borderRadius: 24, background: 'rgba(255,255,255,0.9)', boxShadow: `0 0 0 1px ${C.line}, ${SHADOW.lift}`}}>
          <div style={{font: `600 ${tall ? 54 : 50}px ${FONT.disp}`, letterSpacing: '-0.025em', color: C.yes}}>✓ Recorded on NEAR · 4.5 s</div>
          <div style={{display: 'flex', gap: 22, marginTop: 10, alignItems: 'baseline'}}>
            <span style={{font: `500 ${tall ? 30 : 26}px ${FONT.mono}`, color: C.ink2}}>FGFhi1…BBvc6</span>
            <span style={{font: `500 ${tall ? 28 : 24}px ${FONT.text}`, color: C.ink3}}>NEAR: a public blockchain</span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- the receipt on the phone ---------------------------------------------------------------------------
const Receipt: React.FC<P> = ({t, T}) => {
  const cut = useCut();
  const four = wordStart(cut, 'L03', 'four', 11.6);
  const k = ease(t, 0, 2.2, EASE.out);
  const inPublic = wordsIn(cut, 10.5, 11.3);
  const b = ease(T, four - 0.05, 0.35, EASE.spring);
  return (
    <Ground glow="30% 50%">
      <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '0 130px 30px 170px'}}>
        <Phone3D src="site/receipt-p.png" width={400} pose={{ry: mix(32, 18, k), rx: mix(10, 5, k), rz: mix(-5, -2.5, k), s: mix(0.92, 1.0, k)}} sheen={clamp01(t / 2)} />
        <div style={{width: 960}}>
          <Spoken t={T} words={inPublic} size={92} color={C.ink2} paint={false} />
          <div style={{...big(236), marginTop: 18, transformOrigin: '0 100%', transform: `scale(${mix(1.08, 1, b)})`, opacity: T >= four - 0.05 ? 1 : 0}}>
            4.5<span style={{fontSize: '0.45em', marginLeft: 18}}>seconds</span>
          </div>
          <div style={{font: `500 30px ${FONT.mono}`, color: C.ink3, marginTop: 28, opacity: ease(t, 0.4, 0.4)}}>tx FGFhi1W9mLtCvQ44SzDvpbKVCCPi…BBvc6</div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- every line priced ----------------------------------------------------------------------------------
const Feed: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const k = ease(t, 0, shot.dur, EASE.inOut);
  const words = wordsIn(cut, shot.at - 0.1, shot.at + shot.dur).slice(0, 7);
  return (
    <Ground glow="60% 40%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{transform: 'translate(470px, 70px)'}}>
          <Browser3D src="site/home-d__full.png" url="isitpriced.com" width={1500} height={930} top={mix(FEED_Y, FEED_Y + 380, k)} pose={{rx: mix(20, 16, k), ry: mix(-26, -20, k), rz: 5, z: mix(-120, -30, k)}} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(248,249,251,0.98) 0%, rgba(248,249,251,0.9) 40%, transparent 66%)'}} />
      <AbsoluteFill style={{justifyContent: 'center', padding: '0 0 40px 130px'}}>
        <div style={{width: 800}}>
          <Spoken t={T} words={words} size={104} paint={false} />
          <div style={{font: `500 30px ${FONT.text}`, color: C.ink3, marginTop: 30, opacity: ease(t, 0.5, 0.4)}}>AI traders: bots that bet their own money</div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- seven bets ------------------------------------------------------------------------------------------
const Steps: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const cut = useCut();
  // the plate starts 0.5 s in, so the seven steps fall on "Seven bets took this one from fifty percent to ten"
  const skip = tall ? 0.15 : 0.5;
  const rate = tall ? 4.8 / shot.dur : 1;
  const local = skip + t * rate;
  const title = ease(t, 0, 0.5);
  const done = LEDGER.filter((l) => local >= l.at);
  const last = done[done.length - 1];
  const tail = wordsIn(cut, shot.at - 0.1, shot.at + shot.dur);
  void tail;
  void T;
  if (tall) {
    return (
      <AbsoluteFill style={{background: C.bg}}>
        <Plate shot="steps" local={local} />
        <AbsoluteFill style={{padding: '170px 76px 0'}}>
          <div style={{...big(120), opacity: title}}>7 bets</div>
          <div style={{...big(82, C.ink2), marginTop: 12, opacity: title}}>50% → 10%</div>
          <div style={{font: `500 34px ${FONT.text}`, color: C.ink3, marginTop: 12, opacity: title}}>chance it’s true</div>
        </AbsoluteFill>
        {last ? (
          <AbsoluteFill style={{justifyContent: 'flex-end', padding: '0 76px 500px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
              <Chip tone={last.yes ? 'yes' : 'no'} size={2.2}>
                {last.yes ? 'Yes, it’s true' : 'No, it’s false'}
              </Chip>
              <span style={{font: `500 36px ${FONT.text}`, color: C.ink2}}>{last.who}</span>
            </div>
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="steps" local={local} style={{transform: 'scale(1.07)', transformOrigin: '100% 50%'}} />
      <AbsoluteFill style={{left: 1215, width: 620, justifyContent: 'center', paddingBottom: 30}}>
        <div style={{opacity: title, transform: `translateY(${(1 - title) * 18}px)`}}>
          <div style={{...big(108)}}>7 bets</div>
          <div style={{...big(70, C.ink2), marginTop: 10}}>50% → 10%</div>
          <div style={{font: `500 26px ${FONT.text}`, color: C.ink3, marginTop: 8, marginBottom: 26}}>chance it’s true</div>
        </div>
        {LEDGER.map((l) => {
          const k = ease(local, l.at, 0.3, EASE.spring);
          return (
            <div key={l.at} style={{display: 'grid', gridTemplateColumns: '128px 1fr 80px', alignItems: 'center', height: 54, borderTop: `1px solid ${C.line}`, opacity: k, transform: `translateX(${(1 - k) * 24}px)`, visibility: k > 0 ? 'visible' : 'hidden'}}>
              <span style={{font: `600 22px ${FONT.text}`, color: l.yes ? C.yes : C.no}}>{l.yes ? 'Yes, true' : 'No, false'}</span>
              <span style={{font: `500 24px ${FONT.text}`, color: C.ink2}}>{l.who}</span>
              <span style={{font: `700 30px ${FONT.disp}`, letterSpacing: '-0.02em', color: C.ink, textAlign: 'right', fontFeatureSettings: "'tnum'"}}>{l.p}%</span>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- the AI traders explain --------------------------------------------------------------------------------
const Traders: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const k = ease(t, 0, shot.dur, EASE.inOut);
  const lift = ease(t, 0.5, 0.8, EASE.out);
  const b = boxes.skeptic;
  // the recorded run's receipt: the Skeptic's reply sits on the right of the page, so the words go on the left
  return (
    <Ground glow="62% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{transform: 'translate(300px, 40px)'}}>
          <Browser3D src={b.src} url="isitpriced.com/c/18" width={1400} height={880} top={Math.max(0, mix(b.y - 420, b.y - 380, k))} pose={{rx: mix(12, 7, k), ry: mix(-22, -16, k), rz: 1.5}} lifts={[{...b, z: lift * 260, ring: true}]} dim={0.16 * lift} dof={3} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(248,249,251,0.97) 0%, rgba(248,249,251,0.8) 28%, transparent 46%)'}} />
      <AbsoluteFill style={{justifyContent: 'center', padding: '0 0 40px 130px'}}>
        <div style={{width: 640}}>
          <Spoken t={T} words={wordsIn(cut, shot.at - 0.1, shot.at + shot.dur)} size={92} paint={false} />
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

const Who: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const words = wordsIn(cut, shot.at - 0.1, shot.at + shot.dur + 0.3).slice(0, 3);
  return (
    <Ground glow="50% 50%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 120px 40px', transform: `scale(${1 + 0.03 * clamp01(t / shot.dur)})`}}>
        <Spoken t={T} words={words} size={216} paint={false} maxWidth={1500} />
      </AbsoluteFill>
    </Ground>
  );
};

const Challenge: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const k = ease(t, 0, shot.dur, EASE.inOut);
  const lift = ease(t, 0.5, 0.7, EASE.out);
  const all = cut.cues.find((q) => q.id === 'L06')?.words ?? [];
  const words = all.slice(all.findIndex((w) => /^Our/.test(w.w)));
  return (
    <Ground glow="62% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{transform: 'translate(-300px, 50px)'}}>
          <Browser3D src="site/c18-d__full.png" url="isitpriced.com/c/18" width={1400} height={880} top={mix(boxes.challenge.y - 285, boxes.challenge.y - 225, k)} pose={{rx: mix(12, 7, k), ry: mix(22, 16, k), rz: 1.5}} lifts={[{...boxes.challenge, z: lift * 260, ring: true}]} dim={0.16 * lift} dof={3} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'linear-gradient(270deg, rgba(248,249,251,0.97) 0%, rgba(248,249,251,0.8) 28%, transparent 46%)'}} />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'flex-end', padding: '0 100px 40px 0'}}>
        <div style={{width: 660}}>
          <Spoken t={T} words={words} size={76} paint />
          <div style={{marginTop: 30, opacity: ease(t, 2.2, 0.4)}}>
            <Chip tone="no" size={1.9}>
              Challenged · $1 staked
            </Chip>
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- the judges read: the room empties before the verdict ---------------------------------------------------
const Judges: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const cut = useCut();
  const words = wordsIn(cut, shot.at - 0.1, shot.at + shot.dur);
  const head = words.slice(0, 3);
  const rest = words.slice(3);
  const scan = ease(t, shot.dur * 0.48, shot.dur * 0.36, EASE.inOut);
  const fade = 1 - ease(t, shot.dur - 0.55, 0.45, EASE.inOut);
  return (
    <AbsoluteFill style={{background: '#FFFFFF'}}>
      <AbsoluteFill style={{opacity: fade, justifyContent: 'center', padding: tall ? '0 76px 300px' : '0 150px 30px'}}>
        <Spoken t={T} words={head} size={tall ? 124 : 176} paint={false} />
        <div style={{height: 26}} />
        <Spoken t={T} words={rest} size={tall ? 56 : 58} weight={600} color={C.ink2} paint={false} maxWidth={tall ? 920 : 1300} />
        <div style={{marginTop: tall ? 60 : 56, font: `500 ${tall ? 30 : 32}px ${FONT.mono}`, color: C.ink3, position: 'relative', whiteSpace: tall ? 'normal' : 'nowrap', opacity: ease(t, shot.dur * 0.4, 0.5)}}>
          <span>U.S. Treasury Bills 122,839,738,995</span>
          <span style={{position: 'absolute', left: 0, top: 0, overflow: 'hidden', width: `${scan * 100}%`, color: C.ink, whiteSpace: 'nowrap'}}>U.S. Treasury Bills 122,839,738,995</span>
          <div style={{font: `500 ${tall ? 26 : 22}px ${FONT.text}`, color: C.ink3, marginTop: 8}}>The evidence: Tether’s own report, 30 September 2026</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- FALSE. FALSE. FALSE. ---------------------------------------------------------------------------------
const Stamps: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const cut = useCut();
  const rate = shot.rate ?? 1;
  const local = t * rate;
  const inK = ease(t, 0, 0.18);
  // in the short cuts the signature detail lands on the stamps themselves
  const c4 = cut.cues.find((q) => q.id === 'C4');
  const sig = c4 ? ease(T, c4.at + 0.15, 0.35, EASE.spring) : 0;
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <AbsoluteFill style={{opacity: inK, transform: c4 ? `scale(${tall ? 0.9 : 0.84})` : undefined, transformOrigin: '50% 8%'}}>
        <Plate shot="stamps" local={local} />
        {NAMES.map((j, i) => {
          const y = (tall ? [617, 958, 1330] : [242, 541, 845])[i];
          const hit = local >= HIT[i];
          return (
            <div key={j.name} style={{position: 'absolute', left: tall ? 60 : 150, top: y - (tall ? 52 : 80)}}>
              <div style={{...big(tall ? 50 : 92), letterSpacing: '-0.03em', whiteSpace: 'nowrap'}}>{j.name}</div>
              <div style={{font: `500 ${tall ? 36 : 48}px ${FONT.text}`, color: C.ink3, marginTop: 10, opacity: hit ? 1 : 0, fontFeatureSettings: "'tnum'"}}>{j.at}</div>
            </div>
          );
        })}
      </AbsoluteFill>
      {c4 ? (
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', paddingBottom: tall ? 470 : 112}}>
          <div style={{opacity: clamp01(sig), transform: `scale(${mix(0.92, 1, sig)})`, padding: '16px 30px', borderRadius: 999, background: 'rgba(255,255,255,0.92)', boxShadow: `0 0 0 1px ${C.line}, ${SHADOW.lift}`, font: `600 ${tall ? 52 : 46}px ${FONT.disp}`, letterSpacing: '-0.02em', color: C.yes}}>✓ Signature checked by NEAR</div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

// ----- signatures: a small, exact, satisfying detail ---------------------------------------------------------
const Signed: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const cut = useCut();
  const seven = wordStart(cut, 'L07e', 'under', shot.at + 0.8);
  const check = wordStart(cut, 'L07e', 'checked', shot.at + 3);
  const k = ease(T, seven, 0.4, EASE.spring);
  void t;
  void tall;
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="stamps" local={5.59} style={{filter: 'blur(26px)', opacity: 0.16, transform: 'scale(1.08)'}} />
      <AbsoluteFill style={{justifyContent: 'center', padding: '0 150px 30px'}}>
        <div style={{...big(84, C.ink2)}}>
          <WordIn t={T} at={shot.at - 0.05}>
            All three
          </WordIn>
        </div>
        <div style={{...big(186), marginTop: 8, opacity: T >= seven ? 1 : 0, transformOrigin: '0 100%', transform: `scale(${mix(1.06, 1, k)})`}}>under 17 seconds</div>
        <div style={{marginTop: 54, display: 'flex', flexDirection: 'column', gap: 8, width: 1560}}>
          {JUDGES.map((j, i) => {
            const c = ease(T, check + i * 0.3, 0.32, EASE.spring);
            return (
              <div key={j.name} style={{display: 'grid', gridTemplateColumns: '360px 300px 1fr', alignItems: 'center', height: 84, borderTop: `1px solid ${C.line}`, opacity: T >= check - 0.6 ? 1 : 0}}>
                <span style={{font: `600 42px ${FONT.disp}`, color: C.ink}}>{j.name}</span>
                <span style={{font: `500 30px ${FONT.mono}`, color: C.ink3}}>{j.tx}</span>
                <span style={{font: `600 42px ${FONT.disp}`, color: C.yes, opacity: c, transform: `translateX(${(1 - c) * 16}px) scale(${mix(0.94, 1, c)})`, transformOrigin: '0 50%'}}>✓ Signature checked by NEAR</span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- ten minutes, then nobody --------------------------------------------------------------------------------
const Window: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const nobody = wordStart(cut, 'L08', 'Nobody', shot.at + 3);
  const k = ease(T, shot.at + 0.25, nobody - shot.at - 0.45, EASE.inOut);
  const secs = Math.round(600 * (1 - k));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const R = 300;
  const L = 2 * Math.PI * R;
  void t;
  return (
    <Ground glow="30% 50%">
      <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', padding: '0 0 30px 170px', gap: 120}}>
        <div style={{position: 'relative', width: 2 * R + 40, height: 2 * R + 40, flex: 'none'}}>
          <svg width={2 * R + 40} height={2 * R + 40} style={{transform: 'rotate(-90deg)'}}>
            <circle cx={R + 20} cy={R + 20} r={R} fill="none" stroke={C.surface3} strokeWidth={12} />
            <circle cx={R + 20} cy={R + 20} r={R} fill="none" stroke={C.ink} strokeWidth={12} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * k} />
          </svg>
          <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...big(146)}}>
            <span style={{fontFeatureSettings: "'tnum'"}}>
              {mm}:{ss}
            </span>
          </div>
        </div>
        <div>
          <div style={{font: `600 54px/1.15 ${FONT.disp}`, letterSpacing: '-0.025em', color: C.ink2, width: 700}}>Anyone can object for 10 minutes.</div>
          <div style={{...big(150), marginTop: 30}}>
            <WordIn t={T} at={nobody - 0.04}>
              Nobody
            </WordIn>{' '}
            <WordIn t={T} at={nobody + 0.22}>
              did.
            </WordIn>
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- the money ---------------------------------------------------------------------------------------------
const Payout: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const cut = useCut();
  const fast = !!shot.fast;
  const start = fast ? shot.at + 0.15 : wordStart(cut, 'L10', 'Four', shot.at + 1.5);
  const k = ease(T, start, fast ? 0.7 : 1.45, EASE.cubicOut);
  const sub = ease(T, start + (fast ? 0.3 : 1.2), 0.4);
  const value = (4.93 * k).toFixed(2);
  const lift = ease(t, 0.05, 1.2);
  const wrong = fast ? [] : wordsIn(cut, shot.at - 0.1, start - 0.3);
  return (
    <Ground glow="30% 45%">
      <AbsoluteFill style={{justifyContent: 'center', padding: tall ? '0 76px 340px' : '0 0 40px 130px'}}>
        {wrong.length ? (
          <div style={{marginBottom: 16}}>
            <Spoken t={T} words={wrong} size={84} color={C.ink2} paint />
          </div>
        ) : null}
        <div style={{...big(tall ? 300 : 340), fontFeatureSettings: "'tnum'", opacity: T >= start - 0.05 ? 1 : 0}}>${value}</div>
        <div style={{font: `600 ${tall ? 62 : 66}px/1.1 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink, marginTop: 18, opacity: sub, transform: `translateY(${(1 - sub) * 16}px)`}}>Paid to everyone who bet No</div>
        <div style={{display: 'flex', gap: 18, alignItems: 'baseline', marginTop: 18, opacity: sub}}>
          <span style={{font: `500 ${tall ? 32 : 28}px ${FONT.text}`, color: C.ink3}}>Settled on NEAR</span>
          <span style={{font: `500 ${tall ? 30 : 26}px ${FONT.mono}`, color: C.ink3}}>3KbCTq…8K1v</span>
        </div>
      </AbsoluteFill>
      {!tall ? (
        <AbsoluteFill style={{alignItems: 'flex-end', justifyContent: 'center', padding: '0 110px 60px 0', perspective: 1800}}>
          <div style={{width: 620, height: Math.round((620 * boxes.noWon.h) / boxes.noWon.w), borderRadius: 26, overflow: 'hidden', position: 'relative', transform: `rotateY(${mix(-32, -20, lift)}deg) rotateX(${mix(9, 5, lift)}deg)`, boxShadow: `0 70px 120px -44px rgba(40,52,66,0.42), 0 0 0 1px ${C.line}`}}>
            <Img src={staticFile(boxes.noWon.src)} style={{position: 'absolute', width: 2880 * (620 / boxes.noWon.w), left: -boxes.noWon.x * (620 / boxes.noWon.w), top: -boxes.noWon.y * (620 / boxes.noWon.w)}} />
          </div>
        </AbsoluteFill>
      ) : null}
    </Ground>
  );
};

const Reopen: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const k = ease(t, 0, shot.dur, EASE.inOut);
  return (
    <Ground glow="62% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{transform: 'translate(460px, 20px)'}}>
          <Browser3D src="site/c32-d.png" url="isitpriced.com/c/32" width={1400} height={876} top={0} pose={{rx: mix(12, 6, k), ry: mix(-26, -19, k), rz: 2, z: mix(-160, -20, k)}} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(248,249,251,0.98) 0%, rgba(248,249,251,0.86) 36%, transparent 54%)'}} />
      <AbsoluteFill style={{justifyContent: 'center', padding: '0 0 40px 130px'}}>
        <div style={{width: 720}}>
          <Spoken t={T} words={wordsIn(cut, shot.at - 0.1, shot.at + shot.dur)} size={96} paint={false} />
          <div style={{marginTop: 30, opacity: ease(t, 1.2, 0.4)}}>
            <Chip size={1.9}>Opened at 50%</Chip>
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

const Pullback: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const k = ease(t, 0, shot.dur, EASE.inOut);
  const words = wordsIn(cut, shot.at - 0.1, shot.at + shot.dur);
  const split = words.findIndex((w) => /^(Six|Seven)/i.test(w.w));
  const six = split >= 0 ? words[split].s : shot.at + 3;
  const b = ease(T, six - 0.05, 0.35, EASE.spring);
  return (
    <Ground glow="50% 60%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{transform: `translate(${mix(0, 60, k)}px, ${mix(260, 200, k)}px)`}}>
          <Browser3D src="site/home-d__full.png" url="isitpriced.com" width={1560} height={940} top={mix(0, FACTS_Y, ease(t, 0.6, shot.dur - 0.6, EASE.inOut))} pose={{rx: mix(14, 38, k), ry: mix(-4, -16, k), rz: mix(1, 8, k), z: mix(80, -620, k)}} dof={3} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(248,249,251,0.97) 0%, rgba(248,249,251,0.86) 22%, transparent 36%)'}} />
      <AbsoluteFill style={{padding: '84px 130px'}}>
        <Spoken t={T} words={split >= 0 ? words.slice(0, split) : words} size={92} paint={false} maxWidth={1400} />
        <div style={{marginTop: 28, display: 'flex', alignItems: 'baseline', gap: 24, opacity: T >= six - 0.05 ? 1 : 0, transformOrigin: '0 100%', transform: `scale(${mix(1.05, 1, b)})`}}>
          <span style={{...big(84, C.ink2)}}>{live.rulings} rulings settled on NEAR</span>
        </div>
        <div style={{font: `500 30px ${FONT.text}`, color: C.ink3, marginTop: 14, opacity: ease(T, six + 0.5, 0.4)}}>Every step a public transaction</div>
      </AbsoluteFill>
    </Ground>
  );
};

const Proof: React.FC<P> = ({t}) => (
  <Ground glow="66% 45%">
    <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '0 130px 30px 130px'}}>
      <div style={{...big(128), width: 660, lineHeight: 1.02, opacity: ease(t, 0, 0.4)}}>Check every step yourself.</div>
      <div style={{width: 960, perspective: 1600}}>
        <div style={{transform: `rotateY(${mix(-24, -16, clamp01(t / 3.75))}deg) rotateX(6deg)`, display: 'flex', flexDirection: 'column', gap: 10}}>
          {PROOF.map(([label, hash], i) => {
            const k = ease(t, 0.2 + i * 0.16, 0.4, EASE.spring);
            return (
              <div key={hash} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', borderRadius: 16, background: SHADOW.panel, boxShadow: `${SHADOW.card}, 0 0 0 1px ${C.line}`, opacity: clamp01(k), transform: `translateY(${(1 - k) * 28}px)`}}>
                <span style={{font: `500 28px ${FONT.text}`, color: C.ink2}}>{label}</span>
                <span style={{font: `500 28px ${FONT.mono}`, color: C.ink}}>{hash}</span>
              </div>
            );
          })}
        </div>
        <div style={{font: `500 24px ${FONT.text}`, color: C.ink3, marginTop: 24, opacity: ease(t, 1.5, 0.4)}}>On nearblocks.io · market.isitpriced.near</div>
      </div>
    </AbsoluteFill>
  </Ground>
);

const End: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const fast = !!shot.fast;
  const a = fast ? 0.15 : 0.9;
  const lock = ease(t, a, 0.5);
  const q = ease(t, a + 0.2, 0.5);
  const free = ease(t, fast ? 0.6 : 3.0, 0.45);
  const url = ease(t, fast ? 1.0 : 3.9, 0.5, EASE.spring);
  void T;
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="end" local={t} />
      <AbsoluteFill style={tall ? {alignItems: 'center', justifyContent: 'flex-end', padding: '0 60px 470px', textAlign: 'center'} : {left: 1080, width: 800, justifyContent: 'center', paddingBottom: 30}}>
        <div style={{opacity: lock, transform: `translateY(${(1 - lock) * 14}px)`, marginBottom: 34}}>
          <Lockup height={tall ? 92 : 84} />
        </div>
        <div style={{...big(tall ? 112 : 118), lineHeight: 1.03, letterSpacing: '-0.035em', opacity: q, transform: `translateY(${(1 - q) * 14}px)`}}>
          Is it true?
          <br />
          <span>Bet on it.</span>
        </div>
        <div style={{font: `500 ${tall ? 38 : 32}px/1.3 ${FONT.text}`, color: C.ink2, marginTop: 30, opacity: free, transform: `translateY(${(1 - free) * 12}px)`}}>Your first $1 is free · no wallet, nothing to lose</div>
        <div style={{marginTop: 30, opacity: clamp01(url), transform: `scale(${mix(0.9, 1, url)})`, transformOrigin: tall ? '50% 50%' : '0 50%'}}>
          <PrimaryButton size={tall ? 1.9 : 1.75}>isitpriced.com</PrimaryButton>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};


// ----- S09b: the page fixed itself, on the real page --------------------------------------------------------------
// isitpriced.com/p/tether ("Written by AI from what the market believes right now"): the T-Bills paragraph in its
// corrected wording, with "What changed" open (ruled false by three AI judges, the TEE signature, the anchor on NEAR).
const PageReal: React.FC<P> = ({shot, t, T}) => {
  const written = shot.written ?? shot.at + shot.dur / 2;
  const land = ease(t, 0, 1.2, EASE.out);
  const lift = ease(t, 0.7, 0.8, EASE.out);
  const k = ease(t, 0, written - shot.at, EASE.inOut);
  // two moves: land on the corrected paragraph with its "What changed" panel lifted toward us, then a whip up the
  // page to its own header ("Written by AI from what the market believes right now") as the voice says it
  const whip = ease(T, written - 0.15, 0.5, EASE.inOut);
  const onHead = whip > 0.5;
  const blur = Math.sin(Math.PI * whip) * 14;
  const p = boxes.para;
  const c = boxes.changed;
  const h = boxes.pageHead;
  const topPara = Math.max(0, Math.min(p.y, c.y) - 150);
  // the page's own header carries the sentence on screen; the voice says it
  const settle = ease(T, written + 0.3, 1.6, EASE.out);
  return (
    <Ground glow="55% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', filter: blur > 0.3 ? `blur(${blur}px)` : undefined}}>
        <div style={{transform: `translate(${onHead ? mix(330, 290, settle) : mix(320, 380, k)}px, ${onHead ? mix(120, 150, settle) : mix(10, 30, land)}px)`}}>
          {onHead ? (
            <Browser3D src={h.src} url="isitpriced.com/p/tether" width={1500} height={900} top={0} pose={{rx: mix(12, 7, settle), ry: mix(-16, -10, settle), rz: 1, z: mix(380, 520, settle)}} dof={2} />
          ) : (
            <Browser3D src={p.src} url="isitpriced.com/p/tether" width={1560} height={940} top={mix(topPara + 220, c.y - 260, land)} pose={{rx: mix(22, 6, land), ry: mix(-14, -6, land), rz: mix(2, 0.5, land), z: mix(-320, 160 + 60 * k, land)}} lifts={[{...c, z: lift * 150, ring: true}]} dim={0.1 * lift} dof={2} />
          )}
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

const FixShot: React.FC<P & {short?: boolean}> = ({shot, short}) => {
  const cut = useCut();
  // the new number rolls in on the voice's "One hundred twenty-two…"
  const one = wordStart(cut, 'L09', 'One', shot.at + 2.2);
  return (
    <AbsoluteFill style={{transform: 'scale(1.12)', transformOrigin: '20% 50%'}}>{short ? <PageFix tempo={1.5} delay={0.25} /> : <PageFix delay={Math.max(0, one - shot.at - 1.05)} />}</AbsoluteFill>
  );
};

export const SHOTS: Record<string, React.FC<P>> = {
  hook: Hook,
  wake: Wake,
  phoneTap: Tap,
  swing: Swing,
  phoneReceipt: Receipt,
  feed: Feed,
  steps: Steps,
  traders: Traders,
  who: Who,
  challenge: Challenge,
  judges: Judges,
  stamps: Stamps,
  signed: Signed,
  window: Window,
  fix: (p) => <FixShot {...p} />,
  fixShort: (p) => <FixShot {...p} short />,
  pageFix: PageReal,
  payout: Payout,
  reopen: Reopen,
  pullback: Pullback,
  proof: Proof,
  end: End,
};
