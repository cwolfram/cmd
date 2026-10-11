// What the Operator's tools share (tools.ts, window-tools.ts): the bench they work through, the
// shape of a tool and of an approval, the input schema every tool starts from (with its `why`),
// and helpers for windows, agents and paths in the workspace.

import path from "node:path";
import type { Agent, AppWindow, Method, Params, Result, WindowId, Workspace } from "@cmd/protocol";
import type { ToolSpec } from "../magic/tools.ts";
import { isDeniedPath, remotePrivatePaths } from "../lib/paths-deny.ts";
import type { Refs } from "./board.ts";

/** What tools work with: the workspace, its methods (gated), the refs. */
export interface Bench {
  workspace: () => Workspace;
  call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>>;
  refs: Refs;
  /** The Operator's own window: never closed or typed into. */
  self: WindowId | null;
  /** What it started reports back as news: an agent when done, failed or needing input; a command when it ends, a server its address. */
  started?: { agent(agentId: string): void; command(paneId: string, label: string): void };
  signal: AbortSignal;
}

export interface OperatorTool {
  spec: ToolSpec;
  /** It changes something: marked on the board, never run beside another act. */
  acts: boolean;
  /** The window it is about, for the card and the board's mark. */
  target?(input: Input, b: Bench): WindowId | null;
  /** What to ask the person before running it, or null to run at once. Throws to refuse outright. */
  confirm?(input: Input, b: Bench): Promise<Ask | null>;
  run(input: Input, b: Bench): Promise<string>;
}

export type Input = Record<string, unknown>;

/** An approval: in words (`title`, naming windows as people do), and exactly what would happen (`exact`: the text, a diff). */
export interface Ask {
  title: string;
  exact?: string;
}

const why = { type: "string", description: "One short line for the person watching, saying what this step does and why, in their words, e.g. \"Running the tests to see what fails\". Name windows by what they are, never by ref." };
export const ref = { type: "string", description: "A window's ref from look: w1, w2… (for tools only; never write refs to the person)." };
export const schema = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: { why, ...props }, required: ["why", ...required], additionalProperties: false });

export const str = (v: unknown) => (typeof v === "string" ? v : undefined);
export const num = (v: unknown, d: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : d);

/** The workspace's windows, panes and agents, read through the bench. */
export async function board(b: Bench) {
  const [windows, panes, agents] = await Promise.all([b.call("window.list", {}), b.call("pane.list", {}), b.call("agent.list", {})]);
  return { workspace: b.workspace(), windows, panes, agents, self: b.self };
}

export async function windowOf(b: Bench, r: unknown): Promise<AppWindow> {
  const id = b.refs.id(r);
  const w = (await b.call("window.list", {})).find((x) => x.id === id);
  if (!w) throw new Error(`${String(r)} is closed: look again`);
  if (w.workspaceId !== b.workspace().id) throw new Error(`${String(r)} is in another workspace`);
  return w;
}

const KIND_NAMES: Record<string, string> = { text: "editor", files: "file browser", markdown: "Markdown window", json: "JSON viewer", diff: "Live Diff", actions: "Workspace Actions" };

/** A window as people say it: the terminal “tests”, the editor “README.md”. */
export const windowName = (w: AppWindow) => `the ${KIND_NAMES[w.kind] ?? w.kind} “${w.title}”`;

export async function agentIn(b: Bench, w: AppWindow): Promise<Agent | null> {
  if (w.kind !== "terminal") return null;
  const pane = (await b.call("pane.list", {})).find((p) => p.id === w.id);
  return pane?.agentId ? ((await b.call("agent.list", {})).find((a) => a.id === pane.agentId) ?? null) : null;
}

/** A path for reading: inside the workspace's folder, never a private one. */
export function readablePath(b: Bench, p: string): string {
  const root = b.workspace().root;
  const abs = path.resolve(root, p.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`${p} is outside the workspace's folder (${root})`);
  if (isDeniedPath(abs, remotePrivatePaths())) throw new Error(`${p} stays private`);
  return abs;
}

export const fmtTime = (at: number) => new Date(at).toTimeString().slice(0, 5);
