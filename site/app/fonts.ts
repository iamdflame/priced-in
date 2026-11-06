// The kit's type, self-hosted through next/font: General Sans (voice and big numbers), Geist (reading
// and every changing number), Geist Mono (hashes), Amstelvar (only what Wikipedia says), and a
// one-glyph Inter subset for the ₮ in USD₮, which neither General Sans nor Geist has.
import localFont from "next/font/local";

export const general = localFont({
  src: [
    { path: "./fonts/GeneralSans-500.woff2", weight: "500" },
    { path: "./fonts/GeneralSans-600.woff2", weight: "600" },
    { path: "./fonts/GeneralSans-700.woff2", weight: "700" },
  ],
  variable: "--font-general",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const geist = localFont({
  src: [{ path: "./fonts/Geist-latin.woff2", weight: "100 900" }],
  variable: "--font-geist",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const geistMono = localFont({
  src: [{ path: "./fonts/GeistMono-latin.woff2", weight: "100 900" }],
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "monospace"],
});

export const amstelvar = localFont({
  src: [
    { path: "./fonts/amstelvar-roman.woff2", weight: "100 1000", style: "normal" },
    { path: "./fonts/amstelvar-italic.woff2", weight: "100 1000", style: "italic" },
  ],
  variable: "--font-amstelvar",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "serif"],
});

export const tugrik = localFont({
  src: [{ path: "./fonts/Inter-tugrik.woff2", weight: "100 900" }],
  variable: "--font-tugrik",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const fontVars = [general.variable, geist.variable, geistMono.variable, amstelvar.variable, tugrik.variable].join(" ");
