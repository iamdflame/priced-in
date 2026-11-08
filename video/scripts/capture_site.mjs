// Captures the real site (light theme, the default) for the film: stills at 2x desktop and 3x phone, the replay's
// real bet flow as a CDP screencast (the phone's UI actually moving), the AI-written Tether page with its T-Bills
// paragraph's "What changed" open, and the boxes the film lifts off each page (src/film/boxes.json). It also reads
// the live count of settled rulings into src/film/live.json. ?film=1 holds countdowns and hides the replay bar;
// the replay sends nothing. Output: public/site/ (git-ignored).
//   BASE=https://isitpriced.com node scripts/capture_site.mjs      (or a local next start on :3100)
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire('C:/Users/Dflame/Pictures/neary/.apex/design/tools/package.json');
const {chromium} = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../public/site');
const BASE = process.env.BASE ?? 'https://isitpriced.com';
fs.mkdirSync(OUT, {recursive: true});

const desktop = {viewport: {width: 1440, height: 900}, deviceScaleFactor: 2, colorScheme: 'light'};
const phone = {viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light'};
const browser = await chromium.launch();
const boxes = {};

// The box of the card holding a text, in source pixels of a full-page 2x capture.
async function boxOf(page, text, key, src, minW = 500, minH = 60) {
  const loc = page.getByText(text).first();
  if (!(await loc.count())) {
    console.log('no box for', key, String(text));
    return;
  }
  const b = await loc.evaluate((el, [mw, mh]) => {
    let e = el;
    while (e && e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.width >= mw && r.height >= mh) break;
      e = e.parentElement;
    }
    const r = e.getBoundingClientRect();
    return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height};
  }, [minW, minH]);
  boxes[key] = {src, x: Math.round(b.x * 2), y: Math.round(b.y * 2), w: Math.round(b.w * 2), h: Math.round(b.h * 2)};
}

