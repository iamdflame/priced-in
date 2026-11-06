// Copies the latest site shots (stand-ins for the footage recorded in stage 2) into public/footage/.
// public/footage/ is git-ignored: these are heavy, regenerated media.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const round = process.env.SITE_SHOTS ?? path.join(root, '.apex/design/site/round-2');
const out = path.resolve(here, '..', 'public/footage');
fs.mkdirSync(out, {recursive: true});

const map = {
  'dark-c18-localhost-3100-c-18__desktop__full.png': 'dark-c18__desktop__full.png',
  'dark-c18-localhost-3100-c-18__desktop.png': 'dark-c18__desktop.png',
  'dark-c18-localhost-3100-c-18__phone.png': 'dark-c18__phone.png',
  'dark-c32-localhost-3100-c-32__desktop.png': 'dark-c32__desktop.png',
  'dark-home-localhost-3100__desktop.png': 'dark-home__desktop.png',
  'dark-home-localhost-3100__desktop__full.png': 'dark-home__desktop__full.png',
  'dark-home-localhost-3100__phone.png': 'dark-home__phone.png',
  'dark-receipt__desktop.png': 'dark-receipt__desktop.png',
  'dark-receipt__phone.png': 'dark-receipt__phone.png',
  'dark-replay-localhost-3100-c-18__desktop.png': 'dark-replay-c18__desktop.png',
  'dark-replay-localhost-3100-c-18__desktop__full.png': 'dark-replay-c18__desktop__full.png',
};
let n = 0;
for (const [from, to] of Object.entries(map)) {
  const src = path.join(round, from);
  if (!fs.existsSync(src)) {
    console.warn('missing', src);
    continue;
  }
  fs.copyFileSync(src, path.join(out, to));
  n++;
}
console.log(`synced ${n} shots from ${round} to ${out}`);
