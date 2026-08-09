// Vault IO. Rewards/wallet/ledger/aggregates live as vault files under a
// configurable base folder; filenames + structure fixed. §V17,§V20.
import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import type { Reward } from "./rewards.js";
import { deriveState, slug } from "./rewards.js";
import type { LedgerEntry, MonthlyAggregate } from "./ledger.js";

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
    const month = e.date.slice(0, 7);
    const path = this.ledgerPath(month);
    const entries = parseJsonBlock<LedgerEntry>(await this.readFile(path));
    entries.push(e);
    await this.writeFile(path, jsonBlock(`ledger ${month}`, entries));
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
    const rows = (await this.readAggregates()).filter((x) => x.month !== a.month);
    rows.push(a);
    rows.sort((x, y) => x.month.localeCompare(y.month));
    await this.writeFile(this.aggPath(), jsonBlock("monthly aggregates", rows));
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
  r.state = deriveState(r);
  return r;
}

// ---- JSON-in-fence helpers (ledger/aggregate files stay human-openable) ----
function jsonBlock(label: string, data: unknown): string {
  return `> ${label}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
}
function parseJsonBlock<T>(content: string | null): T[] {
  if (!content) return [];
  const m = /```json\s*([\s\S]*?)```/.exec(content);
  if (!m) return [];
  try {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
