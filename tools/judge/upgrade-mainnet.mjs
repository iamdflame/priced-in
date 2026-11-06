// Upgrades market.isitpriced.near in place to the reproducible build of this checkout: the same
// path as upgrade-testnet.mjs, which the rehearsal proves first (tools/judge/lib/upgrade.mjs).
//
//   node tools/judge/upgrade-mainnet.mjs --dry-run --set-fee-bps 100        reads only, needs no key
//   CONFIRM_MAINNET=yes node tools/judge/upgrade-mainnet.mjs --set-fee-bps 100
//
// It refuses without CONFIRM_MAINNET=yes, before it reads any key. NEAR_DEPLOYER_PRIVATE_KEY comes
// from .env, only once every read-only check has passed; it must be a full-access key on the
// market and on its owner. The market is paused for the upgrade, about a minute, unless --no-pause.
// A failure after the pause leaves it paused, on purpose: no USDC can leave while it is looked at.
// --finish completes a run that was cut off after the code was deployed. deployments/mainnet.json
// takes the new code hash and an upgrades[] entry.
import { upgradeMarket } from "./lib/upgrade.mjs";

await upgradeMarket("mainnet");
