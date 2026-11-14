import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, DUR, EASE, FONT} from '../brand/tokens';
import {Lockup, SHADOW, Stage, lerp, prog, useT} from '../components/core';
import {LightDial, LiveDot, fade} from './AskIllia';

// "Illia asked for this": his sentence of 4 November 2026 (x.com/ilblackdragon/status/2118027843980366222),
// checked off clause by clause against what is live on NEAR mainnet. 32 s, square, made to be read muted.
// Every figure is read from mainnet or the hosted API on 14 November 2026:
//   claim 18, Wikipedia's Tether line: 7 trades, 10% before the ruling; challenge 0: three FALSE verdicts
//   (DeepSeek-V4.1-Flash-1017, Qwen3.8-27B, glm-5.3-flash), $4.93 paid to No (3KbCTq6s…)
//   claim 32, the corrected line: open at 47% (/api/claims/32); rewrite tether:45:v1 at 38%
//   /api/pages/tether totals: 16 rewrites, 16 signed, 16 anchored; 63 claims, 14 rulings, 40 verdicts (judge check 11)
//   market.isitpriced.near: no access key since 14 November (judge check 12)

const PAD = 84;
const INNER = 1080 - 2 * PAD;
// light theme, from the design skill's token table
const NO = '#C51D28';
const NO_FILL = '#CC272E';
const NO_BG = '#FFEEED';
const YES_BG = '#DFFAE5';

const S = {
  ask: [0, 5.4],
  fact: [5.4, 10.8],
  truth: [10.8, 17.2],
  perp: [17.2, 22.2],
  pages: [22.2, 27.2],
  end: [27.2, 32.0],
} as const;
const STEPS = [S.fact, S.truth, S.perp, S.pages];

const quote = (px: number, lh = 1.22): React.CSSProperties => ({
  font: `400 ${px}px/${lh} ${FONT.quote}`,
  fontVariationSettings: "'opsz' 18",
  letterSpacing: '-0.005em',
  color: C.ink,
});

const Tick: React.FC<{k: number; size: number}> = ({k, size}) => (
  <span
    style={{
      flex: 'none',
      width: size,
      height: size,
      borderRadius: '50%',
      background: C.yes,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: Math.min(1, Math.max(0, k) * 1.6),
      transform: `scale(${lerp(0.4, 1, k)})`,
    }}
  >
    <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56}>
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

const Card: React.FC<{style?: React.CSSProperties; children: React.ReactNode}> = ({style, children}) => (
  <div style={{background: C.surface, borderRadius: 28, boxShadow: `0 0 0 1px ${C.line}, ${SHADOW.card}`, ...style}}>{children}</div>
);

const Wiki: React.FC<{page: string}> = ({page}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        borderRadius: 999,
        background: C.surface2,
        boxShadow: `inset 0 0 0 1px ${C.lineStrong}`,
        ...quote(28, 1),
      }}
    >
      W
    </span>
    <span style={{font: `500 30px ${FONT.text}`, color: C.ink2}}>
      Wikipedia · <span style={{color: C.ink, fontWeight: 600}}>{page}</span>
    </span>
  </div>
);

/** The four steps as bars along the top, filling like a story: where we are in his sentence. */
const Bars: React.FC<{t: number}> = ({t}) => {
  const show = prog(t, S.fact[0] - 0.1, 0.4) * (1 - prog(t, S.end[0] - 0.2, 0.3));
  const gap = 14;
  const w = (INNER - 3 * gap) / 4;
  return (
    <div style={{position: 'absolute', left: PAD, top: 56, display: 'flex', gap, opacity: show}}>
      {STEPS.map(([a, b], i) => (
        <span key={i} style={{width: w, height: 8, borderRadius: 4, background: C.surface3, overflow: 'hidden'}}>
          <span style={{display: 'block', height: '100%', width: `${Math.max(0, Math.min(1, (t - a) / (b - a))) * 100}%`, background: C.ink, borderRadius: 4}} />
        </span>
      ))}
    </div>
  );
};

