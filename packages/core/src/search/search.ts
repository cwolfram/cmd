// Search as the core runs it (docs/33): the transcript reader (restarted when its settings
// change), the search view over the log, its full-text index's rebuild, and finding files in a
// workspace's folder.

import os from "node:os";
import path from "node:path";
import type { AgentKind, SearchStatus, Settings, WorkspaceId } from "@cmd/protocol";
import { logger } from "@cmd/protocol/node";
import type { CoreContext } from "../kernel/context.ts";
import { checkoutOf } from "../lib/checkout.ts";
import { TranscriptIngest } from "../data/sources/ingest.ts";
import { SearchView } from "../data/views/search.ts";
import { FileSearch } from "./files.ts";
import { locateContext, type TranscriptRoot } from "./sources.ts";

const log = logger("core");

export const NO_SEARCH: SearchStatus = { sessions: 0, files: 0, indexing: false, done: 0, total: 0 };

type SearchCore = Pick<CoreContext, "data" | "views" | "sessions" | "transcripts" | "homes" | "scheduler" | "settings" | "workspaces" | "agents" | "broadcast">;

export interface SearchOptions {
  /** Tests: the transcript folders to read (default: TranscriptSources.locate plus search.archiveDirs). */
  transcriptRoots?: (settings: Settings) => TranscriptRoot[];
  /** Tests: read transcripts on this thread instead of in a worker. */
  ingestInline?: boolean;
}

export class Search {
  #core: SearchCore;
  #o: SearchOptions;
  #ingest: TranscriptIngest | null = null;
  readonly view: SearchView;
  readonly files: FileSearch;
  #closed = false;
  /** Restarts are chained so two workers never index at once. */
  #swap: Promise<void> = Promise.resolve();
  #gen = 0;

  constructor(core: SearchCore, o: SearchOptions) {
    this.#core = core;
    this.#o = o;
    this.view = new SearchView(core.data, core.sessions, { viewsFile: core.views.file });
    this.files = new FileSearch({ excluded: () => core.data.rules().folders });
    // Views follow what was forgotten or excluded: rebuilt from what's left.
    core.data.on("removed", ({ types }) => {
      if (types.some((t) => t.startsWith("agent."))) void core.agents.activity.rebuild();
      if (types.some((t) => t.startsWith("transcript."))) void core.sessions.rebuild().then(() => this.view.invalidate());
    });
  }

  status(): SearchStatus {
    return this.#ingest?.status() ?? NO_SEARCH;
  }

  /** The transcript folders being read (remote/policy.ts keeps them private). */
  roots(): TranscriptRoot[] {
    return this.#ingest?.roots() ?? [];
  }

  /** A transcript a hook reported: picks up folders discovery doesn't know. */
  learn(agent: AgentKind, transcriptPath: string): void {
    this.#ingest?.learn(agent, transcriptPath);
  }

  learnHome(agent: AgentKind, dir: string): void {
    this.#ingest?.learnHome(agent, dir);
  }

  reindex(): void {
    if (!this.#ingest) throw new Error("transcripts are off (Settings → Data)");
    this.#ingest.reindex();
  }

  /** Reads transcripts for the current settings (folders, on/off); again when they change. */
  restart(): void {
    const gen = ++this.#gen;
    this.#swap = this.#swap.then(async () => {
      const old = this.#ingest;
      this.#ingest = null;
      await old?.close();
      if (gen !== this.#gen || this.#closed) return; // a newer restart replaces this one
      const { data, views, sessions, transcripts, homes, scheduler, settings, broadcast } = this.#core;
      const s = settings.settings;
      let next: TranscriptIngest | null = null;
      if (s["data.record.transcripts"]) {
        const archives = s["search.archiveDirs"].split(",").map((d) => d.trim()).filter(Boolean);
        const roots = this.#o.transcriptRoots?.(s) ?? transcripts.locate(locateContext(), archives);
        next = new TranscriptIngest({ data, views, sessions, sources: transcripts, roots, inline: this.#o.ingestInline, pace: scheduler });
        for (const h of homes.all()) next.learnHome(h.agent, h.dir);
        next.on("status", (status) => broadcast({ type: "search.status", status }));
        next.on("changed", () => this.view.invalidate());
        next.start();
      }
      this.#ingest = next;
      broadcast({ type: "search.status", status: next?.status() ?? NO_SEARCH });
    });
  }

  /** The full-text index's rebuild (DataStore.buildFts: its steps name themselves `fts rebuild` for the watchdog). */
  async rebuildFts(): Promise<void> {
    const t0 = Date.now();
    try {
      const n = await this.#core.data.store.buildFts({ pace: this.#core.scheduler });
      log.info("full-text index rebuilt", { events: n, ms: Date.now() - t0 });
      this.view.invalidate();
    } catch (err) {
      if (!this.#closed) log.error("could not rebuild the full-text index", err); // closing mid-build: it goes on next start
    }
  }

  /**
   * Where a workspace's files are searched: its folder. In the Home workspace (the home
   * folder: too big to search as you type) the folder of `cwd` instead, the
   * selected window's: its repository's top if it's in one, else the folder
   * itself; never the home folder or one above it.
   */
  root(workspaceId: WorkspaceId | null, cwd: string | null): string | null {
    const workspace = workspaceId ? this.#core.workspaces.get(workspaceId) : undefined;
    if (workspace && !workspace.home) return workspace.root;
    if (!cwd || !path.isAbsolute(cwd)) return null;
    const at = checkoutOf(cwd)?.top ?? path.resolve(cwd);
    const home = os.homedir();
    return at === home || home.startsWith(at.endsWith(path.sep) ? at : at + path.sep) ? null : at;
  }

  /** The search view first, then the reader: its worker's last batches must not land on closed stores. */
  async close(): Promise<void> {
    this.#closed = true;
    this.view.close();
    await this.#swap;
    await this.#ingest?.close();
  }
}
