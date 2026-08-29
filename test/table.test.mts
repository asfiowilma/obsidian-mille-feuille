import { test } from "node:test";
import assert from "node:assert/strict";
import { tableBlock, parseLedgerBlock, parseLedgerBlockStrict } from "../src/table.js";
import { jsonBlock } from "../src/jsonblock.js";

const rows = [
  { kind: "credit", date: "2026-08-18", source: "task", key: "task:Daily.md:write spec", base: 5, crit: 2, chips: 10, tier: null },
  { kind: "credit", date: "2026-08-18", source: "habit", key: "mochi·ult·2026-08-18", base: 8, crit: null, chips: 8, tier: "ult" },
  { kind: "reversal", date: "2026-08-18", reversalOf: "task:Daily.md:write spec", chips: -10 },
  { kind: "spend", date: "2026-08-18", reward: "boba", price: 20, chips: -20 },
  { kind: "spend", date: "2026-08-18", subtype: "gacha", outcome: "rebate_small", value: 3, chips: -2 },
  { kind: "spend", date: "2026-08-18", reward: "boba", price: 0, subtype: "gacha", outcome: "free_reward" },
  { kind: "claim", date: "2026-08-18", reward: "boba" },
];

test("table round-trips every entry kind, absent fields staying absent", () => {
  assert.deepEqual(parseLedgerBlock(tableBlock("ledger 2026-08", rows)), rows);
});

test("a legacy JSON month file still parses (no migration step)", () => {
  assert.deepEqual(parseLedgerBlock(jsonBlock("ledger 2026-08", rows)), rows);
  assert.deepEqual(parseLedgerBlockStrict(jsonBlock("ledger 2026-08", rows), "x.md"), rows);
});

test("appending one entry adds exactly one line", () => {
  const before = tableBlock("ledger 2026-08", rows).split("\n").length;
  const after = tableBlock("ledger 2026-08", [...rows, rows[6]]).split("\n").length;
  assert.equal(after - before, 1);
});

test("a pipe in a task key survives the round trip", () => {
  const piped = [{ kind: "credit", date: "2026-08-18", source: "task", key: "task:a.md:ship a | b", base: 1, crit: null, chips: 1, tier: null }];
  const block = tableBlock("ledger 2026-08", piped);
  assert.deepEqual(parseLedgerBlock(block), piped);
});

test("strict parse refuses to treat an unreadable file as empty (would wipe purchases)", () => {
  assert.deepEqual(parseLedgerBlockStrict(null, "x.md"), []); // absent file is genuinely empty
  assert.deepEqual(parseLedgerBlockStrict("  \n", "x.md"), []);
  assert.throws(() => parseLedgerBlockStrict("> ledger\n\nnotes I typed here\n", "x.md"), /no ledger table/);
});

test("an empty but well-formed table is empty, not unreadable", () => {
  assert.deepEqual(parseLedgerBlockStrict(tableBlock("ledger 2026-08", []), "x.md"), []);
});
