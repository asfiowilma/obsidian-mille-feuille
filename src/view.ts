import { ItemView, WorkspaceLeaf } from "obsidian";
import type MilleFeuillePlugin from "./main.js";
import type { Reward } from "./rewards.js";
import {
  openCount, remaining, canBuy, isSoldOut, isStale, oldestOpenAgeDays, slug,
} from "./rewards.js";

export const MILLE_VIEW = "mille-feuille-view";

const today = (): string => new Date().toISOString().slice(0, 10);
const fmt = (n: number): string => (n === Infinity ? "∞" : n.toLocaleString());
const countsLine = (r: Reward): string =>
  `${r.purchasedCount} bought · ${r.claimedCount} claimed · ${fmt(remaining(r))} left`;

type Screen = "home" | "add";

interface FormState {
  name: string;
  price: string;
  servingsMode: "one" | "n" | "inf";
  n: string;
  isPurchasable: boolean;
  url: string;
}
const blankForm = (): FormState => ({ name: "", price: "", servingsMode: "one", n: "2", isPurchasable: false, url: "" });

export class MilleFeuilleView extends ItemView {
  private screen: Screen = "home";
  private form = blankForm();

  constructor(leaf: WorkspaceLeaf, private plugin: MilleFeuillePlugin) {
    super(leaf);
  }

  getViewType(): string { return MILLE_VIEW; }
  getDisplayText(): string { return "mille-feuille"; }
  getIcon(): string { return "cookie"; }

