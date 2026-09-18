// Markdown-table ledger storage. Pure - no Obsidian imports. §V88
//
// Replaces the fenced-JSON block for ledger files. Two reasons, both about sync:
//
//  1. Appending one entry to a JSON array rewrites every line after the last `}` - brackets,
//     indentation, commas - so no line-level merge can ever help when two revisions collide.
//     A table append adds exactly one line, which is the shape a text merge can resolve.
//  2. When a conflict does have to be fixed by hand, the user is reading their own ledger. A
//     table shows "three credits and a purchase" at a glance; a JSON array does not.
//
// Reading stays backward-compatible: `parseLedgerBlock` accepts a legacy JSON file unchanged, so
// existing month files keep counting with no migration step and no data rewrite.
import { parseJsonBlock, parseJsonBlockStrict } from "./jsonblock.js";

const COLUMNS = ["date", "kind", "ref", "source", "tier", "base", "crit", "chips", "note"] as const;

// A task key is free text and can contain a pipe. Escape it so the row keeps its column count.
// ponytail: pipe only - a literal backslash in a key would round-trip wrong, but keys are built
// from task text and paths, where a trailing backslash before a pipe does not occur.
const esc = (v: string): string => v.replace(/\|/g, "\\|");
const unesc = (v: string): string => v.replace(/\\\|/g, "|");

/** Split a table row on unescaped pipes, dropping the leading/trailing empties. */
function cells(row: string): string[] {
  const parts = row.split(/(?<!\\)\|/);
  if (parts.length && parts[0].trim() === "") parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
  return parts.map((c) => unesc(c.trim()));
}

const num = (v: string): number | undefined => (v === "" ? undefined : Number(v));

/** `k=v k=v` extras for the fields that only some spend rows carry. */
function noteOf(e: Record<string, unknown>): string {
  const out: string[] = [];
  for (const k of ["price", "subtype", "outcome", "value"]) {
    if (e[k] !== undefined) out.push(`${k}=${String(e[k])}`);
  }
  return out.join(" ");
}

function parseNote(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of s.split(/\s+/)) {
    if (!tok) continue;
    const i = tok.indexOf("=");
    if (i > 0) out[tok.slice(0, i)] = tok.slice(i + 1);
  }
  return out;
}

function rowOf(e: Record<string, unknown>): string {
  const c: Record<string, string> = { date: String(e.date), kind: String(e.kind), ref: "", source: "", tier: "", base: "", crit: "", chips: "", note: "" };
  switch (e.kind) {
    case "credit":
      c.ref = String(e.key);
      c.source = String(e.source);
      c.tier = e.tier === null || e.tier === undefined ? "" : String(e.tier); // empty cell = null
      c.base = String(e.base);
      c.crit = e.crit === null || e.crit === undefined ? "" : String(e.crit); // empty cell = null
      c.chips = String(e.chips);
      break;
    case "reversal":
      c.ref = String(e.reversalOf);
      c.chips = String(e.chips);
      break;
    case "spend":
      // `reward` and `chips` are genuinely optional here: a gacha roll row has neither. An empty
      // cell must therefore read back as absent, not as "" or 0. §V35,§V40
      if (e.reward !== undefined) c.ref = String(e.reward);
      if (e.chips !== undefined) c.chips = String(e.chips);
      c.note = noteOf(e);
      break;
    case "claim":
      c.ref = String(e.reward);
      break;
  }
  return `| ${COLUMNS.map((k) => esc(c[k])).join(" | ")} |`;
}

function entryOf(c: Record<string, string>): unknown | null {
  const date = c.date;
  switch (c.kind) {
    case "credit":
      return {
        kind: "credit", date, source: c.source, key: c.ref,
        base: Number(c.base), crit: c.crit === "" ? null : Number(c.crit),
        chips: Number(c.chips), tier: c.tier === "" ? null : c.tier,
      };
    case "reversal":
      return { kind: "reversal", date, reversalOf: c.ref, chips: Number(c.chips) };
    case "spend": {
      const n = parseNote(c.note);
      const e: Record<string, unknown> = { kind: "spend", date };
      if (c.ref !== "") e.reward = c.ref;
      if (n.price !== undefined) e.price = Number(n.price);
      if (c.chips !== "") e.chips = Number(c.chips);
      if (n.subtype !== undefined) e.subtype = n.subtype;
      if (n.outcome !== undefined) e.outcome = n.outcome;
      if (n.value !== undefined) e.value = Number(n.value);
      return e;
    }
    case "claim":
      return { kind: "claim", date, reward: c.ref };
    default:
      return null; // unknown kind - keep the line out of the balance rather than guess
  }
}

export function tableBlock(label: string, data: unknown[]): string {
  const head = `| ${COLUMNS.join(" | ")} |`;
  const rule = `|${COLUMNS.map(() => "---").join("|")}|`;
  const rows = data.map((e) => rowOf(e as Record<string, unknown>));
  return [`> ${label}`, "", head, rule, ...rows, ""].join("\n");
}

/** Rows in the file, or [] when absent/empty. Accepts the legacy JSON block. Lenient. */
export function parseLedgerBlock<T>(content: string | null): T[] {
  if (!content) return [];
  if (/```json/.test(content)) return parseJsonBlock<T>(content); // legacy month file
  const out: T[] = [];
  for (const line of content.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const c = cells(line);
    if (c.length !== COLUMNS.length) continue;
    if (c[0] === "date" || /^-+$/.test(c[0])) continue; // header / rule
    const rec: Record<string, string> = {};
    COLUMNS.forEach((k, i) => (rec[k] = c[i]));
    const e = entryOf(rec);
    if (e) out.push(e as T);
  }
  return out;
}

/**
 * Same, but throws when a non-empty file yields nothing parseable. Use before rewriting a file:
 * treating an unreadable ledger as empty would drop every purchase, gacha and claim row in it.
 */
export function parseLedgerBlockStrict<T>(content: string | null, path: string): T[] {
  if (content === null || content.trim() === "") return [];
  if (/```json/.test(content)) return parseJsonBlockStrict<T>(content, path);
  const rows = parseLedgerBlock<T>(content);
  if (rows.length === 0 && !/^\s*\|\s*date\s*\|/m.test(content)) {
    throw new Error(`${path}: no ledger table found - refusing to overwrite`);
  }
  return rows;
}

/**
 * Codepoint order, not `localeCompare`: collation is locale-dependent, which would reintroduce
 * the very cross-device disagreement a canonical sort exists to remove. §V89
 */
export const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * Union every ledger file into one canonically ordered array: `(date, file path, row index)`.
 * `getMarkdownFiles()` order is not guaranteed to match between devices, and sorting on `date`
 * alone leaves same-date rows tied — stable sort then keeps that arbitrary order, so two devices
 * could pick different winners in `frozenChips`/`aggregate`. Sorting by path first makes the
 * order a pure function of content plus path. §V89, prerequisite for the read-time dedupe.
 */
export function unionLedger<T extends { date: string }>(
  files: { path: string; content: string }[],
): T[] {
  const out: T[] = [];
  for (const f of [...files].sort(byPath)) {
    out.push(...parseLedgerBlock<T>(f.content));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)); // stable: ties keep (path, row index)
}
