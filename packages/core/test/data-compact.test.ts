// What the event log keeps less of: tool results cut and bookkeeping lines
// dropped as transcripts are read (data/sources/transcripts.ts), and the pass
// that does the same once to a log written before, then vacuums it (data/compact.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataStore } from "../src/data/store.ts";
import { COMPACT_VERSION, compactLog, reclaim } from "../src/data/compact.ts";
import { TOOL_RESULT_KEEP, claudeLine, codexLine } from "../src/data/sources/transcripts.ts";
import { rmTemp } from "./tmp.ts";

let dir: string;
beforeEach(() => void (dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmd-compact-")))));
afterEach(() => rmTemp(dir));

const FILE = { agent: "claude" as const, path: "/x/s.jsonl", env: null };
const output = "line of output\n".repeat(2000);
const claudeResult = (uuid: string) =>
  JSON.stringify({
    type: "user",
    uuid,
    sessionId: "s",
    timestamp: "2026-10-06T10:00:00Z",
    cwd: "/w",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: output }, { type: "image", source: { type: "base64", data: "A".repeat(50_000) } }] }] },
    toolUseResult: { stdout: output, stderr: "" },
  });

describe("reading transcripts", () => {
  it("keeps a tool result's first characters, without images or Claude's second copy", () => {
    const e = claudeLine(claudeResult("u1"), 1, FILE)!;
    expect(e.type).toBe("transcript.tool_result");
    expect(e.data).toMatchObject({ cut: true, chars: claudeResult("u1").length });
    const line = JSON.parse(String(e.content));
    expect(line.toolUseResult).toBeUndefined();
    expect(line.message.content[0].content[0].text).toHaveLength(TOOL_RESULT_KEEP + `…[+${output.length - TOOL_RESULT_KEEP}]`.length);
    expect(line.message.content[0].content[1]).toEqual({ type: "image", omitted: true });
  });

  it("keeps a cut result inline when it's small then, and a short one as it was", () => {
    const small = JSON.stringify({ type: "user", uuid: "u2", sessionId: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] }, toolUseResult: { stdout: "x".repeat(3000) } });
    const e = claudeLine(small, 1, FILE)!;
    expect(e.content).toBeNull();
    expect(e.data).toMatchObject({ cut: true, message: { content: [{ content: "ok" }] } });
    const plain = claudeLine(JSON.stringify({ type: "user", uuid: "u3", sessionId: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } }), 1, FILE)!;
    expect(plain.data).not.toHaveProperty("cut");
  });

  it("keeps thinking without its signature and tool inputs cut, what was written whole", () => {
    const text = "an answer ".repeat(500);
    const line = JSON.stringify({ type: "assistant", uuid: "a1", sessionId: "s", message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "S".repeat(3000) }, { type: "text", text }, { type: "tool_use", id: "t", name: "Write", input: { file_path: "/w/a.ts", content: "x".repeat(30_000) } }] } });
    const e = claudeLine(line, 1, FILE)!;
    const kept = JSON.parse(String(e.content));
    expect(kept.message.content[0]).toEqual({ type: "thinking", thinking: "hmm" });
    expect(kept.message.content[1].text).toBe(text);
    expect(kept.message.content[2].input.file_path).toBe("/w/a.ts");
    expect(kept.message.content[2].input.content.length).toBeLessThan(TOOL_RESULT_KEEP + 20);
    expect(e.body).toContain("a.ts"); // searched by what it was before the cut
  });

  it("keeps no copy of a line still over the class's cap (cut there, it wouldn't parse)", () => {
    const prompt = "pasted log line\n".repeat(6000);
    const e = claudeLine(JSON.stringify({ type: "user", uuid: "p1", sessionId: "s", message: { role: "user", content: prompt } }), 1, FILE)!;
    expect(e.content).toBeNull();
    expect(e.data).toMatchObject({ cut: true });
    expect(e.data).not.toHaveProperty("message");
    expect(e.body).toContain("pasted log line");
  });

  it("drops Claude's bookkeeping lines", () => {
    for (const type of ["attachment", "permission-mode", "file-history-snapshot", "queue-operation", "progress"]) expect(claudeLine(JSON.stringify({ type, uuid: type, sessionId: "s" }), 1, FILE)).toBeNull();
  });

  it("cuts a Codex tool call's output the same way", () => {
    const line = JSON.stringify({ timestamp: "2026-10-06T10:00:00Z", type: "response_item", payload: { type: "function_call_output", call_id: "c", output } });
    const e = codexLine(line, 1, { ...FILE, agent: "codex" }, { sessionId: "c1", cwd: "/r" })!;
    expect(e.type).toBe("transcript.tool_result");
    expect(e.data).toMatchObject({ cut: true, callId: "c" });
    expect(JSON.parse(String(e.content ?? JSON.stringify({ payload: (e.data as { payload: unknown }).payload }))).payload.output.length).toBeLessThan(TOOL_RESULT_KEEP + 20);
  });
});

