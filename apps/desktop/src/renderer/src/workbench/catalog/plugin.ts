// virtual:workbench-catalog in the renderer's dev server (docs/48): the catalog that
// extract.ts reads from the sources, and a loader per story file. Re-read when a
// component or story file changes; the module (and the UI Workbench) updates only when
// what it says changed, so editing a component's look stays a plain HMR update.

import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { CatalogRoots, SourceCache } from "./extract.ts";

const ID = "virtual:workbench-catalog";
const RESOLVED = "\0" + ID;

export function workbenchCatalog(repo: string): Plugin {
  // Loaded on first use, so builds and the app's own dev page never load TypeScript.
  let x: (typeof import("./extract.ts")) | undefined;
  let roots: CatalogRoots | undefined;
  let cache: SourceCache | undefined;
  let code: string | null = null;
  let timer: NodeJS.Timeout | undefined;

  const build = () => {
    const catalog = x!.extractCatalog(roots!, cache);
    const loaders = catalog.stories.map((s) => `  ${JSON.stringify(s.id)}: () => import(${JSON.stringify("/@fs" + path.join(repo, s.file))}),`);
    return `export const catalog = ${JSON.stringify(catalog)};\nexport const loaders = {\n${loaders.join("\n")}\n};\n`;
  };
  const relevant = (file: string) => !!roots && /\.tsx?$/.test(file) && (file.startsWith(roots.kit) || file.startsWith(roots.renderer));

  const changed = (server: ViteDevServer, file: string) => {
    if (!relevant(file)) return;
    cache!.forget(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (code === null) return;
      let next: string;
      try {
        next = build();
      } catch (err) {
        server.config.logger.error(`workbench catalog: ${String(err)}`);
        return;
      }
      // Only what the catalog says counts, not how long it took.
      const strip = (c: string) => c.replace(/"ms":\d+/, "");
      if (strip(next) === strip(code)) return;
      code = next;
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) void server.reloadModule(mod);
    }, 150);
  };

  return {
    name: "workbench-catalog",
    apply: "serve",
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return undefined;
      if (!x) {
        x = await import("./extract.ts");
        roots = x.catalogRoots(repo);
        cache = new x.SourceCache();
      }
      code ??= build();
      return code;
    },
    configureServer(server) {
      // The kit is outside the renderer's root: watch it for new story files too.
      server.watcher.add(path.join(repo, "packages/ui/src"));
      for (const ev of ["add", "change", "unlink"] as const) server.watcher.on(ev, (file) => changed(server, file));
    },
  };
}
