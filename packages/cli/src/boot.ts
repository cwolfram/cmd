// Connecting to a core that's busy before it answers (docs/50): the first
// launch of a version updating its data. The CLI waits and says what it does,
// from the core's boot report, instead of "no core running".

import { runningStep, stepLine } from "@cmd/protocol";
import { connect, readBoot, type Connection } from "@cmd/protocol/node";

/** How long a command waits for a core that's busy before it answers. */
const BOOT_WAIT_MS = 10 * 60_000;

/**
 * The core, waited for while it does work before it answers (the first launch
 * of a version updating data, docs/50), saying what it does; any other failure
 * to connect at once.
 */
export async function connectWaiting(): Promise<Connection> {
  let said = "";
  for (const t0 = Date.now(); ; ) {
    try {
      const conn = await connect();
      if (said && process.stderr.isTTY) process.stderr.write("\r\x1b[K");
      return conn;
    } catch (err) {
      const step = runningStep(readBoot());
      if (!step || Date.now() - t0 > BOOT_WAIT_MS) throw err;
      // A terminal gets one line that updates; a pipe a line per step.
      const line = `cmd is getting ready: ${stepLine(step)}…`;
      if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${line}`);
      else if (!said.startsWith(`cmd is getting ready: ${step.label}`)) console.error(line);
      said = line;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
