// `cmd hook <agent> [event]`: the hook an agent runs on each event (installed by the
// core, agents/hooks.ts). Reads the event from stdin and hands it to the pane's core;
// small and quick on purpose, since it runs on every tool call: no hello, a 2 s cap,
// silent when no core runs.

import { ENV } from "@cmd/protocol";
import { connect } from "@cmd/protocol/node";

/** Hook entry point. Must never block or fail the agent: always exit 0, fast. */
export async function hook(kind: string, eventArg?: string): Promise<number> {
  const paneId = process.env[ENV.paneId];
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  if (!paneId) return 0;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return 0;
  }
  const event = String(payload.hook_event_name ?? eventArg ?? "");
  if (!event) return 0;
  const timer = setTimeout(() => process.exit(0), 2000);
  try {
    const conn = await connect(undefined, { hello: false });
    const { context } = await conn.client.call("hook.ingest", { paneId, agent: kind, event, payload });
    conn.close();
    // Claude, Codex and Gemini all read extra context from this shape.
    if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) + "\n");
  } catch {
    // core not running: ignore
  }
  clearTimeout(timer);
  return 0;
}
