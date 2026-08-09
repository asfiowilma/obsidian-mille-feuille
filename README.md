# Mille-feuille

Turn finished tasks into a reward you actually let yourself have.

Mille-feuille is an Obsidian plugin that pays you **chips** for completing tasks in your vault, then lets you spend those chips in a reward shop you define yourself. Complete a checkbox, earn chips (sometimes a critical hit for bonus payout), hit Fibonacci milestones for multipliers, and cash chips in on rewards you've registered — a spa day, a new game, an evening off — flowing through a two-state **Purchased → Claimed** loop so buying and enjoying stay separate acts.

Everything lives in your vault as plain notes. Zero network, no account, no paid API, no telemetry.

## Features

- **Chips for completed tasks** — every task you check off mints chips (configurable base payout).
- **Crit gacha** — a chance for each payout to critically hit for a multiplier bonus, with crit-streak toasts.
- **Fibonacci milestones** — completion streaks trigger milestone multipliers.
- **Per-task multipliers** — tag a task (`#x2`, `#x3`, `#x5`) to scale its payout.
- **Habit payouts** — dedicated payout tiers for habit sources.
- **Reward shop** — register rewards as vault notes (`price`, `servings`), browse and buy them with your chips.
- **Purchased → Claimed flow** — a two-state reward lifecycle so a bought reward is redeemed deliberately, not the instant you pay.
- **Repeatable rewards** — `servings` capacity: one-off, fixed N, or infinite.
- **Editable toasts** — every notification is a `{{var}}` template you can rewrite in settings.
- **Config-first economy** — the whole value curve is tunable from settings, no code changes.
- **Desktop + Android** — works fully offline on both (iOS not supported).

## Installation

### Via BRAT (recommended while in beta)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from the Obsidian community plugins.
2. Open BRAT settings → **Add Beta Plugin**.
3. Enter this repository URL:
   ```
   https://github.com/asfiowilma/obsidian-mille-feuille
   ```
4. Enable **Mille-feuille** in **Settings → Community plugins**.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/asfiowilma/obsidian-mille-feuille/releases).
2. Copy them into your vault at `<vault>/.obsidian/plugins/mille-feuille/`.
3. Reload Obsidian and enable **Mille-feuille** in **Settings → Community plugins**.

## Usage

1. Set your base folder and economy values in **Settings → Mille-feuille**.
2. Complete tasks (checkboxes) anywhere in your vault to earn chips.
3. Create reward notes with `type: reward`, a `price`, and `servings`.
4. Open the Mille-feuille view to browse the shop, buy rewards, and claim them when you're ready.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # typecheck + production build
npm test        # run tests
```

## License

MIT
