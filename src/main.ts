import { Notice, Plugin, TFile, TAbstractFile } from "obsidian";
import {
  MilleFeuilleSettingTab,
  DEFAULT_SETTINGS,
  type MilleFeuilleSettings,
} from "./settings.js";
import { classifyLine, payout, type Rng } from "./economy.js";
import {
  balance as sumBalance,
  isCredited,
  frozenChips,
  aggregate,
  missingClosedMonths,
  type LedgerEntry,
  type CreditEntry,
} from "./ledger.js";
import type { Reward } from "./rewards.js";
import { isSoldOut, purchase, claim as claimReward, slug, hasCapacity, grantFree } from "./rewards.js";
import { canRoll, rollOutcome, rollNet, type GachaOutcome, type RollDenial } from "./gacha.js";
import { parseLine, habitKey, taskKey, decideAction, inScanScope } from "./scan.js";
import { CritStreak, AffordabilityTracker } from "./toasts.js";
import { renderMsg, renderClaim, critStreakCopy } from "./messages.js";
import { VaultStore } from "./store.js";
import { MILLE_VIEW, MilleFeuilleView } from "./view.js";

const today = (): string => new Date().toISOString().slice(0, 10);
const notify = (msg: string): void => {
  new Notice(msg);
};

export default class MilleFeuillePlugin extends Plugin {
  declare settings: MilleFeuilleSettings;
  store!: VaultStore;
  entries: LedgerEntry[] = [];
  rewards: Reward[] = [];
  private streak = new CritStreak();
  private afford = new AffordabilityTracker();
  private rng: Rng = Math.random;
  private busy = false; // reentrancy lock for money paths (buy/claim) — double-click guard

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new VaultStore(this.app, () => this.settings.baseFolder);
    this.addSettingTab(new MilleFeuilleSettingTab(this.app, this));

    this.registerView(MILLE_VIEW, (leaf) => new MilleFeuilleView(leaf, this));
    this.addRibbonIcon("cookie", "Open mille-feuille", () => this.activateView());
    this.addCommand({ id: "open-mille-feuille", name: "Open panel", callback: () => this.activateView() });
    this.addCommand({ id: "roll-monthly", name: "Roll monthly review", callback: () => this.rollMonthly() });
    this.addCommand({ id: "rescan-vault", name: "Rescan vault for completed tasks", callback: () => this.rescanAll() });

