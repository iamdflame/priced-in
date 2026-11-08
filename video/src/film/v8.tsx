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
import phonebet from '../../public/v7/phonebet-phone.json';

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
  const W = tall ? 960 : 1640;
  return (
    <Ground glow="50% 40%">
      <AbsoluteFill style={{alignItems: 'center', padding: tall ? '200px 60px 0' : '96px 0 0'}}>
        <div style={{width: W}}>
          <div style={{...big(tall ? 96 : 84), marginBottom: tall ? 44 : 34}}>
            This Wikipedia line is
            <br />
            <span style={{color: C.no}}>$50&nbsp;billion</span> out&nbsp;of&nbsp;date.
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 14, font: `600 ${tall ? 32 : 30}px ${FONT.text}`, color: C.ink3, marginBottom: 14}}>
            <span style={{font: `400 ${tall ? 38 : 36}px ${FONT.quote}`, color: C.ink}}>W</span>Wikipedia · Tether (cryptocurrency)
          </div>
          <div style={{...card, padding: tall ? '38px 42px' : '40px 54px'}}>
            <div style={{font: `400 ${tall ? 58 : 66}px/1.24 ${FONT.quote}`, fontVariationSettings: "'opsz' 60", color: C.ink}}>
              {SENTENCE_A}
              <span style={{background: C.warnBg, color: C.warn, borderRadius: 10, padding: '0 8px'}}>$72.6&nbsp;billion</span>.”
            </div>
          </div>
          <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 22, rowGap: 14, marginTop: tall ? 40 : 34, opacity: clamp01(tether * 1.5), transform: `translateY(${(1 - tether) * 24}px)`}}>
            <span style={{font: `600 ${tall ? 40 : 38}px ${FONT.text}`, color: C.ink2}}>Tether’s own report, 30 Sep 2026:</span>
            <span style={{...big(tall ? 88 : 86, C.yes), background: C.yesBg, borderRadius: 14, padding: '2px 16px 8px'}}>$122.84 billion</span>
            <div style={{flexBasis: tall ? '100%' : 'auto'}}>
              <PdfRow scale={tall ? 1.15 : 1.2} k={row} />
            </div>
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
      <div style={{...big(tall ? 66 : 64), marginTop: tall ? 22 : 26, textAlign: tall ? 'center' : 'left'}}>Are most of Tether’s cash reserves U.S. T-Bills, accounting for <span style={{background: C.warnBg, color: C.warn, borderRadius: 12, padding: '0 10px'}}>$72.6&nbsp;billion</span>?</div>
      <div style={{display: 'flex', justifyContent: tall ? 'center' : 'flex-start', marginTop: 18}}>
        <span style={{display: 'inline-flex', alignItems: 'center', gap: 10, height: 56, padding: '0 22px', borderRadius: 999, background: C.warnBg, color: C.warn, font: `600 ${tall ? 32 : 30}px ${FONT.text}`}}>↑ The figure is what’s in doubt</span>
      </div>
    </div>
  );
  if (tall) {
    const m = 'radial-gradient(ellipse 540px 600px at 539px 1014px, black 89%, transparent 100%)';
    return (
      <AbsoluteFill style={{background: C.bg}}>
        <Plate shot="market" local={plateT} set="v6" style={{transform: 'translate(0px, 110px) scale(0.56)', transformOrigin: '539px 1014px', WebkitMaskImage: m, maskImage: m}} />
        <AbsoluteFill style={{alignItems: 'center', padding: '120px 70px 0'}}>
          <div style={{width: 940}}>{q}</div>
        </AbsoluteFill>
        <div style={{position: 'absolute', left: 70, right: 70, top: 690, display: 'flex', gap: 18, ...rise(t, 0.3, 24)}}>
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
// The judges' words, verbatim from isitpriced.com/rulings (market 18).
const JUDGES = [
  {name: 'DeepSeek-V4.1-Flash', line: '…so the stated amount is incorrect.'},
  {name: 'Qwen3.8-27B', line: '…lists U.S. Treasury Bills at approximately $122.84 billion.'},
  {name: 'glm-5.3-flash', line: '…Tether’s attestation reports $122.84 billion in U.S. Treasury Bills…'},
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
    // the cards arrive one by one as the voice brings in "three independent AI models"
    const inK = short ? ease(t, -0.3, 0.4, EASE.out) : ease(T, shot.at + 0.15 + i * 0.55, 0.45, EASE.out);
    const ft = T - f[i];
    const hit = ft >= 0;
    // each card lifts a little as it arrives and again when its seal lands
    const lift = Math.max(Math.sin(Math.PI * clamp01((T - (shot.at + 0.15 + i * 0.55)) / 0.7)) * (short ? 0 : 1), Math.sin(Math.PI * clamp01(ft / 0.5)) * (hit ? 1 : 0));
    return (
      <div key={i} style={{...card, position: 'relative', display: 'flex', flexDirection: 'column', flex: tall ? 'none' : 1, padding: tall ? '30px 36px' : '38px 40px 34px', opacity: clamp01(inK * 1.6), transform: `translateY(${(1 - inK) * 60 - lift * 16}px) scale(${1 + lift * 0.015})`, boxShadow: hit ? `0 0 0 3px ${C.no}, 0 50px 100px -60px rgba(201,34,43,0.5)` : card.boxShadow}}>
        <div style={{font: `700 ${tall ? 44 : 42}px ${FONT.disp}`, letterSpacing: '-0.025em', color: C.ink}}>{j.name}</div>
        {short && !tall ? null : (
          <div style={{marginTop: tall ? 12 : 20, font: `500 ${tall ? 40 : 46}px/1.2 ${FONT.text}`, letterSpacing: '-0.015em', color: C.ink, paddingRight: tall ? 200 : 0}}>“{j.line}”</div>
        )}
        <div style={{marginTop: tall ? 12 : 20, font: `600 28px/1.25 ${FONT.text}`, color: C.yes, opacity: hit ? clamp01(ft / 0.25) : 0}}>✓ Signed in sealed hardware · verified on NEAR</div>
        <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: tall ? -110 : 'auto', paddingTop: tall ? 0 : 12}}>
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4}}>
            <div style={{height: tall ? 120 : 130}}>
              <Seal t={ft} size={tall ? 120 : 130} />
            </div>
            <div style={{font: `600 28px ${FONT.text}`, color: C.no, opacity: hit ? clamp01((ft - 0.1) / 0.25) : 0, whiteSpace: 'nowrap'}}>as of 30 Sep 2026</div>
          </div>
        </div>
      </div>
    );
  };
  return (
    <Ground glow="50% 42%">
      <div style={{position: 'absolute', left: tall ? 50 : 90, right: tall ? 50 : 360, top: tall ? 150 : 128, ...rise(t, -0.2, 16)}}>
        <div style={{font: `600 ${tall ? 40 : 40}px ${FONT.text}`, color: C.ink}}>Three independent AI models <span style={{color: C.ink3}}>· on NEAR AI Cloud</span></div>
      </div>
      <AbsoluteFill style={tall ? {padding: '240px 40px 0', gap: 20} : {flexDirection: 'row', alignItems: 'stretch', gap: 32, padding: short ? '260px 90px 280px' : '230px 90px 280px'}}>
        {JUDGES.map(cardEl)}
      </AbsoluteFill>
    </Ground>
  );
};

