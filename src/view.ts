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
import {
  CAPS, scoreOf, chipsOf, bandCap, matchChips, pendingOf, pendingChips,
  type Match, type Session, type Threshold, type Band, type RayState,
} from "./gaming.js";

export const MILLE_VIEW = "mille-feuille-view";

const today = (): string => new Date().toISOString().slice(0, 10);
const fmt = (n: number): string => (n === Infinity ? "∞" : n.toLocaleString());
const countsLine = (r: Reward): string =>
  `${r.purchasedCount} bought · ${r.claimedCount} claimed · ${fmt(remaining(r))} left`;

type Screen = "home" | "add" | "picker" | "match";

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

// §V62 log-screen state. Raw stats only — the score and the chips are derived on every paint.
interface MatchForm {
  mon: string;
  deaths: number;
  farm: number | null;
  damage: number; // thousands
  points: number;
  ray: RayState;
  focus: boolean;
}
const blankMatch = (): MatchForm => ({ mon: "", deaths: 0, farm: null, damage: 0, points: 0, ray: "none", focus: false });

// Human labels for the thresholds that fired. §V62
const TH_LABEL: Record<string, (op: string, v: number | string) => string> = {
  deaths: (op, v) => `Deaths ${op} ${v}`,
  farm: (op, v) => `Level ${op} ${v} at Ray`,
  damage: (op, v) => `${v}k damage`,
  points: (op, v) => `${v} points`,
  ray: (_op, v) => (v === "stolen" ? "Stole Rayquaza" : "Secured Rayquaza"),
  focus: () => "Focus goal",
};
const thLabel = (t: Threshold): string =>
  `${(TH_LABEL[t.stat] ?? (() => t.stat))(t.op, t.val)} +${t.pts}`;

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
  private matchForm = blankMatch();
  private focusDraft = "";

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
    else if (this.screen === "match") this.renderMatch(root);
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

    // §V69 gaming section sits between the queue and the gacha section.
    this.renderGamingSec(root);

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
    const right = foot.createDiv({ cls: "mf-foot-right" });
    itemLink(right, r);
    const btn = right.createEl("button", { cls: "mf-btn btn-claim", text: openCount(r) > 1 ? "Claim oldest" : "Claim" });
    btn.onclick = () => this.plugin.claim(r);
  }

  private shopCard(root: HTMLElement, r: Reward, bal: number): void {
    const card = root.createDiv({ cls: "mf-card" + (hasThumbSlot(r) ? " has-thumb" : "") });
    thumbEl(card, r);
    const body = card.createDiv({ cls: "mf-card-body" });
    this.cardActions(card, r); // §V absolute-cornered ⋯ menu, out of the content column
    if (r.desc) {
      setTooltip(card, r.desc); // §V styled tooltip on hover
      card.addClass("mf-clickable");
      card.onclick = (ev) => { // §V ...and a styled popover on click (buttons/links still work)
        if ((ev.target as HTMLElement).closest("button, a")) return;
        showDescPopover(r.desc!, ev.clientX, ev.clientY);
      };
    }
    body.createSpan({ cls: "mf-name", text: r.name });
    const affordable = canBuy(r, bal);
    if (!affordable) priceEl(body, r.price); // §V price shows here only when buy button is hidden

    if (affordable) {
      body.createDiv({ cls: "mf-counts", text: countsLine(r) });
      const foot = body.createDiv({ cls: "mf-foot end" });
      const right = foot.createDiv({ cls: "mf-foot-right" });
      itemLink(right, r);
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
      itemLink(right, r);
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


  // ---------------- GAMING (§V69-§V83) ----------------

  /** Public entry for the "Log a match" command. §I.cmd */
  openMatch(): void {
    this.matchForm = blankMatch();
    this.focusDraft = "";
    this.screen = "match";
    this.render();
  }

  private renderGamingSec(root: HTMLElement): void {
    const p = this.plugin;
    const g = p.settings.gaming;
    if (!g.enabled) return; // §V58 presence == visibility, no collapse control needed
    const ts = p.thresholds(), bs = p.bands();
    const id = today();
    const entry = p.sessions.find((x) => x.session.id === id);
    const s: Session = entry?.session ?? { id, processed: 0, matches: [] };
    const unreadable = entry?.unreadable ?? 0;
    const pending = pendingOf(s);
    const covered = s.matches.slice(0, s.processed);
    const coveredChips = covered.reduce((a, m) => a + matchChips(m, ts, bs), 0);
    const pendChips = pendingChips(s, ts, bs);
    const batches = p.batchCounts[id] ?? 0;
    // §V79 older sessions that still hold pending matches, oldest-first.
    const older = p.sessions
      .filter((x) => x.session.id !== id && pendingOf(x.session).length > 0)
      .map((x) => x.session)
      .sort((a, b) => a.id.localeCompare(b.id));

    const det = root.createEl("details", { cls: "mf-gm-sec" });
    det.open = s.matches.length > 0; // §V70 open when there is something to see, from data only
    const sum = det.createEl("summary", { cls: "mf-gm-sum" });
    sum.createSpan({ cls: "mf-sec-h", text: "🎮 Gaming" });
    const right = sum.createDiv({ cls: "mf-gm-sum-right" });
    if (older.length) {
      // §V79 same pill pattern as a stale purchase — it never lies about which session is on screen.
      right.createSpan({ cls: "mf-pill", text: `${older.length} unprocessed day${older.length === 1 ? "" : "s"}` });
    }
    right.createSpan({
      cls: "mf-gm-count",
      text: s.matches.length ? `${s.matches.length} match${s.matches.length === 1 ? "" : "es"} today` : "no matches yet",
    });

    for (const o of older) this.olderSessionLine(det, o, ts, bs);

    const box = det.createDiv({ cls: "mf-gm" });
    const head = box.createDiv({ cls: "mf-gm-head" });
    const dateEl = head.createDiv({ cls: "mf-gm-date", text: `Session ${id}` });
    if (s.matches.length === 0) {
      // §V70 empty: one line, one control. No totals, no note line, no Process control at all.
      dateEl.createEl("small", { text: "Nothing logged. Nothing pending." });
      box.createDiv({
        cls: "mf-gm-empty",
        text: "No matches yet. Log one after you play and the chips add up here.",
      });
      const foot = box.createDiv({ cls: "mf-gm-foot" });
      const log = foot.createEl("button", { cls: "mf-btn btn-primary", text: "+ Log match" });
      log.onclick = () => this.openMatch();
      return;
    }

    dateEl.createEl("small", {
      text: batches
        ? `${batches} batch${batches === 1 ? "" : "es"} written. Chips land when you tick the task.`
        : "Nothing processed yet. Chips land when you tick the task.",
    });
    const sub = head.createDiv();
    const total = sub.createDiv({ cls: "mf-gm-total" + (pendChips ? "" : " none") });
    total.createSpan({ text: String(pendChips) });
    total.createSpan({ cls: "u", text: "pending" });
    // §V69 both totals in words — the dim/bright split is never the only signal.
    sub.createDiv({ cls: "mf-gm-head-sub" }).createSpan({
      cls: "mf-gm-paid",
      text: `${pending.length} pending · ${covered.length} covered (${coveredChips}🪙)`,
    });

    const list = box.createDiv({ cls: "mf-gm-list" });
    const cap = bandCap(bs);
    s.matches.forEach((m, i) => this.matchRow(list, m, i < s.processed, ts, bs, cap));

    const notes: string[] = [];
    const zeros = s.matches.filter((m) => matchChips(m, ts, bs) === 0).length;
    if (zeros) notes.push(`${zeros} match${zeros === 1 ? "" : "es"} scored 0. Neutral, never a penalty.`);
    if (unreadable) notes.push(`${unreadable} row${unreadable === 1 ? "" : "s"} unreadable`); // §V75

    const foot = box.createDiv({ cls: "mf-gm-foot" });
    const log = foot.createEl("button", { cls: "mf-btn btn-ghost", text: "+ Log match" });
    log.onclick = () => this.openMatch();
    // §V73 label carries the count and the chips; disabled with its own label when nothing is new.
    const proc = foot.createEl("button", { cls: "mf-btn btn-primary" });
    if (pending.length === 0) {
      proc.setText("Nothing new");
      proc.disabled = true;
    } else {
      proc.setText(`Process ${pending.length} · +${pendChips}`);
      proc.onclick = () => void this.plugin.processSession(id);
    }
    if (notes.length) box.createDiv({ cls: "mf-gm-note", text: notes.join(" ") });
  }

  /** §V79,§V81 one compact line per older session — totals only, its own Process control. */
  private olderSessionLine(root: HTMLElement, s: Session, ts: Threshold[], bs: Band[]): void {
    const pending = pendingOf(s);
    const chips = pendingChips(s, ts, bs);
    const age = daysAgo(s.id, today());
    const stale = age !== null && age > this.plugin.settings.economy.staleAfterDays;
    const row = root.createDiv({ cls: "mf-gm-older" });
    const left = row.createDiv({ cls: "mf-gm-older-main" });
    left.createSpan({ cls: "mf-gm-older-id", text: s.id });
    left.createSpan({
      cls: "mf-gm-older-sub",
      text: `${pending.length} pending · +${chips}🪙${stale ? ` · ${age} days ago` : ""}`,
    });
    const btn = row.createEl("button", { cls: "mf-btn btn-ghost", text: `Process ${pending.length}` });
    btn.onclick = () => void this.plugin.processSession(s.id); // §V82 this session only
  }

  private matchRow(list: HTMLElement, m: Match, coveredRow: boolean, ts: Threshold[], bs: Band[], cap: number): void {
    const score = scoreOf(m, ts).score;
    const chips = chipsOf(score, bs);
    const row = list.createDiv({ cls: "mf-gm-row" + (coveredRow ? " paid" : "") });
    // §V69 state is never colour alone — every row says which it is.
    setTooltip(row, coveredRow ? "Covered by a batch already" : "Pending, not batched yet");
    row.createSpan({ cls: "mf-gm-n", text: String(m.n) });
    row.createSpan({ cls: "mf-gm-mon", text: m.mon || "—" });
    pips(row, chips, cap);
    row.createSpan({ cls: "mf-gm-score", text: String(score) });
    row.createSpan({ cls: "mf-gm-chips" + (chips ? "" : " zero"), text: chips ? `+${chips}` : "0" });
  }

  // ---------------- LOG SCREEN (§V62, §V71, §V72) ----------------
  private renderMatch(root: HTMLElement): void {
    const p = this.plugin;
    const g = p.settings.gaming;
    const ts = p.thresholds(), bs = p.bands();
    const cap = bandCap(bs);
    const id = today();
    const session = p.sessionOf(id);
    const f = this.matchForm;
    const n = (session?.matches.length ?? 0) + 1;

    const head = root.createDiv({ cls: "mf-add-head" });
    const back = head.createEl("button", { cls: "mf-back", text: "‹ Back" });
    back.onclick = () => { this.screen = "home"; this.render(); }; // §V72 writes nothing
    head.createSpan({ cls: "mf-add-ttl", text: `Match ${n} · ${id}` });

    // §V76 asked once per session, inline on this screen — never a modal.
    if (g.promptFocus && session?.focus === undefined) {
      const fw = field(root, "Focus goal for this session");
      const fi = fw.createEl("input", { attr: { type: "text", placeholder: "e.g. dodge before you commit" } });
      fi.value = this.focusDraft;
      fi.oninput = () => { this.focusDraft = fi.value; };
      fw.createEl("small", { cls: "mf-hint", text: "Asked once a day. It never changes a score." });
    }

    // live readout
    const live = root.createDiv({ cls: "mf-live" });
    const scoreEl = live.createDiv({ cls: "mf-live-box" });
    const scoreV = scoreEl.createSpan({ cls: "mf-live-v" });
    scoreEl.createSpan({ cls: "mf-live-l", text: "score" });
    const chipEl = live.createDiv({ cls: "mf-live-box" });
    const chipV = chipEl.createSpan({ cls: "mf-live-v chips" });
    chipEl.createSpan({ cls: "mf-live-l", text: "chips" });
    const pipWrap = live.createDiv({ cls: "mf-live-pips" });

    // Pokémon: the 8 most recent names of the folder + free text. §V83
    const monField = field(root, "Pokémon");
    const monRow = monField.createDiv({ cls: "mf-mons" });
    const monInput = monField.createEl("input", { attr: { type: "text", placeholder: "Type a name" } });
    monInput.value = f.mon;
    const paintMons = () => {
      monRow.empty();
      for (const name of recentMons(p.sessions)) {
        const b = monRow.createEl("button", { cls: "mf-mon" + (f.mon === name ? " on" : ""), text: name });
        b.onclick = () => { f.mon = name; monInput.value = name; paintMons(); };
      }
    };
    monInput.oninput = () => { f.mon = monInput.value; paintMons(); };
    paintMons();

    // four numeric fields — typed entry and step buttons write the same state. §V71
    const steppers: (() => void)[] = [];
    const numeric = (
      label: string, hint: string, key: "deaths" | "farm" | "damage" | "points", step: number, unit = "",
    ): void => {
      const [lo, hi] = CAPS[key];
      const wrap = root.createDiv({ cls: "mf-step" });
      const lab = wrap.createDiv({ cls: "mf-step-lab", text: label });
      lab.createEl("small", { text: hint });
      const ctl = wrap.createDiv({ cls: "mf-step-ctl" });
      const minus = ctl.createEl("button", { cls: "mf-step-btn", text: "−" });
      const input = ctl.createEl("input", { cls: "mf-step-val", attr: { type: "text", inputmode: "numeric" } });
      const plus = ctl.createEl("button", { cls: "mf-step-btn", text: "+" });
      if (unit) ctl.createSpan({ cls: "mf-step-unit", text: unit });
      const get = (): number | null => f[key];
      const set = (v: number | null): void => {
        if (key === "farm") f.farm = v === null ? null : clamp(v, lo, hi);
        else (f[key] as number) = clamp(v ?? 0, lo, hi);
        paint();
      };
      const draw = () => {
        if (document.activeElement === input) return; // §V71 never fight the caret
        const v = get();
        input.value = v === null ? "" : String(v);
        input.toggleClass("zero", v === null || v === 0);
      };
      steppers.push(draw);
      minus.onclick = () => {
        const v = get();
        if (key === "farm") return set(v === null || v - step < lo ? null : v - step);
        set((v ?? 0) - step);
      };
      plus.onclick = () => {
        const v = get();
        if (key === "farm" && v === null) return set(lo);
        set((v ?? 0) + step);
      };
      input.oninput = () => {
        const t = input.value.replace(/[^\d]/g, ""); // §V71 a non-digit never lands
        input.value = t;
        set(t === "" ? (key === "farm" ? null : 0) : Number(t));
      };
      input.onblur = () => draw();
      minus.setAttr("aria-label", `Decrease ${label}`);
      plus.setAttr("aria-label", `Increase ${label}`);
    };
    numeric("Deaths", "Every death costs a tier.", "deaths", 1);
    numeric("Level at Rayquaza", "Blank if you never got there.", "farm", 1);
    numeric("Damage", "In thousands.", "damage", 5, "k");
    numeric("Points scored", "", "points", 10);

    // Rayquaza, three ways
    const rayField = field(root, "Rayquaza");
    const raySeg = rayField.createDiv({ cls: "mf-seg" });
    const paintRay = () => {
      raySeg.empty();
      const modes: [RayState, string][] = [["none", "Lost it"], ["secured", "Secured"], ["stolen", "Stole it"]];
      for (const [v, label] of modes) {
        const b = raySeg.createEl("button", { cls: f.ray === v ? "on" : "", text: label });
        b.onclick = () => { f.ray = v; paintRay(); paint(); };
      }
    };
    paintRay();

    // focus goal met?
    const tog = root.createDiv({ cls: "mf-tog" });
    const lab = tog.createDiv({ cls: "mf-tog-lab" });
    lab.createSpan({ text: "Focus goal met?" });
    lab.createEl("small", { text: session?.focus ? session.focus : "The goal you set for this session." });
    const sw = tog.createEl("button", { cls: "mf-switch" + (f.focus ? " on" : "") });
    sw.onclick = () => { f.focus = !f.focus; sw.toggleClass("on", f.focus); paint(); };

    // thresholds that passed
    const firedLab = root.createDiv({ cls: "mf-fired-lab", text: "What scored" });
    const fired = root.createDiv({ cls: "mf-fired" });
    firedLab.hide();

    const foot = root.createDiv({ cls: "mf-form-foot" });
    const cancel = foot.createEl("button", { cls: "mf-btn btn-ghost", text: "Cancel" });
    cancel.onclick = () => { this.screen = "home"; this.render(); }; // §V72
    const save = foot.createEl("button", { cls: "mf-btn btn-primary", text: "Save match" });
    save.onclick = async () => {
      save.disabled = true;
      const focus = g.promptFocus && session?.focus === undefined ? this.focusDraft.trim() : undefined;
      await p.logMatch({ n, mon: f.mon.trim() || "Unknown", deaths: f.deaths, farm: f.farm, damage: f.damage, points: f.points, ray: f.ray, focus: f.focus }, focus);
      // §V72 the screen stays open with clear fields, ready for the next match.
      this.matchForm = blankMatch();
      this.focusDraft = "";
      this.render();
    };

    const paint = (): void => {
      const m: Match = { n, mon: f.mon, deaths: f.deaths, farm: f.farm, damage: f.damage, points: f.points, ray: f.ray, focus: f.focus };
      const { score, hits } = scoreOf(m, ts);
      const chips = chipsOf(score, bs);
      scoreV.setText(String(score));
      chipV.setText(String(chips));
      pipWrap.empty();
      pips(pipWrap, chips, cap);
      fired.empty();
      firedLab.toggle(hits.length > 0);
      if (!hits.length) fired.createSpan({ cls: "mf-fired-none", text: "Nothing yet. A blank match still counts as played." });
      else for (const h of hits) fired.createSpan({ cls: "mf-fired-tag", text: thLabel(h) });
      for (const draw of steppers) draw();
    };
    paint();
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
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** One mark per chip, up to the per-match cap. §V62,§V69 */
function pips(parent: HTMLElement, chips: number, cap: number): void {
  const wrap = parent.createSpan({ cls: "mf-pips" });
  for (let i = 0; i < Math.max(cap, chips); i++) wrap.createEl("i", { cls: i < chips ? "on" : "" });
}

/** Whole days between two ISO dates, or null when the id is not a date. §V81 */
function daysAgo(id: string, todayIso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return null;
  return Math.round((Date.parse(todayIso) - Date.parse(id)) / 86400000);
}

/** The 8 most recent Pokémon names from the session notes, newest-first. §V83 */
function recentMons(sessions: { session: Session }[]): string[] {
  const out: string[] = [];
  for (const { session } of sessions) { // already newest-first
    for (let i = session.matches.length - 1; i >= 0; i--) {
      const name = session.matches[i].mon.trim();
      if (name && !out.includes(name)) out.push(name);
      if (out.length >= 8) return out;
    }
  }
  return out;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

function field(root: HTMLElement, label: string): HTMLElement {
  const wrap = root.createDiv({ cls: "mf-field" });
  wrap.createEl("label", { text: label });
  return wrap;
}
function itemLink(parent: HTMLElement, r: Reward): void {
  if (!r.purchaseUrl) return;
  const a = parent.createEl("a", { cls: "mf-itemlink", text: "View item ↗", href: r.purchaseUrl });
  a.setAttr("target", "_blank");
  a.setAttr("rel", "noopener");
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
// §V styled desc popover on card click; one at a time, dismissed on outside click.
function showDescPopover(text: string, x: number, y: number): void {
  document.querySelectorAll(".mf-desc-pop").forEach((n) => n.remove());
  const pop = document.body.createDiv({ cls: "mf-desc-pop", text });
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
  pop.style.top = Math.min(y + 12, window.innerHeight - r.height - 8) + "px";
  const close = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) { pop.remove(); document.removeEventListener("mousedown", close); }
  };
  window.setTimeout(() => document.addEventListener("mousedown", close), 0);
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
