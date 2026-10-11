// The UI Workbench (docs/48): a sidebar of every component and story over a page that
// shows one. All of it comes from the catalog (virtual:workbench-catalog, read from the
// sources): a component's page (matrix, playground, props, its stories), a story's page
// (every variant), or one variant alone on the stage. The URL holds the choice
// (?component=ui/Button, ?story=shell/feedback&variant=Sent, &theme=gruvbox-dark), so a
// script can drive it (scripts/workbench.mjs). A story's old id, its file name in lower
// case (?story=feedback), still works.

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Callout, ErrorBoundary, IconButton, LinkButton, Segmented, Select, Spacer, Split, Toolbar } from "@cmd/ui";
import { allThemes, themeFor } from "@cmd/ui/themes";
import type { SettingsSnapshot } from "@cmd/protocol";
import { cmd } from "../lib/bridge.ts";
import { applyThemeSettings, pinTheme } from "../lib/theme.ts";
import { applyLookSettings } from "../lib/look.ts";
import { catalog, loaders, type Catalog, type StoryInfo } from "./catalog/index.ts";
import { ComponentPage, Head } from "./ComponentPage.tsx";
import { Sidebar, type Selection } from "./Sidebar.tsx";
import { Themes } from "./Themes.tsx";
import { Layered, Sized } from "./Layered.tsx";
import { AuditOverlay } from "./AuditOverlay.tsx";
import { audit } from "./audit.ts";
import { StoryPage, variantNames, type StoryModule } from "./StoryPage.tsx";

const FOLLOW = "settings";

// scripts/workbench.mjs reads it: whether a target is a component or a story, and `ls`.
(globalThis as { workbenchCatalog?: Catalog }).workbenchCatalog = catalog;
// `pnpm workbench audit` measures with the same code the overlay draws.
(globalThis as { workbenchAudit?: () => ReturnType<typeof audit> }).workbenchAudit = () => audit(stageRoot() ?? document);
const PARAMS = ["component", "story", "variant", "theme", "mount", "mode", "width", "backdrop", "audit"] as const;
/** The widths windows get (window-design skill), or the variant's own. */
const WIDTHS = ["natural", "220", "320", "480", "640"];
/** The stage's root, for the audit. */
const stageRoot = () => document.querySelector(".ui-split-main");
type Params = Partial<Record<(typeof PARAMS)[number], string>>;

const read = (): Params => Object.fromEntries(PARAMS.map((k) => [k, new URLSearchParams(location.search).get(k) ?? undefined]).filter(([, v]) => v !== undefined));

/** The URL's choice; `go` replaces the keys it names (undefined removes one). */
function useUrl(): [Params, (patch: Params) => void] {
  const [params, setParams] = useState(read);
  // A script changes the URL with history.replaceState and fires this to apply it.
  useEffect(() => {
    const on = () => setParams(read());
    addEventListener("workbench:url", on);
    return () => removeEventListener("workbench:url", on);
  }, []);
  const go = (patch: Params) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) v === undefined ? q.delete(k) : q.set(k, v);
    history.replaceState(null, "", `?${q}`);
    setParams(read());
  };
  return [params, go];
}

/** A story by id, or by its old id (the file name in lower case) when that is unique. */
function findStory(c: Catalog, id: string | undefined): StoryInfo | undefined {
  if (!id) return undefined;
  const exact = c.stories.find((s) => s.id === id);
  if (exact) return exact;
  const old = c.stories.filter((s) => s.title.toLowerCase() === id.toLowerCase());
  return old.length === 1 ? old[0] : undefined;
}

/** The theme: the app's settings (live), or one picked here (this window only). Subscribes to every
 * event, like the app window: a subscription replaces the last one, and stories need ai.updated etc. */
