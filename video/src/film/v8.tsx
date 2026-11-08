// v8: one composed element per shot, designed motion, real proof (.apex/prompts/V8-film-composed.md).
// Each beat isolates one real element, big and crisp: the Wikipedia sentence, Tether's figure (cut from the real
// attestation PDF at 4x), the market card and its dial, the receipt chip of the real free $1 (FGFhi1…BBvc6), the
// three signed verdicts, the figure "as of" Tether's report, the decided dial, and the corrected line with its source.
// Text never sits under a caption: the caption band (wide: y > 930; tall: 1380–1560) is kept empty, and no text zooms.
import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {C, EASE, FONT} from '../brand/tokens';
import {Lockup} from '../components/core';
import {Ground, Plate, Shot, clamp01, ease, mix, useTall} from './lib';

type P = {shot: Shot; t: number; T: number};
const big = (size: number, color: string = C.ink): React.CSSProperties => ({font: `700 ${size}px/1.04 ${FONT.disp}`, letterSpacing: '-0.035em', color});
const rise = (t: number, at: number, dy = 36, dur = 0.5) => {
  const k = ease(t, at, dur, EASE.out);
  return {opacity: clamp01(0.45 + k * 1.2), transform: `translateY(${(1 - k) * dy}px)`};
};
const card: React.CSSProperties = {background: C.surface, borderRadius: 30, boxShadow: `0 0 0 1px ${C.line}, 0 50px 100px -60px rgba(40,52,66,0.45)`};

const SENTENCE_A = '“The majority of Tether’s reserves held in cash and cash equivalents are U.S. T-Bills, accounting for ';
const HASH = 'FGFhi1W9mLtCvQ44SzDvpbKVCCPiDtkmMRpM15MBBvc6';

/** Tether's figure, cut from the real attestation PDF (page 4, rendered at 4x): the row label and its value, side by side. */
const PdfRow: React.FC<{scale: number; k: number}> = ({scale, k}) => {
  // page px boxes from public/v7/att.json: label 552–819 × 906–944, value 1715–1962 × 906–944
  const pad = 14;
  const lab = {x: 552 - pad, y: 906 - pad, w: 819 - 552 + 2 * pad, h: 944 - 906 + 2 * pad};
  const val = {x: 1715 - pad, y: 906 - pad, w: 1962 - 1715 + 2 * pad, h: 944 - 906 + 2 * pad};
  const crop = (b: typeof lab) => (
    <div style={{position: 'relative', width: b.w * scale, height: b.h * scale, overflow: 'hidden'}}>
      <Img src={staticFile('v7/att_p8.png')} style={{position: 'absolute', width: 2382 * scale, left: -b.x * scale, top: -b.y * scale, maxWidth: 'none'}} />
    </div>
  );
  return (
    <div style={{display: 'inline-flex', alignItems: 'center', gap: 40 * scale, padding: `${10 * scale}px ${26 * scale}px`, borderRadius: 16, background: '#fff', boxShadow: `0 0 0 1px ${C.line}`, position: 'relative'}}>
      <div style={{position: 'absolute', inset: 0, borderRadius: 16, background: 'rgba(0,161,81,0.12)', transformOrigin: '0 50%', transform: `scaleX(${clamp01(k)})`}} />
      {crop(lab)}
      {crop(val)}
    </div>
  );
};