/** The clause of his sentence this scene answers, with the tick that lands when the proof has been shown. */
const Ask: React.FC<{n: number; px?: number; done: number; children: React.ReactNode}> = ({n, px = 62, done, children}) => (
  <div style={{position: 'absolute', left: PAD, width: INNER, top: 100}}>
    <div style={{display: 'flex', justifyContent: 'space-between', font: `500 30px ${FONT.text}`, color: C.ink3, fontFeatureSettings: "'tnum'"}}>
      <span>Illia asked for</span>
      <span>{n} of 4</span>
    </div>
    <div style={{marginTop: 14, display: 'flex', alignItems: 'center', gap: 24}}>
      <div style={{flex: 1, ...quote(px, 1.14), fontWeight: 500}}>{children}</div>
      <Tick k={done} size={72} />
    </div>
  </div>
);

const Caption: React.FC<{k: number; t?: number; children: React.ReactNode}> = ({k, t, children}) => (
  <div style={{position: 'absolute', left: PAD, width: INNER, bottom: 64, display: 'flex', alignItems: 'center', gap: 16, font: `500 34px ${FONT.text}`, color: C.ink2, ...fade(k, 14)}}>
    {t === undefined ? null : <LiveDot t={t} />}
    {children}
  </div>
);

// ───────────────────────────── 0 · the ask ─────────────────────────────
const ASK: {s: string; key?: boolean}[] = [
  {s: '“AI encyclopedia with prediction markets: instead of community curation, '},
  {s: 'every fact becomes a perpetual truth-seeking market', key: true},
  {s: ' (Augur-style). '},
  {s: 'The official pages are generated by AI based on the current market understanding.', key: true},
  {s: '”'},
];

const TheAsk: React.FC<{t: number}> = ({t}) => {
  const dim = prog(t, 1.5, 0.6, EASE.inOut);
  const built = prog(t, 3.5, 0.5, EASE.spring);
  const live = prog(t, 3.85, 0.5);
  return (
    <AbsoluteFill style={{padding: `96px ${PAD}px`}}>
      <div style={{font: `500 32px ${FONT.text}`, color: C.ink3}}>4 November 2026 · @ilblackdragon</div>
      <div style={{marginTop: 14, font: `700 84px/1 ${FONT.disp}`, letterSpacing: '-0.04em', color: C.ink}}>Illia asked for this.</div>
      <div style={{marginTop: 46, ...quote(53, 1.25)}}>
        {ASK.map((q, i) => (
          <span key={i} style={{opacity: q.key ? 1 : lerp(1, 0.36, dim)}}>
            {q.s}
          </span>
        ))}
      </div>
      <div style={{position: 'absolute', left: PAD, bottom: 122, font: `700 96px/1 ${FONT.disp}`, letterSpacing: '-0.045em', color: C.ink, opacity: Math.min(1, built * 1.5), transform: `scale(${lerp(0.9, 1, built)})`, transformOrigin: '0 100%'}}>
        We built it.
      </div>
      <Caption k={live} t={t}>
        Live on NEAR mainnet, in real USDC
      </Caption>
    </AbsoluteFill>
  );
};

// ───────────────────────────── 1 · every fact becomes a market ─────────────────────────────
const Bet: React.FC<{yes?: boolean; on: number; press?: number; children: React.ReactNode}> = ({yes, on, press = 0, children}) => {
  const idleBg = yes ? YES_BG : NO_BG;
  const fg = yes ? C.yes : NO;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 84,
        padding: '0 26px',
        borderRadius: 14,
        background: on > 0.5 ? (yes ? C.yes : NO_FILL) : idleBg,
        color: on > 0.5 ? '#fff' : fg,
        font: `600 31px ${FONT.disp}`,
        whiteSpace: 'nowrap',
        transform: `scale(${1 - 0.04 * press})`,
      }}
    >
      {children}
    </span>
  );
};

