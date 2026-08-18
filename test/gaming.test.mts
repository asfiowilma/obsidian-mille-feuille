import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GAMING, parseThresholds, thresholdsToStr, parseBands, bandsToStr, chipsOf, bandCap,
  scoreOf, matchChips, parseSessionNote, appendMatchRow, setFrontmatterField, sessionNote,
  pendingOf, pendingChips, countBatches, taskBlock, insertTask, parseRow,
  type Match, type Threshold, type Band,
} from "../src/gaming.js";

const TS = parseThresholds(DEFAULT_GAMING.thresholds);
const BS = parseBands(DEFAULT_GAMING.bands);
const m = (over: Partial<Match> = {}): Match => ({
  n: 1, mon: "Cinderace", deaths: 5, farm: null, damage: 0, points: 0, ray: "none", focus: false, ...over,
});

test("default threshold + band tables parse whole (V60,V61)", () => {
  assert.equal(TS.length, 13);
  assert.equal(BS.length, 5);
  assert.deepEqual(BS[4], { from: 8, to: Infinity, chips: 5 });
  assert.equal(bandCap(BS), 5);
  // round-trip
  assert.deepEqual(parseThresholds(thresholdsToStr(TS)), TS);
  assert.deepEqual(parseBands(bandsToStr(BS)), BS);
});

test("death lines stack (V60 / AC 4)", () => {
  assert.equal(scoreOf(m({ deaths: 0 }), TS).score, 4); // <=3, <=2, ==0
  assert.equal(scoreOf(m({ deaths: 2 }), TS).score, 2); // <=3, <=2
  assert.equal(scoreOf(m({ deaths: 4 }), TS).score, 0);
});

test("a farm line never passes on a blank level (V60 / AC 5)", () => {
  assert.equal(scoreOf(m({ deaths: 9, farm: null }), TS).score, 0);
  assert.equal(scoreOf(m({ deaths: 9, farm: 13 }), TS).score, 2); // >=11 and >=13
});

test("an unreadable threshold line is skipped, the rest still score (V60 / AC 6)", () => {
  const ts = parseThresholds("deaths ?? 3 : 1\ndeaths <= 3 : 1\nray == purple : 9\nfocus == maybe : 9");
  assert.deepEqual(ts, [{ stat: "deaths", op: "<=", val: 3, pts: 1 }] as Threshold[]);
  assert.equal(parseThresholds("").length, 0); // empty list → score 0
  assert.equal(scoreOf(m({ deaths: 0 }), parseThresholds("")).score, 0);
});

test("damage compares in thousands (V60 / AC 7)", () => {
  const hits = scoreOf(m({ deaths: 9, damage: 83 }), TS).hits.filter((t) => t.stat === "damage");
  assert.deepEqual(hits.map((t) => t.val), [60, 80]); // 100 does not pass
});

test("bands: first holding band wins, no band → 0, never negative (V61,V67 / AC 8,9)", () => {
  assert.equal(chipsOf(7, BS), 3);
  assert.equal(chipsOf(12, BS), 5); // through `8+`
  assert.equal(chipsOf(0, BS), 0);
  assert.equal(chipsOf(4, parseBands("0-1 : 0")), 0); // score no band holds
  assert.equal(chipsOf(3, parseBands("2-3 : -5")), 0); // clamped at 0
  assert.equal(matchChips(m(), TS, BS), 0); // worst match pays 0, still a match
});

test("retuning a band re-scores a pending match (V59,V64 / AC 3)", () => {
  const match = m({ deaths: 0, farm: 13, damage: 104, points: 151, ray: "stolen", focus: true });
  const score = scoreOf(match, TS).score;
  assert.ok(score >= 8);
  assert.equal(matchChips(match, TS, BS), 5);
  assert.equal(matchChips(match, TS, parseBands("0-1 : 0\n8+ : 9")), 9); // knob moved, match re-reads
});

const NOTE = `---
type: gaming-session
session: 2026-08-18
focus: dodge before you commit
processed: 2
---

| # | Pokémon   | Dth | Lv | Ray   | Dmg | Pts | F |
|---|-----------|-----|----|-------|-----|-----|---|
| 1 | Cinderace | 2   | 13 | -     |  82 | 118 | y |
| 2 | Blissey   | 4   | -  | -     |  61 |  44 | n |
| 3 | Cinderace | 0   | 11 | steal | 104 |  96 | n |
`;

