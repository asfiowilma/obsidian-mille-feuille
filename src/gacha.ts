// Gacha subsystem — pure roll engine + guards. No Obsidian imports (testable).
// §V37 enable guard, §V38 weighted roll, §V39 daily limit, §V40 net-chips ledger entry.
import type { Rng } from "./economy.js";
import type { LedgerEntry, GachaOutcomeType } from "./ledger.js";

export interface GachaOutcome {
  type: GachaOutcomeType;
  weight: number;
  value?: number; // chips returned; only on rebate_small | rebate_big. May exceed cost (design B).
}

export interface GachaConfig {
  enabled: boolean;
  cost: number;
  maxRollsPerDay: number; // 0 = no limit
  jackpotPopupMs: number;
  outcomes: GachaOutcome[];
}

export const DEFAULT_GACHA: GachaConfig = {
  enabled: false,
  cost: 5,
  maxRollsPerDay: 5,
  jackpotPopupMs: 3000,
  outcomes: [
    { type: "nothing", weight: 50 },
    { type: "rebate_small", weight: 30, value: 2 },
    { type: "rebate_big", weight: 15, value: 8 },
    { type: "free_reward", weight: 5 },
  ],
};

export function sumWeights(g: GachaConfig): number {
  return g.outcomes.reduce((a, o) => a + (o.weight > 0 ? o.weight : 0), 0);
}

/** §V37: on when enabled AND the table can actually produce a result. */
export function gachaActive(g: GachaConfig): boolean {
  return g.enabled && g.outcomes.length > 0 && sumWeights(g) > 0;
}

/** §V38: weight → probability, pick one. rng in [0,1). */
export function rollOutcome(g: GachaConfig, rng: Rng): GachaOutcome {
  const total = sumWeights(g);
  let r = rng() * total;
  for (const o of g.outcomes) {
    const w = o.weight > 0 ? o.weight : 0;
    if (w === 0) continue;
    if (r < w) return o;
    r -= w;
  }
  return g.outcomes[g.outcomes.length - 1]; // fp safety net
}

/** §V38: net chips of a roll = -cost + rebate value (nothing/free_reward add 0). */
export function rollNet(cost: number, o: GachaOutcome): number {
  const rebate = o.type === "rebate_small" || o.type === "rebate_big" ? o.value ?? 0 : 0;
  return -cost + rebate;
}

/** §V39: today's roll count from the ledger — spend, subtype gacha, no reward, dated today. */
export function todayRollCount(entries: LedgerEntry[], today: string): number {
  let n = 0;
  for (const e of entries) {
    if (e.kind === "spend" && e.subtype === "gacha" && e.reward === undefined && e.date === today) n++;
  }
  return n;
}

export type RollDenial = "off" | "no-rolls" | "insufficient";

/** §V36,§V39: daily limit checked BEFORE balance. */
export function canRoll(
  g: GachaConfig,
  entries: LedgerEntry[],
  balance: number,
  today: string,
): { ok: true } | { ok: false; reason: RollDenial } {
  if (!gachaActive(g)) return { ok: false, reason: "off" };
  if (g.maxRollsPerDay > 0 && todayRollCount(entries, today) >= g.maxRollsPerDay)
    return { ok: false, reason: "no-rolls" };
  if (balance < g.cost) return { ok: false, reason: "insufficient" };
  return { ok: true };
}
