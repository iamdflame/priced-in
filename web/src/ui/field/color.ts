// Colour helpers: resolve any CSS colour (oklch tokens included) to sRGB through the canvas
// itself, then mix in linear light so atmospheric fades stay clean.

export type RGB = [number, number, number];

const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (c: number) => { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, v)) * 255); };

let probe: CanvasRenderingContext2D | null = null;

export function resolve(css: string): RGB {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) { const n = parseInt(hex[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  if (typeof document === "undefined") return [128, 128, 128];
  if (!probe) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probe = c.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return [128, 128, 128];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/** Mix a towards b by t (0..1) in linear light. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    toSrgb(toLin(a[0]) + (toLin(b[0]) - toLin(a[0])) * t),
    toSrgb(toLin(a[1]) + (toLin(b[1]) - toLin(a[1])) * t),
    toSrgb(toLin(a[2]) + (toLin(b[2]) - toLin(a[2])) * t),
  ];
}

export const css = (c: RGB, alpha = 1) => (alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`);
