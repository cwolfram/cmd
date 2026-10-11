# Spacing system

**Status:** built: steps 1–5 on branch `spacing` (2026-10-11); density and counting `--space-*` at a view's edges not yet.

One unit, a numeric scale of it, and roles on top that components read, so a change of inset or density is one token and every window follows. Builds on docs/40-window-design.md (the tokens, the kit, the audit) and the `window-design` skill (the rules). Written 2026-10-11, after a day of fixing spacing window by window.

## Why the current scale doesn't hold

The scale (`space.tokens.json`) is eight steps with t-shirt names: 2, 4, 6, 8, 12, 16, 24, 32. About 420 declarations read it, nearly all in `packages/ui` and Magic's kit. What went wrong on 2026-10-11, raising the content inset from 12px to 16px:

- **Components pick sizes, not roles.** `pad="lg"` in the settings sidebar, the Photos inspector and SQLite's panels; `--list-inset: var(--space-xs)` in the View body; `--list-inset: 6px` in a panel. Each was "the inset" written as a step, so each had to be found and changed by hand.
- **Relations are sums done in heads.** A list's text sits at the row's highlight margin plus the row's padding (4 + 8 = 12). The grouped list did the sum differently (0 + 8 inside a 16px body = 24) and Workspace Actions drifted 8px from the Navigator.
- **Sizes outside the grid.** Tall rows were 38px, headings 24px and 20px, the toolbar 31px, the footer and window bar 26px, the title bar 38px, `--dialog-pad` 20px, `.ui-toolbar` 34px. The tops of lists measured anywhere from 6px to 23px against a 12px rule.
- **Names that don't do arithmetic.** "Double the space" was `lg` → `3xl`, looked up, and a value between steps (14px) didn't exist. 6px (86 uses) is off the 4px grid the rest follows.
- **One size for every window.** A tile can be 260px wide; Settings beside its sidebar is a page. The same 16px fits neither: that's why `page-inset` and `bar-inset` appeared.

## The system

### 1. One unit, a numeric scale

A 4px unit. Steps are multiples of it, named by the multiple:

| token | `--space-0-5` | `-1` | `-1-5` | `-2` | `-3` | `-4` | `-5` | `-6` | `-8` | `-10` | `-12` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| px | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 |

The names are the familiar ones (Tailwind's). Twice `--space-4` is `--space-8`; a value between is the next multiple, added when a role needs it. The half steps (2, 6) stay for hairline gaps and controls' insides, where the old scale used them; nothing new lays out on them. In TSX, `Stack`/`Inline` take the multiple as a number: `gap={2}`, `pad={4}` (typed to the scale).

The steps are plain px for now (DTCG dimensions); when density comes (see 4) they become `calc(var(--unit) * n)` and a mode is a different `--unit`.

### 2. Roles, which components read

A component's stylesheet reads a role where one exists, and a step only for its own insides (an icon's gap to its label). Views read neither in CSS: they compose with `Stack`, `Inline`, `View` and the roles' props (`pad="inset"`).

| role | now | what it is |
|---|---|---|
| `--inset` | 16 | content from the window's edges, measured to the letters: padded bodies, list text, table edge columns |
| `--bar-inset` | 12 | a bar's items from its edges: window bar, footer, Magic's toolbars |
| `--page-inset` | 32 | a `Page` (Settings beside its sidebar); its View takes it as `--inset` |
| `--list-pad` | 8 | inside a list row's highlight, to its icon or text (and a heading's) |
| `--list-gap` | 2 | between rows, so highlights don't touch |
| `--list-icon-gap` | 8 | a row's icon to its label |
| `--section-gap` | 16 | between sections of a list, panes of an inspector |
| `--heading-gap` | 4 | a grouped list's section heading to its first row |
| `--dialog-pad` | 20 | a dialog's or sheet's edges (was a literal) |
| `--toolbar-pad` | 6 | the window toolbar's items from its edges (tighter on purpose, docs/40) |

### 3. Relations are tokens, not sums

What follows from the roles is written once:

- `--list-inset: calc(var(--inset) - var(--list-pad))`: a row's highlight reaches out of the inset by its padding, so its text sits on the inset. Every list (plain, grouped, nav, tree) uses it; grouped differs only in section gaps, nav in putting the highlight on the inset instead (`--list-inset: var(--inset)`).
- Heights are the line plus padding, rounded up to the grid: a one-line row `--row-h` = 28 (18 + 2 × 5 → 28), a two-line row `--row-h-tall` = 44 (34 + 2 × 5 → 44), a heading 24. Bars move onto the grid too: toolbar 32 (was 31), footer and window bar 28 (26), title bar 40 (38). Each of these changes how a window looks and is decided in the Workbench, one at a time.
- The top of a list or body lands on the inset the same way as its sides: the list's padding is `--inset` less the space above its first row's letters (`calc(var(--inset) - var(--list-pad))`), and `text-box: trim` handles text in padded bodies, as now.

### 4. Size classes and modes remap roles

Roles change with where they are, never in a view:

- **Window size class** (the kit's container classes, on the View): narrow below 360px `--inset-narrow` 12, regular 16, a `Page` 32. A small tile stops wasting a sixth of its width. Built: the View's body, title band, toolbar and footer take `--inset-narrow` as `--inset` in a narrow view; phones keep 16.
- **Pointer** (`pointer-coarse.tokens.json`, the phone client): as now, larger rows and controls, `--page-inset` 16.
- **Density** (a later setting, if wanted): `--unit` 3.5px (compact) or 4.5px (roomy) scales every step and role at once.

## Enforcement

- `design-css.test.ts` already counts literal spacing per stylesheet. Not yet: counting a view's `--space-*` at a window's edge where a role exists.
- The layout audit (`pnpm workbench audit`) checks each window against its roles (body on `--inset` at the top as well as the sides, bars on `--bar-inset`, a page on `--page-inset`) and every reference and window story runs it. `pnpm workbench audit --all` walks every story (and its `Sizes`), prints only problems and exits 1 on one: run it before handing back layout work.
- Magic: the scale's rename and the 16px inset are kit 3 (current, unreleased on 2026-10-11; kit 2 frozen with the old names and 12px), so kit 2 → 3 needs no rename table; after release a rename is a new kit with one.

## Migration

Each step lands green (`pnpm typecheck && pnpm test`, e2e, audit) and in its own commits.

1. **Scale.** `--unit`, the numeric steps, `Space` as numbers in `Stack`/`Inline`; rename every `--space-<size>` and `gap="…"`/`pad="…"` mechanically (2xs→0-5, xs→1, sm→1-5, md→2, lg→3, xl→4, 2xl→6, 3xl→8). No pixel moves. Magic's kit 3 and prompt follow.
2. **Roles.** Add the role tokens at today's values; move the kit's CSS onto them (lists, rows, headings, bars, dialogs, controls, toolbar). No pixel moves except where two lists disagreed.
3. **Windows.** Each built-in window and widget onto roles and kit pieces: no `--space-*` at its edges, `pad="inset"` for panes, the audit clean at every size. Done 2026-10-11: `audit --all` is clean; the JSON window's tree is on the inset like the Files tree; the files sidebar panel's rows moved 14 → 16px. Left as their own: tables and trees to their header row (6–7px), the SQLite query field (8px, a bar-like row over its grid).
4. **Grid heights.** Built: toolbar 32, footer and window bar 28, title bar 40 (Settings' traffic lights follow). Not moved: the app's top bar (38, app chrome), table rows and headers (24, 26), `--row-h-sm` and toolbar items (22), `--control-h-sm` (20).
5. **Size classes.** Built: narrow windows on 12px.

Density is left for later.
