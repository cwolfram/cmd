// The Operator's conversations (docs/51-operator.md): one per workspace, owned by the core, so
// closing the widget or the app doesn't stop a turn and reopening shows it where it is. A turn
// is one ai.agent run over the whole history; each tool call becomes an item the chat shows
// (and the board marks, when it acts), waits for the person when it must, and goes through
// OPERATOR_ACCESS. Messages sent while a turn runs wait for the next one. Kept in cmd's
// database, a row per workspace.

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ModelMessage } from "ai";
import type { Method, NewDataEvent, OperatorConversation, OperatorEvent, OperatorItem, OperatorUsage, Params, Result, WindowId, Workspace, WorkspaceId } from "@cmd/protocol";
import { logger } from "@cmd/protocol/node";
import type { AgentCall, AgentResult, AgentRun } from "../ai/backends.ts";
import type { ToolOutput } from "../magic/tools.ts";
import { AiNotConfigured } from "../ai/service.ts";
import { OPERATOR_ACCESS } from "./access.ts";
import { Refs, clip, look } from "./board.ts";
import { systemPrompt } from "./prompt.ts";
import { OPERATOR_TOOLS, type Bench, type OperatorTool } from "./tools.ts";

const log = logger("operator");

/** Tool steps in one turn before the Operator must answer. */
export const MAX_STEPS = 40;
/** Denials in a row that end a turn: the person wants something else. */
const DENIALS = 3;
/** What a tool returns to the model, at most; the card shows less. */
const OUTPUT_MAX = 30_000;
const CARD_MAX = 4000;
/** Items kept per conversation (the model's history is trimmed separately). */
const ITEMS_MAX = 600;
/** Old tool results are replaced by a line once the history is longer than this (characters). */
const HISTORY_MAX = 400_000;

export interface OperatorDeps {
  workspace(id: WorkspaceId): Workspace | null;
  /** A method as the core runs it (Core.call); the service gates it. */
  call(method: Method, params: unknown): Promise<unknown>;
  /** One run of the model over the conversation (AiService.agent). */
  agent(r: AgentRun): Promise<AgentResult>;
  /** The Operator's window in a workspace, if one is open. */
  selfIn(workspaceId: WorkspaceId): WindowId | null;
  broadcast(e: OperatorEvent): void;
  /** A turn waits for the person, ended or failed while nobody looked (a notification). */
  notify?(workspaceId: WorkspaceId, title: string, body: string): void;
  /** Into the event log (docs/28): each turn (operator.turn) and each tool call in it (operator.tool). */
  record?(e: NewDataEvent): void;
  /** Where conversations are kept (cmd's database); null: in memory only (tests). */
  db: DatabaseSync | null;
}

interface Conversation {
  workspaceId: WorkspaceId;
  items: OperatorItem[];
  messages: ModelMessage[];
  refs: Refs;
  system: string | null;
  usage: OperatorUsage;
  model: string | null;
  latency: OperatorConversation["latency"];
  busy: boolean;
  abort: AbortController | null;
  queue: { text: string; selected: WindowId | null }[];
  approvals: Map<string, (a: { allow: boolean; reason?: string }) => void>;
  denials: number;
}

interface Saved {
  items: OperatorItem[];
  messages: ModelMessage[];
  refs: Record<string, WindowId>;
  system: string | null;
  usage: OperatorUsage;
  model: string | null;
}

const zero = (): OperatorUsage => ({ input: 0, output: 0, cacheRead: 0 });

export class OperatorService {
  #d: OperatorDeps;
  #all = new Map<WorkspaceId, Conversation>();

  constructor(d: OperatorDeps) {
    this.#d = d;
    d.db?.exec(`CREATE TABLE IF NOT EXISTS operator_conversations (workspace_id TEXT PRIMARY KEY, json TEXT NOT NULL, at INTEGER NOT NULL)`);
  }

  get(workspaceId: WorkspaceId): OperatorConversation {
    const c = this.#conv(workspaceId);
    return { workspaceId, items: c.items, busy: c.busy, usage: c.usage, model: c.model, latency: c.latency };
  }

