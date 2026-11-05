// The ink law for running text: a sentence's price is drawn by Amstelvar's GRAD axis alone, which
// never changes a glyph's width, so nothing reflows when a price moves. The mapping is the one in
// .apex/design/exec/shared/kit.js (core/store's inkGrad), clamped to the font's real range,
// -300 (thin, doubted) to +500 (heavy, sure).
import { inkGrad } from "../../core/store";

export const grad = (p: number) => Math.max(-300, Math.min(500, inkGrad(p)));
export const runningInk = (p: number | null, opsz = 20) => (p === null ? `"opsz" ${opsz}` : `"opsz" ${opsz},"GRAD" ${grad(p)}`);
