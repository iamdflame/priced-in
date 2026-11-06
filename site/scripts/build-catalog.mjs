// Builds data/catalog.json: the art direction for each claim (topic, art object, coin icon, a short
// name for live sentences) and, for lines the corpus audit found out of date, what the newer source
// says. Sources, all real: the Pulse kit's data (.apex/design/brand/pulse/assets/data.js, itself built
// from the mainnet snapshot, the contract's event log and corpus/ERRORS.json) and the one-line
// evidence the kit's clarity pass wrote from those sources. Prices are never stored here: the site
// reads every number live from the API. A corrected sentence needs no entry: it takes the look of the
// sentence it replaced (lib/server/facts.ts).
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KIT = `${ROOT}.apex/design/brand/pulse/assets/data.js`;
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(KIT, 'utf8'), ctx);
const D = ctx.window.PI;

// One line from the newer source, for cards (the kit's clarity pass; the full quotes live on the market page).
const EVIDENCE = {
  24: '140+ countries (Kalshi, Oct 2025)',
  18: '$122.84B (Tether’s attestation, Sep 2026)',
  6: 'Tether stopped issuing on EOS, Algorand and others (tether.to)',
  20: '0.15 a second in Jan 2016 (Etherscan)',
  21: 'up to 2% a year can still be minted (the UNI contract)',
  22: 'KPMG completed an audit (Tether, Aug 2026)',
  23: 'trading now uses pUSD, backed by USDC (Polymarket docs)',
  25: 'it is also blocked in Alberta, BC and Quebec (Polymarket help)',
  26: 'SKY replaced MKR for governance (Sky)',
  27: 'about $78B a week in June 2025 (DefiLlama)',
};
// Plain names for live sentences ("The Quant bet $0.13 that Tether's T-Bills fact is false").
const FACT = {
  18: "Tether's T-Bills fact", 10: 'the Cantor Fitzgerald fact', 9: 'the T3 frozen-funds fact', 12: "Tether's $187.8B assets fact",
  13: 'the XAU₮ gold fact', 16: 'the “backed 100%” fact', 7: 'the “five Tether tokens” fact', 6: 'the “13 chains” fact',
  4: 'the El Salvador HQ fact', 2: 'the “350M users” fact', 1: 'the “largest stablecoin” fact', 0: 'the USD₮ codes fact',
};

const claims = {};
for (const m of D.markets) {
  if (m.id === null || m.id === undefined) continue;
  claims[m.id] = {
    page: m.page, topic: m.topic, article: m.article, icon: m.icon, art: m.art,
    name: FACT[m.id] || `the “${m.short}” fact`,
    caught: m.caught ? { today: m.caught.today, onPage: m.caught.onPage, source: m.caught.source, label: m.caught.label, checked: m.caught.checked, line: EVIDENCE[m.id] || null } : null,
  };
}
// The Wikipedia revision each page was read from (web/src/ui/data/corpus.json), for "where it's from".
const corpus = JSON.parse(fs.readFileSync(`${ROOT}web/src/ui/data/corpus.json`, 'utf8'));
const pages = {};
for (const c of Object.values(claims)) {
  const pg = corpus.pages[c.page];
  if (pg) pages[c.page] = { title: pg.title, url: pg.url, attribution: pg.attribution };
}

const out = {
  note: 'Art direction per claim id, from the Pulse kit (.apex/design/brand/pulse), and the Wikipedia revision of each page. No prices: those are read live. Rebuild: npm run catalog.',
  claims,
  pages,
};
fs.writeFileSync(new URL('../data/catalog.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`catalog: ${Object.keys(claims).length} claims`);

// The replay (?recorded=1) reads the complete mainnet run, copied in so the build never reaches outside site/.
fs.copyFileSync(`${ROOT}deployments/rehearsal/mainnet.json`, new URL('../data/rehearsal-mainnet.json', import.meta.url));
console.log('rehearsal: copied deployments/rehearsal/mainnet.json');
