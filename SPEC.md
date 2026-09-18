# SPEC — mille-feuille

## §G

Obsidian plugin. Pay **chips** ∀ completed task (base + crit gacha), Fibonacci milestone multiplier, chip shop of registered rewards, two-state reward flow (Purchased→Claimed), repeatable rewards vs `servings` capacity. Config-first economy, tuned monthly in existing review pass.

## §C

- ⊥ pledge / IF-THEN(tasks→single reward) system.
- ⊥ per-task difficulty/priority tagging.
- Habit def/gating/energy ∈ mochi; money ledgers ∈ cendol. mille-feuille owns task→reward only. Completed mochi habit = 1 task source, nothing more.
- Anti-loop: purchase|claim ⊥ credit chips. Only work credits.
- Obsidian plugin, released BRAT from 1 repo → desktop + Android via LiveSync.
- Fully in-vault: zero network, no paid API, no account, no telemetry.
- ⊥ iOS (Android + desktop only).
- Vault theme Rooftop Bakery; currency = **chips** (poker/choc-chip dual read).

## §I

```yaml
# config: economy (value curve) — all monthly tuning here, no code change
economy:
  defaultBase: 10
  critChance: 0.15
  critMultipliers: [1.5, 2.0]
  milestoneByTag: { "#x2": 2, "#x3": 3, "#x5": 5 }   # per-task multiplier (⊥ on-top; see V4)
  habitPayout: { farm: 8, ult: 20 }
  staleAfterDays: 7
# config: plugin settings (non-economy)
baseFolder: mille-feuille
scanInclude: []          # folder prefixes, empty = whole vault (V30)
scanExclude: []          # folder prefixes, exclude beats include (V30)
messages:                # editable toast templates, {{var}} substitution (V31)
  mint: "Earned +{{chips}}🪙{{crit}}"
  milestone: "Milestone hit! +{{chips}}🪙{{crit}}"
  critSuffix: " ✦ critical hit!"
  refund: "Undone, −{{chips}}🪙 returned"
  purchase: "Bought {{name}} for −{{price}}🪙"
  added: "Added {{name}} to the shop for {{price}}🪙 🛒"
  deleted: "Removed {{name}} from the shop"
  soldOut: "{{name}} sold out, no servings left"
  fullyClaimed: "{{name}} fully claimed 🎉"
  afford: "You can now afford {{name}} ({{price}}🪙) ✨"
  firstChip: "First chips minted, the bakery opens 🥐"
  monthly: "Monthly review ready, {{chips}}🪙 earned this month"
  critStreak: "Crit streak x{{count}}! 🔥"   # count==2 special-cased to "Double crit! 🔥"
  claim:                 # LIST — random pick, CRUD in settings (V31)
    - "{{name}} claimed, enjoy it you earned this 🍰"
    - "{{name}} claimed, go treat yourself ✨"
    - "{{name}} claimed, no guilt you did the work 🍪"
    - "{{name}} claimed, fresh out the oven enjoy 🥐"
    - "{{name}} claimed, cashed in enjoy! 🎉"
```
```yaml
# file: reward note (one note/reward, vault frontmatter)
type: reward
name: Spa day out
price: 500
servings: 3          # 1 one-off | N | -1 infinite | 0 sold-out
purchasedCount: 2
claimedCount: 1
openPurchaseDates: [2026-08-06]   # open occurrences, oldest-first, self-trims on claim
state: purchased     # DERIVED top-level (sold-out|purchased|available)
isPurchasable: true  # OPTIONAL — omitted when false/absent, written only when true (V25)
purchaseUrl: https://…  # OPTIONAL — only when isPurchasable: true (V25)
```
- **ledger** entries (source of truth for balance & aggregates):
  - credit: `{date, source, key, base, crit, chips, tier}` — source ∈ {task,subtask,milestone,habit}; key=`(id,✅date)` for habits; tier=milestone tag|habit tier.
  - reversal: `{date, reversalOf: key, chips: -N}`.
  - spend: `{date, reward, price}` — see §I.gacha for signed `chips` + gacha fields (V35,V40).
  - claim: `{date, reward}` — no chip movement, feeds aggregates. ⊥ `source` field (gacha proof on grant marker, not claim).
- **mochi bridge**: line `- [x] <id> · <tier> ✅ <date>` under `## Tasks`. Read by §I scan, no API/event/marker.
- **file layout** (base folder configurable in settings, default `mille-feuille`; filenames & structure fixed):
  - `<base>/wallet.md` — frontmatter `balance` (cached sum of ledger).
  - `<base>/ledger/<YYYY-MM>.<device>.md` — append-only entries, one file/month/device (§V87). Reads union the folder; legacy unsuffixed `<YYYY-MM>.md` still counts.
  - `<base>/aggregates.<device>.md` — permanent monthly aggregate record, 1 row/month/device (§V91). Reads union `aggregates*.md` at the base root and collapse to 1 row/month; legacy unsuffixed `aggregates.md` still counts.
  - `<base>/rewards/<name>.md` — one note/reward (§I reward note shape).

### §I additions — gacha + reward metadata (v0.5, from design-spec shop-gacha)

```yaml
# config: top-level gacha key (⊥ inside economy — keeps gacha economy separate from earn)
gacha:
  enabled: false          # default off. off → hide all gacha UI + config
  cost: 5                 # chips per roll
  maxRollsPerDay: 5       # SPEC ADDITION (not in PRD). 0 = no limit
  jackpotPopupMs: 3000    # free-reward celebration on-screen time
  outcomes:               # weighted table. p = weight / sum(weights)
    - { type: nothing,       weight: 50 }
    - { type: rebate_small,  weight: 30, value: 2 }   # value = chips returned
    - { type: rebate_big,    weight: 15, value: 8 }   # value may exceed cost (design B)
    - { type: free_reward,   weight: 5 }
```
- `type` ∈ {`nothing`,`rebate_small`,`rebate_big`,`free_reward`}.
- `value` present only on `rebate_small`|`rebate_big`. May exceed `cost`.
- sum(weights)==0 | `outcomes` empty → subsystem behaves off.
- ⊥ EV/house-edge check. 1 user, table = their knob.

```ts
export interface SpendEntry {
  kind: "spend";
  date: string;
  reward?: string;              // absent on gacha ROLL; present on purchase + free-grant marker
  price?: number;               // present on purchase + free-grant marker (0); absent on gacha roll
  chips?: number;               // NEW. signed. purchase = -price. gacha roll = -cost + rebate.
                                //   free-grant marker = absent (counts 0). pre-fix entry = absent (counts 0).
  subtype?: "gacha";            // NEW. marks gacha spend (roll or free-grant marker)
  outcome?: "nothing" | "rebate_small" | "rebate_big" | "free_reward"; // gacha only
}
export interface ClaimEntry {
  kind: "claim";
  date: string;
  reward: string;
  // ⊥ source field. Gacha proof on grant MARKER (spend), not on claim. Gacha claim = normal claim. Intended.
}
```
- ∀ new `SpendEntry` field optional. Pre-fix entry `{reward,price}` reads unchanged, counts 0.

