// Device identity for ledger write-lanes. §V87
//
// Two devices writing the same ledger file is what loses purchases: `appendLedgerMany` does a
// whole-file read-modify-write, so LiveSync sees one doc modified on both sides, conflicts, and
// keeps one revision entirely. Give each device its own file and the conflict cannot happen.
//
// The id MUST be device-local. Plugin settings live in `data.json`, which LiveSync replicates when
// hidden-file sync is on — a device id stored there syncs to the other device and both pick the
// same lane. `loadLocalStorage`/`saveLocalStorage` are per-install and never replicate.
import type { App } from "obsidian";

const KEY = "mille-feuille:device";

/** Filename-safe token from a user label. Empty when nothing usable survives. */
export function deviceSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/**
 * This install's write-lane token. A user label wins; otherwise a random id, minted once and kept.
 *
 * A changed or regenerated id is harmless: `readLedger` unions every `.md` under `ledger/`, so the
 * filename is a write-lane, not an identity. Worst case is an extra file, never a lost row.
 */
export function deviceId(app: App, label?: string): string {
  const fromLabel = deviceSlug(label ?? "");
  if (fromLabel) return fromLabel;
  const stored = app.loadLocalStorage(KEY);
  if (typeof stored === "string" && stored) return stored;
  const id = Math.random().toString(36).slice(2, 8);
  app.saveLocalStorage(KEY, id);
  return id;
}
