import { ItemView, WorkspaceLeaf, Modal, App, Menu, setTooltip } from "obsidian";
import type MilleFeuillePlugin from "./main.js";
import type { Reward } from "./rewards.js";
import {
  openCount, remaining, canBuy, isStale, oldestOpenAgeDays, slug,
  hasCapacity, isSingleEmoji,
} from "./rewards.js";
import { aggregate } from "./ledger.js";
import type { SpendEntry, ClaimEntry } from "./ledger.js";
import { gachaActive, todayRollCount } from "./gacha.js";

export const MILLE_VIEW = "mille-feuille-view";

const today = (): string => new Date().toISOString().slice(0, 10);
const fmt = (n: number): string => (n === Infinity ? "∞" : n.toLocaleString());
const countsLine = (r: Reward): string =>
  `${r.purchasedCount} bought · ${r.claimedCount} claimed · ${fmt(remaining(r))} left`;

type Screen = "home" | "add" | "picker";

interface FormState {
  name: string;
  price: string;
  servingsMode: "one" | "n" | "inf";
  n: string;
  isPurchasable: boolean;
  url: string;
  thumb: string;
  desc: string;
  emoji: string;
}
const blankForm = (): FormState => ({ name: "", price: "", servingsMode: "one", n: "2", isPurchasable: false, url: "", thumb: "", desc: "", emoji: "" });
const formFrom = (r: Reward): FormState => ({
  name: r.name,
  price: String(r.price),
  servingsMode: r.servings === -1 ? "inf" : r.servings === 1 ? "one" : "n",
  n: r.servings > 1 ? String(r.servings) : "2",
  isPurchasable: !!r.isPurchasable,
  url: r.purchaseUrl ?? "",
  thumb: r.thumbnail ?? "",
  desc: r.desc ?? "",
  emoji: r.emoji ?? "",
});

type ShopSort = "name" | "price-low" | "price-high";

// §V44 nothing-result copy, random per roll.
const NOTHING_TEXT = ["Nope! LMAO 🤣", "Nope! 🤣", "Better luck... nah 💀", "Empty. Skill issue."];
const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Static reveal payload — persists across re-renders until the next roll. §V44
interface GachaReveal {
  big: string;
  msg: string;
  sub?: string;
  hint?: string;
  win: boolean;
}

export class MilleFeuilleView extends ItemView {
  private screen: Screen = "home";
  private form = blankForm();
  private editing: Reward | null = null;
  private shopQuery = "";
  private shopSort: ShopSort = "price-high";
  private shopAffordable = false;
  private gachaReveal: GachaReveal | null = null;
  private gachaAnimating = false;

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
    else if (this.screen === "picker") this.renderPicker(root);
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

    // §V34 current-month stats, read live from ledger
    const stats = aggregate(p.entries, today().slice(0, 7));
    const earned = Object.values(stats.chipsBySource).reduce((a, b) => a + b, 0);
    const statRow = root.createDiv({ cls: "mf-stats" });
    this.stat(statRow, fmt(earned), "earned this month");
    this.stat(statRow, String(stats.claimed), "claimed");
    this.stat(statRow, String(stats.critCount), "crits");
    if (stats.gachaClaims > 0) this.stat(statRow, String(stats.gachaClaims), "gacha wins"); // §V41 separate from paid claims

    const rewards = p.rewards;
    const queue = rewards.filter((r) => openCount(r) > 0)
      .sort((a, b) => (oldestOpenAgeDays(b, today()) ?? 0) - (oldestOpenAgeDays(a, today()) ?? 0));
    const shop = rewards.filter((r) => hasCapacity(r)); // §V servings-left stays in shop, even while queued
    const staleCount = rewards.filter((r) => isStale(r, today(), stale)).length;

    // waiting to claim
    this.section(root, "Waiting to claim", staleCount ? `${staleCount} stale` : null);
    if (!queue.length) {
      root.createDiv({ cls: "mf-empty-q", text: "Nothing waiting. Buy a reward and it lands here until you claim it." });
    } else {
      for (const r of queue) this.queueCard(root, r, stale);
    }

    // §V42 gacha section between the queue and the shop.
    this.renderGacha(root);

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