    this.app.workspace.onLayoutReady(async () => {
      await this.store.ensureLayout();
      await this.reload();
      await this.autoRollMonths(); // §V33 backfill missing closed-month aggregates, silent
      this.afford.seed(this.rewards, this.balance());
      // Scan on file change; §V1 credits on transition to done, ledger-driven idempotency.
      this.registerEvent(this.app.vault.on("modify", (f) => this.onFileChanged(f)));
    });
  }

  onunload(): void {}

  balance(): number {
    return sumBalance(this.entries);
  }

  async reload(): Promise<void> {
    this.entries = await this.store.readLedger();
    this.rewards = await this.store.readRewards();
    this.refreshViews();
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MILLE_VIEW)) {
      const v = leaf.view;
      if (v instanceof MilleFeuilleView) v.render();
    }
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(MILLE_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: MILLE_VIEW, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  // ---- scanning ----
  private async onFileChanged(f: TAbstractFile): Promise<void> {
    if (!(f instanceof TFile) || f.extension !== "md") return;
    if (!inScanScope(f.path, {
      include: this.settings.scanInclude,
      exclude: this.settings.scanExclude,
      base: this.settings.baseFolder,
    })) return; // §V30 scope + own-data guard
    const content = await this.app.vault.read(f);
    let changed = false;
    for (const raw of content.split("\n")) {
      if (await this.reconcileLine(f.path, raw)) changed = true;
    }
    if (changed) {
      await this.afterCredit();
    }
  }

  /** Parse one line, decide credit/reverse vs the ledger, apply. Returns true if it moved chips.
   *  quiet (§V32 rescan): suppress per-line toasts + crit-streak so backfill stays silent. */
  private async reconcileLine(path: string, raw: string, quiet = false): Promise<boolean> {
    const p = parseLine(raw);
    if (!p) return false;
    const hk = habitKey(p.text);
    const key = hk ? `${hk.id}·${hk.doneDate}` : taskKey(path, p.text);
    const credited = isCredited(this.entries, key);
    const action = decideAction(p, credited);
    if (action === "none") return false;

    if (action === "credit") {
      const cls = classifyLine(p.text, this.settings.economy);
      // §V13/§V14: reuse frozen amount if this key was ever credited (no crit re-roll).
      const prior = frozenChips(this.entries, key);
      const pay = prior
        ? { base: prior.base, crit: prior.crit, chips: prior.chips }
        : payout(cls.base, this.settings.economy, this.rng);
      const firstEver = !this.entries.some((e) => e.kind === "credit");
      const entry: CreditEntry = {
        kind: "credit", date: today(), source: cls.source, key,
        base: pay.base, crit: pay.crit, chips: pay.chips, tier: cls.tier,
      };
      this.entries.push(entry);
      await this.store.appendLedger(entry);
      if (!quiet) {
        const m = this.settings.messages;
        const critText = pay.crit ? renderMsg(m, "critSuffix", {}) : "";
        if (firstEver) notify(renderMsg(m, "firstChip", {}));
        notify(cls.source === "milestone"
          ? renderMsg(m, "milestone", { chips: pay.chips, crit: critText, tier: cls.tier ?? "" })
          : renderMsg(m, "mint", { chips: pay.chips, crit: critText }));
        const streak = this.streak.onCredit(!!pay.crit);
        if (streak !== null) notify(critStreakCopy(m, streak));
      }
      return true;
    }

    // reverse
    const frozen = frozenChips(this.entries, key);
    if (!frozen) return false;
    const rev: LedgerEntry = { kind: "reversal", date: today(), reversalOf: key, chips: -frozen.chips };
    this.entries.push(rev);
    await this.store.appendLedger(rev);
    if (!quiet) {
      notify(renderMsg(this.settings.messages, "refund", { chips: frozen.chips }));
      this.streak.onCredit(false); // uncheck breaks streak
    }
    return true;
  }

  private async afterCredit(): Promise<void> {
    await this.store.writeWalletCache(this.balance());
    const m = this.settings.messages;
    for (const r of this.afford.check(this.rewards, this.balance())) {
      notify(renderMsg(m, "afford", { name: r.name, price: r.price }));
    }
    this.refreshViews();
  }

  // ---- shop ops (anti-loop: never credit chips) §V3 ----
  async buy(r: Reward): Promise<void> {
    if (this.busy) return; // double-click guard
    this.busy = true;
    try {
      const m = this.settings.messages;
      const res = purchase(r, this.balance(), today());
      if (!res.ok) {
        if (res.reason === "no-capacity") notify(renderMsg(m, "soldOut", { name: r.name }));
        return;
      }
      const spend: LedgerEntry = { kind: "spend", date: today(), reward: r.name, price: r.price, chips: -r.price };
      this.entries.push(spend);
      await this.store.appendLedger(spend);
      await this.store.writeReward(r);
      await this.store.writeWalletCache(this.balance());
      notify(renderMsg(m, "purchase", { name: r.name, price: r.price }));
      this.afford.check(this.rewards, this.balance()); // update baseline after spend
      this.refreshViews();
    } finally {
      this.busy = false;
    }
  }

  async claim(r: Reward): Promise<void> {
    if (this.busy) return; // double-click guard
    this.busy = true;
    try {
      if (!claimReward(r)) return;
      const c: LedgerEntry = { kind: "claim", date: today(), reward: r.name };
      this.entries.push(c);
      await this.store.appendLedger(c);
      await this.store.writeReward(r);
      const m = this.settings.messages;
      notify(isSoldOut(r) ? renderMsg(m, "fullyClaimed", { name: r.name }) : renderClaim(m, { name: r.name }, this.rng));
      this.refreshViews();
    } finally {
      this.busy = false;
    }
  }

  // ---- gacha (anti-loop: writes only spend entries, never credit) §V3,§V40 ----
  /** §V37,§V38,§V39,§V40. Guards, writes the net-chips roll entry, returns the reveal payload. */
  async roll(): Promise<
    | { ok: false; reason: RollDenial }
    | { ok: true; outcome: GachaOutcome; net: number; hasPool: boolean }
  > {
    const g = this.settings.gacha;
    const guard = canRoll(g, this.entries, this.balance(), today());
    if (!guard.ok) return guard;
    const outcome = rollOutcome(g, this.rng);
    const net = rollNet(g.cost, outcome);
    const spend: LedgerEntry = {
      kind: "spend", date: today(), subtype: "gacha", chips: net, outcome: outcome.type,
    };
    if (outcome.value !== undefined && (outcome.type === "rebate_small" || outcome.type === "rebate_big"))
      spend.value = outcome.value; // §V41 stat source
    this.entries.push(spend);
    await this.store.appendLedger(spend);
    await this.store.writeWalletCache(this.balance());
    this.afford.check(this.rewards, this.balance()); // rebate can move affordability baseline
    // §V46: pool checked AFTER the roll, never before (no info leak).
    const hasPool = this.rewards.some((r) => hasCapacity(r));
    return { ok: true, outcome, net, hasPool };
  }

  /** §V48,§V49,§V50: free win = open purchase at no cost + gacha grant marker. */
  async grantFreeReward(r: Reward): Promise<boolean> {
    if (this.busy) return false; // double-click guard
    this.busy = true;
    try {
      if (!grantFree(r, today())) return false;
      const marker: LedgerEntry = {
        kind: "spend", date: today(), reward: r.name, price: 0, subtype: "gacha", outcome: "free_reward",
      };
      this.entries.push(marker);
      await this.store.appendLedger(marker);
      await this.store.writeReward(r);
      this.refreshViews();
      return true;
    } finally {
      this.busy = false;
    }
  }

  async addReward(r: Reward): Promise<void> {
    await this.store.writeReward(r);
    this.rewards.push(r);
    this.afford.check(this.rewards, this.balance());
    notify(renderMsg(this.settings.messages, "added", { name: r.name, price: r.price }));
    this.refreshViews();
  }

  /** Edit an existing reward in place. If the name (slug) changed, drop the old file. */
  async updateReward(oldName: string, r: Reward): Promise<void> {
    if (slug(oldName) !== slug(r.name)) await this.store.deleteReward(oldName);
    await this.store.writeReward(r);
    const i = this.rewards.findIndex((x) => x.name === oldName);
    if (i >= 0) this.rewards[i] = r; else this.rewards.push(r);
    this.afford.check(this.rewards, this.balance());
    this.refreshViews();
  }

  async removeReward(r: Reward): Promise<void> {
    await this.store.deleteReward(r.name);
    this.rewards = this.rewards.filter((x) => x.name !== r.name);
    notify(renderMsg(this.settings.messages, "deleted", { name: r.name }));
    this.refreshViews();
  }

  /** §V32: walk every in-scope md file through reconcileLine (quiet). Idempotent backfill. */
  async rescanAll(): Promise<void> {
    const before = this.balance();
    const scope = { include: this.settings.scanInclude, exclude: this.settings.scanExclude, base: this.settings.baseFolder };
    let moved = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!inScanScope(f.path, scope)) continue;
      const content = await this.app.vault.read(f);
      for (const raw of content.split("\n")) {
        if (await this.reconcileLine(f.path, raw, true)) moved++;
      }
    }
    if (moved) {
      await this.store.writeWalletCache(this.balance());
      this.afford.seed(this.rewards, this.balance()); // reseed baseline silently, no afford spam
      this.refreshViews();
    }
    const gained = this.balance() - before;
    notify(`Rescan done: ${moved} task${moved === 1 ? "" : "s"} reconciled, ${gained >= 0 ? "+" : ""}${gained}🪙`);
  }

  /** §V33: on load, roll any closed month that has credits but no aggregate yet. Silent. */
  private async autoRollMonths(): Promise<void> {
    const have = (await this.store.readAggregates()).map((a) => a.month);
    for (const m of missingClosedMonths(this.entries, have, today().slice(0, 7))) {
      await this.store.writeAggregate(aggregate(this.entries, m));
    }
  }

  async rollMonthly(): Promise<void> {
    const month = today().slice(0, 7);
    const agg = aggregate(this.entries, month);
    await this.store.writeAggregate(agg);
    const earned = Object.values(agg.chipsBySource).reduce((a, b) => a + b, 0);
    notify(renderMsg(this.settings.messages, "monthly", { chips: earned }));
  }

  // ---- settings ----
  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshViews();
  }
}
