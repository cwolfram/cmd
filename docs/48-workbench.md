# Workbench: one place to see and work on every component

**Status:** proposal

> Status (2026-10-11): proposal, branch `workbench` (on top of `wb-dock`, which keeps the Workbench from opening app windows). Replaces the `@cmd/ui` gallery (`pnpm ui`) with the Workbench, driven from the component sources and the story files.

There are two tools for looking at UI today, and they overlap:

| | Gallery (`pnpm ui`, `packages/ui/gallery`) | Workbench (`pnpm workbench`, `renderer/src/workbench`, `scripts/workbench.mjs`) |
|---|---|---|
| Content | One hand-written `Gallery.tsx` (1,675 lines, 11 pages, about 60 specimens) | 34 `*.story.tsx` files, found by glob; each named export is a variant |
| Runs in | A browser: Lucide icons, no preload, no core | The real app: SF Symbols, preload, core, `webview` |
| Browsing | A sidebar of pages, every specimen of a page with its note, every theme side by side | One variant at a time, picked from a Select |
| Tooling | `shots.mjs` (a fixed list of pages × themes), `dialog.test.ts` (focus, in Chromium) | `goto`, `shot`, `matrix`, `audit`, `eval`, `stop` |

The gallery browses better; the Workbench shows the truth and has the agent loop. Both are maintained by hand: a new component needs a specimen in `Gallery.tsx` (a rule in CLAUDE.md that nothing checks), a specimen's note repeats what the component's header comment says, `code="<Button variant size icon busy>"` is typed out, and the lists of pages and themes are written into `shots.mjs`, `matrix` and the prototype skill.

The goal: **one tool, the Workbench, and everything it shows derived from the sources**, so a new component, prop, variant value or story appears without registering it anywhere.

## Sources of truth

Three things are written by hand. Everything else is derived from them.

| Source | What it holds |
|---|---|
| **Component `.tsx`** | Props and their types (literal unions are the variants), defaults (from the destructuring: `variant = "default"`), JSDoc on the component and on each prop, the file's header comment |
| **`*.story.tsx`** | Only what types can't say: compositions, flows, real data, stand-ins for bridge calls. The doc comment above an export is that variant's note; the file's header comment is the story's description |
| **Tokens and themes** | Already single sources: `packages/ui/tokens` (DTCG) and the theme registry |

Derived: the sidebar and its groups, story ids, the variant list, each component's variant matrix, playground controls, props table and code signature, the notes, coverage (components without a story, stories without a component), the smoke test's cases, the targets of `shot`/`matrix`/`ls`, and the theme list.

**One rule moves:** what a component is for, and when to use which variant, goes in its JSDoc, not in a specimen's note. The editor's hover, the Workbench page and the props table then read the same text. Porting the gallery moves each `Spec` note into the JSDoc of the component it describes.

## Design

### 1. The component catalog (extracted from the source)

A Vite plugin in the Workbench's dev server (`renderer/src/workbench/catalog/`, dev only) reads the kit with the TypeScript checker and serves the result as a virtual module, `virtual:workbench-catalog`:

