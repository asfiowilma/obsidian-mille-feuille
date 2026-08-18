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

const HABIT_LINE_RE = /^(\S+) · (farm|ult)\b/;
const DONE_DATE_RE = /✅ (\d{4}-\d{2}-\d{2})/;

/**
 * mochi habit line: `<id> · <tier> [✅ <date>]` → key parts. §V12,§V13
 * `✅ <date>` is optional: the Tasks plugin appends it a beat after the box is ticked, and the
 * intermediate state can reach us as its own modify event. Falling back to `todayDate` keeps both
 * events on one key so the completion is credited once, not twice.
 */
export function habitKey(text: string, todayDate: string): HabitKey | null {
  const m = HABIT_LINE_RE.exec(text);
  if (!m) return null;
  return { id: m[1], tier: m[2], doneDate: DONE_DATE_RE.exec(text)?.[1] ?? todayDate };
}

// Tasks-plugin metadata tokens. Editing any of these on a credited line must not mint a new key.
const TASK_META_RE = /[⏳🛫📅✅❌🔁⏫🔼🔽⏬🆔⛔➕🏁]/u;

/** Line text minus Tasks metadata — the part that identifies *which* task this is. */
export function taskIdentity(text: string): string {
  const cut = text.search(TASK_META_RE);
  return (cut < 0 ? text : text.slice(0, cut)).trim();
}

/**
 * Stable credit key for a non-habit task line. Text minus Tasks metadata, plus the ✅ date when
 * present so a recurring task earns once per completion. §V13
 */
export function taskKey(filePath: string, text: string): string {
  const done = DONE_DATE_RE.exec(text)?.[1];
  return `task:${filePath}:${taskIdentity(text)}${done ? `·✅${done}` : ""}`;
}

/**
 * Keys this line could already be credited under, canonical first. Second is the pre-fix shape
 * (raw trimmed text), so credits made before metadata-stripping are still found and reversible.
 */
export function taskKeys(filePath: string, text: string): string[] {
  const canonical = taskKey(filePath, text);
  const legacy = `task:${filePath}:${text.trim()}`;
  return canonical === legacy ? [canonical] : [canonical, legacy];
}

export interface ScanScope {
  include: string[]; // folder prefixes; empty = whole vault
  exclude: string[]; // folder prefixes
  base: string; // plugin data folder — always excluded
  gaming?: string; // §V65 match-note folder — always excluded, include can't override it
}

/**
 * Is a file path in scan scope? Base folder always out; exclude beats include. §V30
 * The gaming folder is out on the same footing as our own data folder: a match note holds
 * checkboxes and table rows, so scanning it would credit chips for logging a game. §V65,§V3
 */
export function inScanScope(path: string, s: ScanScope): boolean {
  const under = (prefix: string) => prefix !== "" && (path === prefix || path.startsWith(prefix.replace(/\/?$/, "/")));
  if (under(s.base)) return false;
  if (s.gaming && under(s.gaming)) return false;
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