```ts
// monthly aggregate — new fields
gachaRolls: number;    // count spend where subtype=="gacha" & reward absent
gachaRebated: number;  // total chips rebate results returned this month
gachaClaims: number;   // count spend where subtype=="gacha" & outcome=="free_reward" & reward present.
                       //   = free rewards won. Separate from paid `claimed`.
```

```yaml
# reward note — new optional fields (same omit-when-absent pattern as V25)
desc: "Noise-cancelling, over-ear."   # OPTIONAL. ≤280 chars. top-level, for Dataview
emoji: "🎧"                            # OPTIONAL. exactly one emoji grapheme
```

### §I additions — gaming ledger (v0.6, from design-spec gaming-ledger)

```yaml
# config: top-level gaming key (⊥ inside economy — gaming curve separate from earn curve)
gaming:
  enabled: false               # default off. Off hides section, commands, fields below
  folder: "Gaming Ledger"      # match notes. Always outside scan scope (V65)
  taskFile: "Gaming/Sessions.md"
  taskTag: "#gaming-session"   # "" for no tag
  promptFocus: true            # ask focus goal at session start
  thresholds: |                # 1/line: stat op value : points
    deaths <= 3 : 1
    deaths <= 2 : 1
    deaths == 0 : 2
    farm >= 11 : 1
    farm >= 13 : 1
    ray == secured : 2
    ray == stolen : 3
    damage >= 60 : 1
    damage >= 80 : 1
    damage >= 100 : 1
    points >= 100 : 1
    points >= 150 : 1
    focus == yes : 2
  bands: |                     # 1/line: from-to : chips, or N+ : chips
    0-1 : 0
    2-3 : 1
    4-5 : 2
    6-7 : 3
    8+  : 5
```
- ⊥ `grouping` key, ⊥ `autoProcess` key. Session id always = date; Process always manual (design-spec §Q Q4,Q5).
- Both tables = textarea + parser, pattern of gacha `outcomes` ([settings.ts:138](src/settings.ts)). `SettingGroup` needs app 1.11, manifest `minAppVersion` 1.5.0 ∴ ⊥ grid.

```markdown
<!-- file: match note — one/session, in `gaming.folder` -->
---
type: gaming-session
session: 2026-08-18
focus: dodge before you commit
processed: 5
---

| # | Pokémon   | Dth | Lv | Ray   | Dmg | Pts | F |
|---|-----------|-----|----|-------|-----|-----|---|
| 1 | Cinderace | 2   | 13 | -     |  82 | 118 | y |
| 2 | Blissey   | 4   | -  | -     |  61 |  44 | n |
| 3 | Cinderace | 0   | 11 | steal | 104 |  96 | n |
```
- `session` = session id, always date. `focus` optional, 1 line text. `processed` = count matches a batch covers; plugin-owned, user ⊥ edit.
- `Dth` deaths. `Lv` level at Rayquaza, blank = never reached. `Ray` ∈ {`-`,`secured`,`steal`}. `Dmg` damage in thousands. `Pts` points. `F` ∈ {`y`,`n`} focus met.
- Note holds ⊥ score, ⊥ chips. System derives both (V59).

```ts
interface Match {
  n: number;                 // row number, 1-based
  mon: string;
  deaths: number;
  farm: number | null;       // null = never reached Rayquaza
  damage: number;            // in thousands
  points: number;
  ray: "none" | "secured" | "stolen";
  focus: boolean;
}

interface Threshold {
  stat: "deaths" | "farm" | "damage" | "points" | "ray" | "focus";
  op: "<=" | ">=" | "==" | "<" | ">";
  val: number | string;      // string for ray and for focus
  pts: number;
}

interface Band {
  from: number;
  to: number;                // Infinity for the `N+` form
  chips: number;
}

interface Session {
  id: string;                // "2026-08-18"
  focus?: string;
  processed: number;
  matches: Match[];
}
```

- **session task** — Process writes 1 task under `## Tasks` of `gaming.taskFile`:
```markdown
- [ ] Gaming session 2026-08-18 · gaming:14 #gaming-session
  - Matches: 5 (1-5)
  - Scores: 7, 3, 8, 0, 12
  - Total chips: 14
```
  ` · gaming:14` = payload, carries batch chips to scan (V77). Middot convention of habit tier (V12). 3 sublines = human-only, ⊥ load-bearing, scan ⊥ read them. Batch 2 → ` (2)` before payload, batch 3 → ` (3)`, etc. `Matches` range = row numbers of that batch.
- **ledger entry** — scan writes on tick, gaming code ⊥ write it:
```ts
{ kind: "credit", date: "2026-08-19",
  source: "gaming",
  key: "task:Gaming/Sessions.md:Gaming session 2026-08-18 · gaming:14·✅2026-08-19",
  base: 14, crit: null, chips: 14 }
```
  Key from `taskKey()` ([scan.ts:60](src/scan.ts)) — path + line text sans Tasks metadata + ✅ date. ∴ batch 2 differs by text ∴ existing idempotent scan pays each batch once (V13), ⊥ own key needed. Payload edit → new key, old key stays credited (V64). `date` = tick date ⊥ session date (V80). `crit` may hold multiplier (V78).
- **aggregate**: `source` gains `"gaming"`. ⊥ new field — `chipsBySource` already 1 entry/source (V66).
- **cmd**: `Log a match` → log screen for today session. `Process gaming session` → sweep ∀ session w/ pending matches, oldest-first (V82). `Review session stats` → summary of today session.

## §V