  async onOpen(): Promise<void> { this.render(); }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("mf-root");
    if (this.screen === "home") this.renderHome(root);
    else this.renderAdd(root);
  }

  // ---------------- HOME ----------------
  private renderHome(root: HTMLElement): void {
    const p = this.plugin;
    const bal = p.balance();
    const stale = p.settings.economy.staleAfterDays;

    // wallet
    const wallet = root.createDiv({ cls: "mf-wallet" + (bal === 0 ? " empty" : "") });
    wallet.createSpan({ cls: "mf-coin", text: "🪙" });
    const grow = wallet.createDiv({ cls: "mf-grow" });
    grow.createSpan({ cls: "mf-amt", text: fmt(bal) });
    grow.createSpan({ cls: "mf-cap", text: bal === 0 ? "No chips yet. Finish a task to earn some." : "chips banked" });

    const rewards = p.rewards;
    const queue = rewards.filter((r) => openCount(r) > 0)
      .sort((a, b) => (oldestOpenAgeDays(b, today()) ?? 0) - (oldestOpenAgeDays(a, today()) ?? 0));
    const shop = rewards.filter((r) => openCount(r) === 0 && !isSoldOut(r));
    const activity = rewards.filter((r) => r.purchasedCount > 0 || r.claimedCount > 0);
    const staleCount = rewards.filter((r) => isStale(r, today(), stale)).length;

    // waiting to claim
    this.section(root, "Waiting to claim", staleCount ? `${staleCount} stale` : null);
    if (!queue.length) {
      root.createDiv({ cls: "mf-empty-q", text: "Nothing waiting. Buy a reward and it lands here until you claim it." });
    } else {
      for (const r of queue) this.queueCard(root, r, stale);
    }

    // shop
    const shopSec = this.section(root, "Shop", null);
    const addBtn = shopSec.createEl("button", { cls: "mf-lnk", text: "+ New reward" });
    addBtn.onclick = () => { this.screen = "add"; this.form = blankForm(); this.render(); };
    if (!shop.length) {
      root.createDiv({ cls: "mf-empty-q", text: "No rewards yet. Add one to start saving." });
    } else {
      for (const r of shop) this.shopCard(root, r, bal);
    }

    // ledger
    this.section(root, "Ledger", null);
    if (!activity.length) {
      root.createDiv({ cls: "mf-empty-q", text: "No purchases yet." });
    } else {
      for (const r of activity) this.ledgerRow(root, r, stale);
    }
  }

  private section(root: HTMLElement, title: string, pill: string | null): HTMLElement {
    const sec = root.createDiv({ cls: "mf-sec" });
    sec.createSpan({ cls: "mf-sec-h", text: title });
    if (pill) sec.createSpan({ cls: "mf-pill", text: pill });
    return sec;
  }

  private queueCard(root: HTMLElement, r: Reward, staleAfter: number): void {
    const card = root.createDiv({ cls: "mf-card" });
    const top = card.createDiv({ cls: "mf-top" });
    top.createSpan({ cls: "mf-name", text: r.name });
    priceEl(top, r.price);
    const age = oldestOpenAgeDays(r, today());
    if (isStale(r, today(), staleAfter) && age !== null) {
      card.createDiv({ cls: "mf-stale-flag", text: `⚠ Bought ${age} days ago. Claim it before you forget.` });
    }
    const foot = card.createDiv({ cls: "mf-foot" });
    foot.createSpan({ cls: "mf-badge purch", text: `● ${openCount(r)} open` });
    const btn = foot.createEl("button", { cls: "mf-btn btn-claim", text: openCount(r) > 1 ? "Claim oldest" : "Claim" });
    btn.onclick = () => this.plugin.claim(r);
  }

  private shopCard(root: HTMLElement, r: Reward, bal: number): void {
    const card = root.createDiv({ cls: "mf-card" });
    const top = card.createDiv({ cls: "mf-top" });
    top.createSpan({ cls: "mf-name", text: r.name });
    priceEl(top, r.price);

    const link = (parent: HTMLElement) => {
      if (r.purchaseUrl) {
        const a = parent.createEl("a", { cls: "mf-itemlink", text: "View item ↗", href: r.purchaseUrl });
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
    };

    if (canBuy(r, bal)) {
      card.createDiv({ cls: "mf-counts", text: countsLine(r) });
      const foot = card.createDiv({ cls: "mf-foot" });
      foot.createSpan({ cls: "mf-badge avail", text: "✓ Available" });
      const right = foot.createDiv({ cls: "mf-foot-right" });
      link(right);
      const buy = right.createEl("button", { cls: "mf-btn btn-buy", text: `🪙 ${fmt(r.price)}` });
      buy.setAttr("aria-label", `Buy for ${fmt(r.price)} chips`);
      buy.onclick = () => this.plugin.buy(r);
    } else {
      const pct = Math.min(100, Math.round((bal / r.price) * 100));
      const bar = card.createDiv({ cls: "mf-bar-prog" });
      bar.createEl("i").style.width = pct + "%";
      const foot = card.createDiv({ cls: "mf-foot" });
      foot.createSpan({ cls: "mf-badge exp", text: "Too expensive" });
      const right = foot.createDiv({ cls: "mf-foot-right" });
      link(right);
      right.createSpan({ cls: "mf-mono-mut", text: `${fmt(r.price - bal)} to go` });
    }
  }

  private ledgerRow(root: HTMLElement, r: Reward, staleAfter: number): void {
    const row = root.createDiv({ cls: "mf-ledger-row" });
    row.createSpan({ cls: "mf-ln", text: r.name });
    const stale = isStale(r, today(), staleAfter);
    let badgeCls = "claim", badgeText = "Claimed", line = countsLine(r);
    if (isSoldOut(r)) { badgeCls = "sold"; badgeText = "Sold out"; }
    else if (openCount(r) > 0) { badgeCls = "purch"; badgeText = "Purchased"; line = `${line} · oldest ${oldestOpenAgeDays(r, today())}d`; }
    row.createSpan({ cls: `mf-badge ${badgeCls}`, text: badgeText });
    row.createSpan({ cls: "mf-lc" + (stale ? " st" : ""), text: (stale ? "⚠ " : "") + line });
  }

  // ---------------- ADD ----------------
  private renderAdd(root: HTMLElement): void {
    const head = root.createDiv({ cls: "mf-add-head" });
    const back = head.createEl("button", { cls: "mf-back", text: "‹ Back" });
    back.onclick = () => { this.screen = "home"; this.render(); };
    head.createSpan({ cls: "mf-add-ttl", text: "New reward" });

    const f = this.form;
    const dupName = (): boolean => {
      const s = slug(f.name);
      return !!s && this.plugin.rewards.some((r) => slug(r.name) === s);
    };

    // name
    const nameField = field(root, "Name");
    const nameInput = nameField.createEl("input", { attr: { type: "text", placeholder: "e.g. Noise-cancelling headphones" } });
    nameInput.value = f.name;
    const dupErr = nameField.createDiv({ cls: "mf-field-err" });
    dupErr.hide();
    nameInput.oninput = () => { f.name = nameInput.value; if (dupName()) dupErr.setText("A reward with this name already exists."), dupErr.show(); else dupErr.hide(); update(); };

    // price
    const priceField = field(root, "Price");
    const affix = priceField.createDiv({ cls: "mf-affix" });
    const priceInput = affix.createEl("input", { attr: { type: "number", placeholder: "500", min: "1" } });
    priceInput.value = f.price;
    affix.createSpan({ cls: "mf-unit", text: "chips" });
    priceInput.oninput = () => { f.price = priceInput.value; update(); };

    // servings
    const servField = field(root, "How many times?");
    const seg = servField.createDiv({ cls: "mf-seg" });
    const modes: [FormState["servingsMode"], string][] = [["one", "One-off"], ["n", "N times"], ["inf", "Infinite"]];
    const nWrap = servField.createDiv({ cls: "mf-seg-n" });
    const renderSeg = () => {
      seg.empty();
      for (const [m, label] of modes) {
        const b = seg.createEl("button", { cls: f.servingsMode === m ? "on" : "", text: label });
        b.onclick = () => { f.servingsMode = m; renderSeg(); renderN(); update(); };
      }
    };
    const renderN = () => {
      nWrap.empty();
      if (f.servingsMode === "n") {
        const nInput = nWrap.createEl("input", { attr: { type: "number", min: "2", placeholder: "3" } });
        nInput.value = f.n;
        nInput.oninput = () => { f.n = nInput.value; update(); };
      }
    };
    renderSeg(); renderN();

    // purchasable toggle
    const tog = root.createDiv({ cls: "mf-tog" });
    const lab = tog.createDiv({ cls: "mf-tog-lab" });
    lab.createSpan({ text: "Purchasable item?" });
    lab.createEl("small", { text: "An item you check out online, not an experience." });
    const sw = tog.createEl("button", { cls: "mf-switch" + (f.isPurchasable ? " on" : "") });
    const urlWrap = root.createDiv();
    const renderUrl = () => {
      urlWrap.empty();
      if (f.isPurchasable) {
        const uf = field(urlWrap, "Purchase link");
        const u = uf.createEl("input", { attr: { type: "url", placeholder: "https://store.example/item" } });
        u.value = f.url;
        u.oninput = () => { f.url = u.value; update(); };
      }
    };
    sw.onclick = () => { f.isPurchasable = !f.isPurchasable; sw.toggleClass("on", f.isPurchasable); renderUrl(); update(); };
    renderUrl();

    // footer
    const foot = root.createDiv({ cls: "mf-form-foot" });
    const cancel = foot.createEl("button", { cls: "mf-btn btn-ghost", text: "Cancel" });
    cancel.onclick = () => { this.screen = "home"; this.render(); };
    const create = foot.createEl("button", { cls: "mf-btn btn-primary", text: "Create reward" });

    const valid = (): boolean => {
      const name = f.name.trim();
      const price = parseInt(f.price || "0", 10);
      const nOk = f.servingsMode !== "n" || parseInt(f.n || "0", 10) >= 2;
      const urlOk = !f.isPurchasable || /^https?:\/\/.+/.test(f.url.trim());
      return name.length > 0 && !dupName() && price >= 1 && nOk && urlOk;
    };
    const update = () => { create.disabled = !valid(); };
    update();

    create.onclick = async () => {
      if (!valid()) return;
      const servings = f.servingsMode === "one" ? 1 : f.servingsMode === "inf" ? -1 : parseInt(f.n, 10);
      const r: Reward = {
        type: "reward", name: f.name.trim(), price: parseInt(f.price, 10), servings,
        purchasedCount: 0, claimedCount: 0, openPurchaseDates: [], state: "available",
      };
      if (f.isPurchasable) { r.isPurchasable = true; if (f.url.trim()) r.purchaseUrl = f.url.trim(); }
      await this.plugin.addReward(r);
      this.screen = "home";
      this.render();
    };
  }
}

function field(root: HTMLElement, label: string): HTMLElement {
  const wrap = root.createDiv({ cls: "mf-field" });
  wrap.createEl("label", { text: label });
  return wrap;
}
function priceEl(parent: HTMLElement, price: number): void {
  const el = parent.createSpan({ cls: "mf-price", text: fmt(price) });
  el.createSpan({ cls: "u", text: " chips" });
}
