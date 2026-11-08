// v5: the re-cut after three cold viewers scored v4 5/10 (.apex/prompts/V5-film-recut.md).
// The product is shown big, flat and crisp: the live site's own elements, captured at device scale 3
// (scripts/capture_v5.mjs), never tilted. Every beat has a visual event; no stretch is words on white.
import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {C, EASE, FONT, SHADOW} from '../brand/tokens';
import {Chip, Lockup, PrimaryButton} from '../components/core';
import {PageFix} from '../pieces/PageFix';
import el from './elements.json';
import boxes from './boxes.json';
import {Ground, Plate, Shot, WordIn, clamp01, ease, mix, useCut, useTall, wordStart} from './lib';

type P = {shot: Shot; t: number; T: number};
type El = {w: number; h: number};
const E = el as unknown as Record<string, El> & {phone: {file: string; t: number; tag: string}[]};

const big = (size: number, color: string = C.ink): React.CSSProperties => ({font: `700 ${size}px/1.02 ${FONT.disp}`, letterSpacing: '-0.035em', color});
const card: React.CSSProperties = {borderRadius: 22, overflow: 'hidden', background: C.surface, boxShadow: `0 1px 0 ${C.line}, 0 0 0 1px ${C.line}, 0 40px 80px -40px rgba(40,52,66,0.35)`};

/** A live-site element, flat, at `width` px; `crop` trims CSS px from its top or bottom. */
const Flat: React.FC<{name: string; width: number; cropTop?: number; cropBottom?: number; cropLeft?: number; viewW?: number; style?: React.CSSProperties; frame?: boolean}> = ({name, width, cropTop = 0, cropBottom = 0, cropLeft = 0, viewW, style, frame = true}) => {
  const e = E[name];
  const vw = viewW ?? e.w - cropLeft;
  const k = width / vw;
  const h = (e.h - cropTop - cropBottom) * k;
  return (
    <div style={{position: 'relative', width, height: h, ...(frame ? card : {overflow: 'hidden'}), ...style}}>
      <Img src={staticFile(`site/v5/${name}.png`)} style={{position: 'absolute', left: -cropLeft * k, top: -cropTop * k, width: e.w * k}} />
    </div>
  );
};

/** Slide-and-settle entry. */
const enter = (t: number, at: number, dy = 40, dur = 0.55) => {
  const k = ease(t, at, dur, EASE.out);
  return {opacity: clamp01(k * 1.4), transform: `translateY(${(1 - k) * dy}px)`};
};

// ----- the persistent mark: the name is on screen from the first frame ---------------------------------------------
export const Bug: React.FC = () => {
  const tall = useTall();
  return (
    <AbsoluteFill style={{alignItems: 'flex-end', justifyContent: 'flex-start', padding: tall ? '64px 56px' : '40px 52px', pointerEvents: 'none'}}>
      <Lockup height={tall ? 54 : 44} />
    </AbsoluteFill>
  );
};

// ----- 0:00 the hook: already there in frame 1 --------------------------------------------------------------------
const Hook: React.FC<P> = ({t, T}) => {
  const tall = useTall();
  const cut = useCut();
  const fifty = wordStart(cut, 'L01', 'fifty', 1.5);
  const slam = ease(T, fifty - 0.05, 0.32, EASE.spring);
  const push = 1 + 0.03 * clamp01(t / 3.75);
  return (
    <Ground glow="35% 40%">
      <AbsoluteFill style={{transform: `scale(${push})`, transformOrigin: '20% 30%', padding: tall ? '230px 70px 0' : '96px 120px 0'}}>
        <div style={{font: `500 ${tall ? 32 : 28}px ${FONT.text}`, color: C.ink3, marginBottom: 18}}>Wikipedia · the Tether article says:</div>
        <div style={{font: `400 ${tall ? 80 : 96}px/1.1 ${FONT.quote}`, fontVariationSettings: "'opsz' 72", color: C.ink, letterSpacing: '-0.01em'}}>
          “…are U.S. T-Bills, accounting for{' '}
          <span style={{background: C.warnBg, color: C.warn, borderRadius: 10, padding: '0 8px'}}>$72.6&nbsp;billion</span>.”
        </div>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 26, flexWrap: 'wrap'}}>
          <span style={{font: `500 ${tall ? 40 : 40}px ${FONT.text}`, color: C.ink2}}>Tether’s own report:</span>
          <span style={{...big(tall ? 64 : 64), background: C.yesBg, borderRadius: 12, padding: '2px 14px 8px'}}>$122.84&nbsp;billion</span>
        </div>
        <div style={{...big(tall ? 150 : 176), marginTop: tall ? 90 : 46, transformOrigin: '0 100%', transform: `scale(${mix(1.08, 1, slam)})`, opacity: T >= fifty - 0.05 ? 1 : 0}}>
          $50 billion <span style={{color: C.ink3}}>out of date.</span>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- 0:04 the name and the idea, with the product beside them ----------------------------------------------------
