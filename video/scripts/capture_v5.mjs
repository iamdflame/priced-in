// v5: the product's own elements, captured flat at device scale 3 from the live site (light theme), so the film can
// show them big, flat and crisp instead of tilted whole-page screenshots. Output: public/site/v5/<name>.png and
// public/site/v5/elements.json (each element's CSS size). Retries each page on a network hiccup.
//   node scripts/capture_v5.mjs
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire('C:/Users/Dflame/Pictures/neary/.apex/design/tools/package.json');
const {chromium} = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../public/site/v5');
const BASE = process.env.BASE ?? 'https://isitpriced.com';
fs.mkdirSync(OUT, {recursive: true});
const browser = await chromium.launch();
const meta = {};

async function page(url, fn, view = {viewport: {width: 1440, height: 900}, deviceScaleFactor: 3, colorScheme: 'light'}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ctx = await browser.newContext(view);
    const p = await ctx.newPage();
    try {
      await p.goto(`${BASE}${url}`, {waitUntil: 'domcontentloaded', timeout: 60000});
      await p.waitForTimeout(3000);
      await fn(p);
      await ctx.close();
      return;
    } catch (e) {
      console.log('retry', url, attempt, String(e.message).slice(0, 120));
      await ctx.close();
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw new Error('gave up on ' + url);
}

// The smallest ancestor of a text that is at least minW x minH CSS px, screenshotted on its own.
async function shot(p, text, name, minW, minH, pad = 0) {
  const loc = p.getByText(text).first();
  await loc.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  const handle = await loc.evaluateHandle((el, [mw, mh]) => {
    let e = el;
    while (e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.width >= mw && r.height >= mh) break;
      e = e.parentElement;
    }
    return e;
  }, [minW, minH]);
  const el = handle.asElement();
  const box = await el.boundingBox();
  const clip = {x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2};
  await p.screenshot({path: path.join(OUT, `${name}.png`), clip});
  meta[name] = {w: Math.round(clip.width), h: Math.round(clip.height)};
  console.log('element', name, meta[name]);
}

await page('/c/18?film=1', async (p) => {
  await shot(p, /^Chance it’s true, after each bet$/, 'chart', 600, 180, 0);
  await shot(p, /^Are most of Tether.s cash reserves/, 'question', 600, 60, 0);
  await shot(p, /^The Checker challenged it/, 'challenge', 560, 40, 8);
  await shot(p, /^All three AI judges ruled it false/, 'judges', 560, 220, 8);
  await shot(p, /^What a newer source says$/, 'sources', 600, 80, 0);
  await shot(p, /^No won\.?$/, 'nowon', 200, 180, 0);
});
await page('/c/18?recorded=1&film=1', async (p) => {
  await shot(p, /^Are most of Tether.s cash reserves/, 'market', 600, 300, 0);
});
await page('/p/tether?film=1', async (p) => {
  await shot(p, /^Written by AI from what the market believes right now/, 'pagehead', 700, 60, 0);
  // the opening paragraphs: a sure line (81%), a doubted line (46%), each written to match
  await shot(p, /^It is disputed whether, as of July 2024/, 'doubt', 600, 120, 0);
  await shot(p, /^It is probably represented by its currency codes/, 'sure', 600, 120, 0);
});
await page('/?film=1', async (p) => {
  await shot(p, /^Will the Colts confirm trade talks/, 'news', 800, 300, 0);
  await shot(p, /^You vs the AIs$/, 'vsai', 300, 300, 0);
  await shot(p, /^Will the Ravens confirm they won.t trade/, 'news2', 400, 280, 0);
  await shot(p, /^Will the Knicks confirm a decision/, 'news3', 400, 280, 0);
  await shot(p, /^Will NC State hire Philip Rivers/, 'news4', 400, 280, 0);
});
// The free $1 on the phone, as crisp stills (a screencast is capped at CSS size): before, pressed, sending, the receipt
// as its numbers land. Each still is a full 3x phone screen with its time after the tap.
if (!process.env.SKIP_PHONE) await page('/c/18?recorded=1&film=1', async (p) => {
  const dir = path.join(OUT, 'phone');
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  const shots = [];
  const snap = async (tag) => {
    const t = (Date.now() - t0) / 1000;
    const file = `${String(shots.length).padStart(3, '0')}.png`;
    await p.screenshot({path: path.join(dir, file)});
    shots.push({file, t: +t.toFixed(3), tag});
  };
  let t0 = Date.now();
  await snap('idle');
  const no = p.getByRole('button', {name: /No, it’s false/}).first();
  await no.hover();
  t0 = Date.now();
  await no.click();
  await snap('picked');
  await p.getByTestId('confirm').click().catch(() => console.log('no confirm'));
  const end = Date.now() + 9000;
  while (Date.now() < end) await snap('run');
  meta.phone = shots;
}, {viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light'});
await browser.close();
fs.writeFileSync(path.join(OUT, 'elements.json'), JSON.stringify(meta, null, 1));
fs.writeFileSync(path.resolve(here, '../src/film/elements.json'), JSON.stringify(meta, null, 1));
console.log('done', Object.keys(meta).length);
