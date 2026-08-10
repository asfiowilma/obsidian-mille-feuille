import { ItemView, WorkspaceLeaf, Modal, App } from "obsidian";
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
  thumb: string;
}
const blankForm = (): FormState => ({ name: "", price: "", servingsMode: "one", n: "2", isPurchasable: false, url: "", thumb: "" });
const formFrom = (r: Reward): FormState => ({
  name: r.name,
  price: String(r.price),
  servingsMode: r.servings === -1 ? "inf" : r.servings === 1 ? "one" : "n",
  n: r.servings > 1 ? String(r.servings) : "2",
  isPurchasable: !!r.isPurchasable,
  url: r.purchaseUrl ?? "",
  thumb: r.thumbnail ?? "",
});

type ShopSort = "name" | "price-low" | "price-high";

export class MilleFeuilleView extends ItemView {
  private screen: Screen = "home";
  private form = blankForm();
  private editing: Reward | null = null;
  private shopQuery = "";
  private shopSort: ShopSort = "name";
  private shopAffordable = false;

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
    addBtn.onclick = () => { this.editing = null; this.screen = "add"; this.form = blankForm(); this.render(); };
    if (!shop.length) {
      root.createDiv({ cls: "mf-empty-q", text: "No rewards yet. Add one to start saving." });
    } else {
      this.shopToolbar(root);
      const shown = this.filterSortShop(shop, bal);
      if (!shown.length) {
        root.createDiv({ cls: "mf-empty-q", text: "No rewards match your filters." });
      } else {
        for (const r of shown) this.shopCard(root, r, bal);
      }
    }

