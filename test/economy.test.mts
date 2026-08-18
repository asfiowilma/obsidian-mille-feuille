import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ECONOMY, classifyLine, milestoneMultiplier, rollCrit, payout, type Rng,
} from "../src/economy.js";

const seq = (vals: number[]): Rng => { let i = 0; return () => vals[i++ % vals.length]; };

test("classify regular task → defaultBase", () => {
  const c = classifyLine("Restock choc chips", DEFAULT_ECONOMY);
  assert.equal(c.source, "task");
  assert.equal(c.base, 10);
});

test("classify milestone tag anywhere, any depth → base × multiplier (V4,V5)", () => {
  const c = classifyLine("Ship the bakery site #x3", DEFAULT_ECONOMY);
  assert.equal(c.source, "milestone");
  assert.equal(c.base, 30);
  assert.equal(c.tier, "#x3");
  // deeply indented still matches
  assert.equal(classifyLine("      finish #x2 thing", DEFAULT_ECONOMY).base, 20);
});

test("#x tag inside a word is not a milestone", () => {
  assert.equal(classifyLine("prefix#x2suffix", DEFAULT_ECONOMY).source, "task");
});

test("classify habit tier via ` · <tier>` (V12)", () => {
  assert.equal(classifyLine("abc · farm ✅ 2026-08-09", DEFAULT_ECONOMY).base, 8);
  assert.equal(classifyLine("abc · ult ✅ 2026-08-09", DEFAULT_ECONOMY).base, 20);
  const h = classifyLine("abc · farm ✅ 2026-08-09", DEFAULT_ECONOMY);
  assert.equal(h.source, "habit");
  assert.equal(h.tier, "farm");
});

test("untiered habit falls to defaultBase", () => {
  assert.equal(classifyLine("abc · bogus ✅ 2026-08-09", DEFAULT_ECONOMY).base, 10);
});

test("rollCrit fires below chance, picks from multipliers (V2)", () => {
  assert.equal(rollCrit(DEFAULT_ECONOMY, seq([0.9])), null); // 0.9 >= 0.15 → no crit
  assert.equal(rollCrit(DEFAULT_ECONOMY, seq([0.05, 0.0])), 1.5); // crit, pick idx 0
  assert.equal(rollCrit(DEFAULT_ECONOMY, seq([0.05, 0.99])), 2.0); // crit, pick last
});

test("payout applies crit multiplier, rounds (V2)", () => {
  assert.deepEqual(payout(10, DEFAULT_ECONOMY, seq([0.9])), { base: 10, crit: null, chips: 10 });
  assert.deepEqual(payout(10, DEFAULT_ECONOMY, seq([0.05, 0.0])), { base: 10, crit: 1.5, chips: 15 });
});

test("milestoneMultiplier null when no tag", () => {
  assert.equal(milestoneMultiplier("plain task", DEFAULT_ECONOMY), null);
});

test("gaming payload → source gaming, base = payload; habit and no-payload untouched (V77 / AC 25)", () => {
  const g = classifyLine("Gaming session 2026-08-18 · gaming:14 #gaming-session", DEFAULT_ECONOMY);
  assert.deepEqual(g, { source: "gaming", base: 14, tier: null });
  assert.equal(classifyLine("Gaming session 2026-08-18 (2) · gaming:0", DEFAULT_ECONOMY).base, 0); // gaming:0 is valid
  assert.equal(classifyLine("meditate · ult ✅ 2026-08-18", DEFAULT_ECONOMY).source, "habit"); // still a habit line
  assert.deepEqual(classifyLine("Gaming session 2026-08-18", DEFAULT_ECONOMY), { source: "task", base: DEFAULT_ECONOMY.defaultBase, tier: null });
  // an unreadable payload is not a payload — the line falls back to a regular task
  assert.equal(classifyLine("Gaming session · gaming:oops", DEFAULT_ECONOMY).source, "task");
  // the payload wins over a hand-added milestone tag: the amount is the amount (V77)
  assert.equal(classifyLine("Gaming session · gaming:14 #x2", DEFAULT_ECONOMY).base, 14);
});
