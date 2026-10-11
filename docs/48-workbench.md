# UI Workbench: one place to see and work on every component

**Status:** partly built: step 1 (the catalog and the pages built from it)

> Status (2026-10-11): step 1 built on branch `workbench`: `renderer/src/workbench/catalog/` (extract.ts, plugin.ts), the sidebar, component and story pages, `DialogLayer` in the kit, `--headless`. Proposal before that, branch `workbench` (on top of `wb-dock`, which keeps the Workbench from opening app windows). Replaces the `@cmd/ui` gallery (`pnpm ui`) with the UI Workbench (today's Workbench, grown), driven from the component sources and the story files.

There are two tools for looking at UI today, and they overlap:

| | Gallery (`pnpm ui`, `packages/ui/gallery`) | Workbench, today (`pnpm workbench`, `renderer/src/workbench`, `scripts/workbench.mjs`) |
|---|---|---|
| Content | One hand-written `Gallery.tsx` (1,675 lines, 11 pages, about 60 specimens) | 34 `*.story.tsx` files, found by glob; each named export is a variant |
| Runs in | A browser: Lucide icons, no preload, no core | The real app: SF Symbols, preload, core, `webview` |
| Browsing | A sidebar of pages, every specimen of a page with its note, every theme side by side | One variant at a time, picked from a Select |
| Tooling | `shots.mjs` (a fixed list of pages × themes), `dialog.test.ts` (focus, in Chromium) | `goto`, `shot`, `matrix`, `audit`, `eval`, `stop` |

The gallery browses better; the Workbench shows the truth and has the agent loop. Both are maintained by hand: a new component needs a specimen in `Gallery.tsx` (a rule in CLAUDE.md that nothing checks), a specimen's note repeats what the component's header comment says, `code="<Button variant size icon busy>"` is typed out, and the lists of pages and themes are written into `shots.mjs`, `matrix` and the prototype skill.

The goal: **one tool, the UI Workbench, and everything it shows derived from the sources**, so a new component, prop, variant value or story appears without registering it anywhere.

## The name

The tool is the **UI Workbench**: in docs, skills, CLAUDE.md, the window's title and the CLI's messages. "Workbench" alone is how cmd describes itself ("terminal + agent workbench", docs/15), so the tool always takes the "UI". The command stays `pnpm workbench` (every script, skill and memory uses it); the code keeps its folder and file names (`renderer/src/workbench/`, `workbench.html`, `scripts/workbench.mjs`). "Gallery", `pnpm ui`, "specimen" and `Gallery.tsx` go away as names for anything current.

## Sources of truth

Three things are written by hand. Everything else is derived from them.

| Source | What it holds |
|---|---|
| **Component `.tsx`** | Props and their types (literal unions are the variants), defaults (from the destructuring: `variant = "default"`), JSDoc on the component and on each prop, the file's header comment |
| **`*.story.tsx`** | Only what types can't say: compositions, flows, real data, stand-ins for bridge calls. The doc comment above an export is that variant's note; the file's header comment is the story's description |
| **Tokens and themes** | Already single sources: `packages/ui/tokens` (DTCG) and the theme registry |

Derived: the sidebar and its groups, story ids, the variant list, each component's variant matrix, playground controls, props table and code signature, the notes, coverage (components without a story, stories without a component), the smoke test's cases, the targets of `shot`/`matrix`/`ls`, and the theme list.

**One rule moves:** what a component is for, and when to use which variant, goes in its JSDoc, not in a specimen's note. The editor's hover, the UI Workbench page and the props table then read the same text. Porting the gallery moves each `Spec` note into the JSDoc of the component it describes.

## Design

### 1. The component catalog (extracted from the source)

A Vite plugin in the UI Workbench's dev server (`renderer/src/workbench/catalog/`, dev only) reads the kit with the TypeScript checker and serves the result as a virtual module, `virtual:workbench-catalog`:

- **Which components:** every export of `packages/ui/src/index.ts` whose type is a React component (a function or `forwardRef`/`memo` returning JSX). Renderer folders that have stories are read the same way, for the components their stories render.
- **Per component:** name, file, the JSDoc (else the file's header comment), and its props: name, kind (`union` with its literal values, `boolean`, `string`, `number`, `node`, `function`, `other`), required or not, default, the prop's doc comment. Props inherited from DOM attributes (`ButtonHTMLAttributes`) are dropped, except a short list that matters for states (`disabled`).
- **Live:** the plugin watches the files it read; a change re-extracts that file and invalidates the module, so HMR brings in a new prop or union value on save.
- **Cost:** one checker program over the kit's ~30 files at startup (estimate 1–2 s, to be measured), incremental after. Written against the `typescript` package the repo already has; no `react-docgen-typescript`.

### 2. Stories (plain files, metadata read from them)

Stories stay what they are: `*.story.tsx`, each named export a variant. Nothing new is required. The UI Workbench also globs `packages/ui/src/**/*.story.tsx`, so kit stories live beside the kit.

- **Id:** from the path, not the file name: `ui/button`, `windows/pdf/pdfview`, `shell/feedback`. This fixes the collision two `Foo.story.tsx` would have today. Old ids keep working as aliases while the skills and scripts move.
- **Group:** the folder.
- **Notes:** the doc comment above each export; the description: the file's header comment. Read from the source by the same plugin, which parses story files without type-checking them.
- **Which component:** the component file beside it (`button.story.tsx` → `button.tsx`'s components) or, failing that, the components the story imports from the kit.
- **Optional `export const args`:** values for props the playground can't guess (`{ children: "Save" }`). The only metadata a story may carry, and only where a guess fails.

### 3. The UI Workbench frame

The window becomes the gallery's layout, built from the kit (`Split`, `List`, `View`, `Toolbar`), in the real app:

- **Sidebar:** groups → components and stories → variants, with type-to-filter. Components without a story are marked.
- **Component page:** for each component in the catalog, whether or not it has a story:
  - **Matrix:** every union and boolean prop against its values (variant × size, plus `busy`, `pressed`, `disabled`). Too many combinations (over ~48) splits into one row per prop instead of the full cross product.
  - **Playground:** controls generated from the props (Segmented or Select for a union, Switch for a boolean, a field for a string or number). Function props log their calls into an event list (`onChange("x")`).
  - **Props table:** name, type, default, doc.
  - **Its stories' variants**, if any.
- **Story page:** every variant stacked with its title and note (the gallery's page); clicking one focuses it alone, as today.
- **Themes mode:** the focused variant in every theme at once, each a `.ui-theme` subtree (the gallery's Themes page already scopes themes this way). One look, or one shot, instead of a contact sheet.
- **Stage controls:** width presets (220, 320, 480, 640, fill: the widths windows get), backdrop (bg, well), and an audit overlay that draws `AUDIT()`'s measurements on the stage.
- The URL still holds the choice (`?story=&variant=&theme=&mode=&width=`), and `data-ready`/`data-variants`/`data-theme` still tell scripts when it rendered.

### 4. The CLI (`scripts/workbench.mjs`)

- **`ls [--json]`:** components, stories, variants, and coverage, so agents stop guessing ids.
- **`shot --themes all`:** one image of themes mode, replacing the Python contact-sheet snippet in the prototype skill.
- **`--headless`:** the window isn't shown (`show: false`), so an agent can run the UI Workbench without taking over the user's screen; several can run at once (each already picks a free DevTools port).
- **A clear "the UI Workbench isn't running" error** when `workbench.json` is missing or stale, instead of ENOENT or a CDP connection error.
- `goto`, `shot`, `matrix`, `audit`, `eval`, `stop` stay; their targets and theme lists come from the catalog and the registry.

### 5. Tests

- **A browser stage for kit stories** (`packages/ui/test/stage.html`): no frame, mounts `?story=&variant=&theme=` from the kit's stories and the catalog's matrices, in Playwright's Chromium. Kit stories need no bridge, so they don't need Electron. `dialog.test.ts` moves onto it.
- **Story smoke test:** every kit component's matrix and every kit story variant renders, in a few themes, with no page errors. A component is covered the moment it is exported.
- **Coverage:** every kit component either has a story or a matrix that renders something; the test lists the ones with neither (props the matrix can't generate and no story).
- **Variants against CSS:** the kit draws variants as data attributes (`data-variant`, `data-size`, `data-tone`). With the unions extracted, a test checks that every union value has a rule in the kit's CSS and that no rule targets a value the type doesn't have, so styles can't drift from types.
- App stories (renderer) stay Electron-only; the UI Workbench's own smoke run covers them in `pnpm workbench matrix`.

### 6. Removing the gallery

Delete `packages/ui/gallery` (`Gallery.tsx`, `gallery.css`, `main.tsx`, `index.html`, `shots.mjs`, `vite.config.ts`), the `gallery`, `build` and `shots` scripts in `packages/ui/package.json`, `pnpm ui` at the root, and `gallery/**` in `packages/ui/tsconfig.json`. `lucide.ts` stays (the desktop uses it too). The references to it are step 7's.

What the gallery shows by hand maps to:

| Gallery | Becomes |
|---|---|
| Single-control specimens (button sizes, badge tones, switch states, status dots) | The component's generated matrix; their notes go to JSDoc |
| Composed specimens (forms, Window pieces, overlays, Checklist, FindBar, DataGrid with data) | Kit stories, about 15 files, beside the components |
| Tokens page, Themes page | `tokens.story.tsx`, `themes.story.tsx` (reading `tokens.gen.ts` and the registry) |
| Patterns page | Stories (the reference windows in `renderer/src/reference/` already cover most) |

### 7. Documentation and skills

Everything that tells a person or an agent how to look at UI names the UI Workbench and its commands, and nothing current names the gallery. Found with `grep -ri "workbench\|gallery\|pnpm ui"` (2026-10-11):

| Where | What changes |
|---|---|
| `CLAUDE.md` | The `pnpm ui` line goes; `pnpm workbench` describes the UI Workbench (components and stories, every theme); "a gallery specimen in `Gallery.tsx`" becomes "export it from `@cmd/ui`: the UI Workbench picks it up and the tests check it renders"; a line on stories (where they live, notes from doc comments, `args`) |
| `DEVELOPMENT.md`, `README.md` | The UI Workbench where they cover building or looking at UI (neither names the gallery today; check for a section that should) |
| `.claude/skills/prototype` | Renamed in prose to the UI Workbench; path ids; the component page, themes mode and stage controls; `ls`, `shot --themes all` and `--headless` replace the contact-sheet snippet; the kit rule points to exporting, not to `Gallery.tsx` |
| `.claude/skills/window-design` | Same rename; component pages and the audit overlay where it says how to check a layout; no gallery |
| `.claude/skills/manager` | "a workbench story, the gallery" and `pnpm ui` → the UI Workbench |
| Current docs: `40-window-design.md` (the gallery's pages and shots, how to check a window), `33-search.md` and `36-sqlite-viewer.md` ("with a gallery specimen") | The UI Workbench and its component pages; their status lines unchanged |
| Code comments | The header of `packages/ui/src/index.ts`; `icon.tsx`, `lucide.ts`, `themes/registry.ts`, `tokens/build.ts` (and `tokens.gen.ts` through it), `dialog.test.ts`; the `// Workbench stories (pnpm workbench …)` headers of the 34 stories, for the new path ids |
| Window title and CLI messages | "UI Workbench" (`main/index.ts`, `scripts/workbench.mjs`) |

Not changed: dated records, and the words where they mean something else. `docs/architecture-review-01/` and superseded docs keep what they said then. "Workbench" meaning cmd itself (`15-positioning.md`, `26-data-requirements.md`, `43-performance.md`, the CLI's help, the website) and a Magic widget's workbench folder (`12-magic-widgets.md`) stay; so does "a gallery" for the Widget Library (`16-widgets.md`).

A test keeps it that way (`test/docs.test.ts`): CLAUDE.md, DEVELOPMENT.md, README.md, `.claude/skills/**` and the docs whose status is built, partly built or proposal must not mention the old tool: `pnpm ui`, `Gallery.tsx`, `packages/ui/gallery`, `@cmd/ui gallery`, "gallery specimen" or "the gallery's". Exact phrases, so the Widget Library's "gallery" doesn't trip it. This doc is excepted while it is a proposal (it describes what is replaced).

### 8. More from the source (research, 2026-10-11)

What other design-system teams derive or check, kept to what fits "derived from source, nothing written by hand". Ranked by value for the effort, given what steps 1–5 build:

| Idea | Derived from | Who does it | Effort |
|---|---|---|---|
| **axe on every story × theme**, against a baseline: new violations fail, existing ones are listed | The rendered DOM and computed styles (contrast included) | Storybook's a11y checks per story ([docs](https://storybook.js.org/docs/writing-tests/accessibility-testing)); Chromatic's per-story baseline in every mode ([docs](https://www.chromatic.com/docs/accessibility/)) | S–M, on the smoke test (step 3) |
| **Contrast of token pairs per theme**: pairs found in kit CSS rules that set both `color` and a background, resolved per theme (alpha blended over the backdrop) | Tokens and kit CSS | GitHub Primer checks 100+ pairs across themes on every PR ([post](https://github.blog/engineering/unlocking-inclusive-design-how-primers-color-system-is-making-github-com-more-inclusive/)); a hand-made pair list wouldn't fit | S–M |
| **Tokens per component**: the `var(--x)` its CSS reads, shown on its page; "used by" on the tokens story; unused tokens | Kit CSS and the token JSON | Nobody found deriving it (storybook-design-token needs comment annotations) | S |
| **Usage across the app**: per component, prop and union value, a count and file:line links; dead props, values nobody passes, unused components | The TypeScript checker over the renderer (not names: aliased imports) | react-scanner ([repo](https://github.com/moroshko/react-scanner)); Optimizely planned with Omlet's usage counts ([post](https://blog.zeplin.io/optimizely-harmony-session-2023)) | M |
| **Media and direction toggles**: forced-colors, prefers-contrast, reduced-motion, color-scheme, `dir=rtl`, offered only for the `@media` queries a component's CSS has | Kit CSS; emulated with CDP `Emulation.setEmulatedMedia` | Playwright `emulateMedia` ([docs](https://playwright.dev/docs/api/class-page#page-emulate-media)); Chromatic modes ([docs](https://www.chromatic.com/docs/modes/)) | S |
| **Interaction states from selectors**: `:hover`, `:focus-visible`, `:active`, `:disabled`, `[aria-*]` in a component's CSS, each forced on as a matrix row | Kit CSS | storybook-addon-pseudo-states ([addon](https://storybook.js.org/addons/storybook-addon-pseudo-states)) | M |
| **Dependency graph**: uses / used by on each page, orphans, and which stories a change touches (the `review` step re-shoots only those) | Imports | dependency-cruiser ([repo](https://github.com/sverweij/dependency-cruiser)); Chromatic TurboSnap ([docs](https://www.chromatic.com/docs/turbosnap/)) | S–M |
| **`@deprecated`** from JSDoc: a badge, the prop struck through, its remaining uses; a test that fails once nothing uses it (delete it) | JSDoc and usage | Primer's lifecycle: deprecation names a replacement ([guide](https://primer.style/guides/component-lifecycle)) | S |
| **Health instead of a status field**: has a story, a11y clean, every prop documented, renders in every theme, used in the app, nothing deprecated | The checks above | Primer's statuses are set by hand ([status](https://primer.style/status)): that wouldn't fit | S |
| **Keyboard contract from the role**: a rendered `tablist`, `menu`, `listbox`, `radiogroup` gets that pattern's keys tested (arrows, Home/End, roving focus); one table per ARIA pattern, not per component | The rendered roles | WAI-ARIA APG patterns ([tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)) | M–L |
| **Render cost per story**: mount time and DOM nodes against master | Rendering | Atlassian's storybook-addon-performance ([repo](https://github.com/atlassian-labs/storybook-addon-performance)) | M |
| **The catalog as JSON for agents** (and Magic's prompt): props, docs, story ids | The catalog | Storybook's components manifest ([docs](https://storybook.js.org/docs/ai/manifests)) | S (`pnpm workbench ls --json`, step 4) |
| **A component's history**: `git log` over its files and the tokens it reads | Git | — | S |

Not taken, because they need words or settings written by hand: do/don't sections, token docs from annotations, curated contrast pairs, modes chosen per story (every theme applies everywhere instead), a status field.

## Limits

- **Composition can't be derived.** A `View` with toolbar, list and footer, or a dialog in the middle of a flow, is a story. Those are also the stories most worth reviewing.
- **Some props need values.** Required props (`children`, `columns`, `rows`) are guessed: the prop's name as text, `noop` for functions, the first union value. `args` fills in the rest. Render callbacks, refs and structured data are shown read-only in the playground and skipped by the matrix.
- **Compound components** (`Panel`/`PanelHeader`, `Window`/`WindowBar`) make no sense alone. A component whose required props can't be generated shows only its stories (and the coverage test asks for one).

## Steps

1. **Catalog and pages:** the extractor plugin, path ids, story notes from comments, the new frame (sidebar, component page with matrix, playground and props table, story page). The current stories keep working unchanged.
2. **Themes mode, stage controls, audit overlay.**
3. **Port and delete the gallery:** notes into JSDoc, the composed specimens into kit stories, tokens and themes stories, the browser stage, the smoke, coverage and CSS tests, `dialog.test.ts` moved; remove `packages/ui/gallery` and update CLAUDE.md and the skills.
4. **CLI:** `ls`, `shot --themes all`, `--headless`, the not-running error.
5. **Documentation and skills** (section 7): every reference updated to the UI Workbench and its commands, the old names gone, and the test that keeps them out. Last, so the skills describe what was built, not what was planned; each earlier step updates the lines it makes wrong as it lands, so nothing points to a deleted tool in between.

After step 5, from section 8: axe with a baseline and the token contrast check first (they ride on the smoke test and the themes), tokens per component, media toggles, then usage, `@deprecated` and health (usage feeds both).

Later, not in this doc's scope: **`pnpm workbench review`**, which shoots every story on a branch and on `master` and lists those whose pixels changed (before and after side by side), for reviewing what an agent's branch changed visually. It needs a pixel-diff dependency and two builds.

## Decisions

- **The name is UI Workbench; the command stays `pnpm workbench`.**
- **Viewing is Electron-only.** The browser stage exists for tests, not as a second gallery.
- **No metadata objects in stories.** Names, notes and groups come from the source; `args` is the one optional export.
- **The catalog is dev-only.** Nothing of it ships: the plugin runs in the UI Workbench's dev server, and `workbench.html` stays out of the production build.