async function open(view, url) {
  const ctx = await browser.newContext(view);
  const page = await ctx.newPage();
  // the live pages hold an event stream open, so 'networkidle' never comes: wait for the DOM, then settle
  await page.goto(`${BASE}${url}`, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForTimeout(2800);
  return {ctx, page};
}

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
async function still(view, name, url, opts = {}) {
  if (ONLY && !ONLY.includes(name)) return;
  const {ctx, page} = await open(view, url);
  if (opts.before) await opts.before(page);
  await page.screenshot({path: path.join(OUT, `${name}.png`)});
  if (opts.full) await page.screenshot({path: path.join(OUT, `${name}__full.png`), fullPage: true});
  if (opts.after) await opts.after(page);
  console.log('still', name);
  await ctx.close();
}

await still(desktop, 'home-d', '/?film=1', {
  full: true,
  after: async (p) => {
    boxes.homeTop = {src: 'site/home-d__full.png', x: 0, y: 0, w: 2880, h: 1800};
    // where the encyclopedia's facts begin, below Today's claims
    await boxOf(p, /^Facts from Wikipedia$/, 'facts', 'site/home-d__full.png', 10, 10);
    await boxOf(p, /^Trending$/, 'trending', 'site/home-d__full.png', 10, 10);
  },
});
await still(desktop, 'c18-d', '/c/18?film=1', {
  full: true,
  after: async (p) => {
    await boxOf(p, /The Checker challenged it/, 'challenge', 'site/c18-d__full.png', 900, 50);
    await boxOf(p, /^No won\.?$/, 'noWon', 'site/c18-d__full.png', 300, 300);
  },
});
await still(desktop, 'c32-d', '/c/32?film=1');
// The AI-written page, read as a reader would: its header at the top, then, scrolled down, the corrected T-Bills
// paragraph with its "What changed" panel open. Two pictures: the header screen and a clip around the paragraph.
{
  const {ctx, page} = await open(desktop, '/p/tether?film=1');
  await page.screenshot({path: path.join(OUT, 'ptether-head.png')});
  const head = await page.getByText(/Written by AI from what the market believes right now/).first().evaluate((el) => {
    let e = el;
    while (e.parentElement && e.getBoundingClientRect().width < 600) e = e.parentElement;
    const r = e.getBoundingClientRect();
    return {x: r.left, y: r.top + scrollY, w: r.width, h: r.height};
  });
  boxes.pageHead = {src: 'site/ptether-head.png', x: Math.round(head.x * 2), y: Math.round(head.y * 2), w: Math.round(head.w * 2), h: Math.round(head.h * 2)};
  // the paragraph, scrolled into view the way a reader gets there
  const para = page.locator('a.hs', {hasText: "majority of Tether's reserves held in cash"}).first();
  for (let y = 0; y < 11000; y += 900) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(60);
  }
  await para.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const opened = await para.evaluate((a) => {
    const P = a.closest('p');
    const sec = P.closest('section') || P.parentElement;
    const btn = [...sec.querySelectorAll('button.chg-open')].find((b) => P.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) || sec.querySelector('button.chg-open');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) console.log('no What changed button for the T-Bills paragraph');
  await page.waitForTimeout(1200);
  // a full-page clip would paint the sticky header mid-picture: pin it to the top of the document instead
  await page.addStyleTag({content: 'header, [class*="hdr"], [class*="sticky"] { position: absolute !important; }'});
  await page.waitForTimeout(300);
  await para.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const geo = await para.evaluate((a) => {
    const P = a.closest('p');
    const sec = P.closest('section') || P.parentElement;
    const pr = P.getBoundingClientRect();
    const sr = sec.getBoundingClientRect();
    const dd = [...document.querySelectorAll('dd, p, li, span, div')].find((e) => /ruled false/i.test(e.textContent) && e.getBoundingClientRect().height > 0 && e.children.length < 6 && e.getBoundingClientRect().top > pr.top - 50);
    let panel = dd;
    while (panel && panel.parentElement && (panel.getBoundingClientRect().width < 500 || panel.getBoundingClientRect().height < 120)) panel = panel.parentElement;
    const cr = panel ? panel.getBoundingClientRect() : null;
    return {
      p: {x: pr.left, y: pr.top + scrollY, w: pr.width, h: pr.height},
      s: {x: sr.left, y: sr.top + scrollY, w: sr.width, h: sr.height},
      c: cr ? {x: cr.left, y: cr.top + scrollY, w: cr.width, h: cr.height} : null,
    };
  });
  const top = Math.max(0, Math.round(geo.p.y - 420));
  const bottom = Math.round((geo.c ? geo.c.y + geo.c.h : geo.p.y + geo.p.h) + 360);
  await page.screenshot({path: path.join(OUT, 'ptether-para.png'), fullPage: true, clip: {x: 0, y: top, width: 1440, height: bottom - top}});
  const rel = (b) => ({src: 'site/ptether-para.png', x: Math.round(b.x * 2), y: Math.round((b.y - top) * 2), w: Math.round(b.w * 2), h: Math.round(b.h * 2)});
  boxes.para = rel(geo.p);
  if (geo.c) boxes.changed = rel(geo.c);
  else console.log('no "What changed" panel found under the paragraph');
  console.log('ptether', JSON.stringify({opened, head: boxes.pageHead, para: boxes.para, changed: boxes.changed}));
  await ctx.close();
}
await still(desktop, 'replay-d', '/c/18?recorded=1&film=1');
await still(phone, 'home-p', '/?film=1');
await still(phone, 'c18-p', '/c/18?film=1', {full: true});
await still(phone, 'replay-p', '/c/18?recorded=1&film=1');

// The bet flow, for both views: real UI motion as image frames with timestamps.
async function flow(view, name) {
  const {ctx, page} = await open(view, '/c/18?recorded=1&film=1');
  const dir = path.join(OUT, `flow-${name}`);
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (e) => {
    const file = `${String(n++).padStart(4, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(e.data, 'base64'));
    frames.push({file, t: e.metadata.timestamp});
    await cdp.send('Page.screencastFrameAck', {sessionId: e.sessionId}).catch(() => {});
  });
  const size = view.viewport;
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92, maxWidth: size.width * view.deviceScaleFactor, maxHeight: size.height * view.deviceScaleFactor, everyNthFrame: 1});
  const marks = {start: Date.now() / 1000};
  await page.waitForTimeout(700);
  marks.tapNo = Date.now() / 1000;
  await page.getByRole('button', {name: /No, it’s false/}).first().click();
  await page.waitForTimeout(600);
  marks.confirm = Date.now() / 1000;
  await page.getByTestId('confirm').click().catch(() => console.log('no confirm', name));
  await page.getByTestId('sig-ok').waitFor({timeout: 40000}).catch(() => console.log('no sig-ok', name));
  marks.sig = Date.now() / 1000;
  await page.getByText(/an AI trader, replied/).waitFor({timeout: 30000}).catch(() => console.log('no reply', name));
  marks.reply = Date.now() / 1000;
  await page.waitForTimeout(1200);
  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(300);
  await page.screenshot({path: path.join(OUT, `receipt-${name}.png`)});
  // The AI trader's reasons, as the recorded run replied on the receipt (the Skeptic, on the T-Bills fact)
  if (name === 'd') await boxOf(page, /undated encyclopedia line/, 'skeptic', 'site/receipt-d.png', 500, 100);
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({marks, frames}, null, 0));
  console.log('flow', name, frames.length, 'frames', JSON.stringify(marks));
  await ctx.close();
}
if (!ONLY || ONLY.includes('flow')) {
  await flow(phone, 'p');
  await flow(desktop, 'd');
}
await browser.close();

// The film's measured boxes and its compact flow timing.
const film = path.resolve(here, '../src/film');
const old = fs.existsSync(path.join(film, 'boxes.json')) ? JSON.parse(fs.readFileSync(path.join(film, 'boxes.json'), 'utf8')) : {};
fs.writeFileSync(path.join(film, 'boxes.json'), JSON.stringify({...old, ...boxes}, null, 1));
if (!ONLY || ONLY.includes('flow')) {
const fp = JSON.parse(fs.readFileSync(path.join(OUT, 'flow-p', 'frames.json'), 'utf8'));
const fd = JSON.parse(fs.readFileSync(path.join(OUT, 'flow-d', 'frames.json'), 'utf8'));
const t0 = fp.frames[0].t;
const t1 = fd.frames[0].t;
fs.writeFileSync(path.join(film, 'flow.json'), JSON.stringify({p: fp.frames.map((f) => +(f.t - t0).toFixed(3)), d: fd.frames.map((f) => +(f.t - t1).toFixed(3)), tap: +(fp.marks.tapNo - t0).toFixed(3)}));
}
// The live count of settled rulings, read at capture time.
const r = await (await fetch('https://isitpriced.com/api/rulings')).json();
const settled = r.rulings.filter((x) => x.status === 'settled').length;
fs.writeFileSync(path.join(film, 'live.json'), JSON.stringify({rulings: settled, read_at: new Date().toISOString(), source: 'https://isitpriced.com/api/rulings'}, null, 1));
console.log('boxes', Object.keys(boxes).join(' '), '| rulings settled', settled);
