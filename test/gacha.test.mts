import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GACHA, gachaActive, sumWeights, rollOutcome, rollNet, todayRollCount, canRoll,
  type GachaConfig,
} from "../src/gacha.js";
import type { LedgerEntry } from "../src/ledger.js";

const cfg = (over: Partial<GachaConfig> = {}): GachaConfig => ({ ...structuredClone(DEFAULT_GACHA), enabled: true, ...over });
const roll = (date: string): LedgerEntry => ({ kind: "spend", date, subtype: "gacha", chips: -5, outcome: "nothing" });

test("gachaActive off when disabled / empty table / zero weights (V37)", () => {
  assert.equal(gachaActive(cfg({ enabled: false })), false);
  assert.equal(gachaActive(cfg({ outcomes: [] })), false);
  assert.equal(gachaActive(cfg({ outcomes: [{ type: "nothing", weight: 0 }] })), false);
  assert.equal(gachaActive(cfg()), true);
});

test("rollOutcome picks by weight; boundaries map to right bucket (V38)", () => {
  const g = cfg({ outcomes: [
    { type: "nothing", weight: 50 },
    { type: "rebate_small", weight: 30, value: 2 },
    { type: "rebate_big", weight: 15, value: 8 },
    { type: "free_reward", weight: 5 },
  ] });
  assert.equal(sumWeights(g), 100);
  // rng*total: 0→nothing, 60→rebate_small, 82→rebate_big, 98→free_reward
  assert.equal(rollOutcome(g, () => 0).type, "nothing");
  assert.equal(rollOutcome(g, () => 0.60).type, "rebate_small");
  assert.equal(rollOutcome(g, () => 0.82).type, "rebate_big");
  assert.equal(rollOutcome(g, () => 0.98).type, "free_reward");
});

test("rollNet = -cost + rebate; nothing/free add 0; big can net positive (V38, design B)", () => {
  assert.equal(rollNet(5, { type: "nothing", weight: 1 }), -5);
  assert.equal(rollNet(5, { type: "rebate_small", weight: 1, value: 2 }), -3);
  assert.equal(rollNet(5, { type: "rebate_big", weight: 1, value: 8 }), 3); // positive net
  assert.equal(rollNet(5, { type: "free_reward", weight: 1 }), -5);
});

test("todayRollCount counts only gacha rolls (no reward) dated today (V39)", () => {
  const e: LedgerEntry[] = [
    roll("2026-08-10"), roll("2026-08-10"),
    roll("2026-08-09"), // other day
    { kind: "spend", date: "2026-08-10", reward: "Spa", price: 5, chips: -5 }, // purchase
    { kind: "spend", date: "2026-08-10", reward: "Spa", price: 0, subtype: "gacha", outcome: "free_reward" }, // grant marker (has reward)
  ];
  assert.equal(todayRollCount(e, "2026-08-10"), 2);
});

test("canRoll: daily limit checked BEFORE balance (V36,V39)", () => {
  const g = cfg({ cost: 5, maxRollsPerDay: 5 });
  const capped: LedgerEntry[] = Array.from({ length: 5 }, () => roll("2026-08-10"));
  // capped AND broke → reports no-rolls, not insufficient
  assert.deepEqual(canRoll(g, capped, 3, "2026-08-10"), { ok: false, reason: "no-rolls" });
  // room left but broke
  assert.deepEqual(canRoll(g, [], 3, "2026-08-10"), { ok: false, reason: "insufficient" });
  // ok
  assert.deepEqual(canRoll(g, [], 100, "2026-08-10"), { ok: true });
  // maxRollsPerDay 0 = unlimited
  assert.deepEqual(canRoll(cfg({ cost: 5, maxRollsPerDay: 0 }), capped, 100, "2026-08-10"), { ok: true });
  // off
  assert.deepEqual(canRoll(cfg({ enabled: false }), [], 100, "2026-08-10"), { ok: false, reason: "off" });
});
