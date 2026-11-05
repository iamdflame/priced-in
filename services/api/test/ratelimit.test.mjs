import { test } from "node:test";
import assert from "node:assert/strict";
import { DailyLimiter, clientIp, normalizeIp, DAY_MS } from "../src/ratelimit.mjs";

test("allows the limit per key per day, then refuses with a retry time", () => {
  let t = 5 * DAY_MS + 1000;
  const l = new DailyLimiter(3, { now: () => t });
  assert.equal(l.take("a").ok, true);
  assert.equal(l.take("a").ok, true);
  const third = l.take("a");
  assert.equal(third.ok, true);
  assert.equal(third.remaining, 0);
  const fourth = l.take("a");
  assert.equal(fourth.ok, false);
  assert.equal(fourth.retryAfterS, Math.ceil((DAY_MS - 1000) / 1000));
  assert.equal(l.take("b").ok, true, "other keys are independent");
});

test("release gives a unit back when the paid-for work failed", () => {
  const l = new DailyLimiter(1);
  assert.equal(l.take("a").ok, true);
  assert.equal(l.take("a").ok, false);
  l.release("a");
  assert.equal(l.take("a").ok, true);
});

test("the window resets at the UTC day boundary", () => {
  let t = 10 * DAY_MS + DAY_MS - 5;
  const l = new DailyLimiter(1, { now: () => t });
  assert.equal(l.take("a").ok, true);
  assert.equal(l.take("a").ok, false);
  t += 10;
  assert.equal(l.take("a").ok, true);
});

test("a zero limit refuses everything", () => {
  assert.equal(new DailyLimiter(0).take("a").ok, false);
});

test("client IP: socket address unless a trusted proxy says otherwise", () => {
  const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} });
  assert.equal(clientIp(req("::ffff:10.0.0.1"), false), "10.0.0.1");
  assert.equal(clientIp(req("10.0.0.1", "1.2.3.4"), false), "10.0.0.1", "XFF is ignored without TRUST_PROXY");
  assert.equal(clientIp(req("10.0.0.1", "6.6.6.6, 1.2.3.4"), true), "1.2.3.4", "the last hop, added by our proxy, is the client");
});

test("IPv6 addresses share a bucket per /64", () => {
  assert.equal(normalizeIp("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(normalizeIp("2001:db8:1:2:bbbb:cccc:dddd:eeee"), "2001:db8:1:2::/64");
  assert.equal(normalizeIp("::1"), "0:0:0:0::/64");
  assert.equal(normalizeIp("8.8.8.8"), "8.8.8.8");
});
