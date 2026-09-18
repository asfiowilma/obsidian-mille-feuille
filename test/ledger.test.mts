import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance, isCredited, frozenChips, aggregate, missingClosedMonths, habitCreditKey, migrateHabitKeys, groupByMonth,
  dedupeCredits, collapseByMonth, dedupeCreditsByFile, duplicateCreditMonths,
  type MonthlyAggregate,
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

test("gaming chips are separate in the aggregate (V16,V66 / AC 20)", () => {
  const e: LedgerEntry[] = [
    { kind: "credit", date: "2026-08-01", source: "task", key: "a", base: 40, crit: null, chips: 40, tier: null },
    { kind: "credit", date: "2026-08-02", source: "gaming", key: "g1", base: 14, crit: null, chips: 14, tier: null },
    { kind: "credit", date: "2026-08-03", source: "gaming", key: "g2", base: 8, crit: 1.5, chips: 8, tier: null },
  ];
  const a = aggregate(e, "2026-08");
  assert.equal(a.chipsBySource.gaming, 22);
  assert.equal(a.chipsBySource.task, 40); // gaming never folded into the task total
  assert.equal(a.chipsByTier.base, 40); // §V66 gaming stays out of chipsByTier entirely
  assert.equal(a.critCount, 1); // §V78 a gaming crit still counts
});

test("dedupeCredits: one credit per key, first wins, balance counts it once (V90)", () => {
  const strayfe = credit("task:Daily/2026-09-01.md:skincare-am·✅2026-09-01", 2);
  const hydra = credit("task:Daily/2026-09-01.md:skincare-am·✅2026-09-01", 2, { date: "2026-09-08" });
  const other = credit("kanji·farm·2026-09-15", 4);
  const out = dedupeCredits([strayfe, hydra, other]);

  assert.deepEqual(out, [strayfe, other], "second row for the key drops, first survives");
  assert.equal(balance(out), 6);
  assert.equal(balance([strayfe, hydra, other]), 8, "sanity: the dupe really did over-credit");
});

test("dedupeCredits: the surviving row is the winner frozenChips reports (V90)", () => {
  const key = "kanji·farm·2026-09-15";
  const first = credit(key, 4, { crit: 2, base: 2 });
  const dupe = credit(key, 3, { crit: 1.5, base: 2, date: "2026-09-17" });
  const out = dedupeCredits([first, dupe]);

  // pre-dedupe frozenChips took the LAST row, so the devices disagreed on crit
  assert.equal(frozenChips([first, dupe], key)?.crit, 1.5);
  assert.equal(frozenChips(out, key)?.crit, 2, "both devices now read the same crit");
  assert.equal(frozenChips(out, key)?.chips, 4);
});

test("dedupeCredits: a deduped key that was reversed still reads uncredited (V90)", () => {
  const key = "kanji·farm·2026-09-15";
  const rev: ReversalEntry = { kind: "reversal", date: "2026-09-16", reversalOf: key, chips: -4 };
  const out = dedupeCredits([credit(key, 4), credit(key, 4, { date: "2026-09-17" }), rev]);

  assert.equal(isCredited(out, key), false);
  assert.equal(balance(out), 0, "one credit collapsed, one reversal cancels it");
});

test("dedupeCredits leaves spend / claim / gacha rows alone (V90)", () => {
  const buy: LedgerEntry = { kind: "spend", date: "2026-09-11", reward: "Adhoc game time", price: 5, chips: -5 };
  const claim: LedgerEntry = { kind: "claim", date: "2026-09-11", reward: "Adhoc game time" };
  const roll: LedgerEntry = { kind: "spend", date: "2026-09-11", chips: -3, subtype: "gacha", outcome: "nothing" };
  const rows = [buy, buy, buy, claim, claim, roll, roll];

  assert.deepEqual(dedupeCredits(rows), rows, "repeatable events have no key and all count");
  assert.equal(balance(dedupeCredits(rows)), -21);
});

test("dedupeCredits: aggregate counts a duplicated key once, critCount included (V90)", () => {
  const key = "kanji·farm·2026-09-15";
  const rows = [
    credit(key, 4, { date: "2026-09-15", tier: "farm", source: "habit", crit: 2, base: 2 }),
    credit(key, 3, { date: "2026-09-17", tier: "farm", source: "habit", crit: 1.5, base: 2 }),
  ];
  const dirty = aggregate(rows, "2026-09");
  const clean = aggregate(dedupeCredits(rows), "2026-09");

  assert.equal(dirty.critCount, 2);
  assert.equal(clean.critCount, 1);
  assert.equal(clean.chipsByTier.farm, 4);
  assert.equal(clean.chipsBySource.habit, 4);
});

test("collapseByMonth: one row per month, first wins, sorted by month (V91)", () => {
  const agg = (month: string, critCount: number): MonthlyAggregate => ({
    month, chipsByTier: {}, chipsBySource: {}, critCount,
    purchased: 0, claimed: 0, reversals: 0, gachaRolls: 0, gachaRebated: 0, gachaClaims: 0,
  });
  // union order = file path order: legacy aggregates.md, then hydra's, then strayfe's
  const out = collapseByMonth([agg("2026-08", 3), agg("2026-09", 7), agg("2026-08", 9), agg("2026-07", 1)]);

  assert.deepEqual(out.map((a) => a.month), ["2026-07", "2026-08", "2026-09"]);
  assert.equal(out[1].critCount, 3, "the second row for 2026-08 loses to the first");
});

test("dedupeCreditsByFile: each file keeps only the credits it wins (V93)", () => {
  const key = "kanji·farm·2026-09-15";
  const buy: LedgerEntry = { kind: "spend", date: "2026-09-11", reward: "game time", price: 5, chips: -5 };
  const files = [
    { path: "mf/ledger/2026-09.hydra.md", rows: [credit(key, 4), buy] },
    { path: "mf/ledger/2026-09.strayfe.md", rows: [credit(key, 3), credit("other", 2), buy] },
  ];
  const out = dedupeCreditsByFile(files);

  assert.deepEqual(out[0].rows, files[0].rows, "the winning lane is untouched");
  assert.deepEqual(out[1].rows.map((e) => e.kind), ["credit", "spend"], "loser drops, spend stays");
  assert.equal(balance(out.flatMap((f) => f.rows)), balance(dedupeCredits(files.flatMap((f) => f.rows))),
    "pruning to disk gives the same balance the read-time dedupe already gives");
});

test("dedupeCreditsByFile: re-running on pruned files is a no-op (V93)", () => {
  const files = [
    { path: "a.md", rows: [credit("k", 4)] },
    { path: "b.md", rows: [credit("k", 4), credit("k2", 1)] },
  ];
  const once = dedupeCreditsByFile(files);
  const twice = dedupeCreditsByFile(once);
  assert.deepEqual(twice, once);
});

test("duplicateCreditMonths lists only months that really hold a dupe (V93)", () => {
  const rows = [
    credit("a", 2, { date: "2026-08-01" }),
    credit("b", 2, { date: "2026-09-01" }),
    credit("b", 2, { date: "2026-09-08" }), // the dupe, credited on the other device a week later
    credit("c", 2, { date: "2026-09-20" }),
  ];
  assert.deepEqual(duplicateCreditMonths(rows), ["2026-09"]);
  assert.deepEqual(duplicateCreditMonths(dedupeCredits(rows)), [], "nothing left to prune after a prune");
});