test("match note reads raw stats only, no score or chips stored (V59 / AC 2)", () => {
  const { session, unreadable } = parseSessionNote(NOTE, "x");
  assert.equal(unreadable, 0);
  assert.equal(session.id, "2026-08-18");
  assert.equal(session.focus, "dodge before you commit");
  assert.equal(session.processed, 2);
  assert.equal(session.matches.length, 3);
  assert.deepEqual(session.matches[0], { n: 1, mon: "Cinderace", deaths: 2, farm: 13, damage: 82, points: 118, ray: "none", focus: true });
  assert.equal(session.matches[1].farm, null); // blank Lv
  assert.equal(session.matches[2].ray, "stolen"); // `steal` in the note
  assert.ok(!/score|chips/.test(NOTE));
});

test("an unreadable row is skipped, counted, and takes no row number (V75 / AC 19)", () => {
  const bad = NOTE.replace("| 2 | Blissey   | 4   | -  | -     |  61 |  44 | n |", "| 2 | Blissey   | oops |");
  const { session, unreadable } = parseSessionNote(bad, "x");
  assert.equal(unreadable, 1);
  assert.deepEqual(session.matches.map((x) => x.n), [1, 2]); // renumbered over readable rows
  assert.equal(session.matches[1].mon, "Cinderace"); // the third note row
  assert.equal(parseRow("| 1 | Mon | 2 | 13 | teal | 82 | 118 | y |", 1), null); // bad ray token
});

test("append a row, set frontmatter, keep everything else (V72,V63)", () => {
  const next = appendMatchRow(NOTE, m({ mon: "Comfey", deaths: 1, farm: 12, damage: 55, points: 70 }));
  const { session } = parseSessionNote(next, "x");
  assert.equal(session.matches.length, 4);
  assert.equal(session.matches[3].mon, "Comfey");
  assert.equal(session.processed, 2); // §V72 save never touches processed
  assert.ok(next.includes("focus: dodge before you commit"));
  assert.equal(parseSessionNote(setFrontmatterField(next, "processed", 4), "x").session.processed, 4);
  // a note with no table yet still takes a row
  assert.equal(parseSessionNote(appendMatchRow(sessionNote("2026-08-18"), m()), "x").session.matches.length, 1);
});

test("pending slice comes from processed alone (V63,V64)", () => {
  const { session } = parseSessionNote(NOTE, "x");
  assert.deepEqual(pendingOf(session).map((x) => x.n), [3]);
  assert.equal(pendingChips(session, TS, BS), matchChips(session.matches[2], TS, BS));
  assert.equal(pendingOf({ ...session, processed: 3 }).length, 0); // nothing new
});

test("batch task line carries the payload; sublines are decoration (V63,V64 / AC 13,14)", () => {
  const { session } = parseSessionNote(NOTE, "x");
  const first = taskBlock("2026-08-18", 1, session.matches, TS, BS, "#gaming-session");
  const chips = session.matches.reduce((a, x) => a + matchChips(x, TS, BS), 0);
  assert.equal(first.split("\n")[0], `- [ ] Gaming session 2026-08-18 · gaming:${chips} #gaming-session`);
  assert.ok(first.includes("  - Matches: 3 (1-3)"));
  assert.ok(first.includes("  - Total chips: " + chips));
  // second batch of the same day: ordinal in the text → a different taskKey
  const second = taskBlock("2026-08-18", 2, session.matches.slice(2), TS, BS, "");
  assert.ok(second.split("\n")[0].startsWith("- [ ] Gaming session 2026-08-18 (2) · gaming:"));
  assert.ok(second.includes("  - Matches: 1 (3)"));
  assert.notEqual(first.split("\n")[0], second.split("\n")[0]);
  // a zero-chip batch still writes a task (V68)
  assert.ok(taskBlock("2026-08-18", 1, [m()], TS, BS, "").includes("· gaming:0"));
});

test("batch ordinal counts prior tasks in the task file (V63)", () => {
  let file = "## Tasks\n";
  assert.equal(countBatches(file, "2026-08-18"), 0);
  file = insertTask(file, taskBlock("2026-08-18", 1, [m()], TS, BS, "#gaming-session"));
  assert.equal(countBatches(file, "2026-08-18"), 1);
  file = insertTask(file, taskBlock("2026-08-18", 2, [m()], TS, BS, "#gaming-session"));
  assert.equal(countBatches(file, "2026-08-18"), 2);
  assert.equal(countBatches(file, "2026-08-17"), 0); // another session, own count
  assert.ok(insertTask("# Log\n", "- [ ] x").includes("## Tasks")); // heading added when absent
  assert.ok(file.indexOf("(2)") < file.indexOf("gaming:0 #gaming-session\n  - Matches: 1 (1)\n  - Scores: 0\n  - Total chips: 0\n- [ ] Gaming session"), "newest task on top");
});
