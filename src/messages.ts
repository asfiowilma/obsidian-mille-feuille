// Editable toast templates + {{var}} rendering. Pure. §V31.
import type { Rng } from "./economy.js";

export interface Messages {
  mint: string;
  milestone: string;
  critSuffix: string;
  refund: string;
  purchase: string;
  added: string;
  deleted: string;
  soldOut: string;
  fullyClaimed: string;
  afford: string;
  firstChip: string;
  monthly: string;
  critStreak: string; // count>=3; count==2 special-cased to "Double crit! 🔥"
  claim: string[]; // random pick
}

export const DEFAULT_MESSAGES: Messages = {
  mint: "Earned +{{chips}}🪙{{crit}}",
  milestone: "Milestone hit! +{{chips}}🪙{{crit}}",
  critSuffix: " ✦ critical hit!",
  refund: "Undone, −{{chips}}🪙 returned",
  purchase: "Bought {{name}} for −{{price}}🪙",
  added: "Added {{name}} to the shop for {{price}}🪙 🛒",
  deleted: "Removed {{name}} from the shop",
  soldOut: "{{name}} sold out, no servings left",
  fullyClaimed: "{{name}} fully claimed 🎉",
  afford: "You can now afford {{name}} ({{price}}🪙) ✨",
  firstChip: "First chips minted, the bakery opens 🥐",
  monthly: "Monthly review ready, {{chips}}🪙 earned this month",
  critStreak: "Crit streak x{{count}}! 🔥",
  claim: [
    "{{name}} claimed, enjoy it you earned this 🍰",
    "{{name}} claimed, go treat yourself ✨",
    "{{name}} claimed, no guilt you did the work 🍪",
    "{{name}} claimed, fresh out the oven enjoy 🥐",
    "{{name}} claimed, cashed in enjoy! 🎉",
  ],
};

export type Ctx = Record<string, string | number>;

/** Substitute {{key}} → ctx[key]; absent key → "". No logic. §V31 */
export function render(template: string, ctx: Ctx): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = ctx[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** A blank template falls back to its default — a toast is never blank. §V31 */
export function pick<K extends keyof Messages>(m: Messages, key: K): Messages[K] {
  const v = m[key];
  if (typeof v === "string") return (v.trim() ? v : DEFAULT_MESSAGES[key]) as Messages[K];
  const list = (v as string[]).filter((s) => s.trim());
  return (list.length ? list : DEFAULT_MESSAGES.claim) as Messages[K];
}

export function renderMsg(m: Messages, key: Exclude<keyof Messages, "claim">, ctx: Ctx): string {
  return render(pick(m, key) as string, ctx);
}

/** Random claim line, rendered. §V31 */
export function renderClaim(m: Messages, ctx: Ctx, rng: Rng): string {
  const list = pick(m, "claim") as string[];
  return render(list[Math.min(list.length - 1, Math.floor(rng() * list.length))], ctx);
}

/** Crit streak copy — count==2 special-cased, else the template. §V29,§V31 */
export function critStreakCopy(m: Messages, count: number): string {
  if (count === 2) return "Double crit! 🔥";
  return renderMsg(m, "critStreak", { count });
}