  send(workspaceId: WorkspaceId, text: string, selected: WindowId | null = null): void {
    const t = text.trim();
    if (!t) throw new Error("say what you'd like done");
    if (!this.#d.workspace(workspaceId)) throw new Error(`no workspace ${workspaceId}`);
    const c = this.#conv(workspaceId);
    this.#add(c, { kind: "user", id: randomUUID(), at: Date.now(), text: t });
    c.queue.push({ text: t, selected });
    if (!c.busy) void this.#turn(c);
  }

  stop(workspaceId: WorkspaceId): void {
    const c = this.#all.get(workspaceId);
    if (!c) return;
    c.queue = [];
    c.abort?.abort(new Error("stopped"));
    for (const resolve of c.approvals.values()) resolve({ allow: false, reason: "stopped" });
  }

  answer(workspaceId: WorkspaceId, itemId: string, allow: boolean, reason?: string): void {
    const resolve = this.#all.get(workspaceId)?.approvals.get(itemId);
    if (!resolve) throw new Error("nothing is waiting for that answer");
    resolve({ allow, reason: reason?.trim() || undefined });
  }

  reset(workspaceId: WorkspaceId): void {
    this.stop(workspaceId);
    const c = this.#conv(workspaceId);
    Object.assign(c, { items: [], messages: [], refs: new Refs(), system: null, usage: zero(), model: null, latency: null, denials: 0 });
    this.#save(c);
    this.#d.broadcast({ type: "operator.changed", workspaceId, reset: true, items: [], usage: c.usage, model: null, latency: null });
  }

  dispose(): void {
    for (const id of this.#all.keys()) this.stop(id);
  }

  // ── a turn ─────────────────────────────────────────────

  async #turn(c: Conversation): Promise<void> {
    const asked = c.queue.splice(0);
    if (!asked.length) return;
    const ws = this.#d.workspace(c.workspaceId);
    if (!ws) return;
    const abort = new AbortController();
    const t0 = Date.now();
    let firstStep: number | null = null;
    c.busy = true;
    c.abort = abort;
    c.denials = 0;
    this.#d.broadcast({ type: "operator.changed", workspaceId: c.workspaceId, busy: true });
    const done: OperatorItem[] = [];
    const request = asked.map((a) => a.text).join("\n\n");
    const turn = { id: `operator:${randomUUID()}`, at: t0, type: "operator.turn" as const, source: "cmd", workspaceId: c.workspaceId, text: request.split("\n")[0]!.slice(0, 200) };
    const firstItem = c.items.length;
    let error: string | null = null;
    let stopped = false;
    let tokens = { in: 0, out: 0 };
    this.#d.record?.({ ...turn, data: { steps: 0, denied: 0, stopped: false, error: null, model: null, tokens, firstStepMs: null, ms: null, answer: null }, content: request });
    try {
      const bench = this.#bench(c, abort.signal);
      if (!c.system) c.system = systemPrompt({ root: ws.root, brief: await this.#brief(bench) }).text;
      // The board as it is now goes with the request, so the first step needn't be a look.
      const board = await this.#safe(() => this.#look(bench));
      const selected = asked.map((a) => a.selected).filter(Boolean).pop();
      const text = asked.map((a) => a.text).join("\n\n");
      const content = `${text}${selected ? `\n\n(The person has ${c.refs.of(selected)} selected: "this" means it.)` : ""}${board ? `\n\n<board>\n${board}\n</board>` : ""}`;
      c.messages.push({ role: "user", content });
      this.#trim(c);
      let current: Extract<OperatorItem, { kind: "text" }> | null = null;
      let flush: NodeJS.Timeout | null = null;
      const emitText = () => {
        flush = null;
        if (current) this.#d.broadcast({ type: "operator.changed", workspaceId: c.workspaceId, items: [current] });
      };
      let acting: Promise<void> = Promise.resolve();
      const r = await this.#d.agent({
        system: c.system,
        messages: [...c.messages],
        tools: OPERATOR_TOOLS.map((t) => t.spec),
        maxSteps: MAX_STEPS,
        signal: abort.signal,
        onStep: () => {
          if (flush) clearTimeout(flush), emitText();
          current = null;
        },
        onText: (delta) => {
          if (!current) {
            current = { kind: "text", id: randomUUID(), at: Date.now(), text: "" };
            this.#add(c, current);
          }
          current.text += delta;
          flush ??= setTimeout(emitText, 50);
        },
        exec: async (call) => {
          firstStep ??= Date.now() - t0;
          const tool = OPERATOR_TOOLS.find((t) => t.spec.name === call.name);
          if (!tool) return { output: `no tool ${call.name}`, isError: true };
          // Acts go one at a time, in the order the model asked; reads run beside them.
          if (!tool.acts) return this.#exec(c, tool, call, bench, done, abort, turn.id);
          const run = acting.then(() => this.#exec(c, tool, call, bench, done, abort, turn.id));
          acting = run.then(() => undefined, () => undefined);
          return run;
        },
      });
      if (flush) clearTimeout(flush), emitText();
      c.messages.push(...r.messages);
      c.model = r.model;
      tokens = { in: r.usage.input, out: r.usage.output };
      c.usage = { input: c.usage.input + r.usage.input, output: c.usage.output + r.usage.output, cacheRead: c.usage.cacheRead + r.usage.cacheRead };
    } catch (e) {
      stopped = abort.signal.aborted;
      if (!stopped) error = (e as Error).message;
      // The model's own messages for this turn are lost with the stream: what was done goes back as a note.
      const steps = done.filter((i) => i.kind === "tool").map((i) => `- ${(i as { why: string }).why}: ${(i as { state: string }).state}`);
      c.messages.push({ role: "assistant", content: `(${stopped ? "The person stopped me" : `I failed: ${(e as Error).message}`}.${steps.length ? ` Done before that:\n${steps.join("\n")}` : ""})` });
      for (const i of c.items) if (i.kind === "tool" && (i.state === "running" || i.state === "waiting")) this.#update(c, { ...i, state: "failed", output: stopped ? "Stopped." : i.output });
      this.#add(c, { kind: "error", id: randomUUID(), at: Date.now(), text: stopped ? "Stopped." : friendly(e as Error) });
      if (!stopped) log.warn(`turn failed: ${(e as Error).message}`);
    } finally {
      c.busy = false;
      c.abort = null;
      c.latency = { firstStepMs: firstStep, totalMs: Date.now() - t0 };
      const answer = c.items.slice(firstItem).flatMap((i) => (i.kind === "text" ? [i.text] : [])).join("\n\n").trim() || null;
      const denied = done.filter((i) => i.kind === "tool" && i.state === "denied").length;
      this.#d.record?.({ ...turn, until: Date.now(), data: { steps: done.length, denied, stopped, error, model: c.model, tokens, firstStepMs: firstStep, ms: Date.now() - t0, answer: answer?.slice(0, 2000) ?? null }, content: `${request}${answer ? `\n\n=== answer ===\n\n${answer}` : ""}` });
      this.#save(c);
      this.#d.broadcast({ type: "operator.changed", workspaceId: c.workspaceId, busy: false, usage: c.usage, model: c.model, latency: c.latency });
    }
    if (c.queue.length) void this.#turn(c);
  }

  /** One tool call: its card, the person's approval when it needs one, the call, the result. */
  async #exec(c: Conversation, tool: OperatorTool, call: AgentCall, bench: Bench, done: OperatorItem[], abort: AbortController, turnId: string): Promise<ToolOutput> {
    const { why, ...input } = call.input;
    let target: WindowId | null = null;
    try {
      target = tool.target?.(call.input, bench) ?? null;
    } catch {
      // a bad ref: the run below says so
    }
    const item: Extract<OperatorItem, { kind: "tool" }> = { kind: "tool", id: call.id, at: Date.now(), tool: tool.spec.name, why: typeof why === "string" && why.trim() ? why.trim() : tool.spec.name, acts: tool.acts, target, state: "running", input };
    this.#add(c, item);
    const t0 = Date.now();
    let approval: { ask: string; allowed: boolean | null; reason: string | null } | null = null;
    const end = (state: "done" | "failed" | "denied", output: string, isError: boolean): ToolOutput => {
      const next = { ...item, ...(approval ? { ask: approval.ask } : {}), state, output: clip(output, CARD_MAX), ms: Date.now() - t0 };
      this.#update(c, next);
      done.push(next);
      const sent = clip(output, OUTPUT_MAX);
      this.#d.record?.({ id: `operator:${call.id}`, at: t0, until: Date.now(), type: "operator.tool", source: "cmd", parentId: turnId, workspaceId: c.workspaceId, windowId: target, text: item.why, data: { tool: item.tool, acts: item.acts, state, input, ask: approval?.ask ?? null, allowed: approval?.allowed ?? null, reason: approval?.reason ?? null, ms: next.ms }, content: sent });
      return { output: sent, isError };
    };
    try {
      const ask = tool.confirm ? await tool.confirm(call.input, bench) : null;
      if (ask) {
        this.#update(c, { ...item, state: "waiting", ask });
        if (!this.#d.selfIn(c.workspaceId)) this.#d.notify?.(c.workspaceId, "The Operator asks", ask);
        const a = await new Promise<{ allow: boolean; reason?: string }>((resolve) => c.approvals.set(item.id, resolve));
        c.approvals.delete(item.id);
        approval = { ask, allowed: a.allow, reason: a.reason ?? null };
        if (!a.allow) {
          if (++c.denials >= DENIALS) queueMicrotask(() => abort.abort(new Error("denied")));
          return end("denied", `The person said no${a.reason ? `: ${a.reason}` : ""}. Don't do this another way; ask what they want instead.`, true);
        }
        c.denials = 0;
        this.#update(c, { ...item, ask, state: "running" });
        const out = await tool.run(call.input, { ...bench, call: this.#gate(true, abort.signal) });
        return end("done", out, false);
      }
      return end("done", await tool.run(call.input, bench), false);
    } catch (e) {
      return end("failed", (e as Error).message, true);
    }
  }

  /** The tools' view of cmd: the workspace, its methods gated by OPERATOR_ACCESS (confirm ones only once allowed). */
  #bench(c: Conversation, signal: AbortSignal): Bench {
    return {
      workspace: () => {
        const ws = this.#d.workspace(c.workspaceId);
        if (!ws) throw new Error("the workspace is closed");
        return ws;
      },
      call: this.#gate(false, signal),
      refs: c.refs,
      self: this.#d.selfIn(c.workspaceId),
      signal,
    };
  }

  #gate(allowed: boolean, signal: AbortSignal): Bench["call"] {
    return <M extends Method>(method: M, params: Params<M>) => {
      if (signal.aborted) return Promise.reject(new Error("stopped"));
      const access = OPERATOR_ACCESS[method];
      if (access === "never") return Promise.reject(new Error(`the Operator may not call ${method}`));
      if (access === "confirm" && !allowed) return Promise.reject(new Error(`${method} needs the person's approval first`));
      return this.#d.call(method, params) as Promise<Result<M>>;
    };
  }

  async #look(b: Bench): Promise<string> {
    const [windows, panes, agents] = await Promise.all([b.call("window.list", {}), b.call("pane.list", {}), b.call("agent.list", {})]);
    return look({ workspace: b.workspace(), windows, panes, agents, self: b.self }, b.refs);
  }

  /** The workspace brief (docs/51): where it is, what changed, how to run it, what happened today. Summaries, never raw events. */
  async #brief(b: Bench): Promise<string> {
    const ws = b.workspace();
    const parts: string[] = [];
    const git = await this.#safe(() => b.call("git.status", { path: ws.root }));
    if (git) {
      const n = Object.keys(git.files).length;
      parts.push(`Git: branch ${git.branch ?? "(detached)"}${git.upstream ? `, ${git.ahead} ahead and ${git.behind} behind ${git.upstream}` : ""}; ${n ? `${n}${git.truncated ? "+" : ""} changed files` : "nothing uncommitted"}.`);
    }
    const actions = await this.#safe(() => b.call("actions.list", { workspaceId: ws.id }));
    if (actions?.actions.length) {
      const shown = actions.actions.filter((a) => !a.hidden).slice(0, 40);
      parts.push(`Workspace Actions (run them with run):\n${shown.map((a) => `- ${a.name}: ${a.command}${a.description ? ` (${a.description})` : ""}${a.risky ? " [risky: asks first]" : ""}${a.long ? " [keeps running]" : ""}`).join("\n")}`);
    } else parts.push("No Workspace Actions found.");
    const day = await this.#safe(() => b.call("journal.day", { workspaceId: ws.id, date: workDay(), write: "never" }));
    if (day?.entries.length) parts.push(`Today so far (the journal): ${day.headline}\n${day.entries.slice(0, 8).map((e) => `- ${e.title}: ${e.summary}`).join("\n")}`);
    const events = OPERATOR_TOOLS.find((t) => t.spec.name === "events");
    const counts = events ? await this.#safe(() => events.run({ hours: 8 }, b)) : null;
    if (counts) parts.push(counts.replace(/\nAsk for rows.*$/, ""));
    return parts.join("\n\n");
  }

