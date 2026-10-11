// Workspace Actions (docs/39-workspace-actions.md): the ways to run the project
// in a folder, found in its own files (package.json, Makefile, justfile…), with
// what they do, how often they ran and whether one is running now.

import type { GitPlace, PaneId, WorkspaceId } from "./model.ts";
import type { Def } from "./settings.ts";

/** What the widget, the library and the palette call it; one place to rename. */
export const ACTIONS_TITLE = "Workspace Actions";

/** "agent": an agent skill or command (.claude/skills), run as a new agent session. */
export const ACTION_KINDS = ["dev", "test", "build", "check", "deploy", "setup", "clean", "run", "agent"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface WorkspaceAction {
  /** "<source>:<file relative to the root>:<name>", stable across edits. */
  id: string;
  /** "dev", "test:e2e", "release". */
  name: string;
  /** What is typed in the terminal: "pnpm run dev". */
  command: string;
  /** What it runs when that isn't `command`: a package.json script's text ("vite --port 3000"). */
  script?: string;
  /** Where it runs (a package's folder in a monorepo). */
  cwd: string;
  /** Where it was found; `kind` is the source's id ("npm", "make", "just"…); `file` is relative to the root. */
  source: { kind: string; file: string; line?: number };
  /** Workspace package (monorepos); undefined at the root. */
  package?: string;
  kind: ActionKind;
  /** A server or watcher: it doesn't finish by itself. */
  long: boolean;
  /** Deploys, publishes, drops data: confirm before running. */
  risky: boolean;
  description?: string;
  /** "author": from the file (a doc comment, desc); "cmd": cmd's own (cargo build); "model": written by the fast tier. */
  describedBy?: "author" | "cmd" | "model";
  /** Needs arguments (a just recipe's parameters): typed into the terminal, not run. */
  args?: boolean;
  /** A local server's address known before it runs (a compose service's port). */
  url?: string;
  /** An agent skill's or command's agent: "claude", "codex", "gemini", "qwen", "copilot". */
  agent?: string;
  /** Lifecycle scripts and the like: listed under More. */
  hidden?: boolean;
  /** How often it ran here lately (decayed: last week counts more than last year); 0 if never. */
  use?: number;
  /** A command from history rather than a file: what was typed, how often. */
  history?: { runs: number };
  /** Pinned in this folder: listed first. */
  pinned?: boolean;
}

/** An action's latest run in a terminal started from Workspace Actions. */
export interface ActionRun {
  actionId: string;
  paneId: PaneId;
  startedAt: number;
  /** null while running. */
  endedAt: number | null;
  exitCode: number | null;
  /** A local server's address printed by it (http://localhost:5173/). */
  url: string | null;
}

export interface ActionsList {
  /** The folder the actions are for. */
  root: string;
  /** Ordered: pinned, then by use, then file order. */
  actions: WorkspaceAction[];
  /** Commands run here often that no file names, ranked (at most a few). */
  history: WorkspaceAction[];
  /** Commands from the README and similar that no file names, picked by the model. */
  suggested: WorkspaceAction[];
  /** The one to show big (usually dev); null when nothing stands out. */
  primary: string | null;
  /** Files read, and an error for one that couldn't be (its last good actions are kept). */
  sources: { file: string; error?: string }[];
  runs: ActionRun[];
  /** The checkout the folder is in; null outside a repository. */
  checkout: GitPlace | null;
  /**
   * Every checkout of the folder's repository (the main one first, then linked
   * worktrees): its branch, how many of its actions are running and how many agents work in it.
   */
  worktrees: { top: string; branch: string | null; linked: boolean; running: number; agents: number }[];
  /** Runs of these same actions in the repository's other worktrees (dev in another branch's checkout). */
  elsewhere: (ActionRun & { root: string; branch: string | null })[];
  /** The model is writing descriptions. */
  describing: boolean;
}

/** Workspace Actions' settings, part of SETTINGS_SCHEMA (settings.ts). */
export const ACTIONS_SETTINGS = {
  "actions.describe": { title: "Describe actions with AI", type: "boolean", default: true, description: "A few words on what each action does, from the fast model.", details: "Only the scripts' names and commands and the shell commands in the README go to the model. Descriptions written in the files are always kept." },
  "actions.openBrowser": { title: "Open dev servers in a browser", type: "boolean", default: false, description: "Open a dev server's local address in a browser window beside it." },
} as const satisfies Record<string, Def>;

/** A folder's Workspace Actions changed: its files, a run, the model's descriptions (actions.list again). Part of CoreEvent (rpc.ts). */
export type ActionsEvent = { type: "actions.changed"; root: string };

/** Workspace Actions' RPC methods, part of `Methods` (rpc.ts). */
export interface ActionsMethods {
  /**
   * Workspace Actions (docs/39): the ways to run the project in a folder (`path`,
   * else the workspace's root), ranked, described, and their runs. Changes arrive as actions.changed.
   */
  "actions.list": { params: { path?: string; workspaceId?: WorkspaceId }; result: ActionsList };
  /**
   * Run an action in its terminal when that is back at its prompt, else in a new one in the workspace.
   * A server still running isn't started twice: `started` false and its pane. `restart`: ⌃C, then run it again; `fresh`: always a new terminal.
   * A risky action (a deploy, a publish) is refused unless `confirmed`: the caller asked the person first.
   */
  "actions.run": { params: { root: string; actionId: string; workspaceId?: WorkspaceId; restart?: boolean; fresh?: boolean; confirmed?: boolean }; result: { paneId: PaneId; started: boolean } };
  /** ⌃C to an action's running terminal. */
  "actions.stop": { params: { root: string; actionId: string }; result: null };
  /** Pin an action to the top of its folder's list; a command from history or the README is kept as one. */
  "actions.pin": { params: { root: string; actionId: string; pinned: boolean }; result: null };
}
