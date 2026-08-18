import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, habitKey, taskKey, taskKeys, decideAction, inScanScope } from "../src/scan.js";

test("parseLine reads checkbox markers", () => {
  assert.deepEqual(parseLine("- [x] done thing"), { marker: "x", checked: true, skipped: false, text: "done thing" });
  assert.deepEqual(parseLine("- [ ] todo"), { marker: " ", checked: false, skipped: false, text: "todo" });
  assert.deepEqual(parseLine("- [-] skipped"), { marker: "-", checked: false, skipped: true, text: "skipped" });
  assert.equal(parseLine("plain text"), null);
});

test("habitKey parses `<id> · <tier> ✅ <date>` (V12)", () => {
  assert.deepEqual(habitKey("h42 · farm ✅ 2026-08-09", "2026-08-18"), { id: "h42", tier: "farm", doneDate: "2026-08-09" });
  assert.equal(habitKey("just a task", "2026-08-18"), null);
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

test("habit line missing ✅ falls back to today, so tick + date-append share one key (V13)", () => {
  const pre = habitKey("kanji · ult", "2026-08-18");        // Tasks hasn't appended the date yet
  const post = habitKey("kanji · ult ✅ 2026-08-18", "2026-08-18");
  assert.deepEqual(pre, post); // same key → credited once, not twice
  assert.equal(habitKey("kanji · ultra marathon", "2026-08-18"), null); // tier is a whole token
});

test("taskKey ignores Tasks metadata edits, keeps ✅ date (V13)", () => {
  const f = "Daily Logs/2026-08-18, Tuesday.md";
  const bare = taskKey(f, "buy tickets ✅ 2026-08-18");
  assert.equal(taskKey(f, "buy tickets ⏳ 2026-08-20 ✅ 2026-08-18"), bare); // added ⏳ → same key
  assert.equal(taskKey(f, "buy tickets ⏫ ✅ 2026-08-18"), bare);
  assert.notEqual(taskKey(f, "buy tickets ✅ 2026-08-19"), bare); // different completion
  assert.notEqual(taskKey(f, "buy snacks ✅ 2026-08-18"), bare);

  // pre-fix keys stay findable so old credits are still reversible
  assert.deepEqual(taskKeys(f, "buy tickets ⏳ 2026-08-20 ✅ 2026-08-18"),
    [bare, `task:${f}:buy tickets ⏳ 2026-08-20 ✅ 2026-08-18`]);
  assert.deepEqual(taskKeys(f, "plain task"), [`task:${f}:plain task`]); // no legacy dupe
});

test("the gaming folder is out of scope even when include lists it (V65,V30 / AC 21)", () => {
  const s = { include: ["Gaming Ledger", "Work"], exclude: [], base: "mille-feuille", gaming: "Gaming Ledger" };
  assert.equal(inScanScope("Gaming Ledger/2026-08-18.md", s), false); // a match note credits nothing
  assert.equal(inScanScope("Gaming Ledger/old/2026-01-01.md", s), false); // subfolders too
  assert.equal(inScanScope("Work/plan.md", s), true); // every other include still works
  // the exclusion matches at a path boundary, not as a substring
  assert.equal(inScanScope("Gaming Ledgerside/x.md", { ...s, include: [] }), true);
  // the task file itself lives outside the gaming folder, so its batch tasks stay creditable
  assert.equal(inScanScope("Gaming/Sessions.md", { ...s, include: [] }), true);
});

test("each gaming batch keys apart, and editing the payload mints a new key (V63,V64 / AC 15,26)", () => {
  const f = "Gaming/Sessions.md";
  const b1 = taskKey(f, "Gaming session 2026-08-18 · gaming:14 #gaming-session ✅ 2026-08-19");
  const b2 = taskKey(f, "Gaming session 2026-08-18 (2) · gaming:7 #gaming-session ✅ 2026-08-19");
  assert.notEqual(b1, b2); // two batches of one day are two credits, never one
  // §V64 the amount lives inside the hashed text: a hand edit is a new, unpaid line
  const edited = taskKey(f, "Gaming session 2026-08-18 · gaming:99 #gaming-session ✅ 2026-08-19");
  assert.notEqual(b1, edited);
  // the ✅ date is part of the key, so the same batch ticked on another day is another credit
  assert.notEqual(b1, taskKey(f, "Gaming session 2026-08-18 · gaming:14 #gaming-session ✅ 2026-08-20"));
  // a subline is not a checkbox and can never credit
  assert.equal(parseLine("  - Matches: 5 (1-5)"), null);
});