const Fact: React.FC<{t: number}> = ({t}) => {
  const card = prog(t, 0.3, 0.55);
  const mark = prog(t, 0.95, 0.5, EASE.inOut);
  const row = prog(t, 1.35, 0.5);
  const press = t > 2.0 && t < 2.22 ? 1 : 0;
  const on = t > 2.0 ? 1 : 0;
  const swing = prog(t, 2.1, DUR.needle, EASE.needle);
  const roll = prog(t, 2.1, 1.0);
  const ring = t > 2.45 ? Math.min(1, (t - 2.45) / 1.3) : 0;
  const took = prog(t, 3.0, 0.5);
  const cap = prog(t, 3.5, 0.5);
  const done = prog(t, 3.9, 0.45, EASE.spring);
  return (
    <AbsoluteFill>
      <Ask n={1} px={50} done={done}>
        <span style={{whiteSpace: 'nowrap'}}>“every fact becomes a … market”</span>
      </Ask>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 300, ...fade(card)}}>
        <Wiki page="Tether" />
        <Card style={{marginTop: 20, padding: '38px 44px'}}>
          <div style={quote(43, 1.24)}>
            “The majority of Tether’s reserves held in cash and cash equivalents are U.S. T-Bills, accounting for{' '}
            <span
              style={{
                whiteSpace: 'nowrap',
                fontWeight: 600,
                padding: '0 8px',
                margin: '0 -8px',
                borderRadius: 10,
                backgroundImage: `linear-gradient(${C.warnBg}, ${C.warnBg}), linear-gradient(${C.warnBg}, ${C.warnBg})`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${mark * 100}% 100%`,
              }}
            >
              $72.6 billion
            </span>
            .”
          </div>
        </Card>
      </div>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 652, display: 'flex', alignItems: 'center', gap: 44, ...fade(row)}}>
        <LightDial size={292} p={lerp(0.5, 0.1, swing)} from={50} to={10} roll={roll} ring={ring} />
        <div style={{flex: 1}}>
          <div style={{font: `600 46px/1.05 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink}}>chance it’s true</div>
          <div style={{marginTop: 22, display: 'flex', gap: 14}}>
            <Bet yes on={0}>
              Yes, it’s true
            </Bet>
            <Bet on={on} press={press}>
              No, it’s false
            </Bet>
          </div>
          <div style={{marginTop: 22, font: `500 31px ${FONT.text}`, color: C.ink2, ...fade(took, 12)}}>7 bets in real USDC took it to 10%</div>
        </div>
      </div>
      <Caption k={cap} t={t}>
        63 facts priced on NEAR mainnet so far
      </Caption>
    </AbsoluteFill>
  );
};

// ───────────────────────────── 2 · truth-seeking ─────────────────────────────
const JUDGES = ['DeepSeek-V4.1-Flash-1017', 'Qwen3.8-27B', 'glm-5.3-flash'];

