// The lockup and the topic icons. The lockup is the kit's outlined General Sans wordmark (logo/), drawn
// in currentColor so it follows the theme without a second file; the needle and the i's dot stay cyan.
import type { Fact } from "@/lib/model";

const WORD = [
  ["0", "M339 234H226V0H74V718H339Q472 718 547.5 656.0Q623 594 623 479Q623 363 547.0 298.5Q471 234 339 234ZM338 590H226V362H338Q402 362 437.0 393.0Q472 424 472 478Q472 531 437.0 560.5Q402 590 338 590Z"],
  ["616", "M201 259V0H62V534H190V431Q219 481 276.0 510.5Q333 540 398 540V396Q302 403 251.5 373.0Q201 343 201 259Z"],
  ["1004", "M201 0H62V534H201Z"],
  ["1251", "M287 -10Q172 -10 99.5 67.5Q27 145 27 267Q27 387 100.5 465.5Q174 544 287 544Q391 544 462.0 479.0Q533 414 546 306H400Q395 359 364.5 390.0Q334 421 287 421Q233 421 201.0 379.5Q169 338 169 267Q169 195 200.5 154.0Q232 113 287 113Q335 113 364.5 143.0Q394 173 400 228H546Q534 118 464.0 54.0Q394 -10 287 -10Z"],
  ["1804", "M294 -9Q174 -9 100.5 67.5Q27 144 27 269Q27 388 102.0 466.0Q177 544 292 544Q419 544 493.0 454.0Q567 364 548 233H169Q183 98 291 98Q384 98 409 181H547Q525 90 458.5 40.5Q392 -9 294 -9ZM289 442Q189 442 171 321H401Q398 377 368.0 409.5Q338 442 289 442Z"],
  ["2363", "M27 267Q27 387 92.5 465.5Q158 544 264 544Q360 544 422 465V718H560V0H433V77Q368 -10 264 -10Q158 -10 92.5 69.0Q27 148 27 267ZM170 267Q170 195 205.5 154.5Q241 114 295.0 114.0Q349 114 385.0 155.0Q421 196 421.0 269.0Q421 342 385.0 381.5Q349 421 295.0 421.0Q241 421 205.5 380.5Q170 340 170 267Z"],
  ["3128", "M226 0H74V718H226Z"],
  ["3417", "M201 291V0H62V534H190V458Q253 544 354 544Q436 544 485.5 492.0Q535 440 535 345V0H397V298Q397 421 303 421Q259 421 230.0 387.0Q201 353 201 291Z"],
] as const;
const CYAN = "oklch(0.86 0.15 205)";

export function Lockup({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 171.28 48" role="img" aria-label="Priced In">
      <g transform="translate(-8 0)">
        <path fill="currentColor" fillRule="evenodd" d="M10 40.25V19A14 14 0 1 1 15.5 30.12V40.25A2.75 2.75 0 0 1 10 40.25ZM24 10.5A8.5 8.5 0 1 0 24 27.5A8.5 8.5 0 1 0 24 10.5Z" />
        <path fill={CYAN} d="M25.41 20.27L29.14 14.34A0.7 0.7 0 0 0 28.1 13.4L22.59 17.73Z" />
        <circle fill={CYAN} cx="24" cy="19" r="3" />
      </g>
      <g transform="translate(46 30) scale(0.02924791086350975 -0.02924791086350975)">
        {WORD.map(([x, d]) => <path key={x} fill="currentColor" transform={`translate(${x} 0)`} d={d} />)}
        <path fill={CYAN} transform="translate(1004 0)" d="M223 658Q223 622 197.0 599.0Q171 576 130 576Q90 576 64.0 599.5Q38 623 38 658Q38 695 64.0 718.5Q90 742 130 742Q171 742 197.0 718.5Q223 695 223 658Z" />
      </g>
    </svg>
  );
}

const MONO: Record<string, string> = { "mono:DeFi": "DF", "mono:Ka": "Ka", "mono:Pm": "Pm", "mono:N": "N", "mono:Au": "Au" };

export function TopicIcon({ icon }: { icon: Fact["icon"] }) {
  if (icon.startsWith("mono:")) return <span className="ti mono" aria-hidden="true">{MONO[icon] ?? icon.slice(5, 7)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="ti" aria-hidden="true"><img src={`/icons/coin-${icon}.svg`} alt="" width={22} height={22} /></span>;
}