const PhoneScreen: React.FC<{file: string; width: number; height: number; offset: number; style?: React.CSSProperties; children?: React.ReactNode}> = ({file, width, height, offset, style, children}) => (
  <div style={{position: 'relative', width, height, borderRadius: 44, overflow: 'hidden', background: '#fff', boxShadow: `0 0 0 10px #E9ECEF, 0 0 0 11px ${C.lineStrong}, 0 60px 110px -50px rgba(40,52,66,0.45)`, ...style}}>
    <Img src={staticFile(`site/v5/phone/${file}`)} style={{position: 'absolute', left: 0, top: -offset, width}} />
    {children}
  </div>
);

const Idea: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const cut = useCut();
  const q = cut.cues.find((c) => c.id === 'N02' || c.id === 'N02s')!;
  const pays = q.words.find((w) => w.w === 'pays')!.s;
  const on = q.words.find((w) => w.w === 'On')?.s;
  const lock = ease(T, q.at - 0.05, 0.6, EASE.spring);
  const ph = enter(t, 0.85, 80, 0.7);
  const pw = tall ? 760 : 700;
  const lines = (
    <div>
      <div style={{opacity: clamp01(lock * 1.5), transform: `scale(${mix(0.9, 1, lock)})`, transformOrigin: tall ? '50% 50%' : '0 50%'}}>
        <Lockup height={tall ? 130 : 128} />
      </div>
      <div style={{...big(tall ? 92 : 104), marginTop: 30}}>
        {['pays', 'you', 'to', 'catch', 'it.'].map((w, i) => (
          <React.Fragment key={w}>
            <WordIn t={T} at={pays - 0.04 + i * 0.07}>
              {w}
            </WordIn>{' '}
          </React.Fragment>
        ))}
      </div>
      {on !== undefined ? (
        <div style={{font: `600 ${tall ? 50 : 52}px/1.18 ${FONT.disp}`, letterSpacing: '-0.02em', color: C.ink2, marginTop: 30, maxWidth: tall ? 940 : 820, ...enter(T, on - 0.05, 24, 0.45)}}>
          On Wikipedia, being right pays nothing.
        </div>
      ) : null}
    </div>
  );
  void shot;
  if (tall) {
    return (
      <Ground glow="50% 30%">
        <AbsoluteFill style={{padding: '190px 70px 0', alignItems: 'center', textAlign: 'center'}}>
          {lines}
          <div style={{marginTop: 70, ...ph}}>
            <PhoneScreen file="000.png" width={pw} height={760} offset={150} />
          </div>
        </AbsoluteFill>
      </Ground>
    );
  }
  return (
    <Ground glow="70% 45%">
      <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '40px 140px 0 130px'}}>
        <div style={{width: 900}}>{lines}</div>
        <div style={{...ph}}>
          <PhoneScreen file="000.png" width={pw} height={880} offset={mix(0, 60, clamp01(t / 5))} />
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- the bet, on the real phone --------------------------------------------------------------------------------
const phoneAt = (dt: number) => {
  // dt: seconds after the tap. Before the tap: the idle screen.
  if (dt < 0) return E.phone[0].file;
  // after the press, skip the sheet's dimmed hand-over frames and land on the settled receipt (23% → 12%)
  const real = dt < 0.6 ? dt : dt + 2.0;
  let f = E.phone[1].file;
  for (const p of E.phone.slice(1)) if (p.t <= real) f = p.file;
  return f;
};

