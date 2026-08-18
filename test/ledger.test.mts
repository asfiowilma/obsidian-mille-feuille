import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance, isCredited, frozenChips, aggregate, missingClosedMonths, habitCreditKey, migrateHabitKeys, groupByMonth,
  type LedgerEntry, type CreditEntry, type ReversalEntry,
} from "../src/ledger.js";

const credit = (key: string, chips: number, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ kind: "credit", date: "2026-08-09", source: "task", key, base: chips, crit: null, chips, tier: null, ...extra } as LedgerEntry);

test("balance = credit + reversal + signed spend; pre-fix spend counts 0 (V6,V35)", () => {
  const e: LedgerEntry[] = [
    credit("a", 10),
    { kind: "spend", date: "2026-08-09", reward: "X", price: 500 }, // pre-fix: no chips → 0
    { kind: "spend", date: "2026-08-09", reward: "Y", price: 4, chips: -4 }, // purchase lowers balance
    { kind: "claim", date: "2026-08-09", reward: "X" },
    credit("b", 20),
  ];
  assert.equal(balance(e), 26); // 10 + 20 - 4; pre-fix spend + claim move nothing
});

test("gacha rebate_big can net a positive balance move (V40, design B)", () => {
  const e: LedgerEntry[] = [
    credit("a", 5),
    { kind: "spend", date: "2026-08-09", subtype: "gacha", chips: 3, outcome: "rebate_big", value: 8 },
  ];
  assert.equal(balance(e), 8);
});

test("unchecked completion nets to zero via reversal (V6,V14)", () => {
  const e: LedgerEntry[] = [
    credit("h1", 8),
    { kind: "reversal", date: "2026-08-09", reversalOf: "h1", chips: -8 },
  ];
  assert.equal(balance(e), 0);
  assert.equal(isCredited(e, "h1"), false);
});

test("isCredited tracks credit then reversal then re-credit (V13,V14)", () => {
  const e: LedgerEntry[] = [credit("h1", 8)];
  assert.equal(isCredited(e, "h1"), true);
  e.push({ kind: "reversal", date: "2026-08-09", reversalOf: "h1", chips: -8 });
  assert.equal(isCredited(e, "h1"), false);
  e.push(credit("h1", 8));
  assert.equal(isCredited(e, "h1"), true);
});

test("frozenChips returns most recent credit for key (V14)", () => {
  const e: LedgerEntry[] = [credit("h1", 8, { crit: 2.0, chips: 16, base: 8 })];
  assert.equal(frozenChips(e, "h1")?.chips, 16);
  assert.equal(frozenChips(e, "missing"), null);
});

test("aggregate rolls month from ledger only (V16)", () => {
  const e: LedgerEntry[] = [
    credit("a", 10, { tier: null, source: "task" }),
    credit("b", 30, { tier: "#x3", source: "milestone", crit: null }),
    credit("c", 16, { tier: "ult", source: "habit", crit: 2.0 }),
    { kind: "spend", date: "2026-08-09", reward: "X", price: 500 },
    { kind: "claim", date: "2026-08-09", reward: "X" },
    { kind: "reversal", date: "2026-08-09", reversalOf: "a", chips: -10 },
    credit("d", 10, { date: "2026-07-01" } as Partial<LedgerEntry>),
  ];
  const a = aggregate(e, "2026-08");
  assert.equal(a.chipsBySource.task, 10);
  assert.equal(a.chipsBySource.milestone, 30);
  assert.equal(a.chipsByTier["#x3"], 30);
  assert.equal(a.critCount, 1);
  assert.equal(a.purchased, 1);
  assert.equal(a.claimed, 1);
  assert.equal(a.reversals, 1);
  assert.equal(a.gachaRolls, 0);
  // July credit excluded
  assert.equal(a.chipsByTier.base, 10); // only August 'a' credit counted under base
});

