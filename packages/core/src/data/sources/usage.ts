// Tokens as facts (docs/49): one agent.usage event per model call an agent made, with its
// model and its tokens in, out, read from and written to the prompt cache, and reasoning. From
// the agents' transcripts as they're read: Claude Code repeats a message's usage on every line
// of that message, so the event's id is the message's and the repeats collapse; Codex reports
// each call in a token_count line, its running total telling repeats apart. History read before
// this existed is filled in once (backfillUsage): Claude's from the transcript events already
// in the log, Codex's by reading its files again (it dropped token_count lines then).

import type { AgentKind, EventPayloads } from "@cmd/protocol";
import { logger } from "@cmd/protocol/node";
import type { CoreContext } from "../../kernel/context.ts";
import type { Pacer } from "../../kernel/scheduler.ts";
import type { DataService } from "../service.ts";
import type { StoreEvent as NewEvent } from "../store.ts";

const log = logger("usage");

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function usageEvent(id: string, base: Pick<NewEvent, "at" | "source" | "sessionId" | "projectId">, d: EventPayloads["agent.usage"]): NewEvent | null {
  if (!d.in && !d.out && !d.cacheRead && !d.cacheWrite) return null;
  // No text: numbers aren't searched, and a full-text row per model call would cost more than the fact.
  return { ...base, id, type: "agent.usage", text: null, data: d };
}

/** Claude Code's usage on an assistant message (an Anthropic API usage object): in excludes the cache. */
export function claudeUsage(messageId: string, model: string | null, u: Obj, base: Pick<NewEvent, "at" | "source" | "sessionId" | "projectId">): NewEvent | null {
  const details = isObj(u.output_tokens_details) ? u.output_tokens_details : {};
  if (model === "<synthetic>") return null;
  return usageEvent(`claude:usage:${messageId}`, base, { agent: "claude", model, in: num(u.input_tokens), out: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens), reasoning: num(details.thinking_tokens) });
}

/** A transcript event's usage event, if it is an assistant message with usage (Claude). */
export function usageOfMessage(e: NewEvent): NewEvent | null {
  if (e.type !== "transcript.message" || !isObj(e.data)) return null;
  const d = e.data as Obj;
  const u = isObj(d.usage) ? d.usage : null;
  const id = typeof d.messageId === "string" ? d.messageId : null;
  if (!u || !id || d.role !== "assistant") return null;
  return claudeUsage(id, typeof d.model === "string" ? d.model : null, u, e);
}

/** Codex's token_count payload: last_token_usage is this call's (input includes the cached part); total_token_usage tells repeats apart. */
export function codexUsage(sessionId: string, model: string | null, payload: Obj, base: Pick<NewEvent, "at" | "source" | "sessionId" | "projectId">): NewEvent | null {
  const info = isObj(payload.info) ? payload.info : null;
  const last = info && isObj(info.last_token_usage) ? info.last_token_usage : null;
  const total = info && isObj(info.total_token_usage) ? num(info.total_token_usage.total_tokens) : 0;
  if (!last || !total) return null;
  const cached = num(last.cached_input_tokens);
  return usageEvent(`codex:${sessionId}:usage:${total}`, base, { agent: "codex" as AgentKind, model, in: Math.max(0, num(last.input_tokens) - cached), out: num(last.output_tokens), cacheRead: cached, cacheWrite: 0, reasoning: num(last.reasoning_output_tokens) });
}

const BACKFILL = "usage.backfill";
/** Rows per step to start with; steps then grow or shrink to take about STEP_MS. */
const STEP = { start: 50, min: 10, max: 2000 };
const STEP_MS = 8;

/** Fills in agent.usage for transcripts read before it was recorded; once (marked in the log's meta). */
export async function backfillUsage(data: DataService, reread: (agent: AgentKind) => void, pace: Pacer): Promise<number> {
  if (data.store.meta(BACKFILL)) return 0;
  // Codex: its token_count lines were dropped, so its files are read again (ids make that idempotent).
  reread("codex");
  // Paged by (type, at, seq), the order of the events_type_at index: no scan, no sort.
  let at = -1;
  let seq = 0;
  let n = 0;
  let step = STEP.start;
  const page = (limit: number) =>
    data.store.db.prepare(`SELECT seq, at, source, session_id AS sessionId, project_id AS projectId, json_extract(data, '$.role') AS role, json_extract(data, '$.messageId') AS mid, json_extract(data, '$.model') AS model, json(json_extract(data, '$.usage')) AS usage FROM events WHERE type = 'transcript.message' AND (at > ? OR (at = ? AND seq > ?)) ORDER BY at, seq LIMIT ${limit}`);
  for (;;) {
    const done = pace.mark("usage backfill");
    const t0 = performance.now();
    const rows = page(step).all(at, at, seq) as { seq: number; at: number; source: string; sessionId: string | null; projectId: string | null; role: string | null; mid: string | null; model: string | null; usage: string | null }[];
    const events = rows.flatMap((r) => (r.role === "assistant" && r.mid && r.usage ? [claudeUsage(r.mid, r.model, JSON.parse(r.usage) as Obj, { at: r.at, source: r.source, sessionId: r.sessionId, projectId: r.projectId })] : [])).filter((e): e is NewEvent => !!e);
    if (events.length) n += data.recordBatch(events).length;
    done();
    const ms = performance.now() - t0;
    if (rows.length < step) break;
    const last = rows[rows.length - 1]!;
    (at = last.at), (seq = last.seq);
    step = Math.round(Math.max(STEP.min, Math.min(STEP.max, ms > STEP_MS ? step / 2 : ms < STEP_MS / 3 ? step * 1.5 : step)));
    await pace.yield();
  }
  data.store.setMeta(BACKFILL, String(Date.now()));
  log.info("agent usage filled in from transcripts already read", { events: n });
  return n;
}

/** The backfill as a startup job (kernel/features.ts): after the core answers, before stats count tokens. */
export const usageFeature = {
  id: "usage",
  startup: { label: "Counting tokens", run: async (core: Pick<CoreContext, "data" | "search" | "scheduler">) => void (await backfillUsage(core.data, (agent) => core.search.reread(agent), core.scheduler)) },
};
