// Loads the kit's self-hosted fonts (copied into public/brand/fonts) before any frame renders.
import {continueRender, delayRender, staticFile} from 'remotion';

type Face = {family: string; file: string; weight: string; style?: string; unicodeRange?: string};

const faces: Face[] = [
  {family: 'General Sans', file: 'GeneralSans-500.woff2', weight: '500'},
  {family: 'General Sans', file: 'GeneralSans-600.woff2', weight: '600'},
  {family: 'General Sans', file: 'GeneralSans-700.woff2', weight: '700'},
  // The tugrik (U+20AE) is missing from General Sans and Geist; the kit maps a one-glyph Inter subset.
  {family: 'General Sans', file: 'Inter-tugrik.woff2', weight: '500 700', unicodeRange: 'U+20AE'},
  {family: 'Geist', file: 'Geist-latin.woff2', weight: '100 900'},
  {
    family: 'Geist',
    file: 'Geist-latin-ext.woff2',
    weight: '100 900',
    unicodeRange: 'U+0100-02BA, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF',
  },
  {family: 'Geist', file: 'Inter-tugrik.woff2', weight: '100 900', unicodeRange: 'U+20AE'},
  {family: 'Geist Mono', file: 'GeistMono-latin.woff2', weight: '100 900'},
  {family: 'Amstelvar', file: 'amstelvar-roman.woff2', weight: '100 1000', style: 'normal'},
  {family: 'Amstelvar', file: 'amstelvar-italic.woff2', weight: '100 1000', style: 'italic'},
];

let started = false;

export const loadBrandFonts = () => {
  if (started || typeof document === 'undefined') return;
  started = true;
  const handle = delayRender('Loading Pulse fonts');
  Promise.all(
    faces.map((f) => {
      const face = new FontFace(f.family, `url(${staticFile(`brand/fonts/${f.file}`)}) format('woff2')`, {
        weight: f.weight,
        style: f.style ?? 'normal',
        unicodeRange: f.unicodeRange,
      });
      return face.load().then((loaded) => {
        (document.fonts as unknown as {add: (f: FontFace) => void}).add(loaded);
      });
    }),
  )
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error('Font load failed', err);
      continueRender(handle);
    });
};
