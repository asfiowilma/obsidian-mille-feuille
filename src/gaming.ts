// Gaming ledger — raw match stats → score → chips → one task per batch. Pure, no Obsidian
// imports (testable). §V59 the note stores raw stats only; score and chips are derived at
// every read, so retuning the curve re-scores history that no batch covers yet (§V64).

export interface GamingConfig {
  enabled: boolean;
  folder: string;
  taskFile: string;
  taskTag: string;
  promptFocus: boolean;
  thresholds: string; // §V60 one per line: stat op value : points
  bands: string; // §V61 one per line: from-to : chips, or N+ : chips
}

export const DEFAULT_GAMING: GamingConfig = {
  enabled: false,
  folder: "Gaming Ledger",
  taskFile: "Gaming/Sessions.md",
  taskTag: "#gaming-session",
  promptFocus: true,
  thresholds: [
    "deaths <= 3 : 1",
    "deaths <= 2 : 1",
    "deaths == 0 : 2",
    "farm >= 11 : 1",
    "farm >= 13 : 1",
    "ray == secured : 2",
    "ray == stolen : 3",
    "damage >= 60 : 1",
    "damage >= 80 : 1",
    "damage >= 100 : 1",
    "points >= 100 : 1",
    "points >= 150 : 1",
    "focus == yes : 2",
  ].join("\n"),
  bands: ["0-1 : 0", "2-3 : 1", "4-5 : 2", "6-7 : 3", "8+ : 5"].join("\n"),
};

export type RayState = "none" | "secured" | "stolen";

export interface Match {
  n: number; // row number, 1-based, over readable rows only (§V75)
  mon: string;
  deaths: number;
  farm: number | null; // null = never reached Rayquaza
  damage: number; // in thousands
  points: number;
  ray: RayState;
  focus: boolean;
}

export type Stat = "deaths" | "farm" | "damage" | "points" | "ray" | "focus";
export type Op = "<=" | ">=" | "==" | "<" | ">";

export interface Threshold {
  stat: Stat;
  op: Op;
  val: number | string; // string for ray and for focus
  pts: number;
}

export interface Band {
  from: number;
  to: number; // Infinity for the `N+` form
  chips: number;
}

export interface Session {
  id: string; // "2026-08-18"
  focus?: string;
  processed: number;
  matches: Match[];
}

// Field ranges for the log screen. §V71 clamps every typed value and every step to these.
export const CAPS: Record<"deaths" | "farm" | "damage" | "points", [number, number]> = {
  deaths: [0, 20],
  farm: [10, 15],
  damage: [0, 400],
  points: [0, 400],
};

// ---------------- thresholds (§V60) ----------------

const TH_RE = /^(\w+)\s*(<=|>=|==|<|>)\s*(\S+)\s*:\s*(-?\d+)$/;
const STATS = new Set<string>(["deaths", "farm", "damage", "points", "ray", "focus"]);

/** Parse the threshold text. An unreadable line is skipped silently — no error, no stop. §V60 */
export function parseThresholds(src: string): Threshold[] {
  const out: Threshold[] = [];
  for (const line of src.split("\n")) {
    const m = TH_RE.exec(line.trim());
    if (!m) continue;
    const [, stat, op, rawVal, pts] = m;
    if (!STATS.has(stat)) continue;
    let val: number | string;
    if (stat === "ray") {
      if (rawVal !== "secured" && rawVal !== "stolen") continue;
      val = rawVal;
    } else if (stat === "focus") {
      if (rawVal !== "yes" && rawVal !== "no") continue;
      val = rawVal;
    } else {
      if (!/^-?\d+$/.test(rawVal)) continue;
      val = Number(rawVal);
    }
    out.push({ stat: stat as Stat, op: op as Op, val, pts: Number(pts) });
  }
  return out;
}

export function thresholdsToStr(ts: Threshold[]): string {
  return ts.map((t) => `${t.stat} ${t.op} ${t.val} : ${t.pts}`).join("\n");
}

/** Does one threshold hold for a match? §V60 */
export function passes(t: Threshold, m: Match): boolean {
  if (t.stat === "farm" && m.farm === null) return false; // never reached Ray → farm can't be true
  const actual: number | string =
    t.stat === "ray" ? m.ray
    : t.stat === "focus" ? (m.focus ? "yes" : "no")
    : t.stat === "farm" ? (m.farm as number)
    : m[t.stat];
  if (typeof t.val === "string") return actual === t.val; // ray/focus compare by equality
  const a = actual as number;
  switch (t.op) {
    case "<=": return a <= t.val;
    case ">=": return a >= t.val;
    case "==": return a === t.val;
    case "<": return a < t.val;
    case ">": return a > t.val;
  }
}

