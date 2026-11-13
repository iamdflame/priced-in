// The two numbers a correction turns on: the figure Wikipedia's sentence gave and the one the corrected
// line gives. Read from the two texts themselves, so nothing is typed in: the first amount (money, a
// percentage or a counted quantity) in the old line that the new one no longer has, and the first in the
// new line the old one never had. Null when either side has none: then the sentences are shown instead.

const AMOUNT = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:trillion|billion|million|thousand|bn|[kmbt])\b)?|\d[\d,]*(?:\.\d+)?\s?%|\d[\d,]*(?:\.\d+)?\s(?:trillion|billion|million|thousand)\b)/gi;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function figures(was: string, now: string): { was: string; now: string } | null {
  const a = was.match(AMOUNT) ?? [];
  const b = now.match(AMOUNT) ?? [];
  const inB = new Set(b.map(norm));
  const inA = new Set(a.map(norm));
  const gone = a.find((x) => !inB.has(norm(x)));
  const came = b.find((x) => !inA.has(norm(x)));
  return gone && came ? { was: gone.trim(), now: came.trim() } : null;
}