    // ledger
    this.section(root, "Ledger", null);
    if (!activity.length) {
      root.createDiv({ cls: "mf-empty-q", text: "No purchases yet." });
    } else {
      for (const r of activity) this.ledgerRow(root, r, stale);
    }
  }

  private filterSortShop(shop: Reward[], bal: number): Reward[] {
    const q = this.shopQuery.trim().toLowerCase();
    let out = shop.filter((r) =>
      (!q || r.name.toLowerCase().includes(q)) &&
      (!this.shopAffordable || canBuy(r, bal)));
    if (this.shopSort === "name") out = out.sort((a, b) => a.name.localeCompare(b.name));
    else if (this.shopSort === "price-low") out = out.sort((a, b) => a.price - b.price);
    else out = out.sort((a, b) => b.price - a.price);
    return out;
  }

  private shopToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "mf-shop-tools" });
    const search = bar.createEl("input", { cls: "mf-shop-search", attr: { type: "search", placeholder: "Search rewards…" } });
    search.value = this.shopQuery;
    search.oninput = () => { this.shopQuery = search.value; this.render(); search.focus(); };

    const sort = bar.createEl("select", { cls: "mf-shop-sort" });
    for (const [v, label] of [["name", "Name"], ["price-low", "Price ↑"], ["price-high", "Price ↓"]] as [ShopSort, string][]) {
      sort.createEl("option", { value: v, text: label });
    }
    sort.value = this.shopSort;
    sort.onchange = () => { this.shopSort = sort.value as ShopSort; this.render(); };

    const aff = bar.createEl("button", { cls: "mf-lnk" + (this.shopAffordable ? " on" : ""), text: this.shopAffordable ? "✓ Affordable" : "Affordable" });
    aff.onclick = () => { this.shopAffordable = !this.shopAffordable; this.render(); };
  }

  private section(root: HTMLElement, title: string, pill: string | null): HTMLElement {
    const sec = root.createDiv({ cls: "mf-sec" });
    sec.createSpan({ cls: "mf-sec-h", text: title });
    if (pill) sec.createSpan({ cls: "mf-pill", text: pill });
    return sec;
  }

  private queueCard(root: HTMLElement, r: Reward, staleAfter: number): void {
    const card = root.createDiv({ cls: "mf-card" + (r.thumbnail ? " has-thumb" : "") });
    thumbEl(card, r);
    const body = card.createDiv({ cls: "mf-card-body" });
    const top = body.createDiv({ cls: "mf-top" });
    const main = top.createDiv({ cls: "mf-top-main" });
    main.createSpan({ cls: "mf-name", text: r.name });
    priceEl(main, r.price);
    this.cardActions(top, r);
    const age = oldestOpenAgeDays(r, today());
    if (isStale(r, today(), staleAfter) && age !== null) {
      body.createDiv({ cls: "mf-stale-flag", text: `⚠ Bought ${age} days ago. Claim it before you forget.` });
    }
    const foot = body.createDiv({ cls: "mf-foot" });
    foot.createSpan({ cls: "mf-badge purch", text: `● ${openCount(r)} open` });
    const btn = foot.createEl("button", { cls: "mf-btn btn-claim", text: openCount(r) > 1 ? "Claim oldest" : "Claim" });
    btn.onclick = () => this.plugin.claim(r);
  }

  private shopCard(root: HTMLElement, r: Reward, bal: number): void {
    const card = root.createDiv({ cls: "mf-card" + (r.thumbnail ? " has-thumb" : "") });
    thumbEl(card, r);
    const body = card.createDiv({ cls: "mf-card-body" });
    const top = body.createDiv({ cls: "mf-top" });
    const main = top.createDiv({ cls: "mf-top-main" });
    main.createSpan({ cls: "mf-name", text: r.name });
    priceEl(main, r.price);
    this.cardActions(top, r);

    const link = (parent: HTMLElement) => {
      if (r.purchaseUrl) {
        const a = parent.createEl("a", { cls: "mf-itemlink", text: "View item ↗", href: r.purchaseUrl });
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
    };

    if (canBuy(r, bal)) {
      body.createDiv({ cls: "mf-counts", text: countsLine(r) });
      const foot = body.createDiv({ cls: "mf-foot" });
      foot.createSpan({ cls: "mf-badge avail", text: "✓ Available" });
      const right = foot.createDiv({ cls: "mf-foot-right" });
      link(right);
      const buy = right.createEl("button", { cls: "mf-btn btn-buy", text: `🪙 ${fmt(r.price)}` });
      buy.setAttr("aria-label", `Buy for ${fmt(r.price)} chips`);
      buy.onclick = () => this.plugin.buy(r);
    } else {
      const pct = Math.min(100, Math.round((bal / r.price) * 100));
      const bar = body.createDiv({ cls: "mf-bar-prog" });
      bar.createEl("i").style.width = pct + "%";
      const foot = body.createDiv({ cls: "mf-foot" });
      foot.createSpan({ cls: "mf-badge exp", text: "Too expensive" });
      const right = foot.createDiv({ cls: "mf-foot-right" });
      link(right);
      right.createSpan({ cls: "mf-mono-mut", text: `${fmt(r.price - bal)} to go` });
    }
  }

  private cardActions(parent: HTMLElement, r: Reward): void {
    const acts = parent.createDiv({ cls: "mf-card-acts" });
    const edit = acts.createEl("button", { cls: "mf-icon-btn", text: "✎" });
    edit.setAttr("aria-label", `Edit ${r.name}`);
    edit.onclick = () => { this.editing = r; this.form = formFrom(r); this.screen = "add"; this.render(); };
    const del = acts.createEl("button", { cls: "mf-icon-btn danger", text: "🗑" });
    del.setAttr("aria-label", `Delete ${r.name}`);
    del.onclick = () => new ConfirmModal(this.app, r.name, () => void this.plugin.removeReward(r)).open();
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
    back.onclick = () => { this.editing = null; this.screen = "home"; this.render(); };
    head.createSpan({ cls: "mf-add-ttl", text: this.editing ? "Edit reward" : "New reward" });

    const f = this.form;
    const editingSlug = this.editing ? slug(this.editing.name) : null;
    const dupName = (): boolean => {
      const s = slug(f.name);
      return !!s && this.plugin.rewards.some((r) => slug(r.name) === s && slug(r.name) !== editingSlug);
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

    // thumbnail (optional)
    const thumbField = field(root, "Thumbnail image URL (optional)");
    const thumbInput = thumbField.createEl("input", { attr: { type: "url", placeholder: "https://…/image.png" } });
    thumbInput.value = f.thumb;
    thumbInput.oninput = () => { f.thumb = thumbInput.value; update(); };

    // footer
    const foot = root.createDiv({ cls: "mf-form-foot" });
    const cancel = foot.createEl("button", { cls: "mf-btn btn-ghost", text: "Cancel" });
    cancel.onclick = () => { this.editing = null; this.screen = "home"; this.render(); };
    const create = foot.createEl("button", { cls: "mf-btn btn-primary", text: this.editing ? "Save changes" : "Create reward" });

    const valid = (): boolean => {
      const name = f.name.trim();
      const price = parseInt(f.price || "0", 10);
      const nOk = f.servingsMode !== "n" || parseInt(f.n || "0", 10) >= 2;
      const urlOk = !f.isPurchasable || /^https?:\/\/.+/.test(f.url.trim());
      const thumbOk = !f.thumb.trim() || /^https?:\/\/.+/.test(f.thumb.trim());
      return name.length > 0 && !dupName() && price >= 1 && nOk && urlOk && thumbOk;
    };
    const update = () => { create.disabled = !valid(); };
    update();

    create.onclick = async () => {
      if (!valid()) return;
      const servings = f.servingsMode === "one" ? 1 : f.servingsMode === "inf" ? -1 : parseInt(f.n, 10);
      const prev = this.editing;
      const r: Reward = {
        type: "reward", name: f.name.trim(), price: parseInt(f.price, 10), servings,
        // preserve counts/history when editing
        purchasedCount: prev?.purchasedCount ?? 0,
        claimedCount: prev?.claimedCount ?? 0,
        openPurchaseDates: prev?.openPurchaseDates ?? [],
        state: "available",
      };
      if (f.isPurchasable) { r.isPurchasable = true; if (f.url.trim()) r.purchaseUrl = f.url.trim(); }
      if (f.thumb.trim()) r.thumbnail = f.thumb.trim();
      if (prev) await this.plugin.updateReward(prev.name, r);
      else await this.plugin.addReward(r);
      this.editing = null;
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
function thumbEl(parent: HTMLElement, r: Reward): void {
  if (!r.thumbnail) return; // hide if empty
  const img = parent.createEl("img", { cls: "mf-thumb", attr: { src: r.thumbnail, alt: "", loading: "lazy" } });
  img.onerror = () => img.remove(); // drop broken image, keep layout clean
}

// Delete-confirm dialog — no quick delete; destructive action uses mod-warning.
class ConfirmModal extends Modal {
  constructor(app: App, private name: string, private onConfirm: () => void) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText("Delete reward");
    this.contentEl.createEl("p", { text: `Delete “${this.name}”? This removes it from the shop and can't be undone.` });
    const row = this.contentEl.createDiv({ cls: "mf-form-foot" });
    const cancel = row.createEl("button", { cls: "mf-btn btn-ghost", text: "Cancel" });
    cancel.onclick = () => this.close();
    const del = row.createEl("button", { cls: "mf-btn mod-warning", text: "Delete" });
    del.onclick = () => { this.close(); this.onConfirm(); };
  }
  onClose(): void { this.contentEl.empty(); }
}