  async #safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  /** Old tool results go first when the history grows: a line says what was there (it can be read again; what the person said can't). */
  #trim(c: Conversation): void {
    let size = JSON.stringify(c.messages).length;
    for (const m of c.messages) {
      if (size <= HISTORY_MAX) break;
      if (m.role !== "tool" || !Array.isArray(m.content)) continue;
      for (const part of m.content as { type: string; output?: { type: string; value: unknown } }[]) {
        if (part.type !== "tool-result" || !part.output || part.output.type !== "text") continue;
        const before = String(part.output.value).length;
        if (before < 400) continue;
        part.output = { type: "text", value: "(An earlier result, left out to save room: call the tool again if you need it.)" };
        size -= before;
      }
    }
  }

  // ── items and storage ──────────────────────────────────

  #add(c: Conversation, item: OperatorItem): void {
    c.items.push(item);
    if (c.items.length > ITEMS_MAX) c.items.splice(0, c.items.length - ITEMS_MAX);
    this.#d.broadcast({ type: "operator.changed", workspaceId: c.workspaceId, items: [item] });
  }

  #update(c: Conversation, item: OperatorItem): void {
    const i = c.items.findIndex((x) => x.id === item.id);
    if (i >= 0) c.items[i] = item;
    this.#d.broadcast({ type: "operator.changed", workspaceId: c.workspaceId, items: [item] });
  }

  #conv(workspaceId: WorkspaceId): Conversation {
    let c = this.#all.get(workspaceId);
    if (c) return c;
    const saved = this.#load(workspaceId);
    c = {
      workspaceId,
      items: saved?.items ?? [],
      messages: saved?.messages ?? [],
      refs: new Refs(saved?.refs),
      system: saved?.system ?? null,
      usage: saved?.usage ?? zero(),
      model: saved?.model ?? null,
      latency: null,
      busy: false,
      abort: null,
      queue: [],
      approvals: new Map(),
      denials: 0,
    };
    // A turn that was running when the core stopped didn't finish.
    for (const [i, it] of c.items.entries()) if (it.kind === "tool" && (it.state === "running" || it.state === "waiting")) c.items[i] = { ...it, state: "failed", output: "cmd restarted." };
    this.#all.set(workspaceId, c);
    return c;
  }

  #load(workspaceId: WorkspaceId): Saved | null {
    try {
      const row = this.#d.db?.prepare("SELECT json FROM operator_conversations WHERE workspace_id = ?").get(workspaceId) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as Saved) : null;
    } catch {
      return null;
    }
  }

  #save(c: Conversation): void {
    if (!this.#d.db) return;
    try {
      if (!c.items.length && !c.messages.length) {
        this.#d.db.prepare("DELETE FROM operator_conversations WHERE workspace_id = ?").run(c.workspaceId);
        return;
      }
      const saved: Saved = { items: c.items, messages: c.messages, refs: c.refs.toJSON(), system: c.system, usage: c.usage, model: c.model };
      this.#d.db.prepare("INSERT OR REPLACE INTO operator_conversations (workspace_id, json, at) VALUES (?, ?, ?)").run(c.workspaceId, JSON.stringify(saved), Date.now());
    } catch (e) {
      log.warn(`could not save the conversation: ${(e as Error).message}`);
    }
  }
}

/** Local midnight of today's work day (it runs 04:00 to 04:00, as the journal's). */
function workDay(now = new Date()): number {
  const d = new Date(now.getTime() - 4 * 3600_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function friendly(e: Error): string {
  if (e instanceof AiNotConfigured) return "Set up AI first: Settings → AI.";
  return `Something went wrong: ${e.message}`;
}
