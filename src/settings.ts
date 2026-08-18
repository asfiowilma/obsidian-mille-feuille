import { App, PluginSettingTab, Setting } from "obsidian";
import type MilleFeuillePlugin from "./main.js";
import { DEFAULT_ECONOMY, type Economy } from "./economy.js";
import { DEFAULT_MESSAGES, type Messages } from "./messages.js";
import { DEFAULT_GACHA, type GachaConfig, type GachaOutcome } from "./gacha.js";
import { DEFAULT_GAMING, parseThresholds, parseBands, type GamingConfig } from "./gaming.js";

export interface MilleFeuilleSettings {
  economy: Economy;
  gacha: GachaConfig; // §I top-level, separate from economy
  gaming: GamingConfig; // §I top-level — the gaming curve is separate from the earn curve
  baseFolder: string;
  scanInclude: string[]; // folder prefixes; empty = whole vault
  scanExclude: string[]; // folder prefixes
  messages: Messages; // editable toast templates (V31)
}

export const DEFAULT_SETTINGS: MilleFeuilleSettings = {
  economy: structuredClone(DEFAULT_ECONOMY),
  gacha: structuredClone(DEFAULT_GACHA),
  gaming: structuredClone(DEFAULT_GAMING),
  baseFolder: "mille-feuille",
  scanInclude: [],
  scanExclude: [],
  messages: structuredClone(DEFAULT_MESSAGES),
};

// Single-line toast message ids (claim handled separately as a list).
const MESSAGE_IDS: (keyof Messages)[] = [
  "mint", "milestone", "critSuffix", "refund", "purchase", "added", "deleted",
  "soldOut", "fullyClaimed", "afford", "firstChip", "monthly", "critStreak",
];

const linesToList = (s: string): string[] =>
  s.split("\n").map((x) => x.trim()).filter(Boolean);

