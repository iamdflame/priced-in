import React from 'react';
import {AbsoluteFill, Img} from 'remotion';
import {C, DUR, EASE, FONT, needleAngle} from '../brand/tokens';
import {Lockup, PrimaryButton, Stage, lerp, prog, useT} from '../components/core';
import {Odometer} from '../components/Dial';
// The light theme's ceramic face, the site's own render (the video's public/brand/dial.webp is the graphite one).
// @ts-ignore: webpack serves the file; there is no module declaration for images
import ceramic from '../../../site/public/art/light/dial.webp';

// Wikipedia, "NEAR (blockchain platform)", revision 1374559820, quoted verbatim.
// Top of the page: "It was founded in 2018 by Illia Polosukhin and Alexander Skidanov, with mainnet launching in 2020."
// History section: "NEAR Protocol was founded in early 2017 by Illia Polosukhin and Alexander Skidanov."
// The market on the first sentence is isitpriced.com/c/29; `pct` is its live price, re-rendered when it moves.

const W = 1080;
const PAD = 84;
const QUOTE_PX = 58;

type Seg = {text: string; date?: boolean; br?: boolean};

// Each quote breaks after "founded in" so both dates start a line at the same left edge: the eye compares them.
const TOP: Seg[] = [
  {text: 'It was founded in', br: true},
  {text: '2018', date: true},
  {text: ' by Illia Polosukhin and Alexander Skidanov, with mainnet launching in 2020.'},
];
const HISTORY: Seg[] = [
  {text: 'NEAR Protocol was founded in', br: true},
  {text: 'early 2017', date: true},
  {text: ' by Illia Polosukhin and Alexander Skidanov.'},
];

/** The dial in the light theme, as the site draws it (site/app/styles/instruments.css, light block): the ceramic
 * render, the kit's needle geometry in --needle with a contact shadow, the aluminium hub, an ink read-out. */
const NEEDLE = 'oklch(.57 .14 216)';
const LightDial: React.FC<{size: number; p: number; from: number; to: number; roll: number; ring: number}> = ({size, p, from, to, roll, ring}) => {
  const u = size / 100;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        boxShadow:
          '0 1px 2px oklch(.25 .02 255 / .12), 0 10px 22px -10px oklch(.25 .04 255 / .3), 0 30px 50px -28px oklch(.25 .05 255 / .32)',
      }}
    >
      <Img src={ceramic} style={{width: size, height: size, display: 'block', borderRadius: '50%'}} />
      <span style={{position: 'absolute', left: '22%', bottom: '24%', font: `500 ${3.6 * u}px ${FONT.text}`, color: C.ink3}}>0</span>
      <span style={{position: 'absolute', right: '20%', bottom: '24%', font: `500 ${3.6 * u}px ${FONT.text}`, color: C.ink3}}>100</span>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '8.4%',
          height: '40.5%',
          marginLeft: '-4.2%',
          marginTop: '-40.5%',
          transformOrigin: '50% 100%',
          transform: `rotate(${needleAngle(p)}deg)`,
          filter: 'drop-shadow(0 1px 1px oklch(.25 .05 230 / .4)) drop-shadow(0 4px 5px oklch(.25 .05 230 / .2))',
        }}
      >
        <svg viewBox="0 0 20 100" preserveAspectRatio="none" width="100%" height="100%" style={{display: 'block'}}>
          <path d="M10 0C10.9 0 11.5.6 11.7 1.5L16 100H4L8.3 1.5C8.5.6 9.1 0 10 0Z" fill={NEEDLE} />
        </svg>
      </div>
      {ring > 0 && ring < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '12%',
            height: '12%',
            margin: '-6% 0 0 -6%',
            borderRadius: '50%',
            border: `${Math.max(2, 0.5 * u)}px solid ${NEEDLE}`,
            opacity: 0.9 * (1 - ring),
            transform: `scale(${1 + 8 * ring})`,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '12%',
          height: '12%',
          margin: '-6% 0 0 -6%',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 36% 30%, oklch(1 0 0), oklch(.9 .004 255) 46%, oklch(.7 .01 255))',
          boxShadow: '0 2px 5px oklch(.25 .03 255 / .35), 0 0 0 .5px oklch(.3 .02 255 / .25), inset 0 1px 0 oklch(1 0 0)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '34%',
            borderRadius: '50%',
            background: NEEDLE,
            boxShadow: '0 0 0 1px oklch(1 0 0 / .6), 0 0 6px oklch(.57 .14 216 / .55)',
          }}
        />
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: '60%', display: 'flex', justifyContent: 'center'}}>
        <Odometer from={from} to={to} k={roll} size={25 * u} color={C.ink} />
      </div>
    </div>
  );
};

