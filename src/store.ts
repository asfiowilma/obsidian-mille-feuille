// Vault IO. Rewards/wallet/ledger/aggregates live as vault files under a
// configurable base folder; filenames + structure fixed. §V17,§V20.
import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import type { Reward } from "./rewards.js";
import { deriveState, slug } from "./rewards.js";
import type { LedgerEntry, MonthlyAggregate } from "./ledger.js";
import { groupByMonth } from "./ledger.js";
import { jsonBlock, parseJsonBlock, parseJsonBlockStrict } from "./jsonblock.js";
import {
  appendMatchRow, parseSessionNote, sessionNote, setFrontmatterField, insertTask,
  type Match, type Session,
} from "./gaming.js";

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

  // ---- gaming: match notes + the session task file (§I.file, §V59) ----
  // Paths come from the caller: these files live in the user's vault, outside our base folder.

  private async ensurePath(filePath: string): Promise<void> {
    const dir = filePath.split("/").slice(0, -1).join("/");
    if (dir) await this.ensureFolder(normalizePath(dir));
  }

  /** Every session in the gaming folder, newest-first, each with its unreadable-row count. §V75,§V79 */
  async readSessions(folder: string): Promise<{ session: Session; unreadable: number }[]> {
    const dir = normalizePath(folder);
    const out: { session: Session; unreadable: number }[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path !== dir && !f.path.startsWith(dir + "/")) continue;
      const content = await this.app.vault.read(f);
      const parsed = parseSessionNote(content, f.basename);
      if (!/^type:\s*gaming-session\s*$/m.test(content)) continue; // plugin-owned notes only
      out.push(parsed);
    }
    return out.sort((a, b) => b.session.id.localeCompare(a.session.id));
  }

  private sessionPath(folder: string, id: string): string {
    return normalizePath(`${folder}/${id}.md`);
  }

  /** §V72: append one row, creating the note when absent. Never touches `processed`. */
  async logMatch(folder: string, id: string, m: Match, focus?: string): Promise<void> {
    const path = this.sessionPath(folder, id);
    await this.ensurePath(path);
    const existing = await this.readFile(path);
    let content = existing ?? sessionNote(id, focus);
    if (existing && focus) content = setFrontmatterField(content, "focus", focus); // §V76 once per session
    await this.writeFile(path, appendMatchRow(content, m));
  }

  /** §V76: write the focus goal without logging a match (an empty goal still counts as answered). */
  async writeFocus(folder: string, id: string, focus: string): Promise<void> {
    const path = this.sessionPath(folder, id);
    await this.ensurePath(path);
    const content = (await this.readFile(path)) ?? sessionNote(id);
    await this.writeFile(path, setFrontmatterField(content, "focus", focus));
  }

  /** §V63 step 3: raise `processed` to the match count of the note. Never lowered here (§V74). */
  async setProcessed(folder: string, id: string, n: number): Promise<void> {
    const path = this.sessionPath(folder, id);
    const content = await this.readFile(path);
    if (content === null) return;
    await this.writeFile(path, setFrontmatterField(content, "processed", n));
  }

  async readTaskFile(taskFile: string): Promise<string> {
    return (await this.readFile(normalizePath(taskFile))) ?? "";
  }

  /** §V63 step 2: put one batch task under `## Tasks`. The scan credits it when it is ticked. */
  async appendTask(taskFile: string, block: string): Promise<void> {
    const path = normalizePath(taskFile);
    await this.ensurePath(path);
    await this.writeFile(path, insertTask(await this.readTaskFile(taskFile), block));
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

