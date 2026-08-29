import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceSlug, deviceId } from "../src/device.js";

test("device slug is filename-safe", () => {
  assert.equal(deviceSlug("Work PC"), "work-pc");
  assert.equal(deviceSlug("  Lyth's Laptop!! "), "lyth-s-laptop");
  assert.equal(deviceSlug("phone/../../etc"), "phone-etc"); // no path escape
  assert.equal(deviceSlug("!!!"), "");
  assert.equal(deviceSlug(""), "");
});

test("device id is minted once and reused, and a label overrides it", () => {
  const store = new Map<string, unknown>();
  const app = {
    loadLocalStorage: (k: string) => store.get(k) ?? null,
    saveLocalStorage: (k: string, v: unknown) => void store.set(k, v),
  } as never;

  const first = deviceId(app);
  assert.match(first, /^[a-z0-9]+$/);
  assert.equal(deviceId(app), first, "same install keeps its lane across calls");
  assert.equal(deviceId(app, "Work PC"), "work-pc", "label wins over the random id");
  assert.equal(deviceId(app, "  "), first, "blank label falls back to the stored id");
});