const Truth: React.FC<{t: number}> = ({t}) => {
  const lead = prog(t, 0.3, 0.5);
  const ruled = prog(t, 3.75, 0.45, EASE.spring);
  const paid = prog(t, 4.3, 0.5);
  const count = prog(t, 4.3, 0.8, EASE.cubicOut);
  const done = prog(t, 5.0, 0.45, EASE.spring);
  const cap = prog(t, 5.2, 0.5);
  return (
    <AbsoluteFill>
      <Caption k={cap}>14 rulings settled this way on mainnet</Caption>
      <Ask n={2} done={done}>
        “truth-seeking”
      </Ask>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 298, font: `600 44px/1.1 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink, ...fade(lead)}}>
        A $1 bond sent it to three AI judges
      </div>
      {JUDGES.map((m, i) => {
        const rowIn = prog(t, 0.7 + i * 0.18, 0.5);
        const stamp = prog(t, 1.7 + i * 0.5, 0.32, EASE.spring);
        const ok = prog(t, 2.05 + i * 0.5, 0.35, EASE.spring);
        return (
          <Card key={m} style={{position: 'absolute', left: PAD, width: INNER, top: 376 + i * 128, height: 112, display: 'flex', alignItems: 'center', padding: '0 34px', boxSizing: 'border-box', ...fade(rowIn, 20)}}>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{font: `600 35px/1.1 ${FONT.text}`, color: C.ink}}>{m}</div>
              <div style={{marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, font: `500 25px ${FONT.text}`, color: C.ink3}}>
                Signed in a TEE on NEAR AI
                <span style={{display: 'inline-flex', alignItems: 'center', gap: 8, color: C.yes, opacity: Math.min(1, Math.max(0, ok) * 1.6)}}>
                  <Tick k={ok} size={26} />
                  checked by the contract
                </span>
              </div>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 62,
                padding: '0 24px',
                borderRadius: 12,
                background: NO_FILL,
                color: '#fff',
                font: `700 30px ${FONT.disp}`,
                letterSpacing: '0.03em',
                opacity: Math.min(1, Math.max(0, stamp) * 2),
                transform: `scale(${lerp(1.7, 1, stamp)}) rotate(${lerp(-7, 0, stamp)}deg)`,
              }}
            >
              FALSE
            </span>
          </Card>
        );
      })}
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 772, display: 'flex', alignItems: 'baseline', gap: 28}}>
        <div style={{font: `700 92px/1 ${FONT.disp}`, letterSpacing: '-0.045em', color: C.ink, opacity: Math.min(1, Math.max(0, ruled) * 1.6), transform: `scale(${lerp(0.86, 1, ruled)})`, transformOrigin: '0 100%', whiteSpace: 'nowrap'}}>
          Ruled <span style={{color: NO}}>false</span>.
        </div>
      </div>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 878, font: `600 46px/1.1 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink2, fontFeatureSettings: "'tnum'", ...fade(paid, 16)}}>
        <span style={{color: C.yes}}>${(4.93 * count).toFixed(2)}</span> paid to the No side, on-chain
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────────── 3 · perpetual ─────────────────────────────
const Perpetual: React.FC<{t: number}> = ({t}) => {
  const old = prog(t, 0.3, 0.5);
  const strike = prog(t, 0.95, 0.45, EASE.inOut);
  const neu = prog(t, 1.5, 0.55);
  const row = prog(t, 2.35, 0.5);
  const swing = prog(t, 2.6, DUR.needle, EASE.needle);
  const roll = prog(t, 2.6, 1.0);
  const ring = t > 2.95 ? Math.min(1, (t - 2.95) / 1.3) : 0;
  const done = prog(t, 3.75, 0.45, EASE.spring);
  return (
    <AbsoluteFill>
      <Ask n={3} done={done}>
        “perpetual”
      </Ask>
      <Card style={{position: 'absolute', left: PAD, width: INNER, top: 282, padding: '26px 40px', boxSizing: 'border-box', ...fade(old)}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: `500 27px ${FONT.text}`, color: C.ink3}}>
          <span>Wikipedia’s line</span>
          <span style={{display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 18px', borderRadius: 999, background: NO_BG, color: NO, fontWeight: 600, opacity: strike}}>Ruled false</span>
        </div>
        <div style={{marginTop: 12, ...quote(38, 1.24), color: C.ink2}}>
          “…are U.S. T-Bills, accounting for{' '}
          <span style={{position: 'relative', whiteSpace: 'nowrap', color: lerp(0, 1, strike) > 0.5 ? NO : C.ink2}}>
            $72.6 billion
            <span style={{position: 'absolute', left: -4, top: '54%', height: 4, borderRadius: 2, background: NO, width: `calc(${strike * 100}% + ${8 * strike}px)`}} />
          </span>
          .”
        </div>
      </Card>
      <Card style={{position: 'absolute', left: PAD, width: INNER, top: 506, padding: '26px 40px', boxSizing: 'border-box', ...fade(neu)}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: `500 27px ${FONT.text}`, color: C.ink3}}>
          <span>The corrected line</span>
          <span style={{display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 18px', borderRadius: 999, background: YES_BG, color: C.yes, fontWeight: 600}}>From Tether’s own report</span>
        </div>
        <div style={{marginTop: 12, ...quote(38, 1.24)}}>
          “…are U.S. T-Bills, which Tether’s attestation report, checked on 5 November 2026, puts at{' '}
          <span style={{whiteSpace: 'nowrap', fontWeight: 600, color: C.yes}}>$122.84 billion</span> at 30 September 2026.”
        </div>
      </Card>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 808, display: 'flex', alignItems: 'center', gap: 40, ...fade(row)}}>
        <LightDial size={200} p={lerp(0.5, 0.47, swing)} from={50} to={47} roll={roll} ring={ring} />
        <div style={{flex: 1}}>
          <div style={{font: `600 44px/1.08 ${FONT.disp}`, letterSpacing: '-0.03em', color: C.ink}}>The corrected line opened as a new market</div>
          <div style={{marginTop: 14, display: 'flex', alignItems: 'center', gap: 14, font: `500 30px ${FONT.text}`, color: C.ink2}}>
            <LiveDot t={t} />
            47% chance it’s true, open to bets now
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────────── 4 · the pages are written by AI from the market ─────────────────────────────
const PREFIX = 'Traders doubt that, ';

const Pages: React.FC<{t: number}> = ({t}) => {
  const card = prog(t, 0.3, 0.55);
  const price = prog(t, 1.0, 0.45, EASE.spring);
  const typed = Math.round(prog(t, 1.75, 0.8, (k) => k) * PREFIX.length);
  const swap = prog(t, 1.75, 0.3);
  const chips = [prog(t, 2.9, 0.4, EASE.spring), prog(t, 3.15, 0.4, EASE.spring), prog(t, 3.4, 0.4, EASE.spring)];
  const cap = prog(t, 3.6, 0.5);
  const done = prog(t, 3.95, 0.45, EASE.spring);
  return (
    <AbsoluteFill>
      <Ask n={4} px={41} done={done}>
        “The official pages are generated by AI based on the current market understanding.”
      </Ask>
      <Card style={{position: 'absolute', left: PAD, width: INNER, top: 352, padding: '34px 44px 40px', boxSizing: 'border-box', ...fade(card)}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
          <span style={{font: `700 46px/1 ${FONT.disp}`, letterSpacing: '-0.035em', color: C.ink}}>Tether</span>
          <span style={{position: 'relative', font: `500 27px ${FONT.text}`, color: C.ink3, textAlign: 'right'}}>
            <span style={{opacity: 1 - swap}}>Wikipedia says</span>
            <span style={{position: 'absolute', right: 0, top: 0, whiteSpace: 'nowrap', opacity: swap, color: C.ink2, fontWeight: 600}}>The market’s page says</span>
          </span>
        </div>
        <div style={{marginTop: 22, height: 1, background: C.line}} />
        <div style={{marginTop: 26, minHeight: 172, ...quote(46, 1.25)}}>
          <span style={{fontWeight: 600}}>{PREFIX.slice(0, typed)}</span>
          {typed > 0 ? 'if' : 'If'} Tether were a country, it would be the 18th largest holder of U.S. debt among nations.
        </div>
        <div style={{marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 14, height: 64, padding: '0 24px', borderRadius: 999, background: C.surface2, opacity: Math.min(1, Math.max(0, price) * 1.6), transform: `scale(${lerp(0.85, 1, price)})`, transformOrigin: '0 50%'}}>
          <span style={{font: `700 38px/1 ${FONT.disp}`, letterSpacing: '-0.04em', color: C.ink, fontFeatureSettings: "'tnum'"}}>
            38<i style={{fontStyle: 'normal', fontSize: '0.6em', marginLeft: 1}}>%</i>
          </span>
          <span style={{font: `500 28px ${FONT.text}`, color: C.ink2}}>chance it’s true, so the page says so</span>
        </div>
      </Card>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 836, display: 'flex', justifyContent: 'space-between'}}>
        {['Written by AI', 'Signed in a TEE', 'Anchored on NEAR'].map((label, i) => (
          <span key={label} style={{display: 'inline-flex', alignItems: 'center', gap: 12, font: `600 31px ${FONT.text}`, color: C.ink, opacity: Math.min(1, Math.max(0, chips[i]) * 1.6)}}>
            <Tick k={chips[i]} size={38} />
            {label}
          </span>
        ))}
      </div>
      <Caption k={cap}>16 rewrites signed and anchored on this page</Caption>
    </AbsoluteFill>
  );
};

// ───────────────────────────── 5 · his own post ─────────────────────────────
const OLD_HOST = 'x.com';
const NEW_HOST = 'isitpriced.com';

const End: React.FC<{t: number}> = ({t}) => {
  const bar = prog(t, 0.1, 0.45);
  const del = Math.round(prog(t, 0.65, 0.35, (k) => k) * OLD_HOST.length);
  const typ = Math.round(prog(t, 1.05, 0.75, (k) => k) * NEW_HOST.length);
  const host = typ > 0 ? NEW_HOST.slice(0, typ) : OLD_HOST.slice(0, OLD_HOST.length - del);
  const caret = t > 0.5 && t < 2.0 && Math.floor(t * 3.2) % 2 === 0;
  const h1 = prog(t, 0.3, 0.5);
  const h2 = prog(t, 1.75, 0.45);
  const stats = prog(t, 2.1, 0.45);
  const logo = prog(t, 2.3, 0.5);
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 150, ...fade(bar)}}>
        <div style={{display: 'flex', alignItems: 'center', height: 100, padding: '0 38px', borderRadius: 999, background: C.surface, boxShadow: `0 0 0 1px ${C.lineStrong}, ${SHADOW.card}`, font: `500 37px ${FONT.text}`, color: C.ink3, whiteSpace: 'nowrap', overflow: 'hidden'}}>
          <span style={{color: typ > 0 ? C.brandText : C.ink, fontWeight: 600}}>{host}</span>
          {t < 2.0 ? <span style={{width: 3, height: 44, margin: '0 2px', background: caret ? C.ink : 'transparent'}} /> : null}
          <span>/ilblackdragon/status/21180…</span>
        </div>
      </div>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 338, font: `700 104px/0.98 ${FONT.disp}`, letterSpacing: '-0.045em', color: C.ink, ...fade(h1, 26)}}>
        Illia, your post is priced too.
      </div>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 582, font: `500 42px/1.25 ${FONT.text}`, color: C.ink2, ...fade(h2, 18)}}>
        Change <b style={{color: C.ink, fontWeight: 600}}>x.com</b> to <b style={{color: C.ink, fontWeight: 600}}>isitpriced.com</b> on any post.
      </div>
      <div style={{position: 'absolute', left: PAD, width: INNER, top: 744, display: 'flex', gap: 14, ...fade(stats, 14)}}>
        {[
          ['14', 'rulings on mainnet'],
          ['40', 'signed verdicts'],
          ['0', 'keys that can change the code'],
        ].map(([n, label]) => (
          <div key={label} style={{flex: 1, padding: '22px 26px', borderRadius: 20, background: C.surface, boxShadow: `0 0 0 1px ${C.line}`}}>
            <div style={{font: `700 60px/1 ${FONT.disp}`, letterSpacing: '-0.04em', color: C.ink, fontFeatureSettings: "'tnum'"}}>{n}</div>
            <div style={{marginTop: 8, font: `500 25px/1.2 ${FONT.text}`, color: C.ink2}}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{position: 'absolute', left: PAD, bottom: 60, ...fade(logo, 12)}}>
        <Lockup height={62} sweep={prog(t, 2.3, 0.9, EASE.needle)} />
      </div>
      <div style={{position: 'absolute', right: PAD, bottom: 74, font: `600 36px ${FONT.disp}`, color: C.ink, ...fade(logo, 12)}}>isitpriced.com</div>
    </AbsoluteFill>
  );
};