const fade = (k: number, dy = 24): React.CSSProperties => ({opacity: Math.min(1, k * 1.4), transform: `translateY(${(1 - k) * dy}px)`});

/** One quoted Wikipedia sentence (Amstelvar, quotes only), its date marked in the "Wikipedia may be wrong" amber. */
const Quote: React.FC<{segs: Seg[]; mark: number; dim: number}> = ({segs, mark, dim}) => (
  <div
    style={{
      position: 'relative',
      font: `400 ${QUOTE_PX}px/1.2 ${FONT.quote}`,
      fontVariationSettings: "'opsz' 18",
      color: C.ink,
      letterSpacing: '-0.005em',
    }}
  >
    {/* hanging opening quote, so the dates sit flush on the left edge */}
    <span style={{position: 'absolute', right: '100%', top: 0, opacity: lerp(1, 0.32, dim)}}>“</span>
    {segs.map((s, i) => (
      <React.Fragment key={i}>
        {s.date ? (
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
              color: C.ink,
            }}
          >
            {s.text}
          </span>
        ) : (
          <span style={{opacity: lerp(1, 0.32, dim)}}>{s.text}</span>
        )}
        {s.br ? <br /> : null}
      </React.Fragment>
    ))}
    <span style={{opacity: lerp(1, 0.32, dim)}}>”</span>
  </div>
);

const Where: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div style={{font: `600 34px ${FONT.text}`, color: C.ink3, marginBottom: 14}}>{children}</div>
);

/** The live dot: a cyan ping (2.2 s), the one decorative cyan the kit allows besides the needle. */
const LiveDot: React.FC<{t: number}> = ({t}) => {
  const k = (t % 2.2) / 2.2;
  return (
    <span style={{position: 'relative', width: 16, height: 16, flex: 'none'}}>
      <span style={{position: 'absolute', inset: 0, borderRadius: '50%', background: C.markCyan}} />
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `3px solid ${C.markCyan}`,
          opacity: 0.9 * (1 - k),
          transform: `scale(${1 + 1.6 * k})`,
        }}
      />
    </span>
  );
};

