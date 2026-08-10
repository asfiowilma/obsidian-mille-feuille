import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance, isCredited, frozenChips, aggregate, missingClosedMonths, type LedgerEntry,
} from "../src/ledger.js";

const credit = (key: string, chips: number, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ kind: "credit", date: "2026-08-09", source: "task", key, base: chips, crit: null, chips, tier: null, ...extra } as LedgerEntry);

test("balance = sum of credit + reversal only (V3,V6)", () => {
  const e: LedgerEntry[] = [
    credit("a", 10),
    { kind: "spend", date: "2026-08-09", reward: "X", price: 500 },
    { kind: "claim", date: "2026-08-09", reward: "X" },
    credit("b", 20),
  ];
  assert.equal(balance(e), 30); // spend/claim don't move balance
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
  // July credit excluded
  assert.equal(a.chipsByTier.base, 10); // only August 'a' credit counted under base
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