test("aggregate keeps gacha separate: rolls/rebated/claims, not in purchased (V16,V41)", () => {
  const e: LedgerEntry[] = [
    { kind: "spend", date: "2026-08-09", reward: "Spa", price: 5, chips: -5 }, // real purchase
    { kind: "spend", date: "2026-08-09", subtype: "gacha", chips: -5, outcome: "nothing" }, // roll
    { kind: "spend", date: "2026-08-10", subtype: "gacha", chips: -3, outcome: "rebate_small", value: 2 }, // roll + rebate
    { kind: "spend", date: "2026-08-11", subtype: "gacha", chips: -5, outcome: "free_reward" }, // roll, empty pool
    { kind: "spend", date: "2026-08-11", reward: "Book", price: 0, subtype: "gacha", outcome: "free_reward" }, // grant marker
  ];
  const a = aggregate(e, "2026-08");
  assert.equal(a.purchased, 1); // only the real purchase
  assert.equal(a.gachaRolls, 3); // three reward-less gacha spends
  assert.equal(a.gachaRebated, 2);
  assert.equal(a.gachaClaims, 1); // the grant marker
});

test("missingClosedMonths: closed months with credits and no aggregate, oldest-first (V33)", () => {
  const e: LedgerEntry[] = [
    credit("a", 10, { date: "2026-06-02" } as Partial<LedgerEntry>),
    credit("b", 10, { date: "2026-07-05" } as Partial<LedgerEntry>),
    credit("c", 10, { date: "2026-08-01" } as Partial<LedgerEntry>), // current month, skip
    { kind: "spend", date: "2026-05-01", reward: "X", price: 5 }, // no credit that month, skip
  ];
  assert.deepEqual(missingClosedMonths(e, ["2026-06"], "2026-08"), ["2026-07"]); // June has agg, Aug open, May no credit
  assert.deepEqual(missingClosedMonths(e, [], "2026-08"), ["2026-06", "2026-07"]);
});

test("rescan idempotency: re-crediting an already-credited key never double-credits (V32,V13)", () => {
  const e: LedgerEntry[] = [credit("task:file:x", 10)];
  // rescan re-reads same [x] line; isCredited true → decideAction would return "none"
  assert.equal(isCredited(e, "task:file:x"), true);
  // reversed key stays reversed on rescan (line now unchecked → none, balance unchanged)
  e.push({ kind: "reversal", date: "2026-08-09", reversalOf: "task:file:x", chips: -10 });
  assert.equal(isCredited(e, "task:file:x"), false);
  assert.equal(balance(e), 0);
});

test("same-day farm + ult habit keys don't collide; legacy keys migrate (V12,V13)", () => {
  assert.notEqual(habitCreditKey("kanji", "farm", "2026-08-18"), habitCreditKey("kanji", "ult", "2026-08-18"));

  const legacy: LedgerEntry[] = [
    { kind: "credit", date: "2026-08-18", source: "habit", key: "kanji·2026-08-18", base: 2, crit: null, chips: 2, tier: "farm" },
    { kind: "reversal", date: "2026-08-18", reversalOf: "kanji·2026-08-18", chips: -2 },
  ];
  const m = migrateHabitKeys(legacy);
  assert.equal((m[0] as CreditEntry).key, "kanji·farm·2026-08-18");
  assert.equal((m[1] as ReversalEntry).reversalOf, "kanji·farm·2026-08-18");
  assert.equal(isCredited(m, "kanji·farm·2026-08-18"), false); // reversal still lines up
  // rerun is a no-op (already tiered)
  assert.equal((migrateHabitKeys(m)[0] as CreditEntry).key, "kanji·farm·2026-08-18");
  // ult on the same day is untouched by the farm credit
  assert.equal(isCredited(m, "kanji·ult·2026-08-18"), false);
});

test("groupByMonth buckets a batch per ledger file, order kept (V20)", () => {
  const e: LedgerEntry[] = [
    credit("a", 1, { date: "2026-08-18" }),
    credit("b", 2, { date: "2026-07-02" }),
    credit("c", 3, { date: "2026-08-01" }),
  ];
  const g = groupByMonth(e);
  assert.deepEqual([...g.keys()], ["2026-08", "2026-07"]);
  assert.deepEqual(g.get("2026-08")!.map((x) => (x as CreditEntry).key), ["a", "c"]);
  assert.equal(g.get("2026-07")!.length, 1);
  assert.equal(groupByMonth([]).size, 0);
});
