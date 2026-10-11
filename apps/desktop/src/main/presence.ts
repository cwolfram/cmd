// Whether someone is at this Mac, for the core (ui.presence): pushes to paired
// phones can wait until you're away (remote.push.when, docs/13). Reports the
// screen lock as it changes, and the time since the last input when there was
// new input or every minute; the core counts on from there. The report belongs
// to this connection, so a quit app (or a core restart, until it's back) is away.

import { powerMonitor } from "electron";
import { connect, logger } from "@cmd/protocol/node";

const log = logger("presence");
/** How often the idle time is looked at: new input reaches the core within this. */
const TICK_MS = 5000;
/** Reported at least this often anyway, as a sign of life. */
const HEARTBEAT_MS = 60_000;

export function followPresence(socketPath: string): void {
  let locked = false;
  let report: ((force: boolean) => void) | null = null;
  powerMonitor.on("lock-screen", () => ((locked = true), report?.(true)));
  powerMonitor.on("unlock-screen", () => ((locked = false), report?.(true)));
  // Asleep, the core sleeps too; awake again, the idle time starts over.
  powerMonitor.on("resume", () => report?.(true));

  const attach = async () => {
    try {
      const conn = await connect(socketPath);
      let lastIdle = Infinity;
      let sentAt = 0;
      report = (force) => {
        const idle = powerMonitor.getSystemIdleTime();
        const input = idle < lastIdle; // the idle time went back: someone touched the Mac
        lastIdle = idle;
        if (!force && !input && Date.now() - sentAt < HEARTBEAT_MS) return;
        sentAt = Date.now();
        conn.client.call("ui.presence", { idleSeconds: idle, locked }).catch(() => {});
      };
      report(true);
      const timer = setInterval(() => report?.(false), TICK_MS);
      void conn.closed.then(() => {
        clearInterval(timer);
        report = null;
        setTimeout(attach, 1000);
      });
    } catch (err) {
      log.debug(`can't reach the core: ${(err as Error).message}`);
      setTimeout(attach, 1000);
    }
  };
  void attach();
}