// ----- beat 4b: the win closes the money loop: No won, paid in USDC on NEAR (the real settle transaction) ---------------
const SETTLE = '3KbCTq6sRK8RtSvhwTzbAmGGiUveqasWCfSGTuTk8K1v';
const Paid: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const no = shot.k?.no ?? shot.at + 1.5;
  const up = ease(t, -0.2, 0.5, EASE.spring);
  const won = ease(T, no - 0.1, 0.35, EASE.spring);
  const chk = ease(t, 0.15, 0.4);
  const rev = clamp01((t - 0.5) / 0.8);
  const n = Math.round(rev * SETTLE.length);
  const hashEl = (str: string, from: number) => (
    <span>
      <span style={{color: C.ink}}>{str.slice(0, Math.max(0, n - from))}</span>
      <span style={{color: 'rgba(17,22,30,0.12)'}}>{str.slice(Math.max(0, n - from))}</span>
    </span>
  );
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: tall ? '120px 40px 560px' : '0 0 150px'}}>
        <div style={{...card, width: tall ? 1000 : 1360, padding: tall ? '60px 50px' : '56px 70px', opacity: clamp01(up * 1.6), transform: `translateY(${(1 - up) * 80}px)`, boxShadow: `0 0 0 3px ${C.yes}, 0 50px 100px -60px rgba(0,123,61,0.45)`}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
            <svg width={tall ? 96 : 92} height={tall ? 96 : 92} viewBox="0 0 70 70">
              <circle cx="35" cy="35" r="33" fill={C.yes} />
              <path d="M20 36 l10 10 l20 -22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset={60 * (1 - chk)} />
            </svg>
            <span style={{...big(tall ? 120 : 120, C.yes), transform: `scale(${mix(1.12, 1, won)})`, transformOrigin: '0 50%', display: 'inline-block'}}>No won</span>
          </div>
          <div style={{font: `600 ${tall ? 50 : 54}px ${FONT.disp}`, letterSpacing: '-0.02em', color: C.ink, marginTop: 22}}>$4.93 paid to No, in USDC on NEAR</div>
          <div style={{font: `500 ${tall ? 40 : 40}px ${FONT.text}`, color: C.ink2, marginTop: 12}}>Ruled and paid in 20 minutes</div>
          <div style={{marginTop: 32, padding: tall ? '24px 28px' : '24px 32px', borderRadius: 18, background: 'rgba(0,161,81,0.08)'}}>
            <div style={{display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 22}}>
              <span style={{font: `500 ${tall ? 52 : 48}px/1.3 ${FONT.mono}`, color: C.ink}}>3KbCTq…8K1v</span>
              <span style={{font: `500 ${tall ? 34 : 32}px ${FONT.text}`, color: C.ink3}}>on the public NEAR explorer</span>
            </div>
          </div>
        </div>
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
          <div style={{display: 'inline-flex', alignItems: 'center', gap: 14, marginTop: 50, padding: '14px 30px', borderRadius: 28, background: C.noBg, color: C.no, font: `600 36px/1.25 ${FONT.text}`, opacity: clamp01(dec * 1.5), transform: `translateY(${(1 - dec) * 16}px)`}}>Decided false from Tether’s report,<br />by three AI judges</div>
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
  const win = ease(t, -0.25, 0.55, EASE.out);
  const W = tall ? 1000 : 1560;
  return (
    <Ground glow="50% 42%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: tall ? '100px 40px 560px' : '0 0 140px'}}>
        {/* the page, at home: a browser window on isitpriced.com/p/tether */}
        <div style={{width: W, borderRadius: 26, overflow: 'hidden', background: C.surface, boxShadow: `0 0 0 1px ${C.lineStrong}, 0 60px 120px -60px rgba(40,52,66,0.5)`, opacity: clamp01(0.4 + win), transform: `translateY(${(1 - win) * 40}px)`}}>
          <div style={{height: tall ? 84 : 78, display: 'flex', alignItems: 'center', gap: 18, padding: '0 26px', background: C.surface2, borderBottom: `1px solid ${C.line}`}}>
            <div style={{display: 'flex', gap: 10}}>
              {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <span key={c} style={{width: 16, height: 16, borderRadius: 9, background: c}} />)}
            </div>
            <div style={{flex: 1, height: tall ? 52 : 48, borderRadius: 12, background: C.surface, boxShadow: `0 0 0 1px ${C.line}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', font: `500 ${tall ? 32 : 30}px ${FONT.text}`, color: C.ink2}}>
              <span style={{fontSize: '0.8em'}}>🔒</span> isitpriced.com/p/tether
            </div>
          </div>
          <div style={{padding: tall ? '44px 48px 52px' : '48px 70px 56px'}}>
            <div style={{...big(tall ? 78 : 84)}}>The page fixes itself.</div>
            <div style={{marginTop: tall ? 40 : 40, display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap'}}>
              <span style={{font: `600 ${tall ? 32 : 32}px ${FONT.text}`, color: C.ink3, width: tall ? '100%' : 250, flex: 'none'}}>Wikipedia</span>
              <span style={{font: `400 ${tall ? 56 : 60}px/1.15 ${FONT.quote}`, fontVariationSettings: "'opsz' 60", color: C.ink}}>
                “…T-Bills, accounting for{' '}
                <span style={{position: 'relative', display: 'inline-block', color: C.warn}}>
                  $72.6 billion
                  <span style={{position: 'absolute', left: -4, right: -4, top: '55%', height: 7, borderRadius: 4, background: C.no, transformOrigin: '0 50%', transform: `scaleX(${strike})`}} />
                </span>
                .”
              </span>
            </div>
            <div style={{marginTop: tall ? 34 : 30, display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap', opacity: clamp01(two * 1.5), transform: `translateY(${(1 - two) * 24}px)`}}>
              <span style={{font: `600 ${tall ? 32 : 32}px ${FONT.text}`, color: C.ink3, width: tall ? '100%' : 250, flex: 'none'}}>Priced In</span>
              <span style={{font: `600 ${tall ? 54 : 58}px/1.15 ${FONT.disp}`, letterSpacing: '-0.025em', color: C.ink}}>
                “…<span style={{color: C.yes, background: C.yesBg, borderRadius: 12, padding: '0 10px'}}>$122.84 billion</span> at 30 September 2026.”
              </span>
            </div>
            <div style={{marginTop: 26, marginLeft: tall ? 0 : 272, display: 'inline-flex', alignItems: 'center', height: 62, padding: '0 24px', borderRadius: 999, background: C.surface, boxShadow: `0 0 0 1px ${C.lineStrong}`, font: `600 30px ${FONT.text}`, color: C.ink2, opacity: clamp01(s * 1.5), transform: `translateY(${(1 - s) * 14}px)`}}>
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


// ===== v8.2: the live product inside a device ===============================================================================
type Rec82 = {frames: number; marks: Record<string, {t: number; box?: {x: number; y: number; w: number; h: number}}>; steps: number[]};
const PB = phonebet as unknown as Rec82;
const pbFrame = (n: number) => staticFile(`v7/phonebet-phone/${String(Math.max(1, Math.min(PB.frames, n))).padStart(4, '0')}.jpg`);
const lerpMap = (map: [number, number][], T: number) => {
  if (T <= map[0][0]) return map[0][1];
  for (let i = 0; i < map.length - 1; i++) {
    const [a, b] = [map[i], map[i + 1]];
    if (T <= b[0]) return a[1] + ((T - a[0]) / Math.max(1e-6, b[0] - a[0])) * (b[1] - a[1]);
  }
  const l = map[map.length - 1];
  return l[1] + (T - l[0]);
};

/** A phone: the real page's frames at device scale 3 in a clean graphite body. Nothing is drawn over the screen. */
const PhoneBody: React.FC<{h: number; src: string}> = ({h, src}) => {
  const bez = Math.round(h * 0.022);
  const sh = h - bez * 2;
  const sw = (sh * 390) / 844;
  const r = Math.round(h * 0.075);
  return (
    <div style={{position: 'relative', width: sw + bez * 2, height: h, borderRadius: r, background: 'linear-gradient(145deg, #2A3038, #11161E 60%)', boxShadow: '0 0 0 2px #3A424C, 0 60px 120px -50px rgba(17,22,30,0.55), 0 30px 60px -30px rgba(17,22,30,0.35)'}}>
      <div style={{position: 'absolute', left: bez, top: bez, width: sw, height: sh, borderRadius: r - bez, overflow: 'hidden', background: '#fff'}}>
        <Img src={src} style={{width: sw, height: sh, display: 'block'}} />
      </div>
    </div>
  );
};

const Phone82: React.FC<P> = ({shot, t, T}) => {
  const tall = useTall();
  const tap = shot.k?.tap ?? shot.at + 3.5;
  const fast = !!shot.k?.fast;
  const m = PB.marks;
  const s1 = m.step1.t;
  const s5 = m.step5.t;
  const map: [number, number][] = fast
    ? [[shot.at, s1 - 0.1], [tap - 0.35, s5 + 0.6], [tap - 0.05, m.tapNo.t + 0.05], [tap + 0.05, m.tapNo.t + 0.32]]
    : [[shot.at, 0.2], [shot.at + 0.35, s1 - 0.05], [tap - 0.6, s5 + 0.75], [tap - 0.05, m.tapNo.t + 0.05], [tap + 0.05, m.tapNo.t + 0.32], [tap + 0.55, m.confirm.t], [tap + 0.62, m.receipt.t - 0.25], [tap + 1.1, m.receipt.t + 0.3]];
  const rec = lerpMap(map, T);
  const fr = 1 + Math.floor(rec * 30);
  // which real price the page shows now (the steps were set at the marks)
  let step = 0;
  for (let i = 1; i <= 5; i++) if (rec >= m['step' + i].t) step = i;
  const pct = Math.round(PB.steps[step] * 100);
  const tapped = rec >= m.tapNo.t;
  const receipt = rec >= m.receipt.t;
  const push = mix(1, 1.04, clamp01(t / Math.max(1, shot.dur)));
  // on the receipt the camera moves into the phone, anchored on the receipt card, so the card fills the screen
  const zr = fast ? 0 : ease(T, tap + 0.6, 0.6, EASE.inOut);
  const fade = 'linear-gradient(to bottom, black calc(100% - 70px), transparent 100%)';
  if (tall) {
    return (
      <Ground glow="50% 40%">
        <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 1620, overflow: 'hidden', WebkitMaskImage: fade, maskImage: fade}}>
          <AbsoluteFill style={{alignItems: 'center', paddingTop: 80}}>
            <div style={{transform: `translateY(${mix(0, 190, zr)}px) scale(${push * mix(1, 1.75, zr)})`, transformOrigin: '50% 0%'}}>
              <PhoneBody h={1240} src={pbFrame(fr)} />
            </div>
          </AbsoluteFill>
        </div>
      </Ground>
    );
  }
  const side = (on: boolean, children: React.ReactNode, key: string) => (
    <div key={key} style={{position: 'absolute', left: 0, right: 0, top: 0, opacity: on ? 1 : 0, transform: `translateY(${on ? 0 : 20}px)`, transition: 'none'}}>{children}</div>
  );
  return (
    <Ground glow="40% 45%">
      <div style={{position: 'absolute', left: 0, top: 0, width: 1020, height: 905, overflow: 'hidden', WebkitMaskImage: fade, maskImage: fade}}>
        <div style={{position: 'absolute', left: 330, top: 50, transform: `translateX(${mix(0, -40, zr)}px) scale(${push * mix(1, 2.1, zr)})`, transformOrigin: '50% 0%'}}>
          <PhoneBody h={820} src={pbFrame(fr)} />
        </div>
      </div>
      <div style={{position: 'absolute', left: mix(860, 1040, zr), top: 250, width: 860, height: 520}}>
        {side(!tapped, (
          <>
            <div style={{font: `600 36px ${FONT.text}`, color: C.ink3}}>{step >= 5 ? 'The market before your bet' : 'The market, bet by bet'}</div>
            <div style={{...big(150), marginTop: 10}}>{pct}%</div>
            <div style={{font: `600 40px ${FONT.text}`, color: C.ink2, marginTop: 6}}>chance it’s true · {step === 0 ? 'opening price' : `after ${step} bet${step > 1 ? 's' : ''}`}</div>
            <div style={{font: `500 34px ${FONT.text}`, color: C.ink3, marginTop: 28}}>{step >= 5 ? 'The money is already moving to the truth.' : '\u00a0'}</div>
          </>
        ), 'a')}
        {side(tapped && !receipt, (
          <>
            <div style={{font: `600 36px ${FONT.text}`, color: C.ink3}}>Your free $1</div>
            <div style={{...big(120, C.no), marginTop: 10}}>No, it’s false</div>
          </>
        ), 'b')}
        {side(receipt, (
          <>
            <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
              <svg width="64" height="64" viewBox="0 0 70 70"><circle cx="35" cy="35" r="33" fill={C.yes} /><path d="M20 36 l10 10 l20 -22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span style={big(56, C.yes)}>Recorded on NEAR in 4.5 s</span>
            </div>
            <div style={{font: `600 34px ${FONT.text}`, color: C.ink3, marginTop: 30}}>Transaction</div>
            <div style={{font: `500 64px ${FONT.mono}`, color: C.ink, marginTop: 4}}>FGFhi1…BBvc6</div>
            <div style={{font: `500 36px ${FONT.text}`, color: C.ink2, marginTop: 16}}>23% → 12% chance it’s true</div>
          </>
        ), 'c')}
      </div>
    </Ground>
  );
};

/** One second on the public explorer: the hash and "Success", nothing else. */
const Ex82: React.FC<P> = ({t}) => {
  const tall = useTall();
  // CSS-px boxes on the Pikespeak page (public/v7/explorer.json): hash 434–822 × 201–221, Success 455–503 × 232–248
  const z = tall ? 2.35 : 3.1;
  const crop = {x: 425, y: 192, w: 410, h: 64};
  const k = ease(t, -0.2, 0.4);
  return (
    <Ground glow="50% 45%">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', padding: tall ? '0 0 560px' : '0 0 150px'}}>
        <div style={{font: `600 ${tall ? 36 : 34}px ${FONT.text}`, color: C.ink3, marginBottom: 22, ...rise(t, -0.2, 12)}}>pikespeak.ai · the public NEAR explorer</div>
        <div style={{...card, padding: 26, opacity: clamp01(0.5 + k), transform: `translateY(${(1 - k) * 24}px)`}}>
          <div style={{position: 'relative', width: crop.w * z, height: crop.h * z, overflow: 'hidden'}}>
            <Img src={staticFile('v7/explorer/view.png')} style={{position: 'absolute', width: 1600 * z, left: -crop.x * z, top: -crop.y * z, maxWidth: 'none'}} />
          </div>
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
  v8paid: Paid,
  v82phone: Phone82,
  v82ex: Ex82,
  v8dial: Dial,
  v8payoff: Payoff,
  v8end: End,
};