// §V15 — every economy param editable here, no code change.
export class MilleFeuilleSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MilleFeuillePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const e = this.plugin.settings.economy;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl)
      .setName("Base folder")
      .setDesc("Vault folder for wallet, ledger, aggregates and reward notes.")
      .addText((t) =>
        t.setValue(this.plugin.settings.baseFolder).onChange(async (v) => {
          this.plugin.settings.baseFolder = v.trim() || "mille-feuille";
          await save();
        })
      );

    new Setting(containerEl).setName("Scan scope").setHeading();
    new Setting(containerEl)
      .setName("Include folders")
      .setDesc("One folder path per line. Empty = scan whole vault. Base folder always excluded.")
      .addTextArea((t) =>
        t.setValue(this.plugin.settings.scanInclude.join("\n")).onChange(async (v) => {
          this.plugin.settings.scanInclude = linesToList(v); await save();
        })
      );
    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc("One folder path per line. Wins over include (e.g. an Archive subfolder).")
      .addTextArea((t) =>
        t.setValue(this.plugin.settings.scanExclude.join("\n")).onChange(async (v) => {
          this.plugin.settings.scanExclude = linesToList(v); await save();
        })
      );

    new Setting(containerEl).setName("Economy").setHeading();

    numberField(containerEl, "Default base", "Chips per regular task.", e.defaultBase, async (v) => {
      e.defaultBase = v; await save();
    });
    numberField(containerEl, "Crit chance", "Probability (0–1) of a crit.", e.critChance, async (v) => {
      e.critChance = v; await save();
    });
    new Setting(containerEl)
      .setName("Crit multipliers")
      .setDesc("Comma-separated multipliers, gacha pick on crit.")
      .addText((t) =>
        t.setValue(e.critMultipliers.join(", ")).onChange(async (v) => {
          e.critMultipliers = v.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
          await save();
        })
      );
    new Setting(containerEl)
      .setName("Milestone tags")
      .setDesc("tag:multiplier pairs, comma-separated. base × multiplier.")
      .addText((t) =>
        t.setValue(mapToStr(e.milestoneByTag)).onChange(async (v) => {
          const parsed = strToMap(v);
          if (Object.keys(parsed).length) { e.milestoneByTag = parsed; await save(); }
        })
      );

    numberField(containerEl, "Habit payout · farm", "Chips for a farm-tier habit.", e.habitPayout.farm, async (v) => {
      e.habitPayout.farm = v; await save();
    });
    numberField(containerEl, "Habit payout · ult", "Chips for an ult-tier habit.", e.habitPayout.ult, async (v) => {
      e.habitPayout.ult = v; await save();
    });
    numberField(containerEl, "Stale after days", "Surface open purchases older than this.", e.staleAfterDays, async (v) => {
      e.staleAfterDays = v; await save();
    });

    this.renderGacha(containerEl, save);
    this.renderGaming(containerEl, save);
    this.renderMessages(containerEl, save);
  }

  // §V37,§V42 — toggle always shown; cost/table/limit/popup hidden when off. Rebuild via display().
  private renderGacha(el: HTMLElement, save: () => Promise<void>): void {
    const g = this.plugin.settings.gacha;
    new Setting(el).setName("Gacha").setHeading();
    new Setting(el)
      .setName("Enable gacha")
      .setDesc("Pay chips to roll for rebates and free rewards. Off hides all gacha UI.")
      .addToggle((t) =>
        t.setValue(g.enabled).onChange(async (v) => {
          g.enabled = v; await save(); this.display(); // full rebuild reveals/hides the fields
        })
      );
    if (!g.enabled) return;

    numberField(el, "Cost per roll", "Chips spent on each roll.", g.cost, async (v) => {
      g.cost = v; await save();
    });
    numberField(el, "Max rolls per day", "0 = no limit. Counted live from the ledger.", g.maxRollsPerDay, async (v) => {
      g.maxRollsPerDay = v; await save();
    });
    numberField(el, "Jackpot popup (ms)", "How long the free-reward celebration stays on screen.", g.jackpotPopupMs, async (v) => {
      g.jackpotPopupMs = v; await save();
    });
    new Setting(el)
      .setName("Outcomes table")
      .setDesc("One per line: type weight [value]. Types: nothing, rebate_small, rebate_big, free_reward. Probability = weight ÷ total.")
      .addTextArea((t) => {
        t.setValue(outcomesToStr(g.outcomes)).onChange(async (v) => {
          const parsed = strToOutcomes(v);
          if (parsed.length) { g.outcomes = parsed; await save(); }
        });
        t.inputEl.rows = 4;
        t.inputEl.style.width = "300px";
      });
  }

  // §V58 — toggle always shown; every other gaming field hidden when off. Rebuild via display().
  private renderGaming(el: HTMLElement, save: () => Promise<void>): void {
    const g = this.plugin.settings.gaming;
    new Setting(el).setName("Gaming").setHeading();
    new Setting(el)
      .setName("Enable gaming ledger")
      .setDesc("Score matches from their raw stats and pay the chips through a task. Off hides the section and the commands.")
      .addToggle((t) =>
        t.setValue(g.enabled).onChange(async (v) => {
          g.enabled = v; await save(); this.display(); // full rebuild reveals/hides the fields
        })
      );
    if (!g.enabled) return;

    new Setting(el)
      .setName("Match notes folder")
      .setDesc("One note per session lives here. Always excluded from the scan, so a logged match never credits chips on its own.")
      .addText((t) =>
        t.setValue(g.folder).onChange(async (v) => { g.folder = v.trim() || DEFAULT_GAMING.folder; await save(); })
      );
    new Setting(el)
      .setName("Session task file")
      .setDesc("Where a Process run writes the batch task, under its `## Tasks` heading.")
      .addText((t) =>
        t.setValue(g.taskFile).onChange(async (v) => { g.taskFile = v.trim() || DEFAULT_GAMING.taskFile; await save(); })
      );
    new Setting(el)
      .setName("Session task tag")
      .setDesc("Appended to the task line. Empty for no tag.")
      .addText((t) => t.setValue(g.taskTag).onChange(async (v) => { g.taskTag = v.trim(); await save(); }));
    new Setting(el)
      .setName("Ask for a focus goal")
      .setDesc("Ask once per session, on the log screen. The goal never changes a score.")
      .addToggle((t) => t.setValue(g.promptFocus).onChange(async (v) => { g.promptFocus = v; await save(); }));

    // §V60,§V61 both tables are text areas with a parser — same pattern as the gacha outcomes
    // table. A line the parser can't read is skipped, and the count line is how you notice.
    dslField(el, "Metrics", "One per line: stat op value : points. Stats: deaths, farm, damage (k), points, ray, focus. Every line that passes adds its points.",
      g.thresholds, DEFAULT_GAMING.thresholds, (v) => parseThresholds(v).length, "threshold",
      async (v) => { g.thresholds = v; await save(); });
    dslField(el, "Chip conversion", "One per line: from-to : chips, or N+ : chips. The first band holding the score wins.",
      g.bands, DEFAULT_GAMING.bands, (v) => parseBands(v).length, "band",
      async (v) => { g.bands = v; await save(); });
  }

  // §V31 — editable toast templates + claim-list CRUD + reset-to-default.
  private renderMessages(el: HTMLElement, save: () => Promise<void>): void {
    const m = this.plugin.settings.messages;
    new Setting(el).setName("Toast messages").setHeading();
    el.createEl("p", {
      text: "Use {{variable}} placeholders. Blank restores the default.",
      cls: "setting-item-description",
    });

    for (const id of MESSAGE_IDS) {
      new Setting(el)
        .setName(id)
        .addText((t) => {
          t.setValue(m[id] as string).onChange(async (v) => {
            (m[id] as string) = v; await save();
          });
          t.inputEl.style.width = "260px";
        })
        .addExtraButton((b) =>
          b.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
            (m[id] as string) = DEFAULT_MESSAGES[id] as string;
            await save(); this.display();
          })
        );
    }

    // claim = editable list (add / edit / delete)
    new Setting(el)
      .setName("Claim lines")
      .setDesc("One picked at random per claim. {{name}} available.")
      .addExtraButton((b) =>
        b.setIcon("plus").setTooltip("Add line").onClick(async () => {
          m.claim.push("{{name}} claimed, enjoy!");
          await save(); this.display();
        })
      )
      .addExtraButton((b) =>
        b.setIcon("reset").setTooltip("Reset to defaults").onClick(async () => {
          m.claim = structuredClone(DEFAULT_MESSAGES.claim);
          await save(); this.display();
        })
      );

    m.claim.forEach((line, i) => {
      new Setting(el)
        .addText((t) => {
          t.setValue(line).onChange(async (v) => { m.claim[i] = v; await save(); });
          t.inputEl.style.width = "300px";
        })
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip("Delete").onClick(async () => {
            m.claim.splice(i, 1); await save(); this.display();
          })
        );
    });
  }
}

