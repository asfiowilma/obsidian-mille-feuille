import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, habitKey, decideAction, inScanScope } from "../src/scan.js";

test("parseLine reads checkbox markers", () => {
  assert.deepEqual(parseLine("- [x] done thing"), { marker: "x", checked: true, skipped: false, text: "done thing" });
  assert.deepEqual(parseLine("- [ ] todo"), { marker: " ", checked: false, skipped: false, text: "todo" });
  assert.deepEqual(parseLine("- [-] skipped"), { marker: "-", checked: false, skipped: true, text: "skipped" });
  assert.equal(parseLine("plain text"), null);
});

test("habitKey parses `<id> · <tier> ✅ <date>` (V12)", () => {
  assert.deepEqual(habitKey("h42 · farm ✅ 2026-08-09"), { id: "h42", tier: "farm", doneDate: "2026-08-09" });
  assert.equal(habitKey("just a task"), null);
});

test("decideAction: checked + not credited → credit (V1)", () => {
  assert.equal(decideAction({ marker: "x", checked: true, skipped: false, text: "" }, false), "credit");
});
test("decideAction: checked + already credited → none (V13 idempotent)", () => {
  assert.equal(decideAction({ marker: "x", checked: true, skipped: false, text: "" }, true), "none");
});
test("decideAction: unchecked + credited → reverse (V14)", () => {
  assert.equal(decideAction({ marker: " ", checked: false, skipped: false, text: "" }, true), "reverse");
});
test("decideAction: skipped never credits", () => {
  assert.equal(decideAction({ marker: "-", checked: false, skipped: true, text: "" }, false), "none");
});

test("inScanScope: base folder always excluded (V30)", () => {
  const s = { include: [], exclude: [], base: "mille-feuille" };
  assert.equal(inScanScope("mille-feuille/wallet.md", s), false);
  assert.equal(inScanScope("Daily/2026-08-09.md", s), true);
});

test("inScanScope: empty include = whole vault; exclude beats include (V30)", () => {
  const s = { include: ["Tasks"], exclude: ["Tasks/Archive"], base: "mf" };
  assert.equal(inScanScope("Tasks/today.md", s), true);
  assert.equal(inScanScope("Tasks/Archive/old.md", s), false);
  assert.equal(inScanScope("Other/note.md", s), false); // not in include
  // prefix must be a path boundary, not substring
  assert.equal(inScanScope("TasksExtra/note.md", { include: ["Tasks"], exclude: [], base: "mf" }), false);
});
