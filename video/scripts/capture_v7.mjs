// v7: real recordings of the real artifacts and the live product, for .apex/prompts/V7-film-real.md.
//   node scripts/capture_v7.mjs wiki | nearblocks | replay | home | rulings | c18 | ptether
// Each task writes a frame sequence (or stills) to public/v7/<task>/ and the boxes the film needs to
// public/v7/<task>.json. Artifacts (Wikipedia, NearBlocks) are scrolled frame by frame at device scale 2;
// the product is recorded live through the Chrome DevTools screencast, real clicks included, at device scale 2.
// The brief forbids payout/odds lines, bet or dollar counts on screen, so those few elements are hidden with
// CSS at capture time (listed in HIDE below); nothing else on the page is touched.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire('C:/Users/Dflame/Pictures/neary/.apex/design/tools/package.json');
const {chromium} = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../public/v7');
const BASE = process.env.BASE ?? 'https://isitpriced.com';
const FPS = 30;
const task = process.argv[2];
const PHONE = process.env.PHONE === '1';
const SUF = PHONE ? '-phone' : '';
const VP = PHONE ? {width: 390, height: 844} : {width: 1600, height: 900};
const DSF = PHONE ? 3 : 2;

const HIDE = `
  .ticket .seg button small, .ticket .towin, .ticket .decide, .ticket .howto li:nth-child(3),
  .rc .lines .kv:not(:has(.hashv)) { display: none !important; }
  .ticker { display: none !important; }
  [data-pi-hide] { visibility: hidden !important; }
`;
// text-matched elements to hide: dollar and bet counts (the live strip of bets, .ticker, goes too)
const HIDE_TEXT = [/bet so far/, /^Live · real money/, /\d+ bets?$/, /paid out/];

const dir = (n) => {
  const d = path.join(OUT, n + SUF);
  fs.mkdirSync(d, {recursive: true});
  return d;
};
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

async function open(page, url) {
  for (let i = 1; i <= 5; i++) {
    try {
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
      return;
    } catch (e) {
      console.log('retry', i, String(e.message).slice(0, 100));
      await page.waitForTimeout(5000);
    }
  }
  throw new Error('could not open ' + url);
}

async function tidy(page) {
  await page.addStyleTag({content: HIDE});
  await page.evaluate((pats) => {
    const res = pats.map((p) => new RegExp(p));
    const all = [...document.querySelectorAll('body *')];
    for (const e of all) {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 90) continue;
      if (res.some((r) => r.test(t)) && ![...e.children].some((c) => res.some((r) => r.test((c.textContent || '').trim())))) e.setAttribute('data-pi-hide', '1');
    }
  }, HIDE_TEXT.map((r) => r.source));
}

/** Live recording: the DevTools screencast, resampled to a constant 30 fps by timestamp. */
async function record(page, name, script) {
  const d = dir(name);
  for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({t: f.metadata.timestamp, data: f.data});
    try {
      await cdp.send('Page.screencastFrameAck', {sessionId: f.sessionId});
    } catch {}
  });
  const vp = page.viewportSize();
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92, maxWidth: vp.width * DSF, maxHeight: vp.height * DSF, everyNthFrame: 1});
  const t0 = Date.now() / 1000;
  const marks = {};
  const mark = (k, extra = {}) => (marks[k] = {t: Date.now() / 1000 - t0, ...extra});
  await script(mark);
  await cdp.send('Page.stopScreencast');
  // resample
  const start = t0;
  const end = Date.now() / 1000;
  const n = Math.floor((end - start) * FPS);
  let j = 0;
  let written = 0;
  for (let k = 0; k < n; k++) {
    const t = start + k / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    if (!frames.length) break;
    fs.writeFileSync(path.join(d, String(k + 1).padStart(4, '0') + '.jpg'), Buffer.from(frames[j].data, 'base64'));
    written++;
  }
  console.log(name, 'source frames', frames.length, 'written', written, 'seconds', (end - start).toFixed(2));
  return {frames: written, marks, scale: DSF, viewport: vp};
}

const browser = await chromium.launch();
const {devices} = require('playwright');
const ctx = await browser.newContext({...(PHONE ? devices['iPhone 14'] : {}), viewport: VP, deviceScaleFactor: DSF, colorScheme: 'light', locale: 'en-US'});
const page = await ctx.newPage();
let meta = {};

