/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// NEAR_NETWORK may be given without the VITE_ prefix (the services use that name).
const network = process.env.VITE_NEAR_NETWORK || process.env.NEAR_NETWORK || "testnet";

export default defineConfig({
  define: { __PRICEDIN_NETWORK__: JSON.stringify(network) },
  resolve: { alias: { util: fileURLToPath(new URL("./src/shims/util.ts", import.meta.url)) } },
  server: { port: 5173, fs: { allow: [".."] } },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 600 },
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 15000 },
});