V1: ∀ completed checkbox (tagged|not, incl mochi habit line) → credit chips on transition to done.
V2: crit lives on payout magnitude only, ⊥ reward identity. Roll independent per task & per milestone payout. Applies uniform to task|milestone|habit.
V3: purchase|claim ⊥ credit chips (anti-loop). Only task/subtask/milestone/habit completion credits.
V4: milestone tag → pay `defaultBase × multiplier` (+own crit) for that one tagged task. Pure per-task multiplier — ⊥ relation to subtask payouts, ⊥ parent/child bonus, ⊥ on-top.
V5: task tagged `#x2`/`#x3`/`#x5` → milestone. Respected wherever tag sits, any hierarchy depth. Nesting ⊥ matter.
V6 (changed): balance = sum `chips` over credit + reversal + **spend** entries. Spend counts `e.chips` when present, 0 when absent. Credit+reversal logic unchanged. Defect fix — old wording (balance excludes spend) retired; V7 now correct. Unchecked completion nets 0.
V7 (changed): purchase allowed iff capacity (`purchasedCount < servings | servings == -1`) & `price ≤ balance()`. On buy → write spend `{reward, price, chips: -price}`, `purchasedCount++`, append today→`openPurchaseDates`. Refuse when `price > balance()`. Balance never < 0. Normal-purchase `chips` always ≤ 0.
V8: claim FIFO → `claimedCount++`, pop `openPurchaseDates[0]`.
V9: `state` derived top-level: `sold-out` when `servings≠-1 & purchasedCount≥servings & openPurchaseDates==[]`; `purchased` when `openPurchaseDates` non-empty; else `available`. Affordability = `balance ≥ price`, computed live, ⊥ persisted.
V10: reward w/ open (purchased-not-claimed) occurrence → visible/queryable until claimed.
V11: oldest open `openPurchaseDates[0]` older than `staleAfterDays` → surfaced (anti-forget guarantee).
V12: habit classifier: line carries ` · <tier>`, tier ∈ {farm,ult} → `habitPayout[tier]`; else `defaultBase`. Regular tasks ⊥ use ` · ` middot. Habit lines ⊥ `#x2` tag (tier-match & milestone-tag disjoint).
V13: habit payout frozen per key `(id,✅date)` on first `[x]`. Rewrite idempotent — no re-credit, no crit re-roll. `[-]` & `[ ]` credit nothing.
V14: uncheck habit → reversal entry for exact recorded amount; re-check re-applies frozen amount (no crit re-roll).
V15: every economy param ∈ config object, edited via Obsidian plugin settings tab (⊥ raw file edit needed). Change → live, no recompile.
V16 (changed): monthly aggregates (chips by tier, purchased/claimed, open/stale count, crit count) produced FROM ledger, ⊥ from reward notes. Monthly pass rolls ledger → permanent aggregate; closed occurrences may then trim. `aggregate()` ⊥ count gacha spend (`subtype=="gacha"`) in `purchased`. Adds `gachaRolls`,`gachaRebated`,`gachaClaims` (§I). Reversal/credit/claim counts unchanged. **(changed v0.6)** credit `source=="gaming"` → `chipsBySource.gaming`. ⊥ added to task|subtask|habit totals, ⊥ in `chipsByTier`. Gaming credit may crit ∴ counts in `critCount`. Reversal/claim/purchase/gacha counts unchanged.
V17: rewards & wallet stored as vault notes/frontmatter (⊥ plugin-only `data.json`); derived fields top-level for naive Dataview read.
V18: every view styled by default (bare-unstyled = defect). Palette bound to Obsidian CSS vars, light/dark fallback, ⊥ hardcoded dark-only. Correct dark+light, mobile+desktop, tap targets ≥ 40px.
V19: reward card shows counts + remaining servings; `Purchased` (pending) ⊥ mistakable for `Claimed` (done) — distinct badge + tint.
V20: file layout per §I. Base folder configurable via settings (default `mille-feuille`); filenames & structure fixed. Ledger split 1 file/month → small reads, closed months trim independent. wallet.md `balance` = cache, source of truth = ledger sum (V6), recomputed on load. Plugin `data.json` holds transient only (e.g. last-scan cursor), ⊥ economy state (V17).
V21: add-reward form = own sidebar screen (view swap in plugin leaf, ⊥ modal); back control → home. Submit → create `type: reward` note (V17 storage). Hand-authoring note stays valid (form additive, ⊥ gate).
V22: form fields — `name` (text), `price` (chips), `servings` three-way: One-off (`1`) | N-times (`N≥2`) | Infinite (`-1`), default One-off; + optional purchasable fields (V25). Auto-init on create: `purchasedCount:0, claimedCount:0, openPurchaseDates:[], state:available` — ⊥ exposed in form (plugin-owned).
V23: form validation inline on blur — `name` non-empty & unique (⊥ existing reward-note slug collision); `price` int ≥1; `N` int ≥2 in N-times mode. Create disabled until valid. Filename slugged from `name` (e.g. `<base>/rewards/spa-day-out.md`); slug collision = uniqueness check.
V24: creating reward ⊥ credit chips (anti-loop, per V3).
V25: purchasable metadata inert to economy (⊥ price/payout/buy/claim/aggregate/state). `isPurchasable` bool — omitted when false/absent, written only when true. `purchaseUrl` valid only when `isPurchasable:true`; form requires `http(s)://` before Create in that mode, may be omitted (added later). `purchaseUrl` present → card shows `View item ↗`; opening ⊥ touch chips/state. Both top-level frontmatter for Dataview filter.
V26: chip credit (task/subtask/habit) → toast `Earned +<n>🪙`. Crit → append ` ✦ critical hit!` (actual paid amount, post-multiplier). Obsidian `Notice`. Ex: `Earned +2🪙` | `Earned +22🪙 ✦ critical hit!`.
V27: toast catalogue — event → copy (`<name>` = reward name, `<n>` = chips). Readable phrasing, no dot/em-dash except real separators:
- milestone credit → `Milestone hit! +<n>🪙` (+ ` ✦ critical hit!` on crit) — replaces plain mint for milestone source
- uncheck/reversal → `Undone, −<n>🪙 returned`
- purchase → `Bought <name> for −<price>🪙`
- claim → `<name> claimed, <random enjoy line>` (uniform pick from enjoy set)
- reward added → `Added <name> to the shop for <price>🪙 🛒`
- reward deleted → `Removed <name> from the shop`
- purchase refused (no capacity) → `<name> sold out, no servings left`
- final claim → sold-out → `<name> fully claimed 🎉`
- affordability crossing (V28) → `You can now afford <name> (<price>🪙) ✨`
- first chip ever (balance 0 → first credit) → `First chips minted, the bakery opens 🥐`
- monthly review rolled (T9) → `Monthly review ready, <n>🪙 earned this month`
- enjoy set: [`enjoy it you earned this 🍰`, `go treat yourself ✨`, `no guilt you did the work 🍪`, `fresh out the oven enjoy 🥐`, `cashed in enjoy! 🎉`]
V28: affordability toast fires once on upward crossing `balance` `<price → ≥price` per reward w/ capacity left. Track per-reward `wasAffordable` bool; fire on false→true only. ⊥ fire when sold-out, ⊥ on load (recompute silent), ⊥ re-fire until balance drops below then re-crosses. Not persisted.
V29: crit streak — track consecutive crit count across ALL credit sources (task/subtask/milestone/habit; milestone crits count). Streak reaches 2 → toast `Double crit! 🔥`; each further consecutive crit → `Crit streak x<k>! 🔥`. Non-crit credit resets streak to 0. Streak toast in addition to mint/milestone toast.
V30: scan scope — settings `scanInclude` (folder prefixes, empty = whole vault) & `scanExclude` (prefixes). Line creditable iff file `inScanScope`: base folder always excluded, exclude beats include, prefix match at path boundary (⊥ substring). Own data folder never scanned. **(changed v0.6)** `gaming.folder` always out of scope, even when ∈ `scanInclude` (V65). User ⊥ turn off. Base-folder exclusion & include/exclude precedence unchanged ∀ other folder.
V31: toast copy from editable templates in settings (`messages`), not hardcoded. `{{key}}` → context value; absent key → empty string (⊥ literal `{{…}}`); braces tolerate inner whitespace; plain-text sub, no logic. `{{crit}}` = `critSuffix` template when crit fired else empty. `claim` = list of templates, uniform random pick, add/edit/delete in settings (⊥ reorder — order cosmetic under random pick); empty list → default list. Blank message → default (toast ⊥ blank). Per-message reset-to-default. Templating changes copy only — ⊥ alter when toast fires, variable values, or economy; editing ⊥ credit chips. Per-event vars per design-spec Req 16 table.
V32: rescan command "Rescan vault for completed tasks" → walk ∀ in-scope md file (§V30 scope) thru `reconcileLine`. Idempotent vs ledger (`isCredited`) — no re-credit, no crit re-roll (V13). Backfills credits missed while plugin off. Already-reversed key stays reversed (⊥ re-credit). Run `afterCredit` once at end iff any moved chips.
V33: auto monthly roll on load — `onLayoutReady`, ∀ closed month (< current `YYYY-MM`) w/ ≥1 credit ledger entry & ⊥ existing aggregate row → roll it (V16), oldest-first. Current (open) month ⊥ rolled. ⊥ duplicate existing aggregate rows. Manual `roll-monthly` command stays. Monthly toast (V27) ⊥ fire on auto-roll (silent backfill).
V34: panel shows current-month stats row, read FROM ledger (V16 `aggregate` over `today().slice(0,7)`), ⊥ from reward notes. Shows chips earned this month, claimed count, crit count. Recomputed live on `refreshViews`, ⊥ persisted apart from ledger. Empty month → zeros, row ⊥ hidden. **(changed v0.6)** row keeps 3 tiles, ⊥ gaming tile. Gaming separation lives in aggregate (V16) + monthly review, ⊥ panel.

