// The pre-registered headline: H = (S + W) / (C + S + W), with a 95% Wilson interval, z = 1.959964.
export function wilson(k, n, z = 1.959964) {
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [c - h, c + h];
}
const r = (x) => +x.toFixed(4);
export function summarise(pages) {
  const rows = pages.flatMap((p) => p.sentences);
  const data = rows.filter((x) => x.class === 'data');
  const n = (v) => data.filter((x) => x.verdict === v).length;
  const C = n('current'), S = n('stale'), W = n('wrong'), U = n('undecidable'), R = n('reclassified');
  const datedC = data.filter((x) => x.verdict === 'current' && x.dated).length;
  const contradicted = data.filter((x) => x.verdict === 'undecidable' && x.contradicted).length;
  const decided = C + S + W;
  const [lo, hi] = wilson(S + W, decided);
  const byArticle = {};
  for (const p of pages) {
    const d = p.sentences.filter((x) => x.class === 'data');
    const c = (v) => d.filter((x) => x.verdict === v).length;
    byArticle[p.slug] = { data: d.length, current: c('current'), stale: c('stale'), wrong: c('wrong'), undecidable: c('undecidable'), reclassified: c('reclassified') };
  }
  const byClass = { data: data.length, sourced: rows.filter((x) => x.class === 'sourced').length, opinion: rows.filter((x) => x.class === 'opinion').length, total: rows.length };
  const worst = S + W + contradicted, worstDen = decided + contradicted;
  return {
    headline: { formula: '(stale + wrong) / (current + stale + wrong)', numerator: S + W, denominator: decided, share: r((S + W) / decided), wilson95: [r(lo), r(hi)] },
    counts: { checked: data.length, current: C, currentDated: datedC, stale: S, wrong: W, undecidable: U, undecidableContradicted: contradicted, reclassified: R },
    sensitivity: {
      lowerBoundCountingUndecidable: r((S + W) / (decided + U)),
      excludingDated: r((S + W) / (decided - datedC)),
      countingContradictedUndecidableAsOutOfDate: r(worst / worstDen),
    },
    byClass, byArticle,
  };
}
