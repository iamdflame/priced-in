// v6 beats 6 and 7: the live text of isitpriced.com/p/tether, so the film can set it full frame and legible in the
// page's own style: the header, the corrected T-Bills sentence and its margin note, a plain sentence and the one
// genuinely disputed sentence with their odds. Writes src/film/page.json. Retries on a network hiccup.
//   node scripts/capture_page.mjs
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire('C:/Users/Dflame/Pictures/neary/.apex/design/tools/package.json');
const {chromium} = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'https://isitpriced.com';
const browser = await chromium.launch();
let out = null;
for (let attempt = 1; attempt <= 5 && !out; attempt++) {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  try {
    await page.goto(`${BASE}/p/tether?film=1`, {waitUntil: 'domcontentloaded', timeout: 60000});
    await page.waitForTimeout(3000);
    out = await page.evaluate(() => {
      const text = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : null);
      const head = [...document.querySelectorAll('b, strong')].find((b) => /Written by AI from what the market believes/.test(b.textContent));
      const anchors = [...document.querySelectorAll('a.hs')];
      const sent = (a) => {
        // the sentence text without its odds superscript or "No bets" tag
        const c = a.cloneNode(true);
        c.querySelectorAll('sup, small, .odds, [class*="tag"]').forEach((x) => x.remove());
        return text(c).replace(/\s*(No bets|\d+%)\s*$/, '');
      };
      const odds = (a) => {
        const sup = a.parentElement?.querySelector('sup') || a.querySelector('sup');
        const m = (sup ? sup.textContent : a.parentElement?.textContent || '').match(/(\d+)%/);
        return m ? +m[1] : null;
      };
      const tbills = anchors.find((a) => /majority of Tether.s reserves held in cash/.test(a.textContent));
      const issuer = anchors.find((a) => /issuer of USDT/.test(a.textContent));
      const disputed = anchors.find((a) => /disputed whether/.test(a.textContent));
      // the margin note beside the T-Bills paragraph
      let note = null;
      if (tbills) {
        const sec = tbills.closest('section') || tbills.parentElement;
        const n = [...sec.querySelectorAll('*')].find((e) => /Corrected from its source|Rewritten from these odds/.test(e.textContent) && e.children.length < 4);
        note = text(n);
      }
      return {
        read_at: new Date().toISOString(),
        url: location.href,
        header: text(head),
        tbills: tbills ? {text: sent(tbills), odds: odds(tbills), note} : null,
        plain: issuer ? {text: sent(issuer), odds: odds(issuer)} : null,
        disputed: disputed ? {text: sent(disputed), odds: odds(disputed)} : null,
      };
    });
  } catch (e) {
    console.log('retry', attempt, String(e.message).slice(0, 120));
    await new Promise((r) => setTimeout(r, 5000));
  }
  await page.close();
}
await browser.close();
if (!out) throw new Error('could not read the page');
fs.writeFileSync(path.resolve(here, '../src/film/page.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