// ----- beat 1: the sentence card, Tether's figure, "$50 billion out of date" (frame 1 already says it) -----------------
const Hook: React.FC<P> = ({shot, t}) => {
  const tall = useTall();
  const s = t + (shot.k?.t0 ?? 0);
  const tether = ease(s, 0.95, 0.45, EASE.out);
  const row = ease(s, 1.25, 0.5, EASE.inOut);
  const fifty = ease(s, 1.45, 0.3, EASE.spring);
  const W = tall ? 960 : 1560;
  return (
    <Ground glow="50% 40%">
      <AbsoluteFill style={{alignItems: 'center', padding: tall ? '190px 60px 0' : '150px 0 0'}}>
        <div style={{width: W}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 14, font: `600 ${tall ? 32 : 30}px ${FONT.text}`, color: C.ink3, marginBottom: 18}}>
            <span style={{font: `400 ${tall ? 38 : 36}px ${FONT.quote}`, color: C.ink}}>W</span>Wikipedia · Tether (cryptocurrency)
          </div>
          <div style={{...card, padding: tall ? '38px 42px' : '40px 54px'}}>
            <div style={{font: `400 ${tall ? 54 : 60}px/1.24 ${FONT.quote}`, fontVariationSettings: "'opsz' 60", color: C.ink}}>
              {SENTENCE_A}
              <span style={{background: C.warnBg, color: C.warn, borderRadius: 10, padding: '0 8px'}}>$72.6&nbsp;billion</span>.”
            </div>
          </div>
          <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 22, rowGap: 14, marginTop: tall ? 40 : 34, opacity: clamp01(tether * 1.5), transform: `translateY(${(1 - tether) * 24}px)`}}>
            <span style={{font: `600 ${tall ? 36 : 34}px ${FONT.text}`, color: C.ink2}}>Tether’s own report, 30 Sep 2026:</span>
            <span style={{...big(tall ? 76 : 72, C.yes), background: C.yesBg, borderRadius: 14, padding: '2px 16px 8px'}}>$122.84 billion</span>
            <div style={{flexBasis: tall ? '100%' : 'auto'}}>
              <PdfRow scale={tall ? 0.95 : 0.95} k={row} />
            </div>
          </div>
          <div style={{marginTop: tall ? 70 : 40, opacity: s >= 1.4 ? 1 : 0, transform: `translateY(${(1 - fifty) * 30}px)`}}>
            <span style={big(tall ? 136 : 132)}>$50 billion </span>
            {tall ? <br /> : null}
            <span style={big(tall ? 136 : 132, C.ink3)}>out of date.</span>
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beats 2–3: the market card: the dial and two buttons; the free $1 on No (no payouts, no chip) ----------------------
const Market: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const tap = shot.k?.tap ?? shot.at + 3;
  const pressed = T >= tap;
  const press = T >= tap && T < tap + 0.16 ? 0.96 : 1;
  const ripple = T >= tap && T < tap + 0.5 ? (T - tap) / 0.5 : 0;
  // the dial plate swings 6.26 s in, 0.15 s after the tap it was cut for: line the swing up with this tap
  const plateT = t + (6.11 - (tap - shot.at));
  const L = ease(t, -0.25, 0.5, EASE.out);
  const btn = (side: 'yes' | 'no') => {
    const no = side === 'no';
    const fill = no && pressed;
    return (
      <div style={{position: 'relative', flex: 1, height: tall ? 128 : 116, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: fill ? C.noFill : no ? C.noBg : C.yesBg, color: fill ? C.noInk : no ? C.no : C.yes, transform: `scale(${no ? press : 1})`, overflow: 'hidden', font: `600 ${tall ? 48 : 46}px ${FONT.disp}`, letterSpacing: '-0.02em'}}>
        {no ? 'No, it’s false' : 'Yes, it’s true'}
        {no && ripple > 0 ? <div style={{position: 'absolute', left: '55%', top: '50%', width: 110, height: 110, margin: '-55px 0 0 -55px', borderRadius: '50%', background: 'rgba(255,255,255,0.5)', opacity: 1 - ripple, transform: `scale(${1 + ripple * 4})`}} /> : null}
      </div>
    );
  };
  const q = (
    <div style={{opacity: clamp01(L * 1.5), transform: `translateY(${(1 - L) * 24}px)`}}>
      <div style={{height: tall ? 120 : 104, display: 'flex', justifyContent: tall ? 'center' : 'flex-start'}}>
        <Lockup height={tall ? 100 : 92} />
      </div>
      <div style={{...big(tall ? 66 : 64), marginTop: tall ? 22 : 26, textAlign: tall ? 'center' : 'left'}}>Are most of Tether’s cash reserves U.S. T-Bills, accounting for $72.6 billion?</div>
    </div>
  );
  if (tall) {
    const m = 'radial-gradient(ellipse 540px 600px at 539px 1014px, black 89%, transparent 100%)';
    return (
      <AbsoluteFill style={{background: C.bg}}>
        <Plate shot="market" local={plateT} set="v6" style={{transform: 'translate(0px, 70px) scale(0.6)', transformOrigin: '539px 1014px', WebkitMaskImage: m, maskImage: m}} />
        <AbsoluteFill style={{alignItems: 'center', padding: '120px 70px 0'}}>
          <div style={{width: 940}}>{q}</div>
        </AbsoluteFill>
        <div style={{position: 'absolute', left: 70, right: 70, top: 630, display: 'flex', gap: 18, ...rise(t, 0.3, 24)}}>
          {btn('yes')}
          {btn('no')}
        </div>
      </AbsoluteFill>
    );
  }
  const mk = 'linear-gradient(to bottom, transparent 0px, black 70px), radial-gradient(ellipse 620px 560px at 1380px 520px, black 86%, transparent 100%)';
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="market" local={plateT} set="v6" style={{transform: 'scale(0.84)', transformOrigin: '100% 47%', WebkitMaskImage: mk, maskImage: mk, WebkitMaskComposite: 'source-in', maskComposite: 'intersect'}} />
      <AbsoluteFill style={{justifyContent: 'center', padding: '0 0 120px 120px'}}>
        <div style={{width: 860}}>
          {q}
          <div style={{display: 'flex', gap: 18, marginTop: 44, ...rise(t, 0.3, 24)}}>
            {btn('yes')}
            {btn('no')}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- beat 3b: the receipt chip of the real free $1 ------------------------------------------------------------------
