// The UI Workbench (docs/47): a sidebar of every component and story over a page that
// shows one. All of it comes from the catalog (virtual:workbench-catalog, read from the
// sources): a component's page (matrix, playground, props, its stories), a story's page
// (every variant), or one variant alone on the stage. The URL holds the choice
// (?component=ui/Button, ?story=shell/feedback&variant=Sent, &theme=gruvbox-dark), so a
// script can drive it (scripts/workbench.mjs). A story's old id, its file name in lower
// case (?story=feedback), still works.

import { useEffect, useState, type ComponentType } from "react";
import { Callout, ErrorBoundary, Select, Spacer, Split, Toolbar } from "@cmd/ui";
import { allThemes, themeFor } from "@cmd/ui/themes";
import type { SettingsSnapshot } from "@cmd/protocol";
import { cmd } from "../lib/bridge.ts";
import { applyThemeSettings, pinTheme } from "../lib/theme.ts";
import { applyLookSettings } from "../lib/look.ts";
import { catalog, loaders, type Catalog, type StoryInfo } from "./catalog/index.ts";
import { ComponentPage, Head } from "./ComponentPage.tsx";
import { Sidebar, type Selection } from "./Sidebar.tsx";
import { StoryPage, variantNames, type StoryModule } from "./StoryPage.tsx";

const FOLLOW = "settings";

// scripts/workbench.mjs reads it: whether a target is a component or a story, and `ls`.
(globalThis as { workbenchCatalog?: Catalog }).workbenchCatalog = catalog;
const PARAMS = ["component", "story", "variant", "theme", "mount"] as const;
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
      (e: unknown) => live && setGot({ id: story.id, mod: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => void (live = false);
  }, [story?.id, story?.file]); // eslint-disable-line react-hooks/exhaustive-deps
  return story && got?.id === story.id ? got : { mod: null, error: null };
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
  }, [ready, names.join(), params.mount, params.story, params.component]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wb">
      <Toolbar edge="bottom" className="wb-bar" label="UI Workbench">
        <span className="wb-crumbs">
          {component?.name ?? story?.title ?? "UI Workbench"}
          {variant && <span className="wb-dim"> › {variant}</span>}
        </span>
        <Spacer />
        <Select size="sm" label="Theme" value={theme} options={[{ value: FOLLOW, label: "Theme from Settings" }, ...allThemes().map((t) => ({ value: t.id, label: t.title }))]} onChange={(v) => go({ theme: v })} />
      </Toolbar>
      <div className="wb-body">
        <Split pane={<Sidebar catalog={catalog} selection={selection} onSelect={select} />} width={{ min: 180, ideal: 240, max: 400 }}>
          {component ? (
            <ComponentPage key={`${component.id}/${params.mount ?? ""}`} component={component} stories={catalog.stories} onOpen={(id, v) => select({ kind: "story", id, ...(v ? { variant: v } : {}) })} />
          ) : View ? (
            /* key: a new variant (or mount) starts with fresh state. */
            <main className="wb-stage">
              <ErrorBoundary key={`${story!.id}/${variant}/${params.mount ?? ""}`} title="This story stopped working" reloadLabel="Reload">
                <View />
              </ErrorBoundary>
            </main>
          ) : story && mod ? (
            <StoryPage key={`${story.id}/${params.mount ?? ""}`} story={story} mod={mod} onFocus={(v) => select({ kind: "story", id: story.id, variant: v })} />
          ) : story && error ? (
            <article className="wb-page">
              <Head title={story.title} file={story.file} doc={story.doc} />
              <Callout tone="danger" title="This story's file didn't load">
                {error} The dev server's output says why (an import that isn't there, a syntax error).
              </Callout>
            </article>
          ) : !story ? (
            <Overview />
          ) : null}
        </Split>
      </div>
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
        file="docs/47-workbench.md"
        doc={`${kit.length} kit components and ${catalog.stories.length} stories, read from the sources in ${catalog.ms} ms. ${bare} of the components have no story yet (a dim icon): their page shows what their props make. Pick one on the left.`}
      />
    </article>
  );
}
