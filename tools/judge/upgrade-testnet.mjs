// Upgrades a testnet market in place to the reproducible build of this checkout, only if the
// contract's state layout is unchanged, and proves the result. Every step is in lib/upgrade.mjs.
//
//   node tools/judge/upgrade-testnet.mjs [--dry-run] [--from-rev <git rev>] [--set-fee-bps <n>]
//     [--no-pause] [--finish] [--state <file>] [--deployment <file>] [--no-record]
//
// --from-rev names the commit whose source built the live code (default: code.market.source_rev
// in the deployment file); the stored value types are compared with it.
// Defaults: --state .apex-test/judge-testnet.json (git-ignored, holds the test root's key, which
// is the market's full-access key) and --deployment deployments/testnet.json (public values).
// The swarm is not touched; the script says whether its build still matches the chain.
import { upgradeMarket } from "./lib/upgrade.mjs";

await upgradeMarket("testnet");
