// The e2e's offline stack, shared by run.mjs (the checks) and serve.mjs (a stack left running for
// screenshots): services/api's mock RPC behind a market shim that executes trades with the real
// LMSR, services/api with the AI writer mounted on services/ai's offline NEAR AI stand-in, and this
// web app on Vite (dev server, or the production build with build: true). Testnet names only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");

export const MARKET = "market.e2e.testnet";
export const LANE = "lane.e2e.testnet";

export async function startStack({ claims, build = false, port = 5199, env: extra = {} }) {
  if ((process.env.NEAR_NETWORK || "testnet") !== "testnet" || (process.env.VITE_NEAR_NETWORK || "testnet") !== "testnet") throw new Error("the web e2e runs on testnet names only");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-web-e2e-"));
  const cleanup = [];
  const stop = async () => {
    for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* keep closing */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fine */ }
  };
  try {
    const { KeyPair } = await import("near-api-js");
    const { startMockNearAI, MOCK_MODELS } = await import("../../services/ai/test/mock-nearai.mjs");
    const { loadAiConfig } = await import("../../services/ai/src/config.js");
    const { mountAi } = await import("../../services/ai/src/mount.js");
    const { createApp } = await import("../../services/api/src/app.mjs");
    const { startMarketShim } = await import("./market-shim.mjs");

    const nearai = await startMockNearAI();
    cleanup.push(() => nearai.close?.());
    const writerModel = MOCK_MODELS[2];
    const shim = await startMarketShim({ marketId: MARKET, laneAccountId: LANE, models: { [writerModel]: nearai.signerHex(writerModel) }, claims });
    cleanup.push(() => shim.close());
    const admin = KeyPair.fromRandom("ed25519");
    shim.mock.addAdminKey(LANE, admin.getPublicKey().toString());

    const env = {
      NEAR_NETWORK: "testnet", HOST: "127.0.0.1", PORT: "0", SCAN_INTERVAL_MS: "100", CORS_ORIGINS: "*",
      MARKET_CONTRACT_ID: MARKET, LANE_ACCOUNT_ID: LANE, LANE_PRIVATE_KEY: admin.toString(),
      RPC_URLS: shim.urls[0], PUBLIC_RPC_URLS: shim.urls.join(","),
      NEARAI_API_KEY: nearai.apiKey, NEARAI_BASE_URL: nearai.url, WRITER_MODEL: writerModel, WRITER_SIGNATURE_DEADLINE_MS: "4000",
      LEDGER_FILE: path.join(tmp, "ledger.json"), ATTESTATIONS_DIR: path.join(tmp, "attestations"), JURY_AUTO: "0",
      ...(typeof extra === "function" ? extra({ nearai, MOCK_MODELS }) : extra),
    };
    const { api: apiCfg, ai, errors } = loadAiConfig(env);
    if (errors.length) throw new Error(errors.join("; "));
    const app = createApp(apiCfg, { log: () => {} });
    mountAi(app, ai, { quoteVerifier: nearai.quoteVerifier, gpuVerifier: nearai.gpuVerifier, log: () => {} });
    // the hosted site's after-trade hook: the offline API scans its own chain, so it has nothing to do here
    app.addRoute("POST", "/after-trade", async () => ({ status: 200, body: { status: "ignored", note: "the offline stack scans the chain itself" } }));
    const addr = await app.start();
    cleanup.push(() => app.stop());
    const api = `http://127.0.0.1:${addr.port}`;

    process.env.VITE_API_BASE = api;
    process.env.VITE_NEAR_NETWORK = "testnet";
    process.env.VITE_RPC_URLS = shim.urls.join(",");
    const { createServer, build: viteBuild, preview } = await import("vite");
    let vite;
    if (build) {
      const outDir = path.join(tmp, "dist");
      await viteBuild({ root: web, configFile: path.join(web, "vite.config.ts"), logLevel: "error", build: { outDir, emptyOutDir: true } });
      vite = await preview({ root: web, configFile: path.join(web, "vite.config.ts"), logLevel: "error", build: { outDir }, preview: { port: port - 1, strictPort: false, host: "127.0.0.1" } });
      vite.close = vite.close || (() => new Promise((r) => vite.httpServer.close(r)));
    } else {
      vite = await createServer({ root: web, configFile: path.join(web, "vite.config.ts"), logLevel: "error", server: { port, strictPort: false, host: "127.0.0.1" } });
      await vite.listen();
    }
    cleanup.push(() => vite.close());
    const site = vite.resolvedUrls.local[0].replace(/\/$/, "");
    return { site, api, shim, app, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