export const IlliaAsked: React.FC = () => {
  const t = useT();
  const wrap = ([from, to]: readonly [number, number], edge?: 'first' | 'last'): React.CSSProperties | null => {
    if (t < from || t >= to) return null;
    const a = edge === 'first' ? 1 : prog(t, from, 0.42);
    const b = edge === 'last' ? 0 : prog(t, to - 0.3, 0.3, EASE.inOut);
    return {opacity: Math.min(1, a * 1.5) * (1 - b), transform: `translateY(${(1 - a) * 34 - b * 34}px)`};
  };
  const scenes: [readonly [number, number], React.FC<{t: number}>, ('first' | 'last')?][] = [
    [S.ask, TheAsk, 'first'],
    [S.fact, Fact],
    [S.truth, Truth],
    [S.perp, Perpetual],
    [S.pages, Pages],
    [S.end, End, 'last'],
  ];
  return (
    <Stage glowAt="50% 40%" push={0.015 * Math.min(1, t / 30)}>
      {/* a flat ground: the stage's soft glow bands in H.264 on a field this light */}
      <AbsoluteFill style={{background: C.bg}} />
      <Bars t={t} />
      {scenes.map(([range, Scene, edge], i) => {
        const style = wrap(range, edge);
        return style ? (
          <AbsoluteFill key={i} style={style}>
            <Scene t={t - range[0]} />
          </AbsoluteFill>
        ) : null;
      })}
    </Stage>
  );
};
