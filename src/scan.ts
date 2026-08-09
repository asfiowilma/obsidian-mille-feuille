// Checkbox line parsing + credit/reverse decision. Pure. §V1,§V13,§V14.
// Idempotency is ledger-driven: a key already credited is never re-credited (§V13);
// unchecking a credited key reverses it (§V14). No per-line state cache needed.

export interface ParsedLine {
  marker: string; // x | X | - | (space)
  checked: boolean; // [x]/[X]
  skipped: boolean; // [-]
  text: string; // content after the checkbox
}

const CB_RE = /^\s*[-*]\s+\[([ xX\-])\]\s?(.*)$/;

export function parseLine(line: string): ParsedLine | null {
  const m = CB_RE.exec(line);
  if (!m) return null;
  const marker = m[1];
  return {
    marker,
    checked: marker === "x" || marker === "X",
    skipped: marker === "-",
    text: m[2],
  };
}

export interface HabitKey {
  id: string;
  tier: string;
  doneDate: string;
}

const HABIT_LINE_RE = /^(\S+) · (farm|ult)\b.*?✅ (\d{4}-\d{2}-\d{2})/;

/** mochi habit line: `<id> · <tier> ✅ <date>` → key (id, ✅date). §V12,§V13 */
export function habitKey(text: string): HabitKey | null {
  const m = HABIT_LINE_RE.exec(text);
  if (!m) return null;
  return { id: m[1], tier: m[2], doneDate: m[3] };
}

/** Stable credit key for a non-habit task line at a location. */
export function taskKey(filePath: string, text: string): string {
  return `task:${filePath}:${text.trim()}`;
}

export interface ScanScope {
  include: string[]; // folder prefixes; empty = whole vault
  exclude: string[]; // folder prefixes
  base: string; // plugin data folder — always excluded
}

/** Is a file path in scan scope? Base folder always out; exclude beats include. §V30 */
export function inScanScope(path: string, s: ScanScope): boolean {
  const under = (prefix: string) => prefix !== "" && (path === prefix || path.startsWith(prefix.replace(/\/?$/, "/")));
  if (under(s.base)) return false;
  if (s.exclude.some(under)) return false;
  if (s.include.length === 0) return true;
  return s.include.some(under);
}

export type ScanAction = "credit" | "reverse" | "none";

/**
 * Decide what a scanned line should do given whether its key is already credited.
 * `[-]` skipped and `[ ]` unchecked never credit; unchecking a credited key reverses. §V1,§V13,§V14
 */
export function decideAction(p: ParsedLine, credited: boolean): ScanAction {
  if (p.skipped) return credited ? "reverse" : "none"; // [-] never credits; if was credited then flipped to [-], undo
  if (p.checked) return credited ? "none" : "credit";
  return credited ? "reverse" : "none"; // [ ] unchecked
}
