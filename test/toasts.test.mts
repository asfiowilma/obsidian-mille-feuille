import { test } from "node:test";
import assert from "node:assert/strict";
import { CritStreak, AffordabilityTracker } from "../src/toasts.js";
import type { Reward } from "../src/rewards.js";

const mk = (over: Partial<Reward> = {}): Reward => ({
  type: "reward", name: "Spa day out", price: 500, servings: -1,
  purchasedCount: 0, claimedCount: 0, openPurchaseDates: [], state: "available", ...over,
});

test("crit streak returns count at 2+, resets on non-crit (V29)", () => {
  const s = new CritStreak();
  assert.equal(s.onCredit(true), null); // 1
  assert.equal(s.onCredit(true), 2);
  assert.equal(s.onCredit(true), 3);
  assert.equal(s.onCredit(false), null); // reset
  assert.equal(s.onCredit(true), null); // back to 1
});

test("affordability returns rewards crossing once, seeded silent (V28)", () => {
  const r = mk({ price: 500 });
  const t = new AffordabilityTracker();
  t.seed([r], 0);
  assert.deepEqual(t.check([r], 400).map((x) => x.name), []);
  assert.deepEqual(t.check([r], 500).map((x) => x.name), ["Spa day out"]);
  assert.deepEqual(t.check([r], 600).map((x) => x.name), []); // no re-fire
  assert.deepEqual(t.check([r], 100).map((x) => x.name), []); // drop below
  assert.deepEqual(t.check([r], 500).map((x) => x.name), ["Spa day out"]); // re-cross
});

test("affordability silent when seeded already affordable (V28 no toast on load)", () => {
  const r = mk({ price: 100 });
  const t = new AffordabilityTracker();
  t.seed([r], 500);
  assert.deepEqual(t.check([r], 500), []);
});
