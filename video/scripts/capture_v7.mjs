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
// (and on /rulings the verdict times and the payout line of the timeline)
const HIDE_TEXT = [/bet so far/, /^Live · real money/, /\d+ bets?$/, /paid out/, /^Ruled in [\d.]+ s$/, /in [\d.]+ s$/, /paid to No/, /^[\d.]+ s$/, /\$[\d.]+ paid/];

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

/** Stepped recording, for long pages where the live screencast drops frames: a screenshot per step, each stamped
 *  with its real time, then resampled to 30 fps like record(). */
async function stepped(page, name, script) {
  const d = dir(name);
  for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  const shots = [];
  const t0 = Date.now() / 1000;
  const marks = {};
  const mark = (k, extra = {}) => (marks[k] = {t: Date.now() / 1000 - t0, ...extra});
  const snap = async () => shots.push({t: Date.now() / 1000 - t0, buf: await page.screenshot({type: 'jpeg', quality: 92})});
  await script(mark, snap);
  const end = Date.now() / 1000 - t0;
  const n = Math.floor(end * FPS);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = k / FPS;
    while (j + 1 < shots.length && shots[j + 1].t <= t) j++;
    fs.writeFileSync(path.join(d, String(k + 1).padStart(4, '0') + '.jpg'), shots[j].buf);
  }
  console.log(name, 'snaps', shots.length, 'written', n);
  return {frames: n, marks, scale: DSF, viewport: VP};
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

if (task === 'rulings') {
  // the three judges' signed verdicts, in their own words; a viewer's real "Verify the signature" on each
  await open(page, `${BASE}/rulings?film=1`);
  await page.waitForTimeout(4000);
  await tidy(page);
  await page.evaluate((pad) => {
    const h = [...document.querySelectorAll('h2, h3')].find((e) => /three AI judges, in their own words/.test(e.textContent));
    window.scrollTo(0, h.getBoundingClientRect().top + scrollY - pad);
  }, PHONE ? 70 : 92);
  await page.waitForTimeout(800);
  await tidy(page);
  const cards = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('button')) {
      if (!/Verify the signature/.test(b.textContent)) continue;
      let c = b;
      for (let i = 0; i < 8 && c && c.getBoundingClientRect().height < 300; i++) c = c.parentElement;
      const r = c.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      out.push({card: {x: r.x, y: r.y, w: r.width, h: r.height}, button: {x: br.x, y: br.y, w: br.width, h: br.height}});
    }
    const tags = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() === 'FALSE').map((e) => {
      const r = e.getBoundingClientRect();
      return {x: r.x, y: r.y, w: r.width, h: r.height};
    }).filter((r) => r.y > 0 && r.y < innerHeight);
    return {cards: out, tags};
  });
  const verify = page.getByRole('button', {name: /Verify the signature/});
  meta = await record(page, 'rulings', async (mark) => {
    await page.waitForTimeout(1000);
    for (let i = 0; i < 3; i++) {
      const bb = cards.cards[i]?.button;
      if (bb) await page.mouse.move(bb.x + bb.w / 2, bb.y + bb.h / 2, {steps: 8});
      mark('verify' + (i + 1), {box: bb});
      if (await verify.count()) await verify.first().click();
      await page.waitForTimeout(i === 1 ? 1600 : 1200);
    }
    await page.waitForTimeout(3500);
  });
  meta.cards = cards.cards;
  meta.tags = cards.tags;
}