### §V new — v0.5 shop-gacha (from design-spec)

V35: signed spend + new-only migration. `SpendEntry.chips` signed. `balance()` adds it: `e.chips` when present else 0. ⊥ date gate, ⊥ data migration. Pre-fix spend no `chips` → counts 0, stays free. Only post-fix spend lowers balance.
V36: no negative balance. ∀ chip-spending txn (purchase | gacha roll) checks balance first, refused when cost > balance. Balance never < 0.
V37: master enable guard. Check `gacha.enabled` first — before ∀ gacha txn (roll|rebate|free grant) & before showing any gacha UI. Off → no gacha section, no gacha config fields, gacha txn does nothing. Also off when sum(weights)==0 | `outcomes` empty.
V38: weighted roll. At roll, weights→probabilities `p = weight / sum(weights)`, select 1 result. `rebate_small`|`rebate_big` returns `value` chips, net = `-cost + value`. `nothing`|`free_reward` add 0.
V39: daily limit (SPEC addition). Count today's rolls FROM ledger: spend where `subtype=="gacha"` & `reward` absent & `date`==today. ⊥ stored counter, resets on date change. Refuse roll when `maxRollsPerDay > 0` & todayCount ≥ `maxRollsPerDay`. Check daily limit BEFORE balance.
V40: roll entry. Roll writes 1 spend: `subtype "gacha"`, `chips = -cost + rebate`, `outcome`, ⊥ `reward`. Rebate in same entry, never separate credit. Gacha writes ⊥ credit → earn stats ⊥ show roll, only raw balance moves. Roll may net positive (design B).
V41: gacha separate in aggregate. `aggregate()` ⊥ count gacha spend in `purchased`; reports `gachaRolls`,`gachaRebated`,`gachaClaims` (§I). Gacha never in `chipsBySource`,`chipsByTier`,`critCount`.
V42: conditional section. Gacha section at top of shop, heading `🎰 Gacha`, thin divider below/above reward list. Shown only when `gacha.enabled`. Visibility = presence of whole section. ⊥ collapse control.
V43: roll button + disabled states. Label `Roll Gacha (X chips)`. Tap target ≥ 40px. Two disabled states, two tooltips: balance < cost → disabled+dim, `Not enough chips`; daily limit reached (not unlimited) → disabled, `No rolls left today`. When limit applies (not unlimited) label = `Roll Gacha (X chips) · n/max today`; hide counter when `maxRollsPerDay`==0. Button locked during reveal anim (stops double spend). Reduced-motion path immediate → needs no lock.
V44: tiered reveal (CSS + emoji only, ⊥ libs). Section shake ≤ 300ms, then per-result treatment. Placeholder holds reveal area before roll (⊥ layout jump), text `Roll the gacha to see your luck.`. Result stays until next roll | leave screen. Treatments:
- nothing: small, teasing, gentle fade. text random ∈ {`Nope! LMAO 🤣`,`Nope! 🤣`,`Better luck... nah 💀`,`Empty. Skill issue.`}
- rebate_small: coin bounce, colour `--mf-coin`. text `+X chips! 🪙`
- rebate_big: coin shower|scale-pop, brighter. text `+X chips!! 🎉`
- free_reward: full centred burst overlay, scale-in. text `JACKPOT! 🎉 Pick your reward!` → picker opens (V51)

  small|big split from outcome table. `nothing` text random per roll.
V45: jackpot overlay ≠ banned modal. Free-reward celebration = overlay, short, ⊥ block user, carries ⊥ decision. On-screen = `gacha.jackpotPopupMs` (default 3000ms). Tap dismisses sooner. After overlay → picker opens. ⊥ the ConfirmModal picker PRD bans. Reduced-motion → short handoff ~400ms, ignores setting.
V46: free reward w/ empty pool. `free_reward` occurs but no reward has capacity → result becomes `nothing`. Roll stands, chips spent, daily limit used. ⊥ change screen. ⊥ pre-check pool (would leak table info). Reveal shows teasing headline `Free reward!`, then `No rewards, huh? LOL too bad 🤣`, then dim honest hint `Every reward is sold out or at capacity — nothing to grant.` Picker opens only w/ non-empty list.
V47: reduced motion + sound. All motion inside `@media (prefers-reduced-motion: no-preference)`. Reduced → immediate text change, ⊥ shake/burst; jackpot → straight to picker. ⊥ sound.
V48: free win = open purchase, no cost, claimed later. Free reward = open purchase in "Waiting to claim" queue, granted at 0 chip cost. User claims later via usual claim flow (V8). ⊥ immediate claim.
V49: grant marker. At pick, write spend `{reward: X, price: 0, subtype: "gacha", outcome: "free_reward"}`. ⊥ `chips` → counts 0 in balance. `subtype "gacha"` → aggregate ⊥ count in `purchased`. Gacha-origin proof on this marker. Later claim = normal `{kind:"claim", reward:X}`, ⊥ `source`.
V50: `grantFree` helper (new, pure). ⊥ reuse `purchase()` (it checks balance can pay `r.price` → would refuse free win for broke user). Add to `rewards.ts`:
```ts
/** Free grant: an open purchase at no cost. It checks capacity only. */
export function grantFree(r: Reward, today: string): boolean {
  if (!hasCapacity(r)) return false;
  r.purchasedCount++;
  r.openPurchaseDates.push(today);
  r.state = deriveState(r);
  return true;
}
```
V51: picker screen. `Screen` type → `"home" | "add" | "picker"`. `render()` gets `"picker"` branch, same screen-swap as `"add"`. ⊥ modal. Header `Choose your free reward`. Lists ∀ reward w/ capacity, ignores price+balance (free), sorts like shop. Card compact, reuses `.mf-card`; shows `Free` badge in place of price+buy button. On select → `grantFree(r, today)`, write grant marker, write reward note, screen→`"home"`, render. May show 150ms pulse on chosen card before swap. Back button forfeits win (⊥ grant, ⊥ refund; roll cost stays spent). Picker reached only after `free_reward` roll. ⊥ nav button to picker.
V52: reward metadata model. `Reward` gets optional `desc` (≤280 chars) + `emoji`. Both top-level (Dataview), omit when absent. Pattern of V25.
V53: emoji validation. Valid emoji = exactly 1 emoji grapheme (family 👨‍👩‍👧, flag 🇮🇩, skin-tone 👍🏽 each = 1). Refuse text, >1 emoji, empty. Pure helper in `rewards.ts`, form reuses:
```ts
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u; // +keycap mark, B1
export function isSingleEmoji(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const g = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)];
  return g.length === 1 && EMOJI_RE.test(t);
}
```
  Obsidian (Electron) has `Intl.Segmenter`. Field optional → empty valid. Invalid → inline error, stops save (pattern V23).
