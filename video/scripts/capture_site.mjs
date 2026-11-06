// Captures the real site for the film: stills at 2x desktop and 3x phone, and the replay's real bet flow
// as a CDP screencast (the phone's UI actually moving). Dark theme, ?film=1, nothing is sent: the replay
// is the recorded mainnet run. Output: public/site/ (git-ignored).
//   BASE=http://127.0.0.1:3100 node scripts/capture_site.mjs
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire('C:/Users/Dflame/Pictures/neary/.apex/design/tools/package.json');
const {chromium} = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../public/site');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
fs.mkdirSync(OUT, {recursive: true});

const desktop = {viewport: {width: 1440, height: 900}, deviceScaleFactor: 2, colorScheme: 'dark'};
const phone = {viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark'};
const browser = await chromium.launch();
// The replay's chart caption reads "$0.00 bet so far · 5 bets": the replay has no dollar figure at that point.
// The film shows only the true part ("5 bets"). This edits the captured page, not the site (see the result file).
const FIX = `new MutationObserver(()=>{if(!document.body)return;for(const e of document.body.querySelectorAll('div,span,p,small')){const t=e.textContent;if(t.length<40&&t.includes('bet so far')&&t.includes('0.00')){const m=t.match(/([0-9]+.bets?)/);if(m&&e.textContent!==m[1])e.textContent=m[1]}}}).observe(document.documentElement,{childList:true,subtree:true,characterData:true})`;

async function still(view, name, url, opts = {}) {
  const ctx = await browser.newContext(view);
  const page = await ctx.newPage();
  await page.addInitScript(FIX);
  await page.goto(`${BASE}${url}`, {waitUntil: 'networkidle'}).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({path: path.join(OUT, `${name}.png`)});
  if (opts.full) await page.screenshot({path: path.join(OUT, `${name}__full.png`), fullPage: true});
  console.log('still', name);
  await ctx.close();
}

await still(desktop, 'home-d', '/?film=1&theme=dark', {full: true});
await still(desktop, 'c18-d', '/c/18?film=1&theme=dark', {full: true});
await still(desktop, 'c32-d', '/c/32?film=1&theme=dark');
await still(desktop, 'replay-d', '/c/18?recorded=1&film=1&theme=dark');
await still(phone, 'home-p', '/?film=1&theme=dark');
await still(phone, 'c18-p', '/c/18?film=1&theme=dark', {full: true});
await still(phone, 'replay-p', '/c/18?recorded=1&film=1&theme=dark');

// The bet flow, for both views: real UI motion as image frames with timestamps.
async function flow(view, name) {
  const ctx = await browser.newContext(view);
  const page = await ctx.newPage();
  await page.addInitScript(FIX);
  await page.goto(`${BASE}/c/18?recorded=1&film=1&theme=dark`, {waitUntil: 'networkidle'}).catch(() => {});
  await page.waitForTimeout(1200);
  const dir = path.join(OUT, `flow-${name}`);
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
  await page.getByTestId('confirm').click();
  await page.getByTestId('sig-ok').waitFor({timeout: 40000}).catch(() => console.log('no sig-ok', name));
  marks.sig = Date.now() / 1000;
  await page.getByText(/an AI trader, replied/).waitFor({timeout: 30000}).catch(() => console.log('no reply', name));
  marks.reply = Date.now() / 1000;
  await page.waitForTimeout(1200);
  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(300);
  await page.screenshot({path: path.join(OUT, `receipt-${name}.png`)});
  if (name === 'p') await page.locator('.sheet-in').screenshot({path: path.join(OUT, 'receipt-p__sheet.png')}).catch(() => {});
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({marks, frames}, null, 0));
  console.log('flow', name, frames.length, 'frames', JSON.stringify(marks));
  await ctx.close();
}
await flow(phone, 'p');
await flow(desktop, 'd');
await browser.close();