    // ledger — this month's transaction log (spend + claim, incl gacha), newest first §V
    this.section(root, "Ledger", null);
    const month = today().slice(0, 7);
    const all = p.entries.filter((e): e is SpendEntry | ClaimEntry => e.kind === "spend" || e.kind === "claim");
    const log = all.filter((e) => e.date.startsWith(month));
    if (!log.length) {
      root.createDiv({ cls: "mf-empty-q", text: "No purchases this month." });
    } else {
      for (let i = log.length - 1; i >= 0; i--) this.ledgerRow(root, log[i]);
      if (all.length > log.length) root.createDiv({ cls: "mf-ledger-more", text: "Older entries hidden" });
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

  private stat(parent: HTMLElement, value: string, label: string): void {
    const s = parent.createDiv({ cls: "mf-stat" });
    s.createSpan({ cls: "mf-stat-v", text: value });
    s.createSpan({ cls: "mf-stat-l", text: label });
  }

  private section(root: HTMLElement, title: string, pill: string | null): HTMLElement {
    const sec = root.createDiv({ cls: "mf-sec" });
    sec.createSpan({ cls: "mf-sec-h", text: title });
    if (pill) sec.createSpan({ cls: "mf-pill", text: pill });
    return sec;
  }

  private queueCard(root: HTMLElement, r: Reward, staleAfter: number): void {
    const card = root.createDiv({ cls: "mf-card" + (hasThumbSlot(r) ? " has-thumb" : "") });
    thumbEl(card, r);
    const body = card.createDiv({ cls: "mf-card-body" });
    const top = body.createDiv({ cls: "mf-top" });
    const main = top.createDiv({ cls: "mf-top-main" });
    main.createSpan({ cls: "mf-name", text: r.name });
    priceEl(main, r.price);
    descEl(body, r);
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
    const card = root.createDiv({ cls: "mf-card" + (hasThumbSlot(r) ? " has-thumb" : "") });
    thumbEl(card, r);
    const body = card.createDiv({ cls: "mf-card-body" });
    this.cardActions(card, r); // §V absolute-cornered ⋯ menu, out of the content column
    if (r.desc) setTooltip(card, r.desc); // §V styled Obsidian tooltip, not raw title attr
    body.createSpan({ cls: "mf-name", text: r.name });
    const affordable = canBuy(r, bal);
    if (!affordable) priceEl(body, r.price); // §V price shows here only when buy button is hidden

    const link = (parent: HTMLElement) => {
      if (r.purchaseUrl) {
        const a = parent.createEl("a", { cls: "mf-itemlink", text: "View item ↗", href: r.purchaseUrl });
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
    };

    if (affordable) {
      body.createDiv({ cls: "mf-counts", text: countsLine(r) });
      const foot = body.createDiv({ cls: "mf-foot" });
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
    const btn = acts.createEl("button", { cls: "mf-icon-btn", text: "⋯" });
    btn.setAttr("aria-label", `Actions for ${r.name}`);
    btn.onclick = (ev) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Edit").setIcon("pencil")
        .onClick(() => { this.editing = r; this.form = formFrom(r); this.screen = "add"; this.render(); }));
      menu.addItem((i) => i.setTitle("Delete").setIcon("trash").setWarning(true)
        .onClick(() => new ConfirmModal(this.app, r.name, () => void this.plugin.removeReward(r)).open()));
      menu.showAtMouseEvent(ev);
    };
  }

  private ledgerRow(root: HTMLElement, e: SpendEntry | ClaimEntry): void {
    const row = root.createDiv({ cls: "mf-ledger-row" });
    row.setAttr("title", e.date); // §V date only — no clock time is stored
    let label: string, amt = "", amtCls = "";
    if (e.kind === "claim") {
      label = `Claimed ${e.reward}`;
    } else if (e.subtype === "gacha") {
      if (e.reward === undefined) { // roll
        label = "🎰 Gacha roll";
        const c = e.chips ?? 0;
        amt = c >= 0 ? `+${fmt(c)}` : fmt(c);
        amtCls = c >= 0 ? " pos" : " neg";
      } else { // free-reward win marker
        label = `🎁 Gacha win: ${e.reward}`;
      }
    } else { // purchase
      label = `Purchased ${e.reward ?? ""}`.trimEnd();
      amt = fmt(e.chips ?? -(e.price ?? 0));
      amtCls = " neg";
    }
    row.createSpan({ cls: "mf-ln", text: label });
    if (amt) row.createSpan({ cls: "mf-amt" + amtCls, text: `${amt}🪙` });
  }

  // ---------------- GACHA (§V42-§V47) ----------------
  private renderGacha(root: HTMLElement): void {
    const p = this.plugin;
    const g = p.settings.gacha;
    if (!gachaActive(g)) return; // §V37 section presence == visibility, no collapse control
    const bal = p.balance();
    const rolls = todayRollCount(p.entries, today());
    const limited = g.maxRollsPerDay > 0;
    const capped = limited && rolls >= g.maxRollsPerDay;

    // §V52 collapsible: closed by default only when no rolls left today; open otherwise (incl. broke).
    const det = root.createEl("details", { cls: "mf-gacha-sec" });
    det.open = !capped;
    const head = det.createEl("summary", { cls: "mf-gacha-sum" });
    head.createSpan({ cls: "mf-sec-h", text: "🎰 Gacha" });
    if (limited) head.createSpan({ cls: "mf-gacha-rolls" + (capped ? " low" : ""), text: `${rolls}/${g.maxRollsPerDay} today` });

    const box = det.createDiv({ cls: "mf-gacha" });
    const stage = box.createDiv({ cls: "mf-gacha-stage" });
    this.paintStage(stage);

    const btn = box.createEl("button", { cls: "mf-roll-btn" });
    let label = `Roll Gacha (${fmt(g.cost)} chips)`;
    if (limited) label += ` · ${rolls}/${g.maxRollsPerDay} today`; // §V43 counter, hidden when unlimited
    btn.setText(label);
    btn.setAttr("aria-label", `Roll the gacha for ${fmt(g.cost)} chips`);

    const hint = box.createDiv({ cls: "mf-gacha-hint" });
    const insufficient = bal < g.cost;
    if (capped) { btn.disabled = true; btn.setAttr("title", "No rolls left today"); hint.addClass("err"); hint.setText("No rolls left today"); }
    else if (insufficient) { btn.disabled = true; btn.setAttr("title", "Not enough chips"); hint.addClass("err"); hint.setText("Not enough chips"); }
    else hint.setText(" ");
    if (this.gachaAnimating) btn.disabled = true; // §V43 locked during reveal
    btn.onclick = () => void this.doRoll(stage, box);

    root.createDiv({ cls: "mf-gacha-div" }); // §V42 divider above reward list
  }

  private paintStage(stage: HTMLElement): void {
    stage.empty();
    const r = this.gachaReveal;
    if (!r) {
      stage.addClass("pre"); // §V44 placeholder holds the area, no layout jump
      stage.createDiv({ cls: "mf-g-big", text: "🎲" });
      stage.createDiv({ cls: "mf-g-msg", text: "Roll the gacha to see your luck." });
      return;
    }
    stage.removeClass("pre");
    stage.toggleClass("win", r.win);
    stage.createDiv({ cls: "mf-g-big", text: r.big });
    stage.createDiv({ cls: "mf-g-msg", text: r.msg });
    if (r.sub) stage.createDiv({ cls: "mf-g-sub", text: r.sub });
    if (r.hint) stage.createDiv({ cls: "mf-g-dim", text: r.hint });
  }

  private async doRoll(stage: HTMLElement, box: HTMLElement): Promise<void> {
    if (this.gachaAnimating) return;
    this.gachaAnimating = true; // §V43 lock BEFORE await — double-click reentry guard
    const res = await this.plugin.roll();
    if (!res.ok) { this.gachaAnimating = false; return; } // release on denial
    const rm = reducedMotion();
    const o = res.outcome;
    const value = o.value ?? 0;

    // free_reward routes to the picker (or degrades on an empty pool). §V45,§V46
    if (o.type === "free_reward") {
      if (res.hasPool) { this.jackpot(box, rm); return; }
      // §V46 empty pool → teasing headline, then honest dim hint. Roll still spent.
      this.gachaReveal = {
        big: "🎁", msg: "No rewards, huh? LOL too bad 🤣",
        hint: "Every reward is sold out or at capacity — nothing to grant.", win: false,
      };
      this.commitReveal(stage, box, rm, "mf-anim-fade", null); // no confetti on a dud
      return;
    }

    if (o.type === "nothing") {
      this.gachaReveal = { big: "🫠", msg: pick(NOTHING_TEXT), win: false };
      this.commitReveal(stage, box, rm, "mf-anim-wobble", null);
    } else if (o.type === "rebate_small") {
      this.gachaReveal = { big: "🪙", msg: `+${fmt(value)} chips! 🪙`, win: true };
      this.commitReveal(stage, box, rm, "mf-anim-bounce", { emojis: ["🪙"], n: 6 });
    } else {
      this.gachaReveal = { big: "🪙", msg: `+${fmt(value)} chips!! 🎉`, win: true };
      this.commitReveal(stage, box, rm, "mf-anim-pop", { emojis: ["🪙", "✨", "🎉"], n: 14 }); // coin shower
    }
  }

  /** Shake → paint result → burst → unlock + full render. Reduced motion skips it all. §V44,§V47 */
  private commitReveal(stage: HTMLElement, box: HTMLElement, rm: boolean, anim: string, particles: { emojis: string[]; n: number } | null): void {
    const done = () => { this.gachaAnimating = false; this.render(); };
    if (rm) { this.paintStage(stage); done(); return; } // §V47 no shake, no burst
    stage.addClass("mf-shaking");
    window.setTimeout(() => {
      stage.removeClass("mf-shaking");
      this.paintStage(stage);
      stage.addClass(anim);
      if (particles) this.burst(box, particles.emojis, particles.n);
      window.setTimeout(done, 450);
    }, 300);
  }

  /** Fling emoji particles out from the reveal centre. Self-cleaning. §V44 (CSS + emoji only). */
  private burst(box: HTMLElement, emojis: string[], n: number): void {
    for (let i = 0; i < n; i++) {
      const p = box.createDiv({ cls: "mf-particle", text: pick(emojis) });
      const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 70;
      p.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(ang) * dist - 30}px`);
      p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
      p.style.setProperty("--dur", `${0.7 + Math.random() * 0.5}s`);
      p.style.marginLeft = `${Math.random() * 20 - 10}px`;
      window.setTimeout(() => p.remove(), 1300);
    }
  }

  /** §V45 short non-blocking overlay, then the picker. Not the banned ConfirmModal. */
  private jackpot(box: HTMLElement, rm: boolean): void {
    const ov = box.createDiv({ cls: "mf-jackpot" });
    ov.createDiv({ cls: "mf-jp-big" + (rm ? "" : " mf-anim-pop"), text: "🎁" });
    ov.createDiv({ cls: "mf-jp-h", text: "JACKPOT! 🎉" });
    ov.createDiv({ cls: "mf-jp-sub", text: "Pick your reward!" });
    if (!rm) this.burst(box, ["🎉", "✨", "🎊", "⭐"], 22); // §V44 full centred celebration
    let done = false;
    const go = () => {
      if (done) return; done = true;
      this.gachaReveal = null; // fresh placeholder when we return home
      this.gachaAnimating = false;
      this.screen = "picker";
      this.render();
    };
    ov.onclick = go; // tap dismisses early
    const ms = rm ? 400 : this.plugin.settings.gacha.jackpotPopupMs;
    window.setTimeout(go, ms);
  }

  // ---------------- PICKER (§V51) ----------------
  private renderPicker(root: HTMLElement): void {
    const head = root.createDiv({ cls: "mf-add-head" });
    const back = head.createEl("button", { cls: "mf-back", text: "‹ Back" });
    back.onclick = () => { this.screen = "home"; this.render(); }; // §V51 Back forfeits — no grant, no refund
    head.createSpan({ cls: "mf-add-ttl", text: "Choose your free reward" });

    root.createDiv({ cls: "mf-won", text: "🎉 Jackpot — pick one below. It lands in Waiting to claim, no chips spent." });

    // §V51 every reward with capacity, price+balance ignored, sorted like the shop.
    const pool = this.plugin.rewards.filter((r) => hasCapacity(r)).sort((a, b) => a.name.localeCompare(b.name));
    this.section(root, "Available rewards", `${pool.length} available`);
    for (const r of pool) this.pickerCard(root, r);
    root.createDiv({ cls: "mf-empty-q", text: "Back forfeits the win — the roll's chips stay spent, nothing is granted." });
  }

  private pickerCard(root: HTMLElement, r: Reward): void {
    const card = root.createDiv({ cls: "mf-card mf-pick-card" + (hasThumbSlot(r) ? " has-thumb" : "") });
    card.tabIndex = 0;
    thumbEl(card, r);
    const body = card.createDiv({ cls: "mf-card-body" });
    const top = body.createDiv({ cls: "mf-top" });
    const main = top.createDiv({ cls: "mf-top-main" });
    main.createSpan({ cls: "mf-name", text: r.name });
    top.createSpan({ cls: "mf-badge avail", text: "Free" }); // §V51 Free badge in place of price + buy
    descEl(body, r);
    body.createDiv({ cls: "mf-counts", text: countsLine(r) });
    const grant = async () => {
      if (!reducedMotion()) { card.addClass("mf-pulse"); await sleep(150); } // §V51 optional pulse before swap
      await this.plugin.grantFreeReward(r);
      this.screen = "home";
      this.render();
    };
    card.onclick = () => void grant();
    card.onkeydown = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void grant(); } };
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

    // emoji (optional) §V56 — inline error, stops save
    const emojiField = field(root, "Emoji (optional)");
    const emojiInput = emojiField.createEl("input", { attr: { type: "text", placeholder: "🎧" } });
    emojiInput.value = f.emoji;
    const emojiErr = emojiField.createDiv({ cls: "mf-field-err" });
    emojiErr.hide();
    emojiInput.oninput = () => {
      f.emoji = emojiInput.value;
      if (f.emoji.trim() && !isSingleEmoji(f.emoji.trim())) { emojiErr.setText("Enter exactly one emoji."); emojiErr.show(); }
      else emojiErr.hide();
      update();
    };

    // description (optional) §V56 — maxlength caps at 280, no live counter
    const descField = field(root, "Description (optional)");
    const descInput = descField.createEl("textarea", { attr: { maxlength: "280", rows: "2", placeholder: "Noise-cancelling, over-ear." } });
    descInput.value = f.desc;
    descInput.oninput = () => { f.desc = descInput.value; update(); };

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
      const emojiOk = !f.emoji.trim() || isSingleEmoji(f.emoji.trim()); // §V56
      return name.length > 0 && !dupName() && price >= 1 && nOk && urlOk && thumbOk && emojiOk;
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
      if (f.emoji.trim()) r.emoji = f.emoji.trim(); // §V56 write only when non-empty
      if (f.desc.trim()) r.desc = f.desc.trim();
      if (prev) await this.plugin.updateReward(prev.name, r);
      else await this.plugin.addReward(r);
      this.editing = null;
      this.screen = "home";
      this.render();
    };
  }
}

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

function field(root: HTMLElement, label: string): HTMLElement {
  const wrap = root.createDiv({ cls: "mf-field" });
  wrap.createEl("label", { text: label });
  return wrap;
}
function priceEl(parent: HTMLElement, price: number): void {
  const el = parent.createSpan({ cls: "mf-price", text: fmt(price) });
  el.createSpan({ cls: "u", text: " chips" });
}
// §V54 slot order: thumbnail → emoji → nothing. Chosen from data, not runtime image state.
function thumbEl(parent: HTMLElement, r: Reward): void {
  if (r.thumbnail) {
    const img = parent.createEl("img", { cls: "mf-thumb", attr: { src: r.thumbnail, alt: "", loading: "lazy" } });
    img.onerror = () => img.remove(); // broken image → text-only; emoji is NOT a fallback (§V54)
    return;
  }
  if (r.emoji) parent.createDiv({ cls: "mf-thumb-emoji", text: r.emoji });
}
// §V55 two-line CSS clamp; omitted when absent.
function descEl(body: HTMLElement, r: Reward): void {
  if (r.desc) body.createDiv({ cls: "mf-desc", text: r.desc });
}
function hasThumbSlot(r: Reward): boolean {
  return !!r.thumbnail || !!r.emoji; // §V54 emoji tile also earns the has-thumb layout
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
