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
export interface SpendEntry {
  kind: "spend";
  date: string;
  reward: string;
  price: number;
}
export interface ClaimEntry {
  kind: "claim";
  date: string;
  reward: string;
}
export type LedgerEntry = CreditEntry | ReversalEntry | SpendEntry | ClaimEntry;

/** Balance = sum of chips over credit + reversal entries. Spend/claim never move it. §V3,§V6 */
export function balance(entries: LedgerEntry[]): number {
  let b = 0;
  for (const e of entries) {
    if (e.kind === "credit" || e.kind === "reversal") b += e.chips;
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

export interface MonthlyAggregate {
  month: string; // yyyy-mm
  chipsByTier: Record<string, number>;
  chipsBySource: Record<string, number>;
  critCount: number;
  purchased: number;
  claimed: number;
  reversals: number;
}

/** Roll a month's ledger into one permanent aggregate record. From ledger only. §V16 */
export function aggregate(entries: LedgerEntry[], month: string): MonthlyAggregate {
  const inMonth = entries.filter((e) => e.date.startsWith(month));
  const chipsByTier: Record<string, number> = {};
  const chipsBySource: Record<string, number> = {};
  let critCount = 0, purchased = 0, claimed = 0, reversals = 0;
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
      case "spend": purchased++; break;
      case "claim": claimed++; break;
    }
  }
  return { month, chipsByTier, chipsBySource, critCount, purchased, claimed, reversals };
}
