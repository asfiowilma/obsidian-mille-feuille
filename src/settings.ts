import { App, PluginSettingTab, Setting } from "obsidian";
import type MilleFeuillePlugin from "./main.js";
import { DEFAULT_ECONOMY, type Economy } from "./economy.js";
import { DEFAULT_MESSAGES, type Messages } from "./messages.js";

export interface MilleFeuilleSettings {
  economy: Economy;
  baseFolder: string;
  scanInclude: string[]; // folder prefixes; empty = whole vault
  scanExclude: string[]; // folder prefixes
  messages: Messages; // editable toast templates (V31)
}

export const DEFAULT_SETTINGS: MilleFeuilleSettings = {
  economy: structuredClone(DEFAULT_ECONOMY),
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
    new Setting(containerEl).setName("Mille Feuille").setHeading();
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

    this.renderMessages(containerEl, save);
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