const Bet: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const tap = shot.tap ?? shot.at + 1.5;
  const chip = shot.chip ?? tap + 0.8;
  const dt = T - tap;
  const pw = tall ? 900 : 760;
  const scale = pw / 390;
  const win = tall ? 1250 : 1000;
  // pan down to the bet buttons before the tap, back up to the receipt after it
  const down = (844 - win / scale) * scale;
  const off = dt < 0 ? mix(0, down, ease(t, 0.2, Math.max(0.3, tap - shot.at - 0.5), EASE.inOut)) : dt < 0.75 ? down : mix(down, 0, ease(dt, 0.75, 0.45, EASE.inOut));
  const ripple = dt >= 0 && dt < 0.5 ? dt / 0.5 : 0;
  const c = ease(T, chip, 0.45, EASE.spring);
  const tag = (
    <div style={{opacity: clamp01(c * 1.5), transform: `scale(${mix(0.9, 1, c)})`, transformOrigin: tall ? '50% 50%' : '0 50%'}}>
      <span style={{display: 'inline-flex', alignItems: 'center', gap: 14, height: tall ? 92 : 84, padding: '0 32px', borderRadius: 999, background: C.yesBg, color: C.yes, font: `600 ${tall ? 50 : 46}px ${FONT.disp}`, letterSpacing: '-0.02em'}}>
        ✓ Recorded on NEAR · 4.5 s
      </span>
      <div style={{font: `500 ${tall ? 34 : 32}px ${FONT.mono}`, color: C.ink2, marginTop: 18}}>tx FGFhi1…BBvc6</div>
      <div style={{font: `500 ${tall ? 32 : 30}px ${FONT.text}`, color: C.ink3, marginTop: 6}}>NEAR: a public blockchain</div>
    </div>
  );
  const phone = (
    <PhoneScreen file={phoneAt(dt)} width={pw} height={win} offset={off}>
      {ripple > 0 ? (
        <div style={{position: 'absolute', left: '74%', top: down > 0 ? 690 * scale - off + 60 : 0, width: 90, height: 90, margin: '-45px 0 0 -45px', borderRadius: '50%', background: 'rgba(17,22,30,0.18)', opacity: 1 - ripple, transform: `scale(${1 + ripple * 3})`}} />
      ) : null}
    </PhoneScreen>
  );
  if (tall) {
    return (
      <Ground glow="50% 50%">
        <AbsoluteFill style={{alignItems: 'center', padding: '170px 0 0', gap: 40, textAlign: 'center'}}>
          <div style={{height: 230, display: 'flex', alignItems: 'center'}}>{tag}</div>
          {phone}
        </AbsoluteFill>
      </Ground>
    );
  }
  return (
    <Ground glow="35% 50%">
      <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', gap: 110, padding: '30px 0 0 260px'}}>
        {phone}
        <div style={{width: 760}}>{tag}</div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- the odds: the dial and the real chart move together -------------------------------------------------------
const Odds: React.FC<P> = ({t}) => {
  const local = 0.5 + t; // the plate's first bet lands 0.4 s in
  const wipe = clamp01((local - 0.6) / 4.2);
  const w = 880;
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="steps" local={local} style={{transform: 'translate(-330px, 0) scale(1.02)'}} />
      <AbsoluteFill style={{left: 960, width: 900, justifyContent: 'center', paddingBottom: 20}}>
        <div style={{font: `500 30px ${FONT.text}`, color: C.ink2, marginBottom: 18, ...enter(t, 0.1, 16)}}>Chance it’s true, after each bet</div>
        <div style={{position: 'relative', ...enter(t, 0.05, 30)}}>
          <Flat name="chart" width={w} cropTop={26} />
          <div style={{position: 'absolute', top: 0, bottom: 0, right: 0, width: `${(1 - wipe) * 100}%`, background: C.surface}} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- anyone can challenge: the real ruling timeline, then the evidence -------------------------------------------
const Challenge: React.FC<P> = ({shot, t, T}) => {
  const src = shot.src ?? shot.at + 3;
  return (
    <Ground glow="50% 40%">
      <AbsoluteFill style={{padding: '170px 120px 0', gap: 40}}>
        <div style={enter(t, 0.05, 40)}>
          <Flat name="challenge" width={1680} viewW={560} />
        </div>
        <div style={{alignSelf: 'flex-end', ...enter(T, src - 0.1, 60)}}>
          <Flat name="sources" width={1250} cropLeft={482} />
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

const JUDGES = ['DeepSeek V4.1', 'Qwen 3.8', 'GLM 5.3'];

const Judges: React.FC<P> = ({t}) => {
  const scan = ease(t, 0.6, 2.2, EASE.inOut);
  const e = E.sources;
  const w = 1250;
  const h = (e.h * w) / (e.w - 482);
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{padding: '230px 120px 0'}}>
        <div style={{position: 'relative', width: w}}>
          <Flat name="sources" width={w} cropLeft={482} />
          <div style={{position: 'absolute', top: 0, bottom: 0, left: `${scan * 100}%`, width: 6, marginLeft: -3, background: 'rgba(17,22,30,0.25)', opacity: scan > 0 && scan < 1 ? 1 : 0}} />
          <div style={{position: 'absolute', top: 0, bottom: 0, left: 0, width: `${scan * 100}%`, background: 'rgba(17,22,30,0.035)'}} />
        </div>
        <div style={{display: 'flex', gap: 22, marginTop: 56, alignItems: 'center', marginLeft: 4}}>
          {JUDGES.map((j, i) => (
            <div key={j} style={enter(t, 0.25 + i * 0.18, 24, 0.45)}>
              <span style={{display: 'inline-flex', alignItems: 'center', gap: 12, height: 64, padding: '0 26px', borderRadius: 999, background: C.surface, boxShadow: `0 0 0 1px ${C.lineStrong}`, font: `600 30px ${FONT.disp}`, color: C.ink}}>
                <span style={{width: 12, height: 12, borderRadius: 9, background: C.ink3, opacity: 0.4 + 0.6 * Math.abs(Math.sin((t - i * 0.3) * 4))}} />
                {j}
              </span>
            </div>
          ))}
          <span style={{font: `500 30px ${FONT.text}`, color: C.ink3, marginLeft: 12, ...enter(t, 1.0, 16)}}>independent AI judges · each in sealed hardware</span>
        </div>
        <div style={{height: h * 0}} />
      </AbsoluteFill>
    </Ground>
  );
};

// ----- signatures: the real judge cards, each checked ------------------------------------------------------------
const Signed: React.FC<P> = ({shot, t, T}) => {
  const cut = useCut();
  const check = wordStart(cut, 'C4', 'checked', shot.at + 0.6);
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', padding: '150px 0 0'}}>
        <div style={enter(t, 0, 40)}>
          <Flat name="judges" width={1560} />
        </div>
        <div style={{display: 'flex', gap: 22, marginTop: 34, alignItems: 'center'}}>
          {JUDGES.map((j, i) => {
            const k = ease(T, check + i * 0.3, 0.35, EASE.spring);
            return (
              <span key={j} style={{opacity: clamp01(k * 1.5), transform: `scale(${mix(0.88, 1, k)})`, display: 'inline-flex', alignItems: 'center', height: 70, padding: '0 28px', borderRadius: 999, background: C.yesBg, color: C.yes, font: `600 34px ${FONT.disp}`}}>
                ✓ {j}
              </span>
            );
          })}
          <span style={{font: `600 34px ${FONT.disp}`, color: C.ink, marginLeft: 8, opacity: clamp01(ease(T, check + 0.9, 0.3) * 1.5)}}>signatures checked by NEAR</span>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- "Money sets the odds. Evidence decides." -----------------------------------------------------------------------
const Rule: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const ev = shot.ev ?? shot.at + 1.6;
  const b = ease(T, ev - 0.05, 0.45, EASE.spring);
  const left = (
    <div style={{...enter(t, 0, 30)}}>
      <div style={{...big(tall ? 84 : 76), marginBottom: 30}}>Money sets the odds.</div>
      <Flat name="chart" width={tall ? 940 : 820} cropTop={26} />
    </div>
  );
  const right = (
    <div style={{opacity: clamp01(b * 1.5), transform: `translateY(${(1 - b) * 30}px)`}}>
      <div style={{...big(tall ? 84 : 76), marginBottom: 20}}>Evidence decides.</div>
      <div style={{position: 'relative', width: tall ? 940 : 820, height: tall ? 740 : 720, overflow: 'hidden', borderRadius: 22, background: C.surface, boxShadow: `0 0 0 1px ${C.line}`}}>
        <Img src={staticFile(`blender/light-${tall ? 'tall' : 'wide'}/stamps/0168.png`)} style={tall ? {position: 'absolute', width: 860, left: -10, top: -405} : {position: 'absolute', width: 1600, left: -623, top: -110}} />
        {['DeepSeek V4.1', 'Qwen 3.8', 'GLM 5.3'].map((n, i) => (
          <div key={n} style={{position: 'absolute', left: 30, top: (tall ? [95, 370, 640] : [106, 355, 608])[i], font: `600 30px ${FONT.disp}`, color: C.ink}}>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={tall ? {padding: '200px 70px 0', gap: 70} : {flexDirection: 'row', justifyContent: 'center', gap: 80, padding: '150px 0 0'}}>
        {left}
        {right}
      </AbsoluteFill>
    </Ground>
  );
};

// ----- the page fixed itself: the morph, then the real panel ---------------------------------------------------------
const Fix: React.FC<P> = ({shot}) => {
  const cut = useCut();
  // the main film rolls the number in on "One hundred…"; the vertical cut's shorter line starts it at once
  const one = cut.cues.some((c) => c.id === 'N08') ? wordStart(cut, 'N08', 'One', shot.at + 2.2) : shot.at + 1.05;
  return (
    <AbsoluteFill style={{transform: 'scale(1.12)', transformOrigin: '20% 50%'}}>
      <PageFix delay={Math.max(0, one - shot.at - 1.05)} />
    </AbsoluteFill>
  );
};

const Panel: React.FC<P> = ({t}) => {
  const tall = useTall();
  const c = (boxes as Record<string, {x: number; y: number; w: number; h: number}>).changed;
  // the corrected sentence's last lines and its open "What changed" panel, from the live page (2x capture)
  const x0 = c.x - 30;
  const y0 = c.y - 150;
  const cw = c.w + 60;
  const ch = c.h + 170;
  const W = tall ? 1000 : 1400;
  const k = W / cw;
  const push = 1 + 0.025 * clamp01(t / 3);
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: tall ? 'flex-start' : 'center', padding: tall ? '260px 0 0' : '20px 0 0'}}>
        <div style={{...enter(t, 0, 50), transform: `${enter(t, 0, 50).transform} scale(${push})`}}>
          <div style={{position: 'relative', width: W, height: ch * k, ...card}}>
            <Img src={staticFile('site/ptether-para.png')} style={{position: 'absolute', width: 2880 * k, left: -x0 * k, top: -y0 * k}} />
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- where the money is sure, the page says it plainly; where it isn't, it says so ------------------------------------
const Page: React.FC<P> = ({shot, t, T}) => {
  const sure = shot.sure ?? shot.at + 2.6;
  const doubt = shot.doubt ?? shot.at + 4;
  const swap = ease(T, doubt - 0.45, 0.4, EASE.inOut);
  const head = E.pagehead;
  const hw = 1320;
  const hk = hw / 440; // the header's first 440 CSS px: "Written by AI from what the market believes right now."
  const s1 = ease(T, sure - 0.2, 0.4, EASE.spring);
  const s2 = ease(T, doubt - 0.1, 0.4, EASE.spring);
  void head;
  return (
    <Ground glow="50% 40%">
      <AbsoluteFill style={{padding: '120px 120px 0'}}>
        <div style={{font: `500 28px ${FONT.text}`, color: C.ink3, marginBottom: 12, ...enter(t, 0, 12)}}>isitpriced.com/p/tether, the page itself</div>
        <div style={{position: 'relative', width: hw, height: 26 * hk, overflow: 'hidden', ...enter(t, 0.05, 20)}}>
          <Img src={staticFile('site/v5/pagehead.png')} style={{position: 'absolute', left: -10 * hk, top: -6 * hk, width: E.pagehead.w * hk}} />
        </div>
        <div style={{position: 'relative', marginTop: 40, height: 520}}>
          <div style={{position: 'absolute', left: 0, top: 0, opacity: 1 - swap, transform: `translateY(${-swap * 30}px)`, display: 'flex', alignItems: 'center', gap: 50}}>
            <Flat name="sure" width={1140} style={{padding: 0}} />
            <div style={{opacity: clamp01(s1 * 1.5), transform: `scale(${mix(0.9, 1, s1)})`}}>
              <div style={{...big(92, C.yes)}}>81%</div>
              <div style={{font: `500 30px ${FONT.text}`, color: C.ink2, marginTop: 6}}>chance it’s true</div>
              <div style={{font: `600 32px ${FONT.disp}`, color: C.ink, marginTop: 14}}>Said plainly.</div>
            </div>
          </div>
          <div style={{position: 'absolute', left: 0, top: 0, opacity: swap, transform: `translateY(${(1 - swap) * 30}px)`, display: 'flex', alignItems: 'center', gap: 50}}>
            <Flat name="doubt" width={1140} />
            <div style={{opacity: clamp01(s2 * 1.5), transform: `scale(${mix(0.9, 1, s2)})`}}>
              <div style={{...big(92, C.warn)}}>46%</div>
              <div style={{font: `500 30px ${FONT.text}`, color: C.ink2, marginTop: 6}}>chance it’s true</div>
              <div style={{font: `600 32px ${FONT.disp}`, color: C.ink, marginTop: 14}}>“It is disputed whether…”</div>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- anyone can dispute; the right side got paid --------------------------------------------------------------------
const LADDER = ['$1', '$2', '$4', '$8', 'Council'];

const Dispute: React.FC<P> = ({shot, t, T}) => {
  const paid = shot.paid ?? shot.at + 3;
  return (
    <Ground glow="60% 45%">
      <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '40px 160px 0 130px'}}>
        <div style={{width: 820}}>
          <div style={{font: `500 30px ${FONT.text}`, color: C.ink2, marginBottom: 26, ...enter(t, 0, 14)}}>To dispute a ruling, post double the bond:</div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            {LADDER.map((s, i) => {
              const k = ease(t, 0.35 + i * 0.32, 0.4, EASE.spring);
              return (
                <React.Fragment key={s}>
                  {i ? <span style={{font: `600 34px ${FONT.text}`, color: C.ink3, opacity: clamp01(k * 1.5)}}>→</span> : null}
                  <span style={{opacity: clamp01(k * 1.5), transform: `scale(${mix(0.8, 1, k)})`, display: 'inline-flex', alignItems: 'center', height: 84, padding: '0 26px', borderRadius: 20, background: i === 4 ? C.ink : C.surface, color: i === 4 ? '#fff' : C.ink, boxShadow: `0 0 0 1px ${C.lineStrong}`, font: `700 ${i === 4 ? 34 : 42}px ${FONT.disp}`, letterSpacing: '-0.02em'}}>
                    {s}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          <div style={{font: `500 28px ${FONT.text}`, color: C.ink3, marginTop: 22, ...enter(t, 2.0, 12)}}>After the third dispute, the council rules.</div>
        </div>
        <div style={enter(T, paid - 0.15, 60)}>
          <Flat name="nowon" width={700} />
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- every day, new claims from the news ---------------------------------------------------------------------------
const News: React.FC<P> = ({t}) => (
  <Ground glow="50% 45%">
    <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 50, padding: '40px 0 0'}}>
      <div style={enter(t, 0.05, 50)}>
        <Flat name="news2" width={1020} />
      </div>
      <div style={enter(t, 0.35, 50)}>
        <Flat name="vsai" width={600} />
      </div>
    </AbsoluteFill>
  </Ground>
);

// ----- every step is a public transaction ------------------------------------------------------------------------------
const PROOF = [
  ['The free $1 on No', 'FGFhi1…BBvc6'],
  ['The challenge, $1 bond', '5C2kye…SnxaQ'],
  ['DeepSeek V4.1: false', '6HWB2E…a2dz'],
  ['Qwen 3.8: false', '7MQF5C…67E'],
  ['GLM 5.3: false', '78KBg1…WhR'],
  ['Settled; No won', '3KbCTq…8K1v'],
  ['The page’s rewrite, anchored', 'BRsksf…B2v1m'],
];

const Proof: React.FC<P> = ({t}) => (
  <Ground glow="60% 45%">
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: '40px 0 0'}}>
      <div style={{width: 1300, display: 'flex', flexDirection: 'column', gap: 12}}>
        {PROOF.map(([label, hash], i) => {
          const k = ease(t, 0.15 + i * 0.2, 0.4, EASE.spring);
          return (
            <div key={hash} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 32px', borderRadius: 18, background: SHADOW.panel, boxShadow: `${SHADOW.card}, 0 0 0 1px ${C.line}`, opacity: clamp01(k), transform: `translateY(${(1 - k) * 26}px)`}}>
              <span style={{font: `500 32px ${FONT.text}`, color: C.ink2}}>{label}</span>
              <span style={{font: `500 32px ${FONT.mono}`, color: C.ink}}>{hash}</span>
            </div>
          );
        })}
        <div style={{font: `500 28px ${FONT.text}`, color: C.ink3, marginTop: 10, ...enter(t, 1.6, 10)}}>On nearblocks.io · market.isitpriced.near</div>
      </div>
    </AbsoluteFill>
  </Ground>
);

// ----- the end card -------------------------------------------------------------------------------------------------
const End: React.FC<P> = ({shot, t}) => {
  const tall = useTall();
  const fast = !!shot.fast;
  const lock = ease(t, 0.1, 0.5);
  const q = ease(t, fast ? 0.3 : 0.9, 0.5);
  const free = ease(t, fast ? 0.7 : 2.6, 0.45);
  const url = ease(t, fast ? 1.0 : 3.3, 0.5, EASE.spring);
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="end" local={Math.min(t + 2.2, tall ? 3.6 : 7.9)} />
      <AbsoluteFill style={tall ? {alignItems: 'center', justifyContent: 'flex-end', padding: '0 60px 430px', textAlign: 'center'} : {left: 1060, width: 820, justifyContent: 'center', paddingBottom: 30}}>
        <div style={{opacity: lock, transform: `translateY(${(1 - lock) * 14}px)`, marginBottom: 34}}>
          <Lockup height={tall ? 100 : 96} />
        </div>
        <div style={{...big(tall ? 112 : 118), opacity: q, transform: `translateY(${(1 - q) * 14}px)`}}>
          Is it true?
          <br />
          Bet on it.
        </div>
        <div style={{font: `500 ${tall ? 40 : 34}px/1.3 ${FONT.text}`, color: C.ink2, marginTop: 30, opacity: free}}>Your first $1 is free · no wallet</div>
        <div style={{marginTop: 30, opacity: clamp01(url), transform: `scale(${mix(0.9, 1, url)})`, transformOrigin: tall ? '50% 50%' : '0 50%'}}>
          <PrimaryButton size={tall ? 1.9 : 1.75}>isitpriced.com</PrimaryButton>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const StampsShot: React.FC<P> = ({shot, t}) => {
  const tall = useTall();
  const rate = shot.rate ?? 1;
  const local = t * rate;
  const HIT = [0.6, 1.6, 3.7];
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="stamps" local={local} />
      {JUDGES.map((j, i) => {
        const y = (tall ? [617, 958, 1330] : [242, 541, 845])[i];
        const hit = local >= HIT[i];
        return (
          <div key={j} style={{position: 'absolute', left: tall ? 50 : 150, top: y - (tall ? 46 : 80)}}>
            <div style={{...big(tall ? 42 : 92), letterSpacing: '-0.03em', whiteSpace: 'nowrap'}}>{j}</div>
            <div style={{font: `500 ${tall ? 36 : 48}px ${FONT.text}`, color: C.ink3, marginTop: 10, opacity: hit ? 1 : 0}}>{['8.0 s', '9.8 s', '16.7 s'][i]}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const SHOTS5: Record<string, React.FC<P>> = {
  v5hook: Hook,
  v5idea: Idea,
  v5bet: Bet,
  v5odds: Odds,
  v5challenge: Challenge,
  v5judges: Judges,
  v5stamps: StampsShot,
  v5signed: Signed,
  v5rule: Rule,
  v5fix: Fix,
  v5panel: Panel,
  v5page: Page,
  v5dispute: Dispute,
  v5news: News,
  v5proof: Proof,
  v5end: End,
};
