// Vault IO. Rewards/wallet/ledger/aggregates live as vault files under a
// configurable base folder; filenames + structure fixed. §V17,§V20.
import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import type { Reward } from "./rewards.js";
import { deriveState, slug } from "./rewards.js";
import type { LedgerEntry, MonthlyAggregate } from "./ledger.js";
import { groupByMonth } from "./ledger.js";
import { jsonBlock, parseJsonBlock, parseJsonBlockStrict } from "./jsonblock.js";

export class VaultStore {
  constructor(private app: App, private base: () => string) {}

  private path(...parts: string[]): string {
    return normalizePath([this.base(), ...parts].join("/"));
  }

  private async ensureFolder(p: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(p)) {
      await this.app.vault.createFolder(p).catch(() => {}); // ponytail: ignore "already exists" race
    }
  }

  async ensureLayout(): Promise<void> {
    await this.ensureFolder(this.path());
    await this.ensureFolder(this.path("rewards"));
    await this.ensureFolder(this.path("ledger"));
  }

  // All ledger/aggregate rewrites run through here in order. Without it, a purchase or gacha roll
  // landing between a rescan flush's read and its write would be clobbered by the flush. §V6
  private tail: Promise<unknown> = Promise.resolve();
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => {});
    return run;
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(path, content);
  }

  private async readFile(path: string): Promise<string | null> {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? this.app.vault.read(f) : null;
  }

  // ---- rewards ----
  rewardPath(name: string): string {
    return this.path("rewards", `${slug(name)}.md`);
  }

  async readRewards(): Promise<Reward[]> {
    const folder = this.path("rewards");
    const out: Reward[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(folder + "/")) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm?.type !== "reward") continue;
      out.push(normalizeReward(fm));
    }
    return out;
  }

  async writeReward(r: Reward): Promise<void> {
    r.state = deriveState(r);
    await this.writeFile(this.rewardPath(r.name), rewardNote(r));
  }

  async deleteReward(name: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(this.rewardPath(name));
    if (f instanceof TFile) await this.app.vault.delete(f);
  }

  // ---- ledger (one file per month) ----
  private ledgerPath(month: string): string {
    return this.path("ledger", `${month}.md`);
  }

  async appendLedger(e: LedgerEntry): Promise<void> {
    await this.appendLedgerMany([e]);
  }

  /**
   * Append a batch with ONE read+write per month file. Appending one entry at a time re-read the
   * file through Obsidian's vault cache, which lags a just-queued modify — under a rescan's rapid
   * loop a later write rebuilt the file from a stale base and dropped the entries in between.
   * Those credits then looked uncredited on reload and got paid again next run. §V13,§V32
   */
  async appendLedgerMany(batch: LedgerEntry[]): Promise<void> {
    await this.serialize(async () => {
      for (const [month, entries] of groupByMonth(batch)) {
        const path = this.ledgerPath(month);
        // Strict: an unreadable month file must abort, not read as empty and wipe its purchases.
        const merged = parseJsonBlockStrict<LedgerEntry>(await this.readFile(path), path);
        merged.push(...entries);
        await this.writeFile(path, jsonBlock(`ledger ${month}`, merged));
      }
    });
  }

  async readLedger(): Promise<LedgerEntry[]> {
    const folder = this.path("ledger");
    const all: LedgerEntry[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(folder + "/")) continue;
      all.push(...parseJsonBlock<LedgerEntry>(await this.app.vault.read(f)));
    }
    return all.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---- aggregates ----
  private aggPath(): string {
    return this.path("aggregates.md");
  }
  async readAggregates(): Promise<MonthlyAggregate[]> {
    return parseJsonBlock<MonthlyAggregate>(await this.readFile(this.aggPath()));
  }
  async writeAggregate(a: MonthlyAggregate): Promise<void> {
    await this.serialize(async () => {
      const path = this.aggPath();
      const rows = parseJsonBlockStrict<MonthlyAggregate>(await this.readFile(path), path)
        .filter((x) => x.month !== a.month);
      rows.push(a);
      rows.sort((x, y) => x.month.localeCompare(y.month));
      await this.writeFile(path, jsonBlock("monthly aggregates", rows));
    });
  }

  // ---- wallet cache ----
  async writeWalletCache(balance: number): Promise<void> {
    await this.writeFile(this.path("wallet.md"), `---\nbalance: ${balance}\n---\n`);
  }
}

// ---- reward note serialization ----
function rewardNote(r: Reward): string {
  const fm: Record<string, unknown> = {
    type: "reward",
    name: r.name,
    price: r.price,
    servings: r.servings,
    purchasedCount: r.purchasedCount,
    claimedCount: r.claimedCount,
    openPurchaseDates: r.openPurchaseDates,
    state: r.state,
  };
  if (r.isPurchasable) {
    fm.isPurchasable = true; // §V25 only when true
    if (r.purchaseUrl) fm.purchaseUrl = r.purchaseUrl;
  }
  if (r.thumbnail) fm.thumbnail = r.thumbnail;
  if (r.desc) fm.desc = r.desc; // §V52 omit when absent
  if (r.emoji) fm.emoji = r.emoji;
  return `---\n${stringifyYaml(fm)}---\n`;
}

function normalizeReward(fm: Record<string, unknown>): Reward {
  const r: Reward = {
    type: "reward",
    name: String(fm.name ?? ""),
    price: Number(fm.price ?? 0),
    servings: Number(fm.servings ?? 1),
    purchasedCount: Number(fm.purchasedCount ?? 0),
    claimedCount: Number(fm.claimedCount ?? 0),
    openPurchaseDates: Array.isArray(fm.openPurchaseDates) ? fm.openPurchaseDates.map(String) : [],
    state: "available",
  };
  if (fm.isPurchasable === true) {
    r.isPurchasable = true;
    if (typeof fm.purchaseUrl === "string") r.purchaseUrl = fm.purchaseUrl;
  }
  if (typeof fm.thumbnail === "string") r.thumbnail = fm.thumbnail;
  if (typeof fm.desc === "string") r.desc = fm.desc;
  if (typeof fm.emoji === "string") r.emoji = fm.emoji;
  r.state = deriveState(r);
  return r;
}

