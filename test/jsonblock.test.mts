import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonBlock, parseJsonBlock, parseJsonBlockStrict } from "../src/jsonblock.js";

const rows = [
  { kind: "credit", date: "2026-08-18", key: "a", chips: 2 },
  { kind: "spend", date: "2026-08-18", reward: "boba", price: 20, chips: -20 },
  { kind: "spend", date: "2026-08-18", subtype: "gacha", outcome: "rebate_small", value: 3, chips: -2 },
  { kind: "claim", date: "2026-08-18", reward: "boba" },
];

test("json block round-trips every entry kind", () => {
  assert.deepEqual(parseJsonBlock(jsonBlock("ledger 2026-08", rows)), rows);
  assert.deepEqual(parseJsonBlockStrict(jsonBlock("ledger 2026-08", rows), "x.md"), rows);
});

test("strict parse refuses to treat an unreadable file as empty (would wipe purchases)", () => {
  assert.deepEqual(parseJsonBlockStrict(null, "x.md"), []); // absent file is genuinely empty
  assert.deepEqual(parseJsonBlockStrict("  \n", "x.md"), []);
  assert.throws(() => parseJsonBlockStrict("> ledger\n\nnotes I typed here\n", "x.md"), /no json block/);
  assert.throws(() => parseJsonBlockStrict("```json\n[{oops}]\n```", "x.md"), /not valid JSON/);
  assert.throws(() => parseJsonBlockStrict('```json\n{"a":1}\n```', "x.md"), /not an array/);
  // lenient parse is the silent-wipe path — kept only for read-only callers
  assert.deepEqual(parseJsonBlock("```json\n[{oops}]\n```"), []);
});
