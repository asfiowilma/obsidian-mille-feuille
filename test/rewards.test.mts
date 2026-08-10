import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveState, canBuy, purchase, claim, isSoldOut, isStale, remaining, slug,
  grantFree, isSingleEmoji, type Reward,
} from "../src/rewards.js";

const mk = (over: Partial<Reward> = {}): Reward => ({
  type: "reward", name: "Spa day out", price: 500, servings: 3,
  purchasedCount: 0, claimedCount: 0, openPurchaseDates: [], state: "available", ...over,
});

test("purchase deducts nothing to reward but bumps count + appends date (V7)", () => {
  const r = mk();
  const res = purchase(r, 500, "2026-08-09");
  assert.equal(res.ok, true);
  assert.equal(r.purchasedCount, 1);
  assert.deepEqual(r.openPurchaseDates, ["2026-08-09"]);
  assert.equal(r.state, "purchased");
});

test("purchase refused with no capacity (V7)", () => {
  const r = mk({ servings: 1, purchasedCount: 1, openPurchaseDates: [], claimedCount: 1 });
  assert.deepEqual(purchase(r, 9999, "2026-08-09"), { ok: false, reason: "no-capacity" });
});

test("purchase refused when unaffordable", () => {
  const r = mk();
  assert.deepEqual(purchase(r, 100, "2026-08-09"), { ok: false, reason: "insufficient" });
});

test("infinite servings always has capacity", () => {
  const r = mk({ servings: -1, purchasedCount: 99 });
  assert.equal(remaining(r), Infinity);
  assert.equal(canBuy(r, 500), true);
});

test("claim pops oldest FIFO, updates state (V8)", () => {
  const r = mk({ purchasedCount: 2, openPurchaseDates: ["2026-08-01", "2026-08-05"], claimedCount: 0 });
  assert.equal(claim(r), true);
  assert.deepEqual(r.openPurchaseDates, ["2026-08-05"]);
  assert.equal(r.claimedCount, 1);
  assert.equal(r.state, "purchased");
});

test("final claim on finite capacity → sold-out (V9)", () => {
  const r = mk({ servings: 1, purchasedCount: 1, openPurchaseDates: ["2026-08-01"] });
  claim(r);
  assert.equal(isSoldOut(r), true);
  assert.equal(deriveState(r), "sold-out");
});

test("deriveState: available when no open + capacity left", () => {
  assert.equal(deriveState(mk()), "available");
});

test("isStale when oldest open older than staleAfterDays (V11)", () => {
  const r = mk({ purchasedCount: 1, openPurchaseDates: ["2026-08-01"] });
  assert.equal(isStale(r, "2026-08-09", 7), true); // 8 days > 7
  assert.equal(isStale(r, "2026-08-07", 7), false); // 6 days
});

test("grantFree grants at no cost, checks capacity only (V50)", () => {
  const r = mk({ price: 500 });
  assert.equal(grantFree(r, "2026-08-10"), true); // balance never consulted
  assert.equal(r.purchasedCount, 1);
  assert.deepEqual(r.openPurchaseDates, ["2026-08-10"]);
  assert.equal(r.state, "purchased");
  // sold-out reward cannot be granted
  const sold = mk({ servings: 1, purchasedCount: 1, claimedCount: 1, openPurchaseDates: [] });
  assert.equal(grantFree(sold, "2026-08-10"), false);
});

test("isSingleEmoji: one grapheme incl ZWJ/flag/skin-tone; rejects text & multi (V53)", () => {
  for (const ok of ["😀", "👨‍👩‍👧", "🇮🇩", "👍🏽", "1️⃣"]) assert.equal(isSingleEmoji(ok), true, ok);
  for (const bad of ["", "ab", "😀😀", "A", "5"]) assert.equal(isSingleEmoji(bad), false, JSON.stringify(bad));
});

test("slug from name (V23)", () => {
  assert.equal(slug("Spa day out"), "spa-day-out");
  assert.equal(slug("  Noise-Cancelling  Headphones!! "), "noise-cancelling-headphones");
});