function mapToStr(m: Record<string, number>): string {
  return Object.entries(m).map(([k, v]) => `${k}:${v}`).join(", ");
}
function strToMap(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of s.split(",")) {
    const [k, v] = pair.split(":").map((x) => x.trim());
    const n = Number(v);
    if (k && n > 0) out[k] = n;
  }
  return out;
}

function outcomesToStr(os: GachaOutcome[]): string {
  return os.map((o) => `${o.type} ${o.weight}${o.value !== undefined ? " " + o.value : ""}`).join("\n");
}
function strToOutcomes(s: string): GachaOutcome[] {
  const types = new Set(["nothing", "rebate_small", "rebate_big", "free_reward"]);
  const out: GachaOutcome[] = [];
  for (const line of s.split("\n")) {
    const [type, w, v] = line.trim().split(/\s+/);
    if (!types.has(type)) continue;
    const weight = Number(w);
    if (!(weight >= 0)) continue;
    const o: GachaOutcome = { type: type as GachaOutcome["type"], weight };
    if (v !== undefined && !Number.isNaN(Number(v))) o.value = Number(v);
    out.push(o);
  }
  return out;
}

/**
 * A parsed text-area setting: the raw text, a reset control, and a live count of the lines the
 * parser actually read. The count is the error report — §V60 skips a bad line in silence, so
 * without it a typo would just quietly stop scoring.
 */
function dslField(
  el: HTMLElement,
  name: string,
  desc: string,
  value: string,
  fallback: string,
  count: (v: string) => number,
  unit: string,
  onChange: (v: string) => Promise<void>,
): void {
  let readout: HTMLElement;
  const say = (v: string) => {
    const n = count(v);
    readout.setText(`${n} ${unit}${n === 1 ? "" : "s"} read`);
  };
  const setting = new Setting(el)
    .setName(name)
    .setDesc(desc)
    .addTextArea((t) => {
      t.setValue(value).onChange(async (v) => { await onChange(v); say(v); });
      t.inputEl.rows = 8;
      t.inputEl.style.width = "300px";
      t.inputEl.style.fontFamily = "var(--font-monospace)";
      readout = setting.descEl.createDiv({ cls: "mf-dsl-count" });
      say(value);
    })
    .addExtraButton((b) =>
      b.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
        await onChange(fallback);
        setting.controlEl.querySelector("textarea")!.value = fallback;
        say(fallback);
      })
    );
}

function numberField(
  el: HTMLElement,
  name: string,
  desc: string,
  value: number,
  onChange: (v: number) => Promise<void>
): void {
  new Setting(el)
    .setName(name)
    .setDesc(desc)
    .addText((t) =>
      t.setValue(String(value)).onChange(async (v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) await onChange(n);
      })
    );
}