V54: card visual slot + order. Applies to shop card + queue card, ⊥ ledger row. Slot = thumbnail square. Order thumbnail → emoji → nothing:
- `thumbnail` present → `<img>` as today, `onerror` removes broken image.
- `thumbnail` absent & `emoji` present → emoji tile `<div class="mf-thumb-emoji">`, large centred emoji in same square. Card gets `has-thumb` layout.
- both absent → nothing in slot, text-only card as today.

  Slot chosen from data only, ⊥ from runtime image state. Broken thumbnail → text-only; emoji ⊥ appear as fallback for broken image.
V55: desc line + CSS clamp. Card shows `desc` below name, inside `mf-card-body` below `mf-top` row, `<div class="mf-desc">`. Clip 2 lines via CSS: `-webkit-line-clamp: 2`, `overflow: hidden`, `display: -webkit-box`, `-webkit-box-orient: vertical`. ⊥ JS char count, ⊥ `Platform.isMobile` check. Clamp counts lines, reflows any width. Omit element when `desc` absent.
V56: form fields. `FormState` gets `desc` (string) + `emoji` (string). `blankForm` sets each "". `formFrom(r)` sets `desc`=`r.desc`||"", `emoji`=`r.emoji`||"". Add Emoji field = single-line `<input>`, inline error from `isSingleEmoji`, stops save. `valid()` gets `emojiOk = !f.emoji.trim() || isSingleEmoji(f.emoji.trim())`. Add Description field = `<textarea maxlength="280">`, ⊥ live counter (`maxlength` sets limit). On save write each field only when non-empty.
V57: metadata regression. Reward w/ neither `desc` nor `emoji` → same card as before. Metadata ⊥ change economy (price/payout/buy/claim/aggregate/state). Same as purchasable fields V25.

### §V new — v0.6 gaming ledger (from design-spec)

V58: master enable guard. Check `gaming.enabled` first — before panel section, before settings fields, before command response, before writing note|task. Off → settings show toggle only, panel ⊥ gaming section, ∀ command no-op. Toggle rebuilds tab via `this.display()`. (Pattern V37.)
V59: note holds raw stats only (§I). ⊥ score, ⊥ chips stored. System derives both per read ∴ threshold|band change re-scores ∀ pending match. Batch already covered keeps chips (V64).
V60: threshold list. Setting `thresholds` = text, 1 line = `stat op value : points`. Sum points of ∀ passing line — passing lines stack (= PRD groups). Rules:
- `stat` ∈ {`deaths`,`farm`,`damage`,`points`,`ray`,`focus`}; `op` ∈ {`<=`,`>=`,`==`,`<`,`>`}.
- `ray` val ∈ {`secured`,`stolen`}; `focus` val ∈ {`yes`,`no`}; else integer.
- `damage` compared in thousands (note stores thousands).
- `farm` line ⊥ pass when `Lv` blank (never reached Rayquaza ∴ farm threshold ⊥ true).
- Unreadable line skipped silently — ⊥ error, ⊥ stop.
- Empty list → score 0 ∀ match.
V61: band table. Setting `bands` = text, 1 line = `from-to : chips` | `N+ : chips`. Read in order, first band holding score wins. Score ∉ any band → 0 chips. Chips never < 0. Per-match cap = largest chips in table; default 5.
V62: log screen. `Screen` gains `"match"`. Replaces panel leaf content, same as `"add"`. ⊥ modal. Parts:
- header: Back control + title `Match <n> · <session>`.
- live readout: score, chips, meter 1 mark/chip up to cap.
- Pokémon control: recent names of session folder as choice row + text field for new name (V83).
- 4 numeric fields: deaths, level at Rayquaza, damage (thousands), points. Each accepts typed number **&** step-button pair. Step: damage 5, points 10, others 1.
- 3-way Rayquaza control: `Lost it` | `Secured` | `Stole it`.
- focus goal toggle.
- list of passing thresholds w/ points each.
- Cancel control + Save control.
V63: Process pays 1 batch. Run reads matches after index `processed` = pending. Order:
1. count pending, sum their chips.
2. write 1 task in `gaming.taskFile` — line holds session id, batch ordinal (after 1st), payload ` · gaming:<chips>`; sublines hold count, row range, scores.
3. raise `processed` to count of note matches.

  Batch never holds match of another batch. Run writes ⊥ ledger entry.
