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
  type LedgerEntry,
  type CreditEntry,
} from "./ledger.js";
import type { Reward } from "./rewards.js";
import { isSoldOut, purchase, claim as claimReward, slug } from "./rewards.js";
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

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new VaultStore(this.app, () => this.settings.baseFolder);
    this.addSettingTab(new MilleFeuilleSettingTab(this.app, this));

    this.registerView(MILLE_VIEW, (leaf) => new MilleFeuilleView(leaf, this));
    this.addRibbonIcon("cookie", "Open Mille-Feuille", () => this.activateView());
    this.addCommand({ id: "open-mille-feuille", name: "Open panel", callback: () => this.activateView() });
    this.addCommand({ id: "roll-monthly", name: "Roll monthly review", callback: () => this.rollMonthly() });

    this.app.workspace.onLayoutReady(async () => {
      await this.store.ensureLayout();
      await this.reload();
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

  /** Parse one line, decide credit/reverse vs the ledger, apply. Returns true if it moved chips. */
  private async reconcileLine(path: string, raw: string): Promise<boolean> {
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
      const m = this.settings.messages;
      const critText = pay.crit ? renderMsg(m, "critSuffix", {}) : "";
      if (firstEver) notify(renderMsg(m, "firstChip", {}));
      notify(cls.source === "milestone"
        ? renderMsg(m, "milestone", { chips: pay.chips, crit: critText, tier: cls.tier ?? "" })
        : renderMsg(m, "mint", { chips: pay.chips, crit: critText }));
      const streak = this.streak.onCredit(!!pay.crit);
      if (streak !== null) notify(critStreakCopy(m, streak));
      return true;
    }

    // reverse
    const frozen = frozenChips(this.entries, key);
    if (!frozen) return false;
    const rev: LedgerEntry = { kind: "reversal", date: today(), reversalOf: key, chips: -frozen.chips };
    this.entries.push(rev);
    await this.store.appendLedger(rev);
    notify(renderMsg(this.settings.messages, "refund", { chips: frozen.chips }));
    this.streak.onCredit(false); // uncheck breaks streak
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
    const m = this.settings.messages;
    const res = purchase(r, this.balance(), today());
    if (!res.ok) {
      if (res.reason === "no-capacity") notify(renderMsg(m, "soldOut", { name: r.name }));
      return;
    }
    const spend: LedgerEntry = { kind: "spend", date: today(), reward: r.name, price: r.price };
    this.entries.push(spend);
    await this.store.appendLedger(spend);
    await this.store.writeReward(r);
    await this.store.writeWalletCache(this.balance());
    notify(renderMsg(m, "purchase", { name: r.name, price: r.price }));
    this.afford.check(this.rewards, this.balance()); // update baseline after spend
    this.refreshViews();
  }

  async claim(r: Reward): Promise<void> {
    if (!claimReward(r)) return;
    const c: LedgerEntry = { kind: "claim", date: today(), reward: r.name };
    this.entries.push(c);
    await this.store.appendLedger(c);
    await this.store.writeReward(r);
    const m = this.settings.messages;
    notify(isSoldOut(r) ? renderMsg(m, "fullyClaimed", { name: r.name }) : renderClaim(m, { name: r.name }, this.rng));
    this.refreshViews();
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
