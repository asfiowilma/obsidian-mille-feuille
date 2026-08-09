// Reward model + two-state repeatable flow. Pure. §V7-§V11,§V25.

export type RewardState = "available" | "purchased" | "sold-out";

export interface Reward {
  type: "reward";
  name: string;
  price: number;
  servings: number; // 1 one-off | N | -1 infinite | 0 sold-out
  purchasedCount: number;
  claimedCount: number;
  openPurchaseDates: string[]; // oldest-first
  state: RewardState; // DERIVED, persisted top-level for Dataview
  isPurchasable?: true; // §V25 written only when true
  purchaseUrl?: string;
}

export function openCount(r: Reward): number {
  return r.openPurchaseDates.length;
}

/** remaining servings; Infinity for -1. §V7 */
export function remaining(r: Reward): number {
  return r.servings === -1 ? Infinity : r.servings - r.purchasedCount;
}

export function hasCapacity(r: Reward): boolean {
  return r.servings === -1 || r.purchasedCount < r.servings;
}

/** §V9 sold-out when capacity spent and no open occurrences. */
export function isSoldOut(r: Reward): boolean {
  return r.servings !== -1 && r.purchasedCount >= r.servings && openCount(r) === 0;
}

/** Derived state, written top-level. §V9 (affordability is live, not stored). */
export function deriveState(r: Reward): RewardState {
  if (isSoldOut(r)) return "sold-out";
  if (openCount(r) > 0) return "purchased";
  return "available";
}

/** Live affordability — never persisted. §V9 */
export function affordable(r: Reward, balance: number): boolean {
  return balance >= r.price;
}

export function canBuy(r: Reward, balance: number): boolean {
  return hasCapacity(r) && affordable(r, balance);
}

/** Oldest open occurrence age in days vs today, or null. §V11 */
export function oldestOpenAgeDays(r: Reward, today: string): number | null {
  if (openCount(r) === 0) return null;
  return daysBetween(r.openPurchaseDates[0], today);
}

export function isStale(r: Reward, today: string, staleAfterDays: number): boolean {
  const age = oldestOpenAgeDays(r, today);
  return age !== null && age > staleAfterDays;
}

export interface BuyResult {
  ok: boolean;
  reason?: "no-capacity" | "insufficient";
}

/** Purchase: guard capacity + affordability, mutate reward. Never credits chips. §V7 */
export function purchase(r: Reward, balance: number, today: string): BuyResult {
  if (!hasCapacity(r)) return { ok: false, reason: "no-capacity" };
  if (!affordable(r, balance)) return { ok: false, reason: "insufficient" };
  r.purchasedCount++;
  r.openPurchaseDates.push(today); // append oldest-first (dates monotonic)
  r.state = deriveState(r);
  return { ok: true };
}

/** Claim FIFO: pop oldest open. Never credits chips. §V8 */
export function claim(r: Reward): boolean {
  if (openCount(r) === 0) return false;
  r.claimedCount++;
  r.openPurchaseDates.shift();
  r.state = deriveState(r);
  return true;
}

/** Filename slug from name. §V23 */
export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}