V64: batch chips frozen. Task carries its total; existing scan pays it on tick. ∴ threshold|band change ⊥ alter covered batch (pending only); row edit inside covered batch ⊥ repay; paid state derived from `processed`, ⊥ per-match flag.
V65: gaming folder ∉ scan scope, always. True even when `scanInclude` lists it. Reason = anti-loop V3 (match note holds checkboxes + table rows). User ⊥ disable.
V66: gaming chips separate in aggregate. Credit carries `source "gaming"` → `chipsBySource.gaming`. ⊥ added to task|subtask|habit totals, ⊥ `chipsByTier`. Answers monthly-review question gaming-vs-other-work. Panel ⊥ show separation (V34).
V67: payout floor. Worst match = 0 chips. Match never negative; default thresholds hold ⊥ negative points. Score-0 match still a match — row stays in note, counted in batch `Matches`.
V68: zero-chip batch. Pending count == 0 → run does nothing. Pending count > 0 & total chips == 0 → run writes task; credit entry carries 0 chips.
V69: section + rows. `details` element, heading `🎮 Gaming`, between "Waiting to claim" queue & gacha section. Summary line: match count of session + batch count. Body: session id, pending chips, covered chips, 1 row/match, `+ Log match` control, Process control. Row shows number, Pokémon, meter 1 mark/chip, score, chips. Uses existing stylesheet tokens, ⊥ own colour (V18). Covered row dim, pending row bright — state ⊥ from colour alone: row has tooltip & section head states both totals in words.
V70: empty + collapsed state. Section open when session has ≥1 match, closed when 0. State from data per render — ⊥ stored, ⊥ setting. Session w/ 0 matches: summary reads `no matches yet`; body = 1 line text + `+ Log match`; pending total, covered line, note line, Process control **absent** (⊥ disabled Process control — nothing to explain when nothing to process). First logged match reopens section.
V71: numeric field behaviour. Typed value & step button write same state. Clamp ∀ value to field range. Level field accepts empty = never reached Rayquaza. Non-digit chars removed. ⊥ redraw field while focused (redraw moves caret).
V72: Save & Back on log screen. Save appends 1 row to today session note, creates note when absent, ⊥ change `processed`, clears fields for next match, keeps screen open. Back & Cancel → home screen, write nothing.
V73: Process control state. Label shows pending count + chips, e.g. `Process 3 · +8`. Pending == 0 → disabled, label `Nothing new`. Match logged after run → count > 0 again, control active for new matches only.
V74: untick ⊥ release batch. Existing reversal path (V14) returns chips. `processed` ⊥ decrease, batch stays closed. Re-tick re-applies frozen amount (as habit line). Repay = hand-lower `processed` in note. Rare, visible, deliberate. System gives ⊥ control for it.
V75: unreadable row. Skip table row system ⊥ parse. Count skipped rows/session, show count in section note line, e.g. `1 row unreadable`. Skipped row ⊥ a match — ∉ row numbers, ∉ batch count, pays nothing.
V76: session focus goal. `promptFocus` default true. True & note has ⊥ `focus` value → log screen asks once for that session, writes answer to frontmatter. 1 line text. Goal ⊥ affect score — threshold `focus == yes` reads row `F` cell, ⊥ frontmatter. Empty goal allowed ∴ ⊥ ask again that session.
V77: classifier reads gaming payload. `classify()` ([economy.ts:36](src/economy.ts)) gains 1 branch: line holding ` · gaming:<n>` (`<n>` integer ≥0) → source `"gaming"`, base `<n>`. Middot rules follow habit tier (V12):
- Regular task never holds middot. Gaming line & habit line disjoint — line holds ` · gaming:<n>` | ` · <tier>`, ⊥ both.
- Gaming line ⊥ milestone tag (`#x2`/`#x3`/`#x5`). Payload = amount; multiplier on top ∉ design.
- Unreadable payload → line = regular task, pays `defaultBase`. System always writes readable payload ∴ only after hand edit.
V78: gaming credit rolls crit. Scan calls `payout()` ∀ source ∴ gaming credit rolls same `critChance` + multipliers (V2). Crit applies to batch total, ⊥ single match. Counts in `critCount` & crit streak (V29). 5-chip cap = per-match cap, ⊥ per-batch cap.
V79: older unprocessed session surfaced. Panel shows today session in full. ∀ older session w/ pending matches → 1 compact line above: session id, pending count, pending chips, own Process control. Compact line ⊥ show per-match rows (note holds detail). Section heading shows pill w/ older-session count, form `1 unprocessed day` (pattern of stale pill V11). Pill + compact lines absent when ∀ older session clear.
V80: date of late batch. Credit entry `date` = ✅ date (scan owns entry). Session of Monday ticked Tuesday → credits Tuesday. Session date stays in task line + note. Gaming code ⊥ write credit w/ own date (would break V3). Across month end, late batch chips ∈ month of tick — same as ∀ other source incl late habit.
V81: ⊥ cutoff on session age. ∀ session w/ pending matches offered, any age. Never drop pending matches, never expire session. Compact line (V79) shows age in days when session older than `economy.staleAfterDays`, form `35 days ago`. Reuses existing knob — ⊥ 2nd knob. User who ⊥ want chips deletes note.
V82: 1 task/session, ⊥ combined task. Panel Process run pays session of its own control. Command `Process gaming session` sweeps ∀ session w/ pending matches, oldest-first, 1 task each. ⊥ 1 task for 2 sessions — freeze (V64) is per session per batch, combined task ⊥ reversible for 1 session alone.
V83: Pokémon list on log screen. Show 8 most recent names from notes of `gaming.folder`, newest-first, as choice row. Plus text field for name ∉ row. System holds ⊥ list of game names (needs maintenance per game release). Name = free text, ⊥ corrected.

### §V new — v0.6.1 defect fix

V84: `gaming.taskFile` ! in scan scope while `gaming.enabled`. Exact-path match → creditable, checked BEFORE base|gaming|exclude|include rules. Reason: taskFile = plugin-written payload carrier (V63,V77); it may legally sit inside `gaming.folder`, which V65 makes unscannable ∴ overlap kills payout path silent (⊥ credit, ⊥ toast). Exemption = 1 exact file path, ⊥ folder — ∀ other file in `gaming.folder` stays excluded, V65 intact. `gaming.enabled` false → ⊥ exemption.

V85: ledger snapshot ! re-read when ledger file changes under us. LiveSync replicates AFTER plugin load ∴ `entries` loaded at `onLayoutReady` = pre-sync ledger ∀ rest of session. Stale snapshot → `isCredited` false for credits already banked → ∀ synced task file paid 2nd time (flood). Modify under `<base>/ledger/` → `reload()` + wallet cache rewrite, ⊥ scan. Checked BEFORE scope (ledger ∈ base, which V30 excludes). Debounced 1500ms — sync pulls month files in burst, each reload re-reads whole folder. Reload skipped while ledger write in flight (would drop unflushed entries → they look uncredited → double-pay).
V86: reversal ! evidence of human edit. Obsidian fires `modify` same for keystroke & LiveSync write, ⊥ flag to tell apart. Blast radius asymmetric: wrong credit inflates wallet (correctable), wrong reversal destroys real completion + its chips. ∴ reverse branch gated on `getActiveFile()?.path === f.path`; credit branch ungated (tick from Tasks/Dataview query view writes non-active source file, ! still pay). Missed reversal recoverable via rescan (V32), which passes gate open — user asked explicitly.
V87: 1 ledger write-lane per device. `ledger/<yyyy-mm>.<device>.md`. `wallet.md` ⊥ suffixed — pure cache, ⊥ read back; lost revision costs 0 (next credit|post-sync reload rewrites it) & post-V85 both devices sum same files ∴ write same number ∴ ⊥ conflict. Split justified only where lost revision loses data. 2 devices writing 1 path + whole-file read-modify-write → LiveSync doc conflict → keeps 1 revision entire → loser's spend|claim rows gone. Device id ∈ localStorage (`loadLocalStorage`/`saveLocalStorage`), ⊥ `data.json` — data.json replicates when LiveSync hidden-file sync on ∴ id there syncs & both pick same lane. Optional user label (filename-slugged) else random 6-char id, minted once. `Platform.isMobile` rejected: ≥2 desktop devices per vault → 2 buckets still share lane. Filename = write-lane, ⊥ identity: `readLedger` unions ∀ `.md` ∈ ledger folder ∴ regenerated id → extra file, ⊥ lost row. Legacy `<yyyy-mm>.md` still read.
V88: ledger file = markdown table, 1 row/entry. Cols `date|kind|ref|source|tier|base|crit|chips|note`. `ref` = key (credit) | reversalOf (reversal) | reward (spend,claim). `note` = `k=v` extras (price, subtype, outcome, value). Empty cell = absent, ⊥ `""`|0 — spend `reward`,`chips`,`price` genuinely optional (V35,V40); credit `tier`,`crit` empty = null. Pipe ∈ key escaped `\|`. Reason: JSON array append rewrites ∀ line after last `}` ∴ ⊥ line-merge possible on conflict; table append = 1 added line + human-legible for hand resolution. Reader accepts legacy json block ∴ ⊥ migration step, ⊥ data rewrite. Strict variant throws on unreadable non-empty file (⊥ overwrite → would wipe purchases).

