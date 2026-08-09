// Stateful toast trackers. Copy now lives in messages.ts (§V31). §V28,§V29.
import type { Reward } from "./rewards.js";
import { canBuy, isSoldOut } from "./rewards.js";

// §V29 — crit streak across all credit sources. Returns streak count at 2+, else null.
export class CritStreak {
  private count = 0;
  onCredit(isCrit: boolean): number | null {
    if (!isCrit) { this.count = 0; return null; }
    this.count++;
    return this.count >= 2 ? this.count : null;
  }
}

// §V28 — affordability crossing. Returns rewards that just crossed false→true.
export class AffordabilityTracker {
  private wasAffordable = new Map<string, boolean>();

  /** Seed silently on load — no crossings reported. */
  seed(rewards: Reward[], balance: number): void {
    for (const r of rewards) this.wasAffordable.set(r.name, canBuy(r, balance));
  }

  /** Re-evaluate after a balance change; return rewards freshly crossed upward. */
  check(rewards: Reward[], balance: number): Reward[] {
    const out: Reward[] = [];
    for (const r of rewards) {
      const now = !isSoldOut(r) && canBuy(r, balance);
      const before = this.wasAffordable.get(r.name) ?? false;
      if (now && !before) out.push(r);
      this.wasAffordable.set(r.name, now);
    }
    return out;
  }
}
