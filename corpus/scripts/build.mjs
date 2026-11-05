// Builds corpus/MANIFEST.json and corpus/ERRORS.json from pages/*.json. Usage: node corpus/scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { ARTICLES } from './articles.mjs';
import { summarise } from './headline.mjs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const pages = ARTICLES.map(([slug]) => JSON.parse(readFileSync(`${root}pages/${slug}.json`, 'utf8')));
const s = summarise(pages);
const CHECK = '2026-11-05';
const dates = { 'ethereum-0119': '2021-01-19', 'ethereum-0131': '2020-12-03', 'proof-of-stake-0042': '2023-03-01', 'dai-0002': '2020-12-14', 'dai-0032': '2021-01-14', 'tether-0030': '2021-04-11', 'tether-0031': '2021-01-26', 'tether-0161': '2024-02-26', 'prediction-market-0186': '2026-03-19', 'prediction-market-0211': '2024-11-15', 'prediction-market-0215': '2025-07-14' };
const ages = Object.entries(dates).map(([id, d]) => ({ id, wordingFirstSeen: d, days: Math.round((Date.parse(CHECK) - Date.parse(d)) / 864e5) }));
const sorted = ages.map((a) => a.days).sort((a, b) => a - b);
const stale = pages.flatMap((p) => p.sentences).filter((x) => x.verdict === 'stale').map((x) => x.id).sort();
if (stale.join() !== Object.keys(dates).sort().join()) throw new Error('stale ages out of step: ' + stale.join());
const audit = JSON.parse(readFileSync(root + 'audit/result.json', 'utf8'));
const manifest = {
  question: 'Of the checkable factual sentences on public encyclopedia pages about crypto and NEAR topics, how many are out of date or wrong today, checked against primary data?',
  checkedOn: CHECK,
  revisionCutoff: '2026-11-05T00:00:00Z',
  source: 'English Wikipedia, CC BY-SA 4.0, by Wikipedia contributors',
  licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  headline: s.headline,
  counts: s.counts,
  sensitivity: s.sensitivity,
  byClass: s.byClass,
  staleAge: { medianDays: sorted[sorted.length >> 1], n: sorted.length, method: 'days from the first revision whose wikitext holds the wording, found by bisecting page history, to the check date', rows: ages },
  audit: { sampled: audit.sampled, agree: audit.agree, agreementRate: audit.agreementRate, bothDecided: audit.bothDecided, bothDecidedAgree: audit.bothDecidedAgree, disagreements: audit.disagreements.map((d) => d.id), limit: audit.limit },
  articles: pages.map((p) => ({ slug: p.slug, title: p.title, revid: p.revid, timestamp: p.timestamp, url: p.url, attribution: p.attribution, sentences: p.sentences.length, classes: p.counts, verdicts: s.byArticle[p.slug] })),
};
writeFileSync(root + 'MANIFEST.json', JSON.stringify(manifest, null, 1) + '\n');
const items = [
  ['ethereum-0172', 'About 25 transactions per second in January 2016', '0.15 per second in January 2016 (Etherscan daily counts); about 23 to 25 per second now'],
  ['uniswap-0035', 'UNI total supply is capped', 'No hard cap: the contract allows a mint of up to 2% a year; live supply is 1,000,000,000 and a minter address is set'],
  ['stablecoin-0085', 'As of November 2026, Tether has never completed an audit by an accounting firm', 'On 13 August 2026 Tether announced that KPMG U.S. completed a full audit of its 2025 statements with an unqualified opinion. The audit report is not public'],
  ['tether-0161', '$72.6 billion in U.S. T-Bills, stated without a date', '$122.84 billion at 30 September 2026'],
  ['prediction-market-0215', 'Polymarket uses the USDC stablecoin', 'pUSD, backed by USDC, is the collateral for all trading on Polymarket'],
  ['prediction-market-0211', 'Kalshi is available only for U.S. residents', 'Kalshi says users can trade from many countries, and announced 140+ countries in October 2025'],
  ['prediction-market-0186', 'Polymarket operates in all of Canada except Ontario', 'Blocked in Alberta, British Columbia, Ontario and Quebec'],
  ['dai-0002', 'DAI is run by a DAO of MKR owners', 'SKY has been voted in as the sole governance token of the Sky Protocol'],
  ['tether-0030', 'Tether issues on 13 chains, including Algorand, EOS and Bitcoin Cash SLP', 'No longer issuing on Kusama, Bitcoin Cash SLP, Omni, EOS and Algorand'],
  ['defi-0069', 'About $18.6 billion in weekly DEX volume in mid-2025', 'About $78 billion a week in June 2025 on DefiLlama; about $67 billion a week in Q2 2025 on CoinGecko'],
];
const byId = new Map(pages.flatMap((p) => p.sentences.map((x) => [x.id, { ...x, page: p }])));
const errors = items.map(([id, onPage, today], i) => {
  const x = byId.get(id);
  if (!['stale', 'wrong'].includes(x.verdict)) throw new Error(id);
  return { rank: i + 1, id, article: x.page.title, sentence: x.text, verdict: x.verdict, valueOnPage: onPage, valueToday: today, checkedOn: CHECK, receipts: x.receipts, thenReceipts: x.thenReceipts, note: x.note, revision: x.page.url, licence: x.page.attribution };
});
writeFileSync(root + 'ERRORS.json', JSON.stringify({ tone: 'The page says X, the source says Y, checked on this date. Volunteers wrote these pages, and a stale figure is not a scandal.', checkedOn: CHECK, items: errors }, null, 1) + '\n');
console.log(JSON.stringify(s.headline), JSON.stringify(s.counts), JSON.stringify(s.sensitivity), 'median stale age days', manifest.staleAge.medianDays);