function useWorkbenchTheme(theme: string) {
  const [settings, setSettings] = useState<SettingsSnapshot["settings"] | null>(null);
  useEffect(() => {
    const off = cmd.onEvent((e) => e.type === "settings.updated" && setSettings(e.snapshot.settings));
    cmd.onStatus((s) => s === "connected" && void cmd.call("events.subscribe", {}).then((r) => setSettings(r.settings.settings)));
    return off;
  }, []);
  useEffect(() => {
    const t = theme !== FOLLOW ? themeFor(theme) : undefined;
    // Pinned, so a story that applies the settings' theme (the store, Settings) doesn't undo the pick.
    pinTheme(t ?? null);
    if (!t && settings) applyThemeSettings(settings);
    if (settings) applyLookSettings(settings);
    // Read by scripts/workbench.mjs: a shot waits until the theme it asked for is on.
    document.body.dataset.theme = t ? t.id : FOLLOW;
  }, [theme, settings]);
}

/** A story file's module, loaded on demand and again when the catalog changes; or why it didn't load. */
function useStoryModule(story: StoryInfo | undefined): { mod: StoryModule | null; error: string | null } {
  const [got, setGot] = useState<{ id: string; mod: StoryModule | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!story) return;
    let live = true;
    void loaders[story.id]?.().then(
      (m) => live && setGot({ id: story.id, mod: m, error: null }),
      (e: unknown) => void loadError(e).then((error) => live && setGot({ id: story.id, mod: null, error })),
    );
    return () => void (live = false);
  }, [story?.id, story?.file]); // eslint-disable-line react-hooks/exhaustive-deps
  return story && got?.id === story.id ? got : { mod: null, error: null };
}

/**
 * Why a story's file didn't load. The browser only says the import failed; the dev server
 * answers the module's URL with the compile error (in its error page's script), so ask it.
 */
async function loadError(e: unknown): Promise<string> {
  const message = e instanceof Error ? e.message : String(e);
  const url = /dynamically imported module: (\S+)/.exec(message)?.[1];
  if (!url) return message;
  try {
    const page = await (await fetch(url)).text();
    const json = /const error = (\{.*\})\s*$/m.exec(page)?.[1];
    return json ? (JSON.parse(json) as { message: string }).message : message;
  } catch {
    return message;
  }
}