const Receipt: React.FC<P> = ({t}) => {
  const tall = useTall();
  const up = ease(t, -0.2, 0.5, EASE.spring);
  const chk = ease(t, 0.3, 0.4, EASE.out);
  const rev = clamp01((t - 0.55) / 0.9);
  const n = Math.round(rev * HASH.length);
  const blk = ease(t, 1.5, 0.4);
  const hashEl = (str: string) => (
    <span>
      <span style={{color: C.ink}}>{str.slice(0, Math.max(0, n))}</span>
      <span style={{color: 'rgba(17,22,30,0.12)'}}>{str.slice(Math.max(0, n))}</span>
    </span>
  );
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: tall ? '120px 40px 560px' : '0 0 150px'}}>
        <div style={{...card, width: tall ? 1000 : 1360, padding: tall ? '64px 50px' : '56px 70px', opacity: clamp01(up * 1.6), transform: `translateY(${(1 - up) * 80}px)`}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 22}}>
            <svg width={tall ? 74 : 70} height={tall ? 74 : 70} viewBox="0 0 70 70">
              <circle cx="35" cy="35" r="33" fill={C.yes} />
              <path d="M20 36 l10 10 l20 -22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset={60 * (1 - chk)} />
            </svg>
            <span style={big(tall ? 76 : 64, C.yes)}>Recorded on NEAR</span>
          </div>
          <div style={{font: `500 ${tall ? 40 : 34}px ${FONT.text}`, color: C.ink2, marginTop: 26}}>The free $1 on “No, it’s false”</div>
          <div style={{marginTop: 34, padding: tall ? '24px 28px' : '24px 32px', borderRadius: 18, background: C.surface2}}>
            <div style={{font: `600 ${tall ? 30 : 28}px ${FONT.text}`, color: C.ink3, marginBottom: 8}}>Transaction</div>
            <div style={{font: `500 ${tall ? 52 : 44}px/1.3 ${FONT.mono}`, letterSpacing: '-0.01em', wordBreak: 'break-all'}}>{tall ? <>{hashEl(HASH.slice(0, 22))}<br />{hashEl(' '.repeat(0) + HASH.slice(22))}</> : hashEl(HASH)}</div>
          </div>
          <div style={{display: 'flex', flexWrap: 'wrap', columnGap: 30, rowGap: 8, marginTop: 28, font: `500 ${tall ? 40 : 34}px ${FONT.text}`, color: C.ink2, opacity: blk}}>
            <span>Block 223,236,617</span>
            <span style={{color: C.ink3}}>·</span>
            <span>public on the NEAR blockchain</span>
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 4: three signed verdicts; each FALSE seal lands on its own spoken "False" ---------------------------------
const JUDGES = [
  {mono: 'DS', name: 'DeepSeek-V4.1-Flash', quote: 'The claim’s $72.6 billion figure is out of date; Tether’s 30 September 2026 attestation reports U.S. Treasury Bills at $122.84 billion.'},
  {mono: 'Qw', name: 'Qwen3.8-27B', quote: 'The figure of $72.6 billion is outdated; the current attestation report from September 30, 2026, lists U.S. Treasury Bills at approximately $122.84 billion.'},
  {mono: 'GL', name: 'glm-5.3-flash', quote: 'The $72.6 billion figure is outdated; Tether’s attestation reports $122.84 billion in U.S. Treasury Bills as of 30 September 2026.'},
];

