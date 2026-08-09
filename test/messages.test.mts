import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MESSAGES, render, renderMsg, renderClaim, critStreakCopy, pick, type Messages,
} from "../src/messages.js";

const M = (): Messages => structuredClone(DEFAULT_MESSAGES);

test("render substitutes {{key}}, absent → empty, tolerates whitespace, no literal braces (V31)", () => {
  assert.equal(render("+{{chips}}🪙", { chips: 10 }), "+10🪙");
  assert.equal(render("{{ chips }} chips", { chips: 5 }), "5 chips");
  assert.equal(render("hi {{missing}}!", {}), "hi !"); // absent → empty
  assert.equal(render("{{name}}", { name: "Spa" }), "Spa");
});

test("mint template injects crit suffix via {{crit}} (V31)", () => {
  const m = M();
  const crit = renderMsg(m, "critSuffix", {});
  assert.equal(renderMsg(m, "mint", { chips: 22, crit }), "Earned +22🪙 ✦ critical hit!");
  assert.equal(renderMsg(m, "mint", { chips: 10, crit: "" }), "Earned +10🪙");
});

test("blank template falls back to default (toast never blank) (V31)", () => {
  const m = M();
  m.mint = "   ";
  assert.equal(pick(m, "mint"), DEFAULT_MESSAGES.mint);
  assert.equal(renderMsg(m, "mint", { chips: 3, crit: "" }), "Earned +3🪙");
});

test("editing template changes copy (V31)", () => {
  const m = M();
  m.mint = "+{{chips}} chips!";
  assert.equal(renderMsg(m, "mint", { chips: 10, crit: "" }), "+10 chips!");
});

test("claim = list, random pick, rendered (V31)", () => {
  const m = M();
  assert.equal(renderClaim(m, { name: "Spa" }, () => 0), "Spa claimed, enjoy it you earned this 🍰");
  assert.equal(renderClaim(m, { name: "Spa" }, () => 0.999).startsWith("Spa claimed,"), true);
});

test("empty claim list falls back to default list (V31)", () => {
  const m = M();
  m.claim = [];
  assert.equal((pick(m, "claim") as string[]).length, DEFAULT_MESSAGES.claim.length);
});

test("add/edit/delete claim entries changes pool (V31)", () => {
  const m = M();
  m.claim = ["{{name}} done!"]; // deleted down to one, edited
  assert.equal(renderClaim(m, { name: "Spa" }, () => 0.5), "Spa done!");
});

test("crit streak: 2 special-cased, 3+ uses template (V29,V31)", () => {
  const m = M();
  assert.equal(critStreakCopy(m, 2), "Double crit! 🔥");
  assert.equal(critStreakCopy(m, 4), "Crit streak x4! 🔥");
  m.critStreak = "combo {{count}}!";
  assert.equal(critStreakCopy(m, 3), "combo 3!");
  assert.equal(critStreakCopy(m, 2), "Double crit! 🔥"); // special case survives edit
});
