// v6: one idea, full frame (.apex/prompts/V6-film-one-idea.md). "Wikipedia that pays you to catch stale facts",
// in eight beats. Every shot fills the frame; no small cards, no tilted text, no words on white.
import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {C, EASE, FONT} from '../brand/tokens';
import {Lockup, PrimaryButton} from '../components/core';
import el from './elements.json';
import pending from './pending.json';
import page from './page.json';
import {Ground, Plate, Shot, clamp01, ease, mix, useCut, useTall, wordStart} from './lib';
import {SHOTS5} from './v5';

type P = {shot: Shot; t: number; T: number};
type El = {w: number; h: number};
const E = el as unknown as Record<string, El>;
const big = (size: number, color: string = C.ink): React.CSSProperties => ({font: `700 ${size}px/1.04 ${FONT.disp}`, letterSpacing: '-0.035em', color});
const enter = (t: number, at: number, dy = 40, dur = 0.55) => {
  const k = ease(t, at, dur, EASE.out);
  return {opacity: clamp01(k * 1.4), transform: `translateY(${(1 - k) * dy}px)`};
};
const PENDING = new Set<string>(pending as string[]);

/** A live-site element captured flat at 3x (scripts/capture_v5.mjs), shown at `width`, with optional crops in CSS px. */
const Flat: React.FC<{name: string; width: number; cropTop?: number; cropBottom?: number; cropLeft?: number; viewW?: number; style?: React.CSSProperties}> = ({name, width, cropTop = 0, cropBottom = 0, cropLeft = 0, viewW, style}) => {
  const e = E[name];
  const vw = viewW ?? e.w - cropLeft;
  const k = width / vw;
  return (
    <div style={{position: 'relative', width, height: (e.h - cropTop - cropBottom) * k, overflow: 'hidden', ...style}}>
      <Img src={staticFile(`site/v5/${name}.png`)} style={{position: 'absolute', left: -cropLeft * k, top: -cropTop * k, width: e.w * k}} />
    </div>
  );
};