V89: ledger read order canonical ∀ device = (date, file path, row index). `getMarkdownFiles()` order ⊥ guaranteed equal across devices & sort on `date` alone leaves same-date rows tied — `Array.sort` stable ∴ ties keep that arbitrary input order. Readers resolving a key by position (`frozenChips` = last credit row for key, `aggregate` walks in sequence) then pick different winners per device → different crit, different chips. Fix: sort files by path (codepoint, ⊥ `localeCompare` — collation locale-dependent = same disagreement back) before parse, stable date sort on top. `unionLedger` ∈ table.ts (pure, testable — store.ts ⊥ importable, obsidian pkg = types only). Legacy unsuffixed `<yyyy-mm>.md` sorts deterministically vs device-suffixed siblings. Prerequisite: read-time dedupe convergent only if ∀ device agrees which duplicate wins.

V90: credit portion of ledger = set keyed by `key`, resolved at read time. 1 completed task credited 2x (58 keys, ~128 chips over-credited, crit rolls diverge ∴ devices disagree on total). V85 closes staleness WITHIN session, ⊥ orders 2 independent files vs each other: LiveSync hands hydra the task file before strayfe's ledger file ∴ `isCredited` legitimately false at write time. Which lands first ⊥ observable ∴ ⊥ write-side guard closes window; scan-time dedupe asks same stale question. Key unique by construction (task path + ✅date | `id·tier·doneDate`) & V32 keeps reversed key reversed ∴ 2nd credit row for a key = always noise. `dedupeCredits` drops any credit whose key already seen; 1st row in V89 canonical order wins ∴ same survivor ∀ device. Applied AFTER `migrateHabitKeys` — migrating a legacy untiered key can itself collide with an already-tiered row. spend|claim|gacha ⊥ deduped: repeatable events, no key (5 identical purchases = 5 real purchases). Reversal matches `reversalOf` vs key ⊥ row ∴ unaffected. ⊥ repair pass: `wallet.md` = write-only cache (no `readWallet` ∈ src), balance always recomputed from `entries` ∴ dedupe propagates on next load. Rejected: balance = Σ closed-month aggregates + current ledger — promotes conflict-prone `aggregates.md` to balance input, 2nd definition that can disagree, buys 0 (⊥ trim exists). Ceiling: dupe rows stay on disk, bounded, ⊥ correctness cost.

V91: 1 aggregates write-lane per device — `aggregates.<device>.md`, same split as V87's ledger. `aggregates.md` was last unsplit write path ∈ base folder: whole-file read-modify-write of a json block, ⊥ line-mergeable (V88) ∴ LiveSync doc conflict keeps 1 revision entire, loser's rows gone. `readAggregates` unions ∀ `aggregates*.md` ∈ base folder root (legacy unsuffixed included), path-sorted (V89), collapsed to 1 row/month, 1st wins — post-V90 ∀ device derives same row from same deduped ledger ∴ winner only matters for pre-V90 rows. Severity low by construction: aggregates ⊥ input to balance (V6 balance = Σ ledger) & only consumer of `readAggregates` reads `.month` — the view computes live stats from `entries` ∴ a lost|stale row costs display of an archival record, ⊥ correctness. Recovery already existed: V33 re-rolls any closed month w/ credits & ⊥ aggregate row, & ⊥ trim ∈ src ∴ ledger source always present.
V92: stale aggregate re-rolled on load. Month rolled BEFORE V90 baked duplicates into its stored row (inflated `chipsBySource`, `critCount`) & V33 `missingClosedMonths` skips any month already present ∴ ⊥ revisit ever. Aggregate = pure fn of ledger & ⊥ path deletes closed-month rows ∴ recompute always safe. ∀ closed month ∈ THIS DEVICE's own rows: recompute, write if ≠ stored. Own rows ⊥ union — comparing vs union makes a device rewrite every load while the other device's copy stays stale; own-file compare settles in 1 pass per device. Open month skipped (still moving). Preferred over a force-re-roll command: ⊥ prompt UI ∈ plugin & correction ⊥ needs user to know it's needed.