/** The FALSE seal: a clean double ring and the word, upright, landing with weight. */
const Seal: React.FC<{t: number; size: number}> = ({t, size}) => {
  if (t < 0) return null;
  const k = ease(t, 0, 0.26, EASE.spring);
  const flash = clamp01(1 - t / 0.45);
  return (
    <div style={{width: size, height: size, transform: `scale(${mix(1.6, 1, k)})`, opacity: clamp01(t / 0.06), filter: `drop-shadow(0 18px 30px rgba(201,34,43,${0.25 + 0.3 * flash}))`}}>
      <svg width={size} height={size} viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="94" fill="#fff" stroke={C.no} strokeWidth="8" />
        <circle cx="100" cy="100" r="80" fill="none" stroke={C.no} strokeWidth="3" />
        {Array.from({length: 36}).map((_, i) => {
          const a = (i / 36) * Math.PI * 2;
          return <line key={i} x1={100 + Math.cos(a) * 84} y1={100 + Math.sin(a) * 84} x2={100 + Math.cos(a) * 89} y2={100 + Math.sin(a) * 89} stroke={C.no} strokeWidth="2.4" />;
        })}
        <text x="100" y="116" textAnchor="middle" style={{font: `700 42px ${FONT.disp}`, letterSpacing: '0.04em'}} fill={C.no}>FALSE</text>
      </svg>
    </div>
  );
};

/** The judges' own words, with "$122.84 billion" lit when the voice says they read Tether's report. */
const hl = (q: string, k: number) => {
  const i = q.indexOf('$122.84 billion');
  if (i < 0) return q;
  return (
    <>
      {q.slice(0, i)}
      <span style={{background: `rgba(0,161,81,${0.14 * k})`, color: k > 0.5 ? C.yes : undefined, borderRadius: 6, padding: '0 3px'}}>$122.84 billion</span>
      {q.slice(i + 15)}
    </>
  );
};

