// Peter's voice-over, line by line, with character timings for the word-by-word type and the captions.
// Existing lines are skipped, so re-running costs nothing. The key comes from ../.env and is never printed.
//   node scripts/gen_vo.mjs [id ...] [--force]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envText = fs.readFileSync(path.resolve(here, '../../.env'), 'utf8');
const KEY = (envText.match(/^ELEVENLABS_API_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!KEY) throw new Error('ELEVENLABS_API_KEY is missing');
const VOICE = 'ZthjuvLPty3kTMaNKVKb'; // Peter, the account's "Jackson"
const MODEL = 'eleven_v4';
const OUT = path.resolve(here, '../public/voice');
fs.mkdirSync(OUT, {recursive: true});

// speed is a time-stretch applied after generation (scripts/mix.mjs): eleven_v4 ignores the API's speed setting.
// The hook runs fastest so "fifty billion dollars" lands inside 3 s.
export const LINES = [
  // the main film (SCRIPT.md v4)
  {id: 'L01', text: 'This Wikipedia line is fifty billion dollars out of date.', speed: 1.15},
  {id: 'L02', text: 'So now it’s a bet. Is it true?', speed: 1.0},
  {id: 'L03', text: 'Bet your free dollar on No. The NEAR blockchain records it, in public, in four and a half seconds.', speed: 1.14},
  {id: 'L04', text: 'People and AI traders bet on every line. Seven bets took this one from fifty percent to ten.', speed: 1.12},
  {id: 'L05', text: 'The AI traders read the sources, and say why.', speed: 1.1},
  {id: 'L06', text: 'But who decides? Our checking bot challenged the line, and staked a dollar that it’s wrong.', speed: 1.14},
  {id: 'L07a', text: 'Three AI judges, on hardware nobody can tamper with, read the evidence.', speed: 1.1},
  {id: 'L07b', text: 'False.', speed: 1.0, prev: 'Three AI judges read the evidence.', next: 'False. False.'},
  {id: 'L07c', text: 'False.', speed: 1.0, prev: 'Three AI judges read the evidence. False.', next: 'False.'},
  {id: 'L07d', text: 'False.', speed: 0.96, prev: 'Three AI judges read the evidence. False. False.', next: 'All three in under seventeen seconds.'},
  {id: 'L07e', text: 'All three in under seventeen seconds. And NEAR checked every signature.', speed: 1.12},
  {id: 'L08', text: 'Then anyone had ten minutes to object. Nobody did.', speed: 1.1},
  {id: 'L09', text: 'So the page fixed itself. One hundred twenty-two point eight four billion, with the source beside it.', speed: 1.13},
  {id: 'L10', text: 'Wrong bets lose. Four dollars and ninety-three cents went to everyone who bet No.', speed: 1.11},
  {id: 'L11', text: 'The corrected sentence opened as a new market.', speed: 1.1},
  {id: 'L12', text: 'A prediction market for every checkable fact. Seven have already been ruled on NEAR.', speed: 1.12},
  {id: 'L14', text: 'Is it true? Bet on it. Your first dollar is free, at is it priced dot com.', speed: 0.98},
  // the 15 s cut
  {id: 'C2', text: 'Bet a free dollar that it’s wrong.', speed: 1.12},
  {id: 'C3', text: 'Three AI judges ruled it false.', speed: 1.1},
  {id: 'C4', text: 'NEAR checked every signature.', speed: 1.1},
  {id: 'C5', text: 'Winners got paid.', speed: 1.08},
  {id: 'C6', text: 'Your first dollar’s free, at is it priced dot com.', speed: 1.08},
  // the vertical cut
  {id: 'V2c', text: 'Tap No with your free dollar.', speed: 1.1},
  {id: 'V2b', text: 'The NEAR blockchain records it in four and a half seconds.', speed: 1.08},
  {id: 'V3b', text: 'Seven bets took it from fifty percent to ten.', speed: 1.1},
  {id: 'V4', text: 'Then three AI judges read the evidence.', speed: 1.04},
  {id: 'V5', text: 'The page fixed itself, and everyone who bet No got paid.', speed: 1.06},
];

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
let spent = 0;
for (const l of LINES) {
  if (only.length && !only.includes(l.id)) continue;
  const mp3 = path.join(OUT, `${l.id}.mp3`);
  if (fs.existsSync(mp3) && !force) continue;
  const body = {
    text: l.text,
    model_id: MODEL,
    voice_settings: {stability: 0.5, similarity_boost: 0.8},
    ...(l.prev ? {previous_text: l.prev} : {}),
    ...(l.next ? {next_text: l.next} : {}),
  };
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {'xi-api-key': KEY, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.log('ERR', l.id, r.status, (await r.text()).slice(0, 300));
    continue;
  }
  const j = await r.json();
  fs.writeFileSync(mp3, Buffer.from(j.audio_base64, 'base64'));
  const a = j.normalized_alignment || j.alignment;
  // words with start and end, from the character timings
  const words = [];
  let cur = null;
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = {w: '', s: a.character_start_times_seconds[i], e: 0};
    cur.w += c;
    cur.e = a.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);
  fs.writeFileSync(path.join(OUT, `${l.id}.json`), JSON.stringify({id: l.id, text: l.text, speed: l.speed, words}, null, 0));
  spent += l.text.length;
  const end = words.length ? words[words.length - 1].e : 0;
  console.log('ok', l.id, l.text.length, 'chars', end.toFixed(2) + 's');
}
console.log('characters this run', spent);
fs.appendFileSync(path.join(OUT, 'spent.log'), `${new Date().toISOString()} ${spent}\n`);