export function Workbench() {
  const [params, go] = useUrl();
  const theme = params.theme ?? FOLLOW;
  useWorkbenchTheme(theme);
  const component = params.component ? catalog.components.find((c) => c.id === params.component) : undefined;
  const story = component ? undefined : findStory(catalog, params.story);
  const { mod, error } = useStoryModule(story);
  const names = story && mod ? variantNames(story, mod) : [];
  const variant = params.variant && names.includes(params.variant) ? params.variant : undefined;
  const View = variant ? (mod![variant] as ComponentType) : null;

  const themes = params.mode === "themes";
  const width = params.width && params.width !== "natural" ? Number(params.width) : undefined;
  const auditing = params.audit === "1";
  /** One variant on stage, or in every theme. */
  const stage = (render: () => ReactNode) =>
    themes ? (
      <div className="wb-page">
        <Themes width={width} render={render} />
      </div>
    ) : (
      <Layered className="wb-stage">
        <Sized width={width}>{render()}</Sized>
      </Layered>
    );

  const selection: Selection = component ? { kind: "component", id: component.id } : story ? { kind: "story", id: story.id, ...(variant ? { variant } : {}) } : null;
  const select = (s: Selection) =>
    go(s?.kind === "component" ? { component: s.id, story: undefined, variant: undefined } : { component: undefined, story: s?.id, variant: s?.kind === "story" ? s.variant : undefined });

  // Read by scripts/workbench.mjs: what was asked, what is on stage once it rendered ("<story>/<variant>",
  // "<story>/*" for a story's page), its variants, and the mount it rendered for.
  const ready = component ? `${component.id}/*` : story && (mod || error) ? `${story.id}/${variant ?? "*"}` : "";
  useEffect(() => {
    document.body.dataset.asked = params.component ?? params.story ?? "";
    document.body.dataset.ready = ready;
    document.body.dataset.variants = names.join(",");
    document.body.dataset.mount = params.mount ?? "";
    if (error) document.body.dataset.loadError = error;
    else delete document.body.dataset.loadError;
  }, [ready, error, names.join(), params.mount, params.story, params.component]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wb" data-backdrop={params.backdrop === "window" ? "window" : undefined}>
      <Toolbar edge="bottom" className="wb-bar" label="UI Workbench">
        <span className="wb-crumbs">
          {variant && story ? (
            <>
              {/* Back to every variant. */}
              <LinkButton onClick={() => select({ kind: "story", id: story.id })}>{story.title}</LinkButton>
              <span className="wb-dim"> › {variant}</span>
            </>
          ) : (
            (component?.name ?? story?.title ?? "UI Workbench")
          )}
        </span>
        <Spacer />
        {(component || variant) && <Segmented size="sm" label="Themes" value={themes ? "themes" : "one"} options={["one", "themes"]} labels={{ one: "One theme", themes: "Every theme" }} onChange={(v) => go({ mode: v === "themes" ? "themes" : undefined })} />}
        <Select size="sm" label="Width" value={params.width ?? "natural"} options={WIDTHS} labels={{ natural: "Natural width", ...Object.fromEntries(WIDTHS.slice(1).map((w) => [w, `${w} px`])) }} onChange={(v) => go({ width: v === "natural" ? undefined : v })} />
        <Segmented size="sm" label="Backdrop" value={params.backdrop === "window" ? "window" : "well"} options={["well", "window"]} labels={{ well: "Well", window: "Window" }} onChange={(v) => go({ backdrop: v === "window" ? "window" : undefined })} />
        <IconButton icon="ruler" label="Audit: where content sits against its window's edges" pressed={auditing} onClick={() => go({ audit: auditing ? undefined : "1" })} />
        <Select size="sm" label="Theme" value={theme} options={[{ value: FOLLOW, label: "Theme from Settings" }, ...allThemes().map((t) => ({ value: t.id, label: t.title }))]} onChange={(v) => go({ theme: v })} />
      </Toolbar>
      <div className="wb-body">
        <Split pane={<Sidebar catalog={catalog} selection={selection} onSelect={select} />} width={{ min: 180, ideal: 240, max: 400 }}>
          {component ? (
            <ComponentPage key={`${component.id}/${params.mount ?? ""}`} component={component} themes={themes} stories={catalog.stories} onOpen={(id, v) => select({ kind: "story", id, ...(v ? { variant: v } : {}) })} />
          ) : View ? (
            /* key: a new variant (or mount) starts with fresh state. */
            stage(() => (
              <ErrorBoundary key={`${story!.id}/${variant}/${params.mount ?? ""}`} title="This story stopped working" reloadLabel="Reload">
                <View />
              </ErrorBoundary>
            ))
          ) : story && mod ? (
            <StoryPage key={`${story.id}/${params.mount ?? ""}`} story={story} mod={mod} width={width} onFocus={(v) => select({ kind: "story", id: story.id, variant: v })} />
          ) : story && error ? (
            <article className="wb-page">
              <Head title={story.title} file={story.file} doc={story.doc} />
              <Callout tone="danger" title="This story's file didn't load">
                <pre className="wb-error">{error}</pre>
              </Callout>
            </article>
          ) : !story ? (
            <Overview />
          ) : null}
        </Split>
      </div>
      {auditing && <AuditOverlay root={stageRoot} />}
    </div>
  );
}

function Overview() {
  const kit = catalog.components.filter((c) => c.kit);
  const covered = new Set(catalog.stories.flatMap((s) => s.components));
  const bare = kit.filter((c) => !covered.has(c.id)).length;
  return (
    <article className="wb-page">
      <Head
        title="UI Workbench"
        file="docs/48-workbench.md"
        doc={`${kit.length} kit components and ${catalog.stories.length} stories, read from the sources in ${catalog.ms} ms. ${bare} of the components have no story yet (a dim icon): their page shows what their props make. Pick one on the left.`}
      />
    </article>
  );
}
