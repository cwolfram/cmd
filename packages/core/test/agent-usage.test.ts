// Tokens as facts (docs/49): agent.usage from Claude Code's messages (one per message, however
// many lines repeat its usage) and Codex's token_count lines (one per call, repeats collapsed by
// the running total), and the one-time backfill from transcript events already in the log.
import { describe, expect, it } from "vitest";
import { Core } from "../src/kernel/core.ts";
import { claudeLine, codexLine } from "../src/data/sources/transcripts.ts";
import { backfillUsage, usageOfMessage } from "../src/data/sources/usage.ts";
import { inlinePacer } from "../src/kernel/scheduler.ts";
import { fakeFactory } from "./fake-pty.ts";

const FILE = { path: "/x/s1.jsonl", root: { agent: "claude", dir: "/x" } } as never;
const usage = { input_tokens: 2, cache_creation_input_tokens: 405, cache_read_input_tokens: 140276, output_tokens: 269, output_tokens_details: { thinking_tokens: 101 } };
const claude = (uuid: string, text: string) => JSON.stringify({ type: "assistant", uuid, sessionId: "s1", timestamp: "2026-10-11T05:00:00Z", cwd: "/src/app", message: { id: "msg_1", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], usage } });

describe("agent usage", () => {
  it("makes one fact per Claude message, whichever of its lines carries it", () => {
    const a = usageOfMessage(claudeLine(claude("u1", "first block"), 1, FILE)!);
    const b = usageOfMessage(claudeLine(claude("u2", "second block"), 2, FILE)!);
    expect(a).toMatchObject({ id: "claude:usage:msg_1", type: "agent.usage", sessionId: "claude:s1", data: { agent: "claude", model: "claude-opus-5-5", in: 2, out: 269, cacheRead: 140276, cacheWrite: 405, reasoning: 101 } });
    expect(b!.id).toBe(a!.id);
  });

  it("reads Codex's token_count lines as calls, with the model from the turn's context", () => {
    const state: { sessionId?: string; cwd?: string; model?: string } = { sessionId: "c1", cwd: "/src/app" };
    codexLine(JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.5-codex" } }), 1, FILE, state);
    const tc = (total: number) => JSON.stringify({ timestamp: "2026-10-11T05:00:00Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: 13947, cached_input_tokens: 13696, output_tokens: 293, reasoning_output_tokens: 157 } } } });
    const e = codexLine(tc(14240), 2, FILE, state);
    expect(e).toMatchObject({ id: "codex:c1:usage:14240", type: "agent.usage", data: { agent: "codex", model: "gpt-5.5-codex", in: 251, cacheRead: 13696, out: 293, reasoning: 157 } });
    expect(codexLine(tc(14240), 3, FILE, state)!.id).toBe(e!.id); // the same report twice
    expect(codexLine(JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } }), 4, FILE, state)).toBeNull();
  });

  it("fills in usage once from transcript events already in the log, and stats count it", async () => {
    const core = new Core({ socketPath: "/dev/null", dbPath: null, settingsPath: null, terminals: fakeFactory().factory, pollMs: 0 });
    try {
      const now = Date.now();
      for (const [i, uuid] of ["u1", "u2"].entries()) core.data.record({ ...claudeLine(claude(uuid, "block"), i, FILE)!, at: now });
      expect(await backfillUsage(core.data, () => {}, inlinePacer)).toBe(1); // two lines, one message
      expect(core.data.query({ types: ["agent.usage"] })).toHaveLength(1);
      expect(await backfillUsage(core.data, () => {}, inlinePacer)).toBe(0);
      core.stats.start();
      await core.stats.idle();
      const r = core.stats.query({ stat: "agents.tokens", range: "today", filter: { token: ["in", "out"] }, by: "agent" });
      expect(r.total).toBe(271);
      expect(r.series[0]!.label).toBe("Claude");
    } finally {
      await core.close();
    }
  });
});