- **Which components:** every export of `packages/ui/src/index.ts` whose type is a React component (a function or `forwardRef`/`memo` returning JSX). Renderer folders that have stories are read the same way, for the components their stories render.
- **Per component:** name, file, the JSDoc (else the file's header comment), and its props: name, kind (`union` with its literal values, `boolean`, `string`, `number`, `node`, `function`, `other`), required or not, default, the prop's doc comment. Props inherited from DOM attributes (`ButtonHTMLAttributes`) are dropped, except a short list that matters for states (`disabled`).
- **Live:** the plugin watches the files it read; a change re-extracts that file and invalidates the module, so HMR brings in a new prop or union value on save.
- **Cost:** one checker program over the kit's ~30 files at startup (estimate 1–2 s, to be measured), incremental after. Written against the `typescript` package the repo already has; no `react-docgen-typescript`.

### 2. Stories (plain files, metadata read from them)

Stories stay what they are: `*.story.tsx`, each named export a variant. Nothing new is required. The Workbench also globs `packages/ui/src/**/*.story.tsx`, so kit stories live beside the kit.

- **Id:** from the path, not the file name: `ui/button`, `windows/pdf/pdfview`, `shell/feedback`. This fixes the collision two `Foo.story.tsx` would have today. Old ids keep working as aliases while the skills and scripts move.
- **Group:** the folder.
- **Notes:** the doc comment above each export; the description: the file's header comment. Read from the source by the same plugin, which parses story files without type-checking them.
- **Which component:** the component file beside it (`button.story.tsx` → `button.tsx`'s components) or, failing that, the components the story imports from the kit.
- **Optional `export const args`:** values for props the playground can't guess (`{ children: "Save" }`). The only metadata a story may carry, and only where a guess fails.

### 3. The Workbench frame

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
- **`--headless`:** the window isn't shown (`show: false`), so an agent can run the Workbench without taking over the user's screen; several can run at once (each already picks a free DevTools port).
- **A clear "the Workbench isn't running" error** when `workbench.json` is missing or stale, instead of ENOENT or a CDP connection error.
- `goto`, `shot`, `matrix`, `audit`, `eval`, `stop` stay; their targets and theme lists come from the catalog and the registry.

### 5. Tests

- **A browser stage for kit stories** (`packages/ui/test/stage.html`): no frame, mounts `?story=&variant=&theme=` from the kit's stories and the catalog's matrices, in Playwright's Chromium. Kit stories need no bridge, so they don't need Electron. `dialog.test.ts` moves onto it.
- **Story smoke test:** every kit component's matrix and every kit story variant renders, in a few themes, with no page errors. A component is covered the moment it is exported.
- **Coverage:** every kit component either has a story or a matrix that renders something; the test lists the ones with neither (props the matrix can't generate and no story).
- **Variants against CSS:** the kit draws variants as data attributes (`data-variant`, `data-size`, `data-tone`). With the unions extracted, a test checks that every union value has a rule in the kit's CSS and that no rule targets a value the type doesn't have, so styles can't drift from types.
- App stories (renderer) stay Electron-only; the Workbench's own smoke run covers them in `pnpm workbench matrix`.

### 6. Removing the gallery

Delete `packages/ui/gallery` (`Gallery.tsx`, `gallery.css`, `main.tsx`, `index.html`, `shots.mjs`, `vite.config.ts`), the `gallery`, `build` and `shots` scripts in `packages/ui/package.json`, `pnpm ui` at the root, and `gallery/**` in `packages/ui/tsconfig.json`. `lucide.ts` stays (the desktop uses it too). Update CLAUDE.md ("pnpm ui", "a gallery specimen in Gallery.tsx" → "export it from `@cmd/ui`; the test checks the rest"), the `prototype`, `window-design` and `manager` skills, and the header comment of `packages/ui/src/index.ts`.

What the gallery shows by hand maps to:

| Gallery | Becomes |
|---|---|
| Single-control specimens (button sizes, badge tones, switch states, status dots) | The component's generated matrix; their notes go to JSDoc |
| Composed specimens (forms, Window pieces, overlays, Checklist, FindBar, DataGrid with data) | Kit stories, about 15 files, beside the components |
| Tokens page, Themes page | `tokens.story.tsx`, `themes.story.tsx` (reading `tokens.gen.ts` and the registry) |
| Patterns page | Stories (the reference windows in `renderer/src/reference/` already cover most) |

## Limits

- **Composition can't be derived.** A `View` with toolbar, list and footer, or a dialog in the middle of a flow, is a story. Those are also the stories most worth reviewing.
- **Some props need values.** Required props (`children`, `columns`, `rows`) are guessed: the prop's name as text, `noop` for functions, the first union value. `args` fills in the rest. Render callbacks, refs and structured data are shown read-only in the playground and skipped by the matrix.
- **Compound components** (`Panel`/`PanelHeader`, `Window`/`WindowBar`) make no sense alone. A component whose required props can't be generated shows only its stories (and the coverage test asks for one).

## Steps

1. **Catalog and pages:** the extractor plugin, path ids, story notes from comments, the new frame (sidebar, component page with matrix, playground and props table, story page). The current stories keep working unchanged.
2. **Themes mode, stage controls, audit overlay.**
3. **Port and delete the gallery:** notes into JSDoc, the composed specimens into kit stories, tokens and themes stories, the browser stage, the smoke, coverage and CSS tests, `dialog.test.ts` moved; remove `packages/ui/gallery` and update CLAUDE.md and the skills.
4. **CLI:** `ls`, `shot --themes all`, `--headless`, the not-running error.

Later, not in this doc's scope: **`pnpm workbench review`**, which shoots every story on a branch and on `master` and lists those whose pixels changed (before and after side by side), for reviewing what an agent's branch changed visually. It needs a pixel-diff dependency and two builds.

## Decisions

- **Viewing is Electron-only.** The browser stage exists for tests, not as a second gallery.
- **No metadata objects in stories.** Names, notes and groups come from the source; `args` is the one optional export.
- **The catalog is dev-only.** Nothing of it ships: the plugin runs in the Workbench's dev server, and `workbench.html` stays out of the production build.