describe("compacting a log written before", () => {
  /** A log as an older cmd wrote it: bookkeeping rows, whole tool results, tool hooks with their output and a copy of the payload. */
  function oldLog(file: string): DataStore {
    const s = new DataStore(file);
    s.record({ id: "claude:other", at: 1, type: "transcript.other", source: "transcript:claude@2.1.1", data: { line: "attachment" }, content: "y".repeat(5000) });
    s.record({ id: "codex:c1:1", at: 1, type: "transcript.other", source: "transcript:codex", data: { line: "event_msg" } });
    s.record({ id: "claude:u1", at: 2, type: "transcript.tool_result", source: "transcript:claude@2.1.1", sessionId: "claude:s", text: "Bash", data: { line: "user", role: "user", chars: 1 }, content: claudeResult("u1") });
    const small = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] }, toolUseResult: { stdout: "z".repeat(3000) } });
    s.record({ id: "claude:u2", at: 3, type: "transcript.tool_result", source: "transcript:claude@2.1.1", data: { line: "user", role: "user", chars: small.length }, content: small });
    const payload = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "make" }, tool_response: { stdout: "o".repeat(4000), is_error: false } };
    s.record({ id: "hook:1", at: 4, type: "agent.hook", source: "hook:claude", data: { name: "PostToolUse", agent: "claude", payload }, content: JSON.stringify(payload) });
    s.record({ id: "hook:2", at: 5, type: "agent.hook", source: "hook:claude", data: { name: "UserPromptSubmit", agent: "claude", payload: { prompt: "p" } }, content: "whole prompt" });
    s.record({ id: "claude:broken", at: 6, type: "transcript.message", source: "transcript:claude@2.1.1", text: "Read", data: { line: "assistant", role: "assistant", chars: 90_000 }, content: claudeResult("u9").slice(0, 64_000) });
    s.record({ id: "claude:small", at: 7, type: "transcript.message", source: "transcript:claude@2.1.1", data: { line: "assistant", role: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "hm", signature: "S".repeat(500) }] } } });
    s.db.exec(`DELETE FROM meta WHERE key = 'compact'`);
    return s;
  }

  it("drops bookkeeping rows, cuts tool results, slims tool hooks and sweeps their blobs", () => {
    const s = oldLog(path.join(dir, "events.sqlite"));
    expect(compactLog(s)).toBe(true);
    expect(s.meta("compact")).toBe(String(COMPACT_VERSION));
    expect(s.get("claude:other")).toBeNull();
    expect(s.get("codex:c1:1")).not.toBeNull(); // Codex's are kept
    const big = s.get("claude:u1")!;
    expect(big.data).toMatchObject({ cut: true });
    expect(JSON.parse(s.blob(big.blob!)!.toString()).toolUseResult).toBeUndefined();
    const small = s.get("claude:u2")!;
    expect(small.blob).toBeNull();
    expect(small.data).toMatchObject({ cut: true, message: { content: [{ content: "ok" }] } });
    // A copy the cap cut short is dropped; a small line loses its thinking signature.
    expect(s.get("claude:broken")).toMatchObject({ blob: null, data: { cut: true } });
    expect(s.get("claude:small")!.data).toMatchObject({ cut: true, message: { content: [{ type: "thinking", thinking: "hm" }] } });
    expect(JSON.stringify(s.get("claude:small")!.data)).not.toContain("signature");
    const hook = s.get("hook:1")!;
    expect(hook.blob).toBeNull();
    expect((hook.data as { payload: Record<string, unknown> }).payload).toMatchObject({ tool_input: { command: "make" }, tool_response: { is_error: false } });
    expect(s.blob(s.get("hook:2")!.blob!)!.toString()).toBe("whole prompt"); // a prompt's copy stays
    // Only the blobs rows still name are left.
    expect(s.db.prepare(`SELECT COUNT(*) AS n FROM blobs`).get()).toEqual({ n: 2 });
    expect(s.db.prepare(`SELECT COUNT(*) AS n FROM blobs WHERE refs <= 0`).get()).toEqual({ n: 0 });
    // Incremental auto-vacuum from now on, the file still in WAL.
    expect(s.db.prepare(`PRAGMA auto_vacuum`).get()).toEqual({ auto_vacuum: 2 });
    expect(s.db.prepare(`PRAGMA journal_mode`).get()).toEqual({ journal_mode: "wal" });
    expect(compactLog(s)).toBe(false); // once
    s.close();
  });

  it("changes nothing the second time: what was cut stays as it was", async () => {
    const { trimLine } = await import("../src/data/sources/transcripts.ts");
    const once = trimLine(JSON.parse(claudeResult("u1")))!;
    expect(trimLine(once)).toBeNull();
    const thinking = trimLine({ message: { content: [{ type: "redacted_thinking", data: "x".repeat(900) }, { type: "tool_use", input: { content: "y".repeat(9000) } }] } })!;
    expect(trimLine(thinking)).toBeNull();
  });

  it("leaves the vacuum for next launch when it fails, with the rows done and the log in WAL", async () => {
    const s = oldLog(path.join(dir, "events.sqlite"));
    const exec = s.db.exec.bind(s.db);
    const spy = vi.spyOn(s.db, "exec").mockImplementation((sql: string) => {
      if (sql.includes("VACUUM")) throw new Error("database is locked");
      return exec(sql);
    });
    expect(compactLog(s)).toBe(true);
    spy.mockRestore();
    expect(s.get("claude:other")).toBeNull(); // the rows are done
    expect(s.meta("compact")).toBeNull(); // the vacuum: next launch
    expect(s.db.prepare(`PRAGMA journal_mode`).get()).toEqual({ journal_mode: "wal" });
    s.close();
  });

  it("gives freed pages back a step at a time", () => {
    const s = oldLog(path.join(dir, "events.sqlite"));
    compactLog(s);
    for (let i = 0; i < 200; i++) s.record({ id: `c${i}`, at: 10, type: "command", source: "osc", data: {}, content: `${i}`.repeat(20_000) });
    s.delete({ types: ["command"] });
    s.sweepBlobs();
    const free = () => (s.db.prepare(`PRAGMA freelist_count`).get() as { freelist_count: number }).freelist_count;
    expect(free()).toBeGreaterThan(10);
    expect(reclaim(s.db, 5)).toBe(true);
    while (reclaim(s.db, 64));
    expect(free()).toBe(0);
    s.close();
  });

  it("makes the indexes of mostly-empty columns partial, on a new log too", () => {
    const s = new DataStore(":memory:");
    compactLog(s);
    const sql = (name: string) => (s.db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name) as { sql: string }).sql;
    expect(sql("events_agent")).toContain("WHERE agent_id IS NOT NULL");
    expect(sql("events_workspace_at")).toContain("WHERE workspace_id IS NOT NULL");
    expect(s.db.prepare(`EXPLAIN QUERY PLAN SELECT seq FROM events WHERE agent_id = ? ORDER BY seq`).all("a").map((r) => (r as { detail: string }).detail).join()).toContain("events_agent");
    s.close();
  });
});