/** Ask Illia: Wikipedia gives two founding dates for NEAR; Priced In prices the first; the question to its co-founder. */
export const AskIllia: React.FC<{pct?: number}> = ({pct = 66}) => {
  const t = useT();
  const P = Math.max(0, Math.min(100, Math.round(pct)));

  // 0 to 3 s: the source, the top-of-page sentence, "2018" marked
  const src = prog(t, 0.05, 0.5);
  const qa = prog(t, 0.2, 0.6);
  const markA = prog(t, 1.05, 0.5, EASE.inOut);
  // 3 to 6 s: the History sentence, "early 2017" marked, everything but the dates steps back
  const qb = prog(t, 3.0, 0.6);
  const markB = prog(t, 3.75, 0.5, EASE.inOut);
  const dim = prog(t, 4.55, 0.5, EASE.inOut);
  const outQ = prog(t, 5.85, 0.4, EASE.inOut);
  // 6 to 9 s: the dial
  const dialIn = prog(t, 6.0, 0.5, EASE.out);
  const swing = prog(t, 6.2, DUR.needle, EASE.needle);
  const roll = prog(t, 6.2, 1.0, EASE.out);
  const ring = t > 6.55 ? Math.min(1, (t - 6.55) / 1.3) : 0;
  const lab = prog(t, 6.55, 0.5);
  const live = prog(t, 6.9, 0.5);
  const outD = prog(t, 8.85, 0.25, EASE.inOut);
  // 9 to 10 s: the end card
  const e1 = prog(t, 9.0, 0.35);
  const e2 = prog(t, 9.12, 0.4, EASE.spring);
  const e3 = prog(t, 9.2, 0.35);

  const dialSize = 600;

  return (
    <Stage glowAt="50% 44%" push={0.02 * Math.min(1, t / 10)}>
      {/* the two sentences */}
      {t < 6.3 ? (
        <AbsoluteFill
          style={{
            padding: `${PAD + 40}px ${PAD}px`,
            opacity: 1 - outQ,
            transform: `translateY(${-outQ * 40}px)`,
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 16, ...fade(src, 12)}}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 52,
                height: 52,
                borderRadius: 999,
                background: C.surface2,
                boxShadow: `inset 0 0 0 1px ${C.lineStrong}`,
                font: `400 34px ${FONT.quote}`,
                fontVariationSettings: "'opsz' 18",
                color: C.ink,
              }}
            >
              W
            </span>
            <span style={{font: `500 34px ${FONT.text}`, color: C.ink2}}>
              Wikipedia · <span style={{color: C.ink, fontWeight: 600}}>NEAR (blockchain platform)</span>
            </span>
          </div>

          <div style={{marginTop: 62, paddingLeft: 26, width: W - 2 * PAD - 26, ...fade(qa)}}>
            <Where>Top of the page</Where>
            <Quote segs={TOP} mark={markA} dim={dim} />
          </div>

          <div style={{marginTop: 58, paddingLeft: 26, width: W - 2 * PAD - 26, ...fade(qb)}}>
            <Where>History section</Where>
            <Quote segs={HISTORY} mark={markB} dim={dim} />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* the market: the dial swings to the real price */}
      {t >= 5.95 && t < 9.15 ? (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingTop: 140,
            opacity: Math.min(1, dialIn * 1.3) * (1 - outD),
            transform: `scale(${lerp(0.9, 1, dialIn) * lerp(1, 0.96, outD)})`,
          }}
        >
          <LightDial size={dialSize} p={lerp(0.5, P / 100, swing)} from={50} to={P} roll={roll} ring={ring} />
          <div
            style={{
              marginTop: 46,
              font: `600 60px/1.05 ${FONT.disp}`,
              letterSpacing: '-0.03em',
              color: C.ink,
              ...fade(lab, 18),
            }}
          >
            chance “2018” is true
          </div>
          <div
            style={{
              marginTop: 26,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              font: `500 36px ${FONT.text}`,
              color: C.ink2,
              ...fade(live, 14),
            }}
          >
            <LiveDot t={t} />
            Live market on NEAR mainnet
          </div>
        </AbsoluteFill>
      ) : null}

      {/* the end card */}
      {t >= 8.95 ? (
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column'}}>
          <div
            style={{
              font: `700 112px/1 ${FONT.disp}`,
              letterSpacing: '-0.04em',
              color: C.ink,
              textAlign: 'center',
              ...fade(e1, 26),
            }}
          >
            Illia, which is it?
          </div>
          <div style={{marginTop: 64, opacity: Math.min(1, e2 * 1.4), transform: `scale(${lerp(0.88, 1, e2)})`}}>
            <PrimaryButton size={2.1}>isitpriced.com/c/29</PrimaryButton>
          </div>
          <div style={{position: 'absolute', bottom: 84, ...fade(e3, 12)}}>
            <Lockup height={64} />
          </div>
        </AbsoluteFill>
      ) : null}
    </Stage>
  );
};
