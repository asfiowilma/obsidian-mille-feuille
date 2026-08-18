// Value curve + payout logic. Pure — no Obsidian imports (testable).
// §V2 crit, §V4/§V5 milestone multiplier, §V12 habit classifier, §V15 config-first.

export type HabitTier = "farm" | "ult";

export interface Economy {
  defaultBase: number;
  critChance: number;
  critMultipliers: number[];
  milestoneByTag: Record<string, number>; // "#x2": 2, ...
  habitPayout: Record<HabitTier, number>;
  staleAfterDays: number;
}

export const DEFAULT_ECONOMY: Economy = {
  defaultBase: 10,
  critChance: 0.15,
  critMultipliers: [1.5, 2.0],
  milestoneByTag: { "#x2": 2, "#x3": 3, "#x5": 5 },
  habitPayout: { farm: 8, ult: 20 },
  staleAfterDays: 7,
};

export type Rng = () => number; // [0,1)

export type Source = "task" | "subtask" | "milestone" | "habit" | "gaming";

export interface Classified {
  source: Source;
  base: number;
  tier: string | null; // milestone tag or habit tier
}

const GAMING_RE = / · gaming:(\d+)(?!\d)/; // §V77 batch payload — the amount that pays
const HABIT_RE = / · (farm|ult)\b/; // §V12 tier-token shape ` · <tier>`

/** Classify a scanned checkbox line → source + base payout (pre-crit). §V4,§V5,§V12,§V77 */
export function classifyLine(text: string, e: Economy): Classified {
  // §V77 gaming first: the payload IS the amount, so no other rule may claim the line. A gaming
  // line and a habit line are disjoint, and a gaming line never carries a milestone tag.
  const game = GAMING_RE.exec(text);
  if (game) return { source: "gaming", base: Number(game[1]), tier: null };
  const habit = HABIT_RE.exec(text);
  if (habit) {
    const tier = habit[1] as HabitTier;
    return { source: "habit", base: e.habitPayout[tier], tier };
  }
  const mult = milestoneMultiplier(text, e);
  if (mult) {
    const tag = milestoneTag(text, e)!;
    return { source: "milestone", base: e.defaultBase * mult, tier: tag };
  }
  return { source: "task", base: e.defaultBase, tier: null };
}

/** First milestone tag present anywhere in the line, at any nesting depth. §V5 */
export function milestoneTag(text: string, e: Economy): string | null {
  for (const tag of Object.keys(e.milestoneByTag)) {
    // \b won't fire before '#', so match tag as a whole token via boundaries around it.
    const re = new RegExp(`(?:^|\\s)${escapeRe(tag)}(?=\\s|$)`);
    if (re.test(text)) return tag;
  }
  return null;
}

export function milestoneMultiplier(text: string, e: Economy): number | null {
  const tag = milestoneTag(text, e);
  return tag ? e.milestoneByTag[tag] : null;
}

/** Roll crit. Returns the chosen multiplier or null. §V2 */
export function rollCrit(e: Economy, rng: Rng): number | null {
  if (rng() >= e.critChance) return null;
  if (e.critMultipliers.length === 0) return null;
  const idx = Math.min(e.critMultipliers.length - 1, Math.floor(rng() * e.critMultipliers.length));
  return e.critMultipliers[idx];
}

export interface Payout {
  base: number;
  crit: number | null; // multiplier applied, null = no crit
  chips: number; // final paid amount, integer
}

/** Deterministic base, then independent crit roll. §V2 */
export function payout(base: number, e: Economy, rng: Rng): Payout {
  const crit = rollCrit(e, rng);
  const chips = crit ? Math.round(base * crit) : base;
  return { base, crit, chips };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