/** Sum the points of every threshold that holds. Passing lines stack. §V60 */
export function scoreOf(m: Match, ts: Threshold[]): { score: number; hits: Threshold[] } {
  const hits = ts.filter((t) => passes(t, m));
  return { score: hits.reduce((a, t) => a + t.pts, 0), hits };
}

// ---------------- bands (§V61) ----------------

const BAND_RE = /^(\d+)\s*(?:-\s*(\d+)|(\+))\s*:\s*(\d+)$/;

export function parseBands(src: string): Band[] {
  const out: Band[] = [];
  for (const line of src.split("\n")) {
    const m = BAND_RE.exec(line.trim());
    if (!m) continue;
    out.push({ from: Number(m[1]), to: m[3] ? Infinity : Number(m[2]), chips: Number(m[4]) });
  }
  return out;
}

export function bandsToStr(bs: Band[]): string {
  return bs.map((b) => `${b.from}${b.to === Infinity ? "+" : `-${b.to}`} : ${b.chips}`).join("\n");
}

/** First band holding the score wins; a score no band holds pays 0. Never below 0. §V61,§V67 */
export function chipsOf(score: number, bs: Band[]): number {
  const hit = bs.find((b) => score >= b.from && score <= b.to);
  return Math.max(0, hit?.chips ?? 0);
}

/** Per-match cap = the largest chips in the table (drives the pip meter). §V61 */
export function bandCap(bs: Band[]): number {
  return bs.reduce((a, b) => Math.max(a, b.chips), 0);
}

/** Chips a match is worth right now. §V59 derived, never stored. */
export function matchChips(m: Match, ts: Threshold[], bs: Band[]): number {
  return chipsOf(scoreOf(m, ts).score, bs);
}

// ---------------- match note (§I.file, §V59, §V75) ----------------

export const TABLE_HEAD = "| # | Pokémon | Dth | Lv | Ray | Dmg | Pts | F |";
export const TABLE_SEP = "|---|---|---|---|---|---|---|---|";

const FM_RE = /^---\n([\s\S]*?)\n---/;
const isSep = (cells: string[]): boolean => cells.every((c) => /^:?-{2,}:?$/.test(c));

/** Split a `| a | b |` row into trimmed cells, or null when the line is not a table row. */
function cells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  return t.slice(1, -1).split("|").map((c) => c.trim());
}

