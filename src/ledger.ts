// Ledger = source of truth for balance + aggregates. Pure. §V3,§V6,§V16.
import type { Source } from "./economy.js";

export interface CreditEntry {
  kind: "credit";
  date: string; // ISO yyyy-mm-dd
  source: Source;
  key: string; // (id,✅date) for habits; unique-ish for others
  base: number;
  crit: number | null;
  chips: number; // + amount
  tier: string | null;
}
export interface ReversalEntry {
  kind: "reversal";
  date: string;
  reversalOf: string; // key of the credit reversed
  chips: number; // negative
}
export type GachaOutcomeType = "nothing" | "rebate_small" | "rebate_big" | "free_reward";

export interface SpendEntry {
  kind: "spend";
  date: string;
  reward?: string; // absent on a gacha ROLL row; present on a purchase + free-grant marker
  price?: number; // present on a purchase + free-grant marker (0); absent on a gacha roll
  chips?: number; // NEW signed. purchase = -price. gacha roll = -cost + rebate. absent = counts 0. §V35
  subtype?: "gacha"; // NEW marks a gacha spend (roll or free-grant marker). §V40,§V49
  outcome?: GachaOutcomeType; // gacha only
  value?: number; // gacha rebate: chips the rebate returned (drives gachaRebated stat). §V41
}
export interface ClaimEntry {
  kind: "claim";
  date: string;
  reward: string;
  // §V49: no `source` — gacha origin proof lives on the grant marker, not the claim.
}
export type LedgerEntry = CreditEntry | ReversalEntry | SpendEntry | ClaimEntry;

/** Balance = sum of chips over credit + reversal + spend entries. §V6,§V35 (spend counts e.chips ?? 0). */
export function balance(entries: LedgerEntry[]): number {
  let b = 0;
  for (const e of entries) {
    if (e.kind === "credit" || e.kind === "reversal") b += e.chips;
    else if (e.kind === "spend") b += e.chips ?? 0; // pre-fix spend has no chips → 0
  }
  return b;
}

/** Is a habit credit key already live (credited and not reversed)? Drives idempotency. §V13 */
export function isCredited(entries: LedgerEntry[], key: string): boolean {
  let credited = false;
  for (const e of entries) {
    if (e.kind === "credit" && e.key === key) credited = true;
    else if (e.kind === "reversal" && e.reversalOf === key) credited = false;
  }
  return credited;
}

/** The frozen chips for a key (from its most recent credit), or null. §V14 re-check re-applies. */
export function frozenChips(entries: LedgerEntry[], key: string): CreditEntry | null {
  let hit: CreditEntry | null = null;
  for (const e of entries) if (e.kind === "credit" && e.key === key) hit = e;
  return hit;
}

/** Credit key for one habit completion. Tier is part of it: same id can have farm + ult on one day. §V12,§V13 */
export function habitCreditKey(id: string, tier: string, doneDate: string): string {
  return `${id}·${tier}·${doneDate}`;
}

/**
 * Legacy habit credits were keyed `id·date` (tier-less), which made a same-day farm+ult pair
 * collide and silently swallow the second payout. Rewrite them to the tiered key in memory on
 * load — ledger files stay untouched, so old rows keep working without a re-credit.
 */
export function migrateHabitKeys(entries: LedgerEntry[]): LedgerEntry[] {
  const remap = new Map<string, string>();
  for (const e of entries) {
    if (e.kind !== "credit" || e.source !== "habit" || !e.tier) continue;
    const cut = e.key.lastIndexOf("·");
    if (cut < 0) continue;
    const id = e.key.slice(0, cut);
    if (id.endsWith(`·${e.tier}`)) continue; // already tiered
    remap.set(e.key, habitCreditKey(id, e.tier, e.key.slice(cut + 1)));
  }
  if (remap.size === 0) return entries;
  return entries.map((e) => {
    if (e.kind === "credit") {
      const to = remap.get(e.key);
      return to ? { ...e, key: to } : e;
    }
    if (e.kind === "reversal") {
      const to = remap.get(e.reversalOf);
      return to ? { ...e, reversalOf: to } : e;
    }
    return e;
  });
}

/** Split a batch of entries into one bucket per ledger month file, insertion order kept. §V20 */
export function groupByMonth(entries: LedgerEntry[]): Map<string, LedgerEntry[]> {
  const byMonth = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(e);
    else byMonth.set(month, [e]);
  }
  return byMonth;
}

export interface MonthlyAggregate {
  month: string; // yyyy-mm
  chipsByTier: Record<string, number>;
  chipsBySource: Record<string, number>;
  critCount: number;
  purchased: number;
  claimed: number;
  reversals: number;
  gachaRolls: number; // §V41 spend, subtype gacha, reward absent
  gachaRebated: number; // §V41 total chips rebate results returned
  gachaClaims: number; // §V41 free rewards won (grant markers) — separate from paid `claimed`
}

/** Closed months (< current) holding ≥1 credit but no aggregate yet, oldest-first. §V33 */
export function missingClosedMonths(entries: LedgerEntry[], haveMonths: string[], currentMonth: string): string[] {
  const have = new Set(haveMonths);
  const months = new Set<string>();
  for (const e of entries) {
    if (e.kind !== "credit") continue;
    const m = e.date.slice(0, 7);
    if (m < currentMonth && !have.has(m)) months.add(m);
  }
  return [...months].sort();
}

/** Roll a month's ledger into one permanent aggregate record. From ledger only. §V16 */
export function aggregate(entries: LedgerEntry[], month: string): MonthlyAggregate {
  const inMonth = entries.filter((e) => e.date.startsWith(month));
  const chipsByTier: Record<string, number> = {};
  const chipsBySource: Record<string, number> = {};
  let critCount = 0, purchased = 0, claimed = 0, reversals = 0;
  let gachaRolls = 0, gachaRebated = 0, gachaClaims = 0;
  for (const e of inMonth) {
    switch (e.kind) {
      case "credit": {
        const tier = e.tier ?? "base";
        chipsByTier[tier] = (chipsByTier[tier] ?? 0) + e.chips;
        chipsBySource[e.source] = (chipsBySource[e.source] ?? 0) + e.chips;
        if (e.crit) critCount++;
        break;
      }
      case "reversal": reversals++; break;
      case "spend":
        if (e.subtype === "gacha") { // §V41 gacha never counts as a reward purchase
          if (e.reward === undefined) gachaRolls++; // roll row
          else if (e.outcome === "free_reward") gachaClaims++; // grant marker
          if (e.value) gachaRebated += e.value;
        } else purchased++;
        break;
      case "claim": claimed++; break;
    }
  }
  return { month, chipsByTier, chipsBySource, critCount, purchased, claimed, reversals, gachaRolls, gachaRebated, gachaClaims };
}
