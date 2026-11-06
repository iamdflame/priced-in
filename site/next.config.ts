import type { NextConfig } from "next";

// The API lives at one origin (API_ORIGIN, default the live service). The browser only ever talks to
// this site: the routes below forward to the API, so the site can later take the API's domain and a
// judge's check of /claims, /health, /events or /v1 keeps answering.
const API_ORIGIN = (process.env.API_ORIGIN || "https://isitpriced.com").replace(/\/+$/, "");

const pass = (from: string, to: string) => [
  { source: from, destination: `${API_ORIGIN}${to}` },
  { source: `${from}/:path*`, destination: `${API_ORIGIN}${to}/:path*` },
];

const config: NextConfig = {
  poweredByHeader: false,
  // the deploy uploads site/ alone: the build type-checks the app, and the tests (some read vectors
  // from the repo around it) are checked by npm run lint and run by vitest and Playwright
  typescript: { tsconfigPath: "tsconfig.build.json" },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_NEAR_NETWORK: process.env.NEAR_NETWORK || process.env.NEXT_PUBLIC_NEAR_NETWORK || "mainnet",
  },
  // the share cards read the kit's fonts and the dial from lib/og at request time
  outputFileTracingIncludes: { "/c/[id]/opengraph-image": ["./lib/og/**"], "/opengraph-image": ["./lib/og/**"] },
  images: { formats: ["image/avif", "image/webp"], minimumCacheTTL: 31536000 },
  // near-api-js pulls in a validator whose code generator calls util.format: a tiny browser shim
  turbopack: { root: process.cwd(), resolveAlias: { util: { browser: "./lib/core/util-shim.ts" } } },
  webpack: (cfg, { isServer }) => {
    if (!isServer) cfg.resolve.alias = { ...(cfg.resolve.alias || {}), util: `${process.cwd()}/lib/core/util-shim.ts` };
    return cfg;
  },
  async rewrites() {
    return [
      ...pass("/api", "/api"),
      ...pass("/health", "/api/health"),
      ...pass("/claims", "/api/claims"),
      ...pass("/events", "/api/events"),
      ...pass("/lane", "/api/lane"),
      ...pass("/v1", "/api/v1"),
      ...pass("/post", "/api/post"),
    ];
  },
  async headers() {
    return [
      { source: "/art/:path*", headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }] },
      { source: "/:path*", headers: [
        { key: "x-content-type-options", value: "nosniff" },
        { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
      ] },
    ];
  },
};

export default config;