V93: duplicate credit rows pruned from disk on load, closed months only, own lane only. V90 makes them stop counting, ⊥ removes them (58 rows ∈ 2026-09 alone). 2 hard constraints: (a) closed month only — an open month still takes appends, & rewriting from a base a queued append already moved is V13's double-pay bug; a closed month is quiet ∴ safe. (b) own `<month>.<device>.md` only — pruning another device's file puts 2 writers back on 1 path = exactly the conflict V87 split to escape. ∴ each device drops only ITS losers; month fully pruned once both ran. Legacy unsuffixed file ⊥ owner ∴ never rewritten. Winner rule = V90's, applied per file in V89 canonical order ∴ prune result ≡ read-time dedupe result. Strict parse: unreadable file aborts prune ⊥ reads empty (would wipe purchase history). Scoped by `duplicateCreditMonths` measured at load BEFORE the collapse ∴ clean vault reads 0 extra files. Idempotent: 2nd run drops 0, writes 0.
V94: `recompute-wallet` command = `reload()` + `writeWalletCache(balance())`. wallet.md = write-only display cache (V87, ⊥ `readWallet` ∈ src) ∴ can look wrong (LiveSync kept other device's revision), never BE wrong. Rescan (V32) & plugin reload already recompute it; this is the door that ⊥ walks the vault.

## §T

id|status|task|cites
T1|x|task scan & completion detect on done transition|V1,I.file
T2|x|milestone parse `#x2`/`#x3`/`#x5`, respected any depth, nesting ⊥ matter|V5
T3|x|payout deterministic base + crit roll|V2
T4|x|milestone payout = per-task multiplier, no subtask relation|V4,V5
T5|x|chip wallet: balance = sum ledger, credit only on completion|V3,V6
T6|x|reward registry two-state repeatable flow vs servings|V7,V8,V9,V10,I.file
T7|x|stale-reward surfacing oldest open > staleAfterDays|V11
T8|x|config-first economy, editable via plugin settings tab|V15,I.config
T9|x|calibration aggregates rolled from ledger by monthly pass|V16
T10|x|store rewards/wallet/ledger/aggregates as vault files, base folder configurable|V17,V20,I.file
T11|x|UI state clarity: counts, servings, distinct Purchased vs Claimed|V18,V19
T12|x|mochi habit bridge: scan shared line, classifier, freeze, reversal|V1,V12,V13,V14
T13|x|palette tokens + component states dark+light mobile+desktop|V18
T14|x|add-reward form: sidebar screen, validation, create note w/ auto-init|V21,V22,V23,V24
T15|x|purchasable metadata: isPurchasable/purchaseUrl inert, View item link|V25
T16|x|toast on chip mint, crit indicator ✦ critical hit!|V26
T17|x|toast catalogue: milestone/refund/purchase/claim(random)/added/deleted/sold-out/first-chip/monthly|V27
T18|x|affordability-crossing toast, once per upward cross, debounced|V28
T19|x|crit-streak tracking + Double crit!/streak toast|V29
T20|x|scan scope filter: include/exclude folders in settings|V30,I.config
T21|x|editable toast templates {{var}} + claim-list CRUD + reset-to-default|V31,I.config
T22|x|rescan-vault command: walk in-scope files thru reconcileLine, idempotent backfill|V32,V30,V13,I.cmd
T23|x|auto monthly roll on load for missing closed months, silent|V33,V16
T24|x|panel current-month stats row from ledger aggregate|V34,V16
T25|x|signed `SpendEntry.chips`; `balance()` adds spend; purchase writes `-price` & refuses when balance too low|V6,V7,V35,V36
T26|x|add `gacha` config key + settings tab; toggle always shown; hide cost/table/limit/popup when off; rebuild via `this.display()`|V37,V42,I.config
T27|x|roll engine: weights→probabilities, select result, daily limit from ledger, write net-chips spend entry|V38,V39,V40
T28|x|keep gacha separate in `aggregate()`; add `gachaRolls`/`gachaRebated`/`gachaClaims`; show `gachaClaims` in month row|V16,V41
T29|x|shop gacha section, roll button, two disabled states, counter|V42,V43
T30|x|tiered CSS reveal, jackpot overlay, empty-pool result, reduced-motion path|V44,V45,V46,V47
T31|x|`grantFree` helper, `"picker"` screen, grant-marker entry, forfeit on Back|V48,V49,V50,V51
T32|x|`isSingleEmoji` helper + 1 self-check|V53
T33|x|`Reward.desc`/`Reward.emoji` fields, card slot order, `.mf-thumb-emoji` + `.mf-desc` clamp styles|V52,V54,V55,V57
T34|x|Emoji input, Description textarea, validation|V56
T35|x|`gaming` config key + settings section: master toggle, folder, taskFile, tag, promptFocus. ⊥ grouping, ⊥ autoProcess. Toggle rebuilds via `this.display()`|V58,I.config
T36|x|threshold parse/serialize + `scoreOf(match, thresholds)` + 1 self-check|V59,V60
T37|x|band parse/serialize + `chipsOf(score, bands)` + 1 self-check|V61,V67
T38|x|2 textarea settings (thresholds, bands), each w/ reset control + parsed-count line|V60,V61
T39|x|match note read/write: frontmatter, raw-stat table, skip unreadable row|V59,V75,I.file
T40|x|`"match"` screen: 6 fields, typed + step buttons, clamps, live readout, passing-threshold list|V62,V71,V72,V18
T41|x|Process run: pending slice, task line w/ ordinal + ` · gaming:<chips>` payload, human sublines, raise `processed`|V63,V64,V68
T42|x|panel gaming section: rows, 2 totals, Process control states, dim covered row, unreadable-row count|V69,V73,V75,V18
T43|x|section empty + collapsed state|V70
T44|x|permanent exclusion of `gaming.folder` from scan scope|V30,V65
T45|x|`"gaming"` source thru `aggregate()`; keep out of task/subtask/habit totals; panel row stays 3 tiles|V16,V34,V66
T46|x|focus-goal prompt + `focus` frontmatter field|V76
T47|x|3 commands; `Process gaming session` sweeps ∀ pending session oldest-first|V58,V82,I.cmd
T48|x|`classify()` gaming branch: ` · gaming:<n>` → source `"gaming"`, base `<n>` + self-check (gaming, habit, no-payload)|V77,V78
T49|x|surface older unprocessed session: pill, compact line + own Process control, age when > `economy.staleAfterDays`|V79,V81
T50|x|recent-Pokémon choice row from folder notes, cap 8, + free-text field|V83
T51|x|exempt `gaming.taskFile` from scan-scope exclusion, checked first|V84,V65,I.config
T52|x|reload ledger (debounced) on modify under ledger folder, skip while write in flight|V85,V13
T53|x|gate reverse branch on active-file edit; credit ungated; rescan passes gate open|V86,V14,V32
T54|x|device-local id in localStorage + settings label; device-suffix ledger path|V87,I.file,I.config
T55|x|markdown-table ledger format, legacy json still read|V88,I.file
T56|x|canonical ledger union order: files by path (codepoint) then stable date sort|V89,V87,V88
T57|x|dedupe credit rows by key on load, after habit-key migration|V90,V89,V32,V13
T58|x|device-suffix aggregates path, union + collapse by month on read|V91,V87,V89,I.file
T59|x|re-roll own stale closed-month aggregates on load|V92,V90,V33,V16
T60|x|prune duplicate credit rows from own closed-month ledger files on load|V93,V90,V89,V87,V13
T61|x|`recompute-wallet` command|V94,V32,V87

## §B

id|date|cause|fix
B1|2026-08-10|V53 `EMOJI_RE` missed keycap seq (`1️⃣`) — U+20E3 mark ∉ `Extended_Pictographic`, so own AC20 example failed|add `|\u{20E3}` alt to EMOJI_RE (V53)
B2|2026-08-19|`gaming.taskFile` ∈ `gaming.folder` (user layout `Collections/Gaming/Sessions.md`) → V65 folder exclusion swallowed task file → tick ⊥ credit, ⊥ toast. V65 forced folder out, nothing forced taskFile in|V84
B3|2026-08-29|LiveSync desktop↔mobile: wallet flooded w/ chips, spent chips reversed, reward purchases erased from history, wallet ≠ ledger. 2 defects compound — (1) `entries` read once at load, never after; replication lands later ∴ ∀ idempotency check runs vs pre-sync ledger → re-credit + spurious reverse. (2) both devices whole-file rewrite same `ledger/<yyyy-mm>.md` from that stale base → LiveSync conflict keeps 1 revision entire → other device's spend|claim rows gone|V85,V86,V87,V88
B4|2026-09-18|same completed task credited once per device — 58 duplicate credit keys, ~128 chips over-credited, crit rolls diverge ∴ devices disagree on balance. V85 fixed staleness within a session but ⊥ ordering between files: replicated task file can arrive before the other device's ledger file ∴ `isCredited` false at write time, credit correct given what device knows. Race ⊥ closable write-side|V89,V90