if (task === 'ptether') {
  // the page: from its header, a real scroll to the corrected T-Bills line, then a reader opens "What changed"
  await open(page, `${BASE}/p/tether?film=1`);
  await page.waitForTimeout(4000);
  await tidy(page);
  await page.addStyleTag({content: 'a.hs sup, .pg-odds { visibility: hidden !important; }'});
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('body *')) {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      if (e.children.length === 0 && (/^\d+%$/.test(t) || /\d+ of \d+ paragraphs/.test(t))) e.style.visibility = 'hidden';
    }
  });
  const header = await page.evaluate(() => {
    const b = [...document.querySelectorAll('b, strong, p')].find((x) => /^Written by AI from what the market believes/.test(x.textContent.trim()));
    const r = b.getBoundingClientRect();
    return {text: b.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height};
  });
  const target = await page.evaluate((vh) => {
    const a = [...document.querySelectorAll('a.hs')].find((x) => /majority of Tether.s reserves held in cash/.test(x.textContent));
    a.id = 'pi-tbills';
    const r = a.getBoundingClientRect();
    return {y: r.top + scrollY - vh * 0.22};
  }, VP.height);
  if (!PHONE) {
    // the desktop page is long and the live screencast drops frames on it: step the same scroll, a frame at a time
    const ease3 = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    meta = await stepped(page, 'ptether', async (mark, snap) => {
      for (let i = 0; i < 6; i++) await snap();
      mark('scroll');
      const y0 = await page.evaluate(() => scrollY);
      for (let i = 1; i <= 40; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), Math.round(y0 + (target.y - y0) * ease3(i / 40)));
        await snap();
      }
      mark('arrived');
      for (let i = 0; i < 6; i++) await snap();
      const btn = await page.evaluateHandle(() => {
        const a = document.getElementById('pi-tbills');
        let found = null;
        for (let up = a; up && !found; up = up.parentElement) found = [...up.querySelectorAll('button')].find((bt) => /What changed/.test(bt.textContent) && bt.getBoundingClientRect().top >= a.getBoundingClientRect().top);
        return found;
      });
      const bb = await btn.asElement().boundingBox();
      mark('open', {box: {x: bb.x, y: bb.y, w: bb.width, h: bb.height}});
      await btn.asElement().click();
      for (let i = 0; i < 14; i++) await snap();
    });
  } else meta = await record(page, 'ptether', async (mark) => {
    await page.waitForTimeout(1000);
    mark('scroll');
    await page.evaluate((y) => new Promise((res) => {
      const y0 = scrollY;
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1600);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        window.scrollTo(0, y0 + (y - y0) * e);
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    }), target.y);
    mark('arrived');
    await page.waitForTimeout(1400);
    const btn = await page.evaluateHandle(() => {
      const a = document.getElementById('pi-tbills');
      let found = null;
      for (let up = a; up && !found; up = up.parentElement) found = [...up.querySelectorAll('button')].find((bt) => /What changed/.test(bt.textContent) && bt.getBoundingClientRect().top >= a.getBoundingClientRect().top);
      return found;
    });
    const bb = await btn.asElement().boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, {steps: 8});
    mark('open', {box: {x: bb.x, y: bb.y, w: bb.width, h: bb.height}});
    await page.mouse.down();
    await page.mouse.up();
    if (PHONE) {
      // on a phone the proof rows sit under the fold: scroll them up, as a reader would
      await page.waitForTimeout(1300);
      mark('more');
      await page.evaluate((d) => new Promise((res) => {
        const y0 = scrollY;
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / 900);
          window.scrollTo(0, y0 + d * (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2));
          if (k < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      }), 300);
      await page.waitForTimeout(2200);
    } else await page.waitForTimeout(3500);
  });
  meta.header = header;
  meta.sentence = await page.evaluate(() => [...document.getElementById('pi-tbills').getClientRects()].map((r) => ({x: r.x, y: r.y, w: r.width, h: r.height})));
}

if (task === 'c18') {
  // the decided market, recorded from the moment the page opens: the outcome, not a live price
  const pats = [...HIDE_TEXT.map((r) => r.source), '^Last price'];
  await page.addInitScript(({css, pats}) => {
    const res = pats.map((p) => new RegExp(p));
    const sweep = () => {
      for (const e of document.querySelectorAll('body *')) {
        const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 90) continue;
        if (res.some((r) => r.test(t)) && ![...e.children].some((c) => res.some((r) => r.test((c.textContent || '').trim())))) e.setAttribute('data-pi-hide', '1');
      }
    };
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = css;
      document.head.appendChild(st);
      sweep();
      new MutationObserver(sweep).observe(document.body, {childList: true, subtree: true, characterData: true});
    });
  }, {css: HIDE, pats});
  await page.goto('about:blank');
  meta = await record(page, 'c18', async (mark) => {
    mark('open');
    await open(page, `${BASE}/c/18?film=1`);
    mark('loaded');
    await page.waitForTimeout(5000);
  });
  meta.boxes = await page.evaluate(() => {
    const find = (re) => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && re.test(e.textContent.trim())).map((e) => {
      const r = e.getBoundingClientRect();
      return {t: e.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height};
    }).slice(0, 3);
    return {zero: find(/^0% chance it.s true$/), decided: find(/^Decided false by three AI judges$/), q: find(/^Are most of Tether/)};
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
