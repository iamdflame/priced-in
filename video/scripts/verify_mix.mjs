// Transcribes each final mix with ElevenLabs Scribe and checks that the voice says exactly the script's words,
// in order (cues from src/film/cuts.json). Numbers are compared as words; punctuation and case are ignored.
//   node scripts/verify_mix.mjs [main c15 v30]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.resolve(here, '../../.env'), 'utf8');
const KEY = (env.match(/^ELEVENLABS_API_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const cuts = JSON.parse(fs.readFileSync(path.resolve(here, '../src/film/cuts.json'), 'utf8'));

const NUM = {'$50': 'fifty billion dollars', '50%': 'fifty percent', '10%': 'ten', '4.5': 'four and a half', '17': 'seventeen', '10': 'ten',
  '$122.84': 'one hundred twenty-two point eight four', '$4.93': 'four dollars and ninety-three cents', 'isitpriced.com': 'is it priced dot com'};
const norm = (t) => {
  let s = ' ' + t.toLowerCase() + ' ';
  s = s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/\$122\.84 billion/g, ' one hundred twenty-two point eight four billion ');
  s = s.replace(/\$4\.93/g, ' four dollars and ninety-three cents ');
  s = s.replace(/\$50 billion/g, ' fifty billion dollars ');
  s = s.replace(/122\.84/g, ' one hundred twenty-two point eight four ');
  s = s.replace(/4\.93/g, ' four ninety-three ');
  s = s.replace(/50%/g, ' fifty percent ').replace(/10%/g, ' ten percent ');
  s = s.replace(/\b4\.5\b/g, ' four and a half ').replace(/\b17\b/g, ' seventeen ').replace(/\b10\b/g, ' ten ').replace(/\b50\b/g, ' fifty ');
  s = s.replace(/\$1\b/g, ' one dollar ').replace(/isitpriced\.com/g, ' is it priced dot com ').replace(/is it priced\.com/g, ' is it priced dot com ');
  s = s.replace(/near/g, 'near').replace(/twenty two/g, 'twenty-two').replace(/ninety three/g, 'ninety-three');
  return s.replace(/[^a-z0-9' -]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
};
void NUM;

// word-level diff (LCS)
function diff(a, b) {
  const n = a.length, m = b.length;
  const d = Array.from({length: n + 1}, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) d[i][j] = a[i] === b[j] ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (d[i + 1][j] >= d[i][j + 1]) out.push(`missing "${a[i++]}"`);
    else out.push(`extra "${b[j++]}"`);
  }
  while (i < n) out.push(`missing "${a[i++]}"`);
  while (j < m) out.push(`extra "${b[j++]}"`);
  return {same: d[0][0], total: n, out};
}

const only = process.argv.slice(2);
const report = {};
for (const k of only.length ? only : Object.keys(cuts)) {
  const file = path.resolve(here, `../public/audio/mix-${k}.wav`);
  const fd = new FormData();
  fd.append('model_id', 'scribe_v1');
  fd.append('file', new Blob([fs.readFileSync(file)], {type: 'audio/wav'}), `mix-${k}.wav`);
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {method: 'POST', headers: {'xi-api-key': KEY}, body: fd});
  const j = await r.json();
  if (!j.text) {
    console.log(k, 'ERR', JSON.stringify(j).slice(0, 200));
    continue;
  }
  const expected = norm(cuts[k].cues.map((c) => c.text).join(' '));
  const heard = norm(j.text);
  const d = diff(expected, heard);
  report[k] = {heard: j.text, match: `${d.same}/${d.total}`, differences: d.out};
  console.log(`${k}: ${d.same}/${d.total} words match; ${d.out.length ? d.out.join(', ') : 'no differences'}`);
}
fs.writeFileSync(path.resolve(here, '../../.apex/design/video/voice/mix-transcripts.json'), JSON.stringify(report, null, 1));
