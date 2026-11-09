// scripts/mainnet/send.mjs's go or no-go: the owner funds one outside account, on the record, and never
// its own accounts, never past the caps, never below the keeper's gas floor.
import test from "node:test";
import assert from "node:assert/strict";
import { sendPlan, MAX_NEAR, MAX_USDC, OWNER_FLOOR_NEAR } from "../../../scripts/mainnet/send-plan.mjs";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const base = { to: "smoothquery7758.near", near: 0.1, usdc: 2, why: "Dispute drill: the founder's wallet objects with $2 (funded by the entrant)", owner: "isitpriced.near", usdcContract: USDC, recipientExists: true, registered: false, storageNear: 0.00125, ownerSpareNear: 1.0, ownerUsdcMicro: 6_000_000n };

test("send: the drill wallet's 0.1 NEAR and $2, registering it for USDC first", () => {
  const p = sendPlan(base);
  assert.equal(p.ok, true);
  assert.equal(p.register, true);
  assert.equal(p.nearYocto, 10n ** 23n);
  assert.equal(p.usdcMicro, 2_000_000n);
  assert.ok(p.spareAfter > OWNER_FLOOR_NEAR);
  assert.equal(sendPlan({ ...base, registered: true }).register, false, "a registered account is not registered again");
  assert.equal(sendPlan({ ...base, usdc: 0 }).register, false, "NEAR alone needs no USDC registration");
});

test("send: never to the owner's own accounts, the USDC contract, or an account that doesn't exist", () => {
  for (const to of ["isitpriced.near", "market.isitpriced.near", "h-archivist.isitpriced.near", "sentinel.isitpriced.near"]) assert.equal(sendPlan({ ...base, to }).ok, false, to);
  assert.equal(sendPlan({ ...base, to: USDC }).ok, false);
  assert.equal(sendPlan({ ...base, recipientExists: false }).ok, false);
  assert.equal(sendPlan({ ...base, to: "Not An Account" }).ok, false);
  assert.equal(sendPlan({ ...base, to: "notisitpriced.near" }).ok, true, "a name that merely ends the same way is someone else's");
});

test("send: the caps, the keeper's gas floor, the owner's USDC and the reason", () => {
  assert.equal(sendPlan({ ...base, near: MAX_NEAR + 0.01 }).ok, false);
  assert.equal(sendPlan({ ...base, usdc: MAX_USDC + 0.01 }).ok, false);
  assert.equal(sendPlan({ ...base, near: 0, usdc: 0 }).ok, false);
  assert.equal(sendPlan({ ...base, near: -1 }).ok, false);
  assert.match(sendPlan({ ...base, ownerSpareNear: 0.6 }).why, /keeper/, "0.6 spare less 0.1 sent dips under the 0.5 floor");
  assert.match(sendPlan({ ...base, ownerUsdcMicro: 1_990_000n }).why, /holds \$1\.99/);
  assert.equal(sendPlan({ ...base, why: "" }).ok, false);
  assert.equal(sendPlan({ ...base, why: "x".repeat(201) }).ok, false);
});
