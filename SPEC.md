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
  - spend: `{date, reward, price}`.
  - claim: `{date, reward}` — no chip movement, feeds aggregates.
- **mochi bridge**: line `- [x] <id> · <tier> ✅ <date>` under `## Tasks`. Read by §I scan, no API/event/marker.
- **file layout** (base folder configurable in settings, default `mille-feuille`; filenames & structure fixed):
  - `<base>/wallet.md` — frontmatter `balance` (cached sum of ledger).
  - `<base>/ledger/<YYYY-MM>.md` — append-only entries, one file/month.
  - `<base>/aggregates.md` — permanent monthly aggregate record, 1 row/month.
  - `<base>/rewards/<name>.md` — one note/reward (§I reward note shape).

## §V

V1: ∀ completed checkbox (tagged|not, incl mochi habit line) → credit chips on transition to done.
V2: crit lives on payout magnitude only, ⊥ reward identity. Roll independent per task & per milestone payout. Applies uniform to task|milestone|habit.
V3: purchase|claim ⊥ credit chips (anti-loop). Only task/subtask/milestone/habit completion credits.
V4: milestone tag → pay `defaultBase × multiplier` (+own crit) for that one tagged task. Pure per-task multiplier — ⊥ relation to subtask payouts, ⊥ parent/child bonus, ⊥ on-top.
V5: task tagged `#x2`/`#x3`/`#x5` → milestone. Respected wherever tag sits, any hierarchy depth. Nesting ⊥ matter.
V6: balance = sum `chips` over credit + reversal entries. Unchecked completion nets 0.
V7: purchase allowed iff `purchasedCount < servings | servings == -1` → deduct price, `purchasedCount++`, append today→`openPurchaseDates`.
V8: claim FIFO → `claimedCount++`, pop `openPurchaseDates[0]`.
V9: `state` derived top-level: `sold-out` when `servings≠-1 & purchasedCount≥servings & openPurchaseDates==[]`; `purchased` when `openPurchaseDates` non-empty; else `available`. Affordability = `balance ≥ price`, computed live, ⊥ persisted.
V10: reward w/ open (purchased-not-claimed) occurrence → visible/queryable until claimed.
V11: oldest open `openPurchaseDates[0]` older than `staleAfterDays` → surfaced (anti-forget guarantee).
V12: habit classifier: line carries ` · <tier>`, tier ∈ {farm,ult} → `habitPayout[tier]`; else `defaultBase`. Regular tasks ⊥ use ` · ` middot. Habit lines ⊥ `#x2` tag (tier-match & milestone-tag disjoint).
V13: habit payout frozen per key `(id,✅date)` on first `[x]`. Rewrite idempotent — no re-credit, no crit re-roll. `[-]` & `[ ]` credit nothing.
V14: uncheck habit → reversal entry for exact recorded amount; re-check re-applies frozen amount (no crit re-roll).
V15: every economy param ∈ config object, edited via Obsidian plugin settings tab (⊥ raw file edit needed). Change → live, no recompile.
V16: monthly aggregates (chips by tier, purchased/claimed, open/stale count, crit count) produced FROM ledger, ⊥ from reward notes. Monthly pass rolls ledger → permanent aggregate; closed occurrences may then trim.
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
V30: scan scope — settings `scanInclude` (folder prefixes, empty = whole vault) & `scanExclude` (prefixes). Line creditable iff file `inScanScope`: base folder always excluded, exclude beats include, prefix match at path boundary (⊥ substring). Own data folder never scanned.
V31: toast copy from editable templates in settings (`messages`), not hardcoded. `{{key}}` → context value; absent key → empty string (⊥ literal `{{…}}`); braces tolerate inner whitespace; plain-text sub, no logic. `{{crit}}` = `critSuffix` template when crit fired else empty. `claim` = list of templates, uniform random pick, add/edit/delete in settings (⊥ reorder — order cosmetic under random pick); empty list → default list. Blank message → default (toast ⊥ blank). Per-message reset-to-default. Templating changes copy only — ⊥ alter when toast fires, variable values, or economy; editing ⊥ credit chips. Per-event vars per design-spec Req 16 table.
V32: rescan command "Rescan vault for completed tasks" → walk ∀ in-scope md file (§V30 scope) thru `reconcileLine`. Idempotent vs ledger (`isCredited`) — no re-credit, no crit re-roll (V13). Backfills credits missed while plugin off. Already-reversed key stays reversed (⊥ re-credit). Run `afterCredit` once at end iff any moved chips.
V33: auto monthly roll on load — `onLayoutReady`, ∀ closed month (< current `YYYY-MM`) w/ ≥1 credit ledger entry & ⊥ existing aggregate row → roll it (V16), oldest-first. Current (open) month ⊥ rolled. ⊥ duplicate existing aggregate rows. Manual `roll-monthly` command stays. Monthly toast (V27) ⊥ fire on auto-roll (silent backfill).
V34: panel shows current-month stats row, read FROM ledger (V16 `aggregate` over `today().slice(0,7)`), ⊥ from reward notes. Shows chips earned this month, claimed count, crit count. Recomputed live on `refreshViews`, ⊥ persisted apart from ledger. Empty month → zeros, row ⊥ hidden.

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

## §B

id|date|cause|fix
