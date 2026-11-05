// Entry point: `npm run api`. Reads services/api/.env if present, then the environment.
import { loadConfig, describeConfig } from "./config.mjs";
import { createApp } from "./app.mjs";

const { config, errors, warnings } = loadConfig(process.env);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`config error: ${e}`);
  console.error("Fix the environment (see services/api/.env.example) and start again.");
  process.exit(1);
}

let app;
try {
  app = createApp(config);
} catch (e) {
  // never echo key material: report which setting failed, not its value
  console.error(`startup failed: ${/key/i.test(e.message) ? "LANE_PRIVATE_KEY or PLANNER_PRIVATE_KEY is malformed" : e.message}`);
  process.exit(1);
}

const addr = await app.start();
console.log(`Priced In API on http://${addr.address === "0.0.0.0" || addr.address === "::" ? "localhost" : addr.address}:${addr.port}`);
console.log(JSON.stringify(describeConfig(config)));

const shutdown = async (sig) => {
  console.log(`${sig}: shutting down`);
  const t = setTimeout(() => process.exit(0), 3000);
  t.unref();
  await app.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