const Verdict: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const k = shot.k ?? {};
  const f = [k.f1 ?? shot.at + 2, k.f2 ?? shot.at + 3, k.f3 ?? shot.at + 5];
  const short = shot.dur < 5;
  const cloud = k.cloud ?? 0;
  const read = k.read ?? 0;
  const cardEl = (j: (typeof JUDGES)[number], i: number) => {
    const inK = ease(t, short ? -0.3 : -0.25 + i * 0.12, 0.5, EASE.out);
    const ft = T - f[i];
    const hit = ft >= 0;
    const quoteK = short ? 1 : ease(t, 0.15 + i * 0.25, 0.5);
    const lit = short ? 0 : ease(T, read - 0.1, 0.5);
    const cl = short ? 1 : ease(T, cloud - 0.1, 0.4);
    return (
      <div key={i} style={{...card, position: 'relative', flex: tall ? 'none' : 1, padding: tall ? '28px 34px 28px' : '34px 36px 100px', opacity: clamp01(inK * 1.5), transform: `translateY(${(1 - inK) * 40}px)`, boxShadow: hit ? `0 0 0 3px ${C.no}, 0 50px 100px -60px rgba(201,34,43,0.5)` : card.boxShadow}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
          <span style={{width: 60, height: 60, borderRadius: 16, background: C.surface2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: `700 26px ${FONT.disp}`, color: C.ink}}>{j.mono}</span>
          <div>
            <div style={{font: `700 ${tall ? 40 : 36}px ${FONT.disp}`, letterSpacing: '-0.02em', color: C.ink}}>{j.name}</div>
            <div style={{font: `500 28px ${FONT.text}`, color: C.ink3, opacity: mix(0.0, 1, cl)}}>on NEAR AI Cloud · sealed hardware</div>
          </div>
        </div>
        {short && !tall ? null : (
          <div style={{marginTop: tall ? 18 : 26, font: `400 ${tall ? 29 : 30}px/1.34 ${FONT.text}`, color: C.ink2, opacity: tall ? 1 : quoteK, paddingRight: tall ? 150 : 0}}>“{hl(j.quote, lit)}”</div>
        )}
        <div style={{position: tall ? 'relative' : 'absolute', left: tall ? 0 : 36, bottom: tall ? 0 : 38, marginTop: tall ? 14 : 0, display: 'flex', alignItems: 'center', gap: 10, font: `600 28px ${FONT.text}`, color: C.yes, opacity: hit ? clamp01(ft / 0.25) : 0}}>✓ Signature verified on NEAR</div>
        <div style={{position: 'absolute', right: tall ? 26 : 30, bottom: tall ? 24 : 96}}>
          <Seal t={ft} size={tall ? 140 : 150} />
        </div>
      </div>
    );
  };
  return (
    <Ground glow="50% 42%">
      {tall ? (
        <div style={{position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', justifyContent: 'center', ...rise(t, 0, 16)}}>
          <span style={{font: `600 40px ${FONT.text}`, color: C.ink}}>Three AI models on NEAR AI Cloud</span>
        </div>
      ) : null}
      <AbsoluteFill style={tall ? {padding: '230px 40px 0', gap: 22} : {flexDirection: 'row', alignItems: short ? 'center' : 'stretch', gap: 32, padding: short ? '0 90px 120px' : '190px 90px 230px'}}>
        {JUDGES.map(cardEl)}
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 5a: the figure, false as of Tether's latest report --------------------------------------------------------
const AsOf: React.FC<P> = ({shot, t, T}) => {
  const fig = shot.k?.fig ?? shot.at + 2;
  const fl = shot.k?.false ?? shot.at + 2.6;
  const strike = ease(T, fl - 0.05, 0.35, EASE.inOut);
  const tag = ease(T, fl + 0.1, 0.35, EASE.spring);
  const rep = ease(T, fig - 0.3, 0.45);
  return (
    <Ground glow="50% 42%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: '0 0 130px'}}>
        <div style={{font: `600 34px ${FONT.text}`, color: C.ink3, ...rise(t, 0, 16)}}>Wikipedia’s figure</div>
        <div style={{position: 'relative', marginTop: 10, ...rise(t, 0.05, 24)}}>
          <span style={big(220)}>$72.6 billion</span>
          <div style={{position: 'absolute', left: -10, right: -10, top: '54%', height: 14, borderRadius: 8, background: C.no, transformOrigin: '0 50%', transform: `scaleX(${strike})`}} />
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 26, marginTop: 34, height: 92}}>
          <span style={{display: 'inline-flex', alignItems: 'center', height: 84, padding: '0 32px', borderRadius: 999, background: C.no, color: '#fff', font: `700 44px ${FONT.disp}`, letterSpacing: '0.04em', opacity: clamp01(tag * 1.5), transform: `translateY(${(1 - tag) * 16}px)`}}>FALSE</span>
          <span style={{font: `600 44px ${FONT.text}`, color: C.ink, opacity: clamp01(tag * 1.5)}}>as of 30 Sep 2026</span>
        </div>
        <div style={{marginTop: 30, font: `500 38px ${FONT.text}`, color: C.ink2, opacity: rep}}>
          Tether’s latest report: <b style={{color: C.yes, font: `700 44px ${FONT.disp}`}}>$122.84 billion</b>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 5b: the decided dial: "Money sets the odds" at 12%, "Evidence decides" takes it to 0% --------------------
const Dial: React.FC<P> = ({shot, t, T}) => {
  const ev = shot.k?.ev ?? shot.at + 2.1;
  const plateT = t + (2.0 - (ev - shot.at));
  const a = ease(t, -0.25, 0.5);
  const b = ease(T, ev - 0.05, 0.4, EASE.out);
  const dec = ease(T, ev + 0.7, 0.45, EASE.out);
  const mk = 'linear-gradient(to bottom, transparent 0px, black 70px), radial-gradient(ellipse 620px 560px at 1380px 520px, black 86%, transparent 100%)';
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Plate shot="decided" local={plateT} set="v6" style={{transform: 'scale(0.84)', transformOrigin: '100% 47%', WebkitMaskImage: mk, maskImage: mk, WebkitMaskComposite: 'source-in', maskComposite: 'intersect'}} />
      <AbsoluteFill style={{justifyContent: 'center', padding: '0 0 120px 120px'}}>
        <div style={{width: 880}}>
          <div style={{...big(96), opacity: clamp01(a * 1.5), transform: `translateY(${(1 - a) * 24}px)`}}>Money sets the odds.</div>
          <div style={{...big(96), marginTop: 26, opacity: clamp01(b * 1.5), transform: `translateY(${(1 - b) * 24}px)`}}>Evidence decides.</div>
          <div style={{display: 'inline-flex', alignItems: 'center', gap: 14, marginTop: 50, height: 76, padding: '0 28px', borderRadius: 999, background: C.noBg, color: C.no, font: `600 36px ${FONT.text}`, opacity: clamp01(dec * 1.5), transform: `translateY(${(1 - dec) * 16}px)`}}>Decided false by three AI judges</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----- beat 6: two lines: Wikipedia's figure, struck; Priced In's line with its source ---------------------------------
const Payoff: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const ours = shot.k?.ours ?? shot.at + 3.5;
  const src = shot.k?.src ?? shot.at + 7;
  const strike = ease(T, ours - 0.1, 0.35, EASE.inOut);
  const two = ease(T, ours + 0.05, 0.5, EASE.out);
  const s = ease(T, src - 0.1, 0.4, EASE.spring);
  return (
    <Ground glow="50% 42%">
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', padding: tall ? '120px 50px 600px' : '0 0 130px'}}>
        <div style={{width: tall ? 980 : 1620}}>
          <div style={{...rise(t, 0, 20), transform: `translateY(${(1 - two) * (tall ? 200 : 150)}px)`}}>
            <div style={{font: `600 ${tall ? 34 : 32}px ${FONT.text}`, color: C.ink3, marginBottom: 10}}>Wikipedia, today</div>
            <div style={{font: `400 ${tall ? 76 : 70}px/1.18 ${FONT.quote}`, fontVariationSettings: "'opsz' 60", color: C.ink}}>
              “…U.S. T-Bills, accounting for{' '}
              <span style={{position: 'relative', display: 'inline-block', color: C.warn}}>
                $72.6 billion
                <span style={{position: 'absolute', left: -4, right: -4, top: '55%', height: 7, borderRadius: 4, background: C.no, transformOrigin: '0 50%', transform: `scaleX(${strike})`}} />
              </span>
              .”
            </div>
          </div>
          <div style={{marginTop: tall ? 90 : 70, opacity: clamp01(two * 1.5), transform: `translateY(${(1 - two) * 30}px)`}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 14, font: `600 ${tall ? 34 : 32}px ${FONT.text}`, color: C.ink3, marginBottom: 10}}>
              <span>Priced In’s page</span>
            </div>
            <div style={{font: `600 ${tall ? 74 : 66}px/1.14 ${FONT.disp}`, letterSpacing: '-0.025em', color: C.ink}}>
              “…puts at <span style={{color: C.yes, background: C.yesBg, borderRadius: 12, padding: '0 10px'}}>$122.84 billion</span> at 30 September 2026.”
            </div>
            <div style={{display: 'inline-flex', alignItems: 'center', gap: 12, marginTop: 28, height: 66, padding: '0 26px', borderRadius: 999, background: C.surface, boxShadow: `0 0 0 1px ${C.lineStrong}`, font: `600 ${tall ? 36 : 32}px ${FONT.text}`, color: C.ink2, opacity: clamp01(s * 1.5), transform: `translateY(${(1 - s) * 14}px)`}}>
              Source: Tether’s attestation, 30 Sep 2026
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 7: the end card, 4 s: the mark, the line, "Priced In · isitpriced.com" -----------------------------------------
const End: React.FC<P> = ({t}) => {
  const tall = useTall();
  const a = ease(t, -0.25, 0.45);
  const b = ease(t, 0.1, 0.45);
  const c = ease(t, 0.4, 0.45, EASE.spring);
  return (
    <Ground glow="50% 46%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: tall ? '0 50px 300px' : '0 0 60px'}}>
        <div style={{opacity: a, transform: `translateY(${(1 - a) * 14}px)`}}>
          <Lockup height={tall ? 130 : 140} />
        </div>
        <div style={{...big(tall ? 124 : 140), marginTop: 50, opacity: b, transform: `translateY(${(1 - b) * 14}px)`}}>
          {tall ? (
            <>
              Is it true?
              <br />
              Bet on it.
            </>
          ) : (
            'Is it true? Bet on it.'
          )}
        </div>
        <div style={{marginTop: 54, display: 'inline-flex', alignItems: 'center', height: tall ? 104 : 100, padding: '0 44px', borderRadius: 999, background: C.brand, color: C.ink, font: `600 ${tall ? 50 : 50}px ${FONT.disp}`, letterSpacing: '-0.02em', whiteSpace: 'nowrap', opacity: clamp01(c * 1.5), transform: `translateY(${(1 - c) * 16}px)`}}>
          Priced In · isitpriced.com
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

export const SHOTS8: Record<string, React.FC<P>> = {
  v8hook: Hook,
  v8market: Market,
  v8receipt: Receipt,
  v8verdict: Verdict,
  v8asof: AsOf,
  v8dial: Dial,
  v8payoff: Payoff,
  v8end: End,
};
