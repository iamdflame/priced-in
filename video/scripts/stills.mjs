// Renders review stills of each piece at film timing, both formats, into out/stills/.
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../src/index.ts');
const outDir = process.env.OUT ?? path.resolve(here, '../out/stills');
fs.mkdirSync(outDir, {recursive: true});
// id:frame pairs, e.g. "HookType-16x9:90 DialSwing-16x9:120"
const jobs = (process.argv.slice(2).length ? process.argv.slice(2) : ['HookType-16x9:92']).map((s) => {
  const [id, f, name] = s.split(':');
  return {id, frame: Number(f), name};
});
const serveUrl = await bundle({entryPoint: entry, publicDir: path.resolve(here, '../public')});
for (const j of jobs) {
  const composition = await selectComposition({serveUrl, id: j.id});
  const output = path.join(outDir, `${j.name ?? `${j.id}-${j.frame}`}.png`);
  await renderStill({composition, serveUrl, output, frame: j.frame, imageFormat: 'png'});
  console.log('wrote', output);
}