function num(s: string): number | null {
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** One table row → Match, or null when it can't be read (the caller counts it). §V75 */
export function parseRow(line: string, n: number): Match | null {
  const c = cells(line);
  if (!c || c.length !== 8 || isSep(c)) return null;
  const [, mon, dth, lv, ray, dmg, pts, f] = c;
  const deaths = num(dth), damage = num(dmg), points = num(pts);
  if (deaths === null || damage === null || points === null) return null;
  const farm = lv === "" || lv === "-" ? null : num(lv);
  if (lv !== "" && lv !== "-" && farm === null) return null;
  const rayState: RayState | null =
    ray === "" || ray === "-" || ray === "none" ? "none"
    : ray === "secured" ? "secured"
    : ray === "steal" || ray === "stolen" ? "stolen"
    : null;
  if (rayState === null) return null;
  const focus = f === "y" || f === "yes";
  if (!focus && f !== "n" && f !== "no" && f !== "" && f !== "-") return null;
  return { n, mon, deaths, farm, damage, points, ray: rayState, focus };
}

export function rowOf(m: Match, n: number): string {
  const lv = m.farm === null ? "-" : String(m.farm);
  const ray = m.ray === "none" ? "-" : m.ray === "stolen" ? "steal" : "secured";
  return `| ${n} | ${m.mon} | ${m.deaths} | ${lv} | ${ray} | ${m.damage} | ${m.points} | ${m.focus ? "y" : "n"} |`;
}

/** Read a match note. Unreadable rows are skipped and counted; they never take a row number. §V75 */
export function parseSessionNote(content: string, fallbackId: string): { session: Session; unreadable: number } {
  const fm = FM_RE.exec(content)?.[1] ?? "";
  const field = (k: string): string | null => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(fm)?.[1]?.trim() ?? null;
  const id = field("session") || fallbackId;
  const focus = field("focus");
  const processed = Number(field("processed") ?? 0);
  const matches: Match[] = [];
  let unreadable = 0;
  const body = content.slice((FM_RE.exec(content)?.[0] ?? "").length);
  for (const line of body.split("\n")) {
    const c = cells(line);
    if (!c) continue; // not a table row at all — prose, blank line, heading
    if (isSep(c) || c[0] === "#") continue; // separator / header row
    const m = parseRow(line, matches.length + 1);
    if (m) matches.push(m);
    else unreadable++;
  }
  const session: Session = { id, processed: Number.isFinite(processed) ? processed : 0, matches };
  if (focus) session.focus = focus;
  return { session, unreadable };
}

/** A fresh note for a session. */
export function sessionNote(id: string, focus?: string): string {
  const fm = [`type: gaming-session`, `session: ${id}`, ...(focus ? [`focus: ${focus}`] : []), `processed: 0`];
  return `---\n${fm.join("\n")}\n---\n\n${TABLE_HEAD}\n${TABLE_SEP}\n`;
}

/** Append one row after the last table row, creating the table when it is absent. §V72 */
export function appendMatchRow(content: string, m: Match): string {
  const lines = content.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (cells(lines[i])) last = i;
  const n = parseSessionNote(content, "").session.matches.length + 1;
  const row = rowOf(m, n);
  if (last < 0) return `${content.replace(/\n*$/, "\n")}\n${TABLE_HEAD}\n${TABLE_SEP}\n${row}\n`;
  lines.splice(last + 1, 0, row);
  return lines.join("\n");
}

/** Set (or add) one frontmatter field. The plugin owns `processed`; `focus` is written once. §V63,§V76 */
export function setFrontmatterField(content: string, key: string, value: string | number): string {
  const fm = FM_RE.exec(content);
  const line = `${key}: ${value}`;
  if (!fm) return `---\n${line}\n---\n${content}`;
  const body = fm[1];
  const re = new RegExp(`^${key}:.*$`, "m");
  const next = re.test(body) ? body.replace(re, line) : `${body}\n${line}`;
  return content.replace(fm[0], `---\n${next}\n---`);
}

// ---------------- batches (§V63, §V64, §V68) ----------------

/** Matches no batch covers yet. Paid state is derived from `processed`, never a per-match flag. §V64 */
export function pendingOf(s: Session): Match[] {
  return s.matches.slice(s.processed);
}

export function pendingChips(s: Session, ts: Threshold[], bs: Band[]): number {
  return pendingOf(s).reduce((a, m) => a + matchChips(m, ts, bs), 0);
}

const TASK_PREFIX = "Gaming session ";

/** How many batches this session already has, counted from the task file. §V63 ordinal */
export function countBatches(taskFile: string, sessionId: string): number {
  let n = 0;
  for (const line of taskFile.split("\n")) {
    if (line.includes(`${TASK_PREFIX}${sessionId}`) && / · gaming:\d+/.test(line)) n++;
  }
  return n;
}

/**
 * The task for one batch. The ` · gaming:<chips>` payload is the only load-bearing part: it
 * lives inside the text that taskKey() hashes, which is what freezes the amount (§V64), and
 * §V77 reads it back. The three sublines are for the user and carry nothing.
 */
export function taskBlock(
  sessionId: string,
  ordinal: number,
  matches: Match[],
  ts: Threshold[],
  bs: Band[],
  tag: string,
): string {
  const scores = matches.map((m) => scoreOf(m, ts).score);
  const chips = matches.reduce((a, m) => a + matchChips(m, ts, bs), 0);
  const first = matches[0]?.n ?? 0, last = matches[matches.length - 1]?.n ?? 0;
  const range = first === last ? String(first) : `${first}-${last}`;
  const ord = ordinal > 1 ? ` (${ordinal})` : "";
  const suffix = tag.trim() ? ` ${tag.trim()}` : "";
  return [
    `- [ ] ${TASK_PREFIX}${sessionId}${ord} · gaming:${chips}${suffix}`,
    `  - Matches: ${matches.length} (${range})`,
    `  - Scores: ${scores.join(", ")}`,
    `  - Total chips: ${chips}`,
  ].join("\n");
}

/** Put a task block under `## Tasks`, adding the heading when the file has none. §V63 */
export function insertTask(content: string, block: string): string {
  const lines = content.split("\n");
  const head = lines.findIndex((l) => /^##\s+Tasks\s*$/.test(l));
  if (head < 0) {
    const base = content.trim() ? content.replace(/\n*$/, "\n\n") : "";
    return `${base}## Tasks\n\n${block}\n`;
  }
  let at = head + 1;
  while (at < lines.length && lines[at].trim() === "") at++;
  lines.splice(at, 0, block);
  return lines.join("\n");
}