// ----- beats 2 and 3: the market, full frame; then the free $1 on No --------------------------------------------
const Market: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const tap = shot.tap ?? 99;
  const chip = shot.chip ?? 99;
  const lock = shot.lock ?? shot.at + 2.5;
  const pressed = T >= tap;
  const press = T >= tap && T < tap + 0.16 ? 0.96 : 1;
  const ripple = T >= tap && T < tap + 0.5 ? (T - tap) / 0.5 : 0;
  const L = ease(T, lock - 0.1, 0.55, EASE.spring);
  const c = ease(T, chip, 0.45, EASE.spring);
  const qIn = enter(t, 0.0, 30, 0.5);
  const btn = (side: 'yes' | 'no') => {
    const no = side === 'no';
    const fill = no && pressed;
    return (
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: tall ? 150 : 132,
          borderRadius: 22,
          padding: tall ? '22px 30px' : '20px 28px',
          background: fill ? C.noFill : no ? C.noBg : C.yesBg,
          color: fill ? C.noInk : no ? C.no : C.yes,
          transform: `scale(${no ? press : 1})`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <div style={{font: `600 ${tall ? 46 : 42}px ${FONT.disp}`, letterSpacing: '-0.02em'}}>{no ? 'No, it’s false' : 'Yes, it’s true'}</div>
        <div style={{font: `500 ${tall ? 32 : 30}px ${FONT.text}`, opacity: 0.92}}>{no ? '$1 wins $1.20' : '$1 wins $2.41'}</div>
        {no && ripple > 0 ? <div style={{position: 'absolute', left: '60%', top: '50%', width: 110, height: 110, margin: '-55px 0 0 -55px', borderRadius: '50%', background: 'rgba(255,255,255,0.45)', opacity: 1 - ripple, transform: `scale(${1 + ripple * 4})`}} /> : null}
      </div>
    );
  };
  const left = (
    <div style={{width: tall ? 940 : 900}}>
      <div style={{height: tall ? 130 : 112, opacity: clamp01(L * 1.5), transform: `scale(${mix(0.88, 1, L)})`, transformOrigin: tall ? '50% 50%' : '0 50%', display: 'flex', justifyContent: tall ? 'center' : 'flex-start'}}>
        <Lockup height={tall ? 104 : 96} />
      </div>
      <div style={{...qIn, marginTop: tall ? 26 : 30}}>
        <span style={{display: 'inline-flex', alignItems: 'center', height: 50, padding: '0 22px', borderRadius: 999, background: C.warnBg, color: C.warn, font: `600 30px ${FONT.text}`}}>⚑ Wikipedia may be wrong</span>
        <div style={{...big(tall ? 70 : 64), marginTop: 22, textAlign: tall ? 'center' : 'left'}}>Are most of Tether’s cash reserves U.S. T-Bills, accounting for $72.6 billion?</div>
      </div>
      {!tall ? (
        <div style={{display: 'flex', gap: 18, marginTop: 40, ...enter(t, 0.35, 30)}}>
          {btn('yes')}
          {btn('no')}
        </div>
      ) : null}
      {!tall ? (
        <div style={{height: 90, marginTop: 28, opacity: clamp01(c * 1.5), transform: `scale(${mix(0.9, 1, c)})`, transformOrigin: '0 50%'}}>
          <span style={{display: 'inline-flex', alignItems: 'center', height: 84, padding: '0 30px', borderRadius: 999, background: C.yesBg, color: C.yes, font: `600 40px ${FONT.disp}`, letterSpacing: '-0.02em'}}>✓ Recorded on NEAR · 4.5 s</span>
        </div>
      ) : null}
    </div>
  );
  if (tall) {
    return (
      <AbsoluteFill style={{background: C.bg}}>
        <Plate shot="market" local={t} set="v6" style={{transform: 'translateY(170px)'}} />
        <AbsoluteFill style={{alignItems: 'center', padding: '150px 70px 0'}}>{left}</AbsoluteFill>
        <AbsoluteFill style={{justifyContent: 'flex-end', padding: '0 70px 360px'}}>
          <div style={{display: 'flex', gap: 18, ...enter(t, 0.35, 30)}}>
            {btn('yes')}
            {btn('no')}
          </div>
          <div style={{height: 96, marginTop: 24, display: 'flex', justifyContent: 'center', opacity: clamp01(c * 1.5), transform: `scale(${mix(0.9, 1, c)})`}}>
            <span style={{display: 'inline-flex', alignItems: 'center', height: 88, padding: '0 30px', borderRadius: 999, background: C.yesBg, color: C.yes, font: `600 42px ${FONT.disp}`}}>✓ Recorded on NEAR · 4.5 s</span>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="market" local={t} set="v6" />
      <AbsoluteFill style={{justifyContent: 'center', padding: '0 0 20px 120px'}}>{left}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- beat 4a: the judges read Tether's own report -------------------------------------------------------------------
const JUDGES = ['DeepSeek V4.1', 'Qwen 3.8', 'GLM 5.3'];

const Evidence: React.FC<P> = ({t}) => {
  const scan = ease(t, 1.0, 2.2, EASE.inOut);
  const w = 1500;
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: '0 0 40px'}}>
        <div style={{font: `500 34px ${FONT.text}`, color: C.ink2, marginBottom: 26, width: w, ...enter(t, 0, 16)}}>Tether’s own report, filed as the evidence:</div>
        <div style={{position: 'relative', width: w, borderRadius: 28, background: C.surface, boxShadow: `0 0 0 1px ${C.line}, 0 50px 90px -50px rgba(40,52,66,0.4)`, padding: '18px 10px', ...enter(t, 0.05, 60, 0.6)}}>
          <Flat name="sources" width={w - 20} cropLeft={482} cropBottom={10} />
          <div style={{position: 'absolute', top: 0, bottom: 0, left: 0, width: `${scan * 100}%`, background: 'rgba(0,236,255,0.06)', borderRight: scan > 0 && scan < 1 ? `4px solid ${C.brand}` : 'none'}} />
        </div>
        <div style={{display: 'flex', gap: 22, marginTop: 50, width: w, alignItems: 'center'}}>
          {JUDGES.map((j, i) => (
            <span key={j} style={{...enter(t, 0.3 + i * 0.18, 24, 0.45), display: 'inline-flex', alignItems: 'center', gap: 14, height: 76, padding: '0 30px', borderRadius: 999, background: C.surface, boxShadow: `0 0 0 1px ${C.lineStrong}`, font: `600 36px ${FONT.disp}`, color: C.ink}}>
              <span style={{width: 14, height: 14, borderRadius: 9, background: C.ink3, opacity: 0.35 + 0.65 * Math.abs(Math.sin((t - i * 0.3) * 4))}} />
              {j}
            </span>
          ))}
          <span style={{font: `500 32px ${FONT.text}`, color: C.ink3, ...enter(t, 0.9, 12)}}>three independent AI judges</span>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 4b: the stamps (v5's plate, every tile inside the frame) -----------------------------------------------------
const Stamps: React.FC<P> = (p) => {
  const tall = useTall();
  const S = SHOTS5.v5stamps;
  return (
    <AbsoluteFill>
      <S {...p} />
      {p.shot.judges ? (
        <AbsoluteFill style={{padding: tall ? '230px 50px 0' : '60px 150px 0', pointerEvents: 'none'}}>
          <div style={{...big(tall ? 70 : 64), ...enter(p.t, 0, 20)}}>Three AI judges:</div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

// ----- beat 4c: No won ---------------------------------------------------------------------------------------------
const Won: React.FC<P> = ({t}) => {
  const k = ease(t, 0.15, 0.55, EASE.spring);
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: '0 0 60px'}}>
        <div style={{opacity: clamp01(k * 1.5), transform: `scale(${mix(0.9, 1, k)})`, borderRadius: 32, background: C.surface, boxShadow: `0 0 0 1px ${C.line}, 0 60px 110px -60px rgba(40,52,66,0.45)`, padding: '40px 56px'}}>
          {/* the live "No won." card, cropped above its dollar line */}
          <Flat name="nowon" width={1300} cropBottom={212} cropLeft={0} />
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 5: Money sets the odds. Evidence decides. ---------------------------------------------------------------------
const Rule: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const ev = shot.ev ?? shot.at + 1.6;
  const b = ease(T, ev - 0.05, 0.45, EASE.spring);
  const dial = (
    <div style={{position: 'relative', width: tall ? 900 : 820, height: tall ? 620 : 700, overflow: 'hidden'}}>
      {/* the end plate's dial at the market's last price, 10% */}
      <Img src={staticFile(`blender/v6-${tall ? 'tall' : 'wide'}/end/0090.png`)} style={tall ? {position: 'absolute', width: 1080, left: -90, top: -150} : {position: 'absolute', width: 1920, left: -260, top: -140}} />
    </div>
  );
  const stamp = (
    <div style={{position: 'relative', width: tall ? 900 : 820, height: tall ? 520 : 700, overflow: 'hidden'}}>
      <Img src={staticFile(`blender/light-${tall ? 'tall' : 'wide'}/stamps/0168.png`)} style={tall ? {position: 'absolute', width: 1500, left: -560, top: -1640} : {position: 'absolute', width: 2600, left: -1820, top: -900}} />
    </div>
  );
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={tall ? {alignItems: 'center', padding: '170px 0 0'} : {flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 60, padding: '90px 0 0'}}>
        <div style={{...enter(t, 0, 30), textAlign: tall ? 'center' : 'left'}}>
          <div style={{...big(tall ? 84 : 84)}}>Money sets the odds.</div>
          {dial}
        </div>
        <div style={{opacity: clamp01(b * 1.5), transform: `translateY(${(1 - b) * 30}px)`, textAlign: tall ? 'center' : 'left'}}>
          <div style={{...big(tall ? 84 : 84)}}>Evidence decides.</div>
          {stamp}
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 6: Wikipedia still says $72.6 billion; Priced In's page says $122.84 billion, with the source ------------------
// Set full frame from the live page's own text (scripts/capture_page.mjs), in the page's style. If the page's T-Bills line
// is hedged, the film shows the ruling's signed corrected wording from the same page's "What changed" panel instead.
const RULED = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, which Tether's attestation report, checked on 5 November 2026, puts at $122.84 billion at 30 September 2026.";
const PG = page as unknown as {header: string; tbills: {text: string; odds: number} | null; plain: {text: string; odds: number} | null; disputed: {text: string; odds: number} | null};
const tbillsPlain = PG.tbills && !/^It is disputed|probably|thought to/i.test(PG.tbills.text) ? PG.tbills.text : null;

const mark = (txt: string, hit: string, bg: string, fg: string) => {
  const i = txt.indexOf(hit);
  if (i < 0) return txt;
  return (
    <>
      {txt.slice(0, i)}
      <span style={{background: bg, color: fg, borderRadius: 8, padding: '0 6px'}}>{hit}</span>
      {txt.slice(i + hit.length)}
    </>
  );
};

const Payoff: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const ours = shot.ours ?? shot.at + 3.7;
  const r = ease(T, ours - 0.15, 0.55, EASE.out);
  const W = tall ? 940 : 1680;
  const sentence = tbillsPlain ?? RULED;
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', padding: tall ? '120px 0 300px' : '0 0 40px'}}>
        <div style={{width: W, ...enter(t, 0, 30)}}>
          <div style={{font: `600 ${tall ? 34 : 32}px ${FONT.text}`, color: C.ink3, marginBottom: 12}}>Wikipedia, today</div>
          <div style={{font: `400 ${tall ? 50 : 52}px/1.22 ${FONT.quote}`, fontVariationSettings: "'opsz' 48", color: C.ink}}>
            “…are U.S. T-Bills, accounting for <span style={{background: C.warnBg, color: C.warn, borderRadius: 8, padding: '0 6px'}}>$72.6&nbsp;billion</span>.”
          </div>
        </div>
        <div style={{width: W, marginTop: tall ? 60 : 56, opacity: clamp01(r * 1.4), transform: `translateY(${(1 - r) * 40}px)`}}>
          <div style={{font: `600 ${tall ? 34 : 32}px ${FONT.text}`, color: C.ink3, marginBottom: 12}}>Priced In’s page{tbillsPlain ? '' : ': the corrected wording, signed'}</div>
          <div style={{borderRadius: 28, background: C.surface, boxShadow: `0 0 0 1px ${C.line}, 0 50px 90px -50px rgba(40,52,66,0.4)`, padding: tall ? '30px 34px' : '30px 40px'}}>
            <div style={{font: `600 ${tall ? 34 : 34}px ${FONT.disp}`, color: C.ink, marginBottom: 16}}>{PG.header}</div>
            <div style={{font: `400 ${tall ? 40 : 42}px/1.4 ${FONT.text}`, color: C.ink}}>{mark(sentence, '$122.84 billion at 30 September 2026', C.yesBg, C.yes)}</div>
            <div style={{display: 'flex', gap: 14, marginTop: 20, flexWrap: 'wrap'}}>
              <span style={{display: 'inline-flex', alignItems: 'center', height: 54, padding: '0 22px', borderRadius: 999, background: C.surface2, color: C.ink2, font: `500 30px ${FONT.text}`}}>Source: Tether’s attestation report, 30 Sep 2026</span>
              <span style={{display: 'inline-flex', alignItems: 'center', height: 54, padding: '0 22px', borderRadius: 999, background: C.yesBg, color: C.yes, font: `500 30px ${FONT.text}`}}>✓ Signed · anchored on NEAR</span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
      {PENDING.has(shot.id) ? <Mark id={shot.id} /> : null}
    </Ground>
  );
};

// ----- beat 7: every page keeps itself current: plain where the money is sure, honest where it isn't --------------------
const Pages: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const honest = shot.honest ?? shot.at + 4;
  const swap = ease(T, honest - 0.35, 0.4, EASE.inOut);
  const plain = PG.plain ?? {text: '', odds: 0};
  const disputed = PG.disputed ?? {text: '', odds: 0};
  const row = (label: string, color: string, s: {text: string; odds: number}, bg: string) => (
    <div style={{display: 'flex', flexDirection: tall ? 'column' : 'row', alignItems: tall ? 'flex-start' : 'center', gap: tall ? 30 : 70}}>
      <div style={{width: tall ? 'auto' : 380, flex: 'none'}}>
        <div style={{...big(tall ? 110 : 120, color)}}>{label}</div>
        <div style={{font: `500 34px ${FONT.text}`, color: C.ink2, marginTop: 8}}>{s.odds}% chance it’s true</div>
      </div>
      <div style={{flex: 1, borderRadius: 28, background: C.surface, boxShadow: `0 0 0 1px ${C.line}, 0 50px 90px -50px rgba(40,52,66,0.35)`, padding: '34px 40px'}}>
        <div style={{font: `400 ${tall ? 44 : 46}px/1.42 ${FONT.text}`, color: C.ink}}>
          <span style={{background: bg, borderRadius: 6, padding: '0 4px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone'}}>{s.text}</span>
          <sup style={{font: `700 26px ${FONT.disp}`, marginLeft: 6}}>{s.odds}%</sup>
        </div>
      </div>
    </div>
  );
  return (
    <Ground glow="50% 40%">
      <AbsoluteFill style={{justifyContent: 'center', padding: tall ? '0 60px 260px' : '0 120px 40px'}}>
        <div style={{position: 'relative', height: tall ? 1100 : 600}}>
          <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', ...enter(t, 0, 40), opacity: (1 - swap) * clamp01(ease(t, 0, 0.55) * 1.4)}}>{row('Plain', C.yes, plain, C.yesBg)}</div>
          <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', opacity: swap, transform: `translateY(${(1 - swap) * 30}px)`}}>{row('Honest', C.warn, disputed, C.warnBg)}</div>
        </div>
      </AbsoluteFill>
      {PENDING.has(shot.id) ? <Mark id={shot.id} /> : null}
    </Ground>
  );
};

const Mark: React.FC<{id: string}> = ({id}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div style={{position: 'absolute', inset: 14, border: '4px dashed #C9222B', borderRadius: 18}} />
    <span style={{position: 'absolute', left: 28, bottom: 28, background: '#C9222B', color: '#fff', font: "700 26px 'General Sans', sans-serif", padding: '8px 16px', borderRadius: 10}}>PLACEHOLDER · waiting for "page ready" ({id})</span>
  </AbsoluteFill>
);

// ----- beat 8: the end card (the v6 plate, 0 and 100 clear of the bezel) ----------------------------------------------------
const End: React.FC<P> = ({shot, t}) => {
  const tall = useTall();
  const fast = !!shot.fast;
  const lock = ease(t, 0.1, 0.5);
  const q = ease(t, fast ? 0.3 : 0.8, 0.5);
  const free = ease(t, fast ? 0.7 : 2.4, 0.45);
  const url = ease(t, fast ? 1.0 : 3.0, 0.5, EASE.spring);
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="end" set="v6" local={Math.min(t + 2.2, tall ? 3.6 : 7.9)} />
      <AbsoluteFill style={tall ? {alignItems: 'center', justifyContent: 'flex-end', padding: '0 60px 420px', textAlign: 'center'} : {left: 1060, width: 820, justifyContent: 'center', paddingBottom: 30}}>
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

const Hook: React.FC<P> = (p) => {
  const H = SHOTS5.v5hook;
  return <H {...p} />;
};

void useCut;
void wordStart;

export const SHOTS6: Record<string, React.FC<P>> = {
  v6hook: Hook,
  v6market: Market,
  v6evidence: Evidence,
  v6stamps: Stamps,
  v6won: Won,
  v6rule: Rule,
  v6payoff: Payoff,
  v6pages: Pages,
  v6end: End,
};