if (task === 'wiki') {
  // en.wikipedia.org, the Tether article: a real scroll from the top to the $72.6 billion sentence
  await open(page, `https://${PHONE ? 'en.m' : 'en'}.wikipedia.org/wiki/Tether_(cryptocurrency)`);
  await page.waitForTimeout(3000);
  await page.addStyleTag({content: '#centralNotice, #siteNotice, .cn-fundraising, .frb { display: none !important; } .collapsible-block, section.mf-section-hidden, .mf-section-hidden { display: block !important; }'});
  if (PHONE) {
    // mobile Wikipedia folds its sections: open them all, as a reader would by tapping the headings
    await page.evaluate(() => document.querySelectorAll('.mf-collapsible-toggle[aria-expanded="false"]').forEach((h) => h.click()));
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(500);
  const target = await page.evaluate(() => {
    const want = 'accounting for $72.6 billion';
    const walker = document.createTreeWalker(document.querySelector('#mw-content-text'), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.data.indexOf(want);
      if (i < 0) continue;
      // the whole sentence: from "The majority" to "billion."
      const s = node.data.lastIndexOf('The majority', i);
      const range = document.createRange();
      range.setStart(node, Math.max(0, s));
      range.setEnd(node, i + want.length + 1);
      const span = document.createElement('span');
      span.id = 'pi-sentence';
      range.surroundContents(span);
      const r = span.getBoundingClientRect();
      return {top: r.top + scrollY, text: span.textContent, rev: document.querySelector('#footer-info-lastmod')?.textContent?.trim()};
    }
    return null;
  });
  if (!target) throw new Error('sentence not found on the live Wikipedia page');
  console.log(target);
  const d = dir('wiki');
  for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  const yEnd = Math.max(0, target.top - VP.height * 0.42);
  const N = 66;
  for (let k = 0; k < N; k++) {
    const y = Math.round(yEnd * ease(Math.min(1, k / (N - 6))));
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(k === 0 ? 400 : 60);
    await page.screenshot({path: path.join(d, String(k + 1).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 92});
  }
  const rects = await page.evaluate(() => [...document.getElementById('pi-sentence').getClientRects()].map((r) => ({x: r.x, y: r.y, w: r.width, h: r.height})));
  const num = await page.evaluate(() => {
    const sp = document.getElementById('pi-sentence');
    const t = sp.firstChild;
    const i = t.data.indexOf('$72.6 billion');
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + 13);
    return [...r.getClientRects()].map((q) => ({x: q.x, y: q.y, w: q.width, h: q.height}));
  });
  meta = {frames: N, scale: DSF, viewport: VP, sentence: rects, number: num, text: target.text, lastmod: target.rev, url: page.url(), read_at: new Date().toISOString()};
}

if (task === 'nearblocks') {
  const hash = 'FGFhi1W9mLtCvQ44SzDvpbKVCCPiDtkmMRpM15MBBvc6';
  await open(page, `https://nearblocks.io/txns/${hash}`);
  await page.waitForTimeout(9000);
  for (const name of [/accept/i, /got it/i, /agree/i]) {
    const b = page.getByRole('button', {name});
    if (await b.count()) await b.first().click().catch(() => {});
  }
  await page.waitForTimeout(1500);
  const d = dir('nearblocks');
  for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  await page.screenshot({path: path.join(d, 'view.png')});
  await page.screenshot({path: path.join(d, 'full.png'), fullPage: true});
  const boxes = await page.evaluate((hash) => {
    const find = (re) => {
      const out = [];
      for (const e of document.querySelectorAll('body *')) {
        const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
        if (re.test(t) && ![...e.children].some((c) => re.test((c.textContent || '').trim()))) {
          const r = e.getBoundingClientRect();
          if (r.width > 0) out.push({t: t.slice(0, 120), x: r.x, y: r.y + scrollY, w: r.width, h: r.height});
        }
      }
      return out.slice(0, 6);
    };
    return {hash: find(new RegExp(hash)), success: find(/^Success$/), time: find(/UTC/), block: find(/^\d{3},\d{3},\d{3}$/), from: find(/^From:?$/), title: find(/Transaction Details/i)};
  }, hash);
  meta = {scale: 2, viewport: {width: 1600, height: 900}, url: page.url(), boxes, read_at: new Date().toISOString()};
  console.log(JSON.stringify(boxes, null, 1).slice(0, 3000));
}

if (task === 'explorer') {
  // NearBlocks answers a headless browser with a Cloudflare "verify you are human" page, which we don't get
  // around; Pikespeak, another public NEAR explorer, shows the same transaction to a plain browser.
  const hash = 'FGFhi1W9mLtCvQ44SzDvpbKVCCPiDtkmMRpM15MBBvc6';
  await open(page, `https://pikespeak.ai/transaction-viewer/${hash}`);
  await page.waitForTimeout(8000);
  const d = dir('explorer');
  for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  await page.screenshot({path: path.join(d, 'view.png')});
  const boxes = await page.evaluate((hash) => {
    const find = (re) => {
      const out = [];
      for (const e of document.querySelectorAll('body *')) {
        const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
        if (re.test(t) && ![...e.children].some((c) => re.test((c.textContent || '').replace(/\s+/g, ' ').trim()))) {
          const r = e.getBoundingClientRect();
          if (r.width > 0) out.push({t: t.slice(0, 120), x: r.x, y: r.y, w: r.width, h: r.height});
        }
      }
      return out.slice(0, 4);
    };
    return {hash: find(new RegExp('^' + hash + '$')), success: find(/^Success$/), time: find(/Nov 05 2026/), block: find(/^223236617$/), signer: find(/^lane\.isitpriced\.near$/), receiver: find(/^market\.isitpriced\.near$/), card: find(/^Block & Timestamp$/)};
  }, hash);
  meta = {scale: DSF, viewport: VP, url: page.url(), boxes, read_at: new Date().toISOString()};
  console.log(JSON.stringify(boxes, null, 1).slice(0, 2500));
}

if (task === 'replay') {
  // the real replay of the free $1: tap No, confirm, the receipt lands with the transaction
  await open(page, `${BASE}/c/18?recorded=1&film=1`);
  await page.waitForTimeout(3500);
  await tidy(page);
  await page.waitForTimeout(500);
  const no = page.getByRole('button', {name: /No, it.s false/}).first();
  const box = async (l) => {
    const b = await l.boundingBox();
    return b ? {x: b.x, y: b.y, w: b.width, h: b.height} : null;
  };
  meta = await record(page, 'replay', async (mark) => {
    await page.waitForTimeout(1200);
    const b1 = await box(no);
    await page.mouse.move(b1.x + b1.w * 0.5, b1.y + b1.h * 0.5, {steps: 12});
    mark('tapNo', {box: b1});
    await no.click();
    await page.waitForTimeout(900);
    const confirm = page.getByRole('button', {name: /Bet \$1 free: No/});
    const b2 = await box(confirm);
    await page.mouse.move(b2.x + b2.w * 0.5, b2.y + b2.h * 0.5, {steps: 12});
    mark('confirm', {box: b2});
    await confirm.click();
    await page.waitForTimeout(400);
    await tidy(page);
    await page.waitForSelector('dialog.sheet[open]', {timeout: 15000}).catch(() => {});
    mark('receipt');
    await page.waitForTimeout(600);
    await tidy(page);
    const hb = await box(page.locator('dialog.sheet .hashv').first());
    mark('hash', {box: hb});
    await page.waitForTimeout(5500);
  });
}

if (task === 'home') {
  await open(page, `${BASE}/?film=1`);
  await page.waitForTimeout(3500);
  await tidy(page);
  const hero = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h1')][0];
    const r = h.getBoundingClientRect();
    return {x: r.x, y: r.y, w: r.width, h: r.height, text: h.textContent};
  });
  meta = await record(page, 'home', async (mark) => {
    await page.waitForTimeout(2600);
  });
  meta.hero = hero;
}

fs.writeFileSync(path.join(OUT, `${task}${SUF}.json`), JSON.stringify(meta, null, 1));
console.log('wrote', task, JSON.stringify(meta).slice(0, 400));
await browser.close();
