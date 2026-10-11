// What the core does before it answers, for the windows (docs/50-boot-work.md):
// while waitForCore waits, the core's boot report (`<home>/core.boot.json`,
// readBoot: only the live core's) is read and sent to every window as
// `core-boot`, and a window that opens meanwhile asks for it. The wait gives up
// on a core whose report stops changing for STALL_MS, not after a fixed time: a
// migration that keeps reporting may take as long as it takes.

import { BrowserWindow, ipcMain } from "electron";
import type { BootReport } from "@cmd/protocol";
import { readBoot } from "@cmd/protocol/node";

/** Longer than any single statement that can't report (a VACUUM INTO of a big log on a slow disk). */
export const STALL_MS = 10 * 60_000;

/** Reads at most this often: a read takes the instance's lock for a moment (coreLocked). */
const POLL_MS = 250;

let current: BootReport | null = null;
let changedAt = Date.now();
let polledAt = 0;

ipcMain.handle("core-boot", () => current);

function send(r: BootReport | null): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("core-boot", r);
}

/** Reads the report again and tells the windows when it changed. */
export function pollBoot(): void {
  if (Date.now() - polledAt < POLL_MS) return;
  polledAt = Date.now();
  const r = readBoot();
  if ((r?.at ?? 0) === (current?.at ?? 0)) return;
  changedAt = Date.now();
  current = r;
  send(r);
}

/** Whether the instance's core is busy with boot work it reports (it's alive: no need to start another). */
export const booting = (): boolean => current !== null;

/** The core answers: no report from here on. */
export function bootDone(): void {
  if (current) (current = null), send(null);
}

/** Whether a core that's busy starting has stopped saying what it does (or never said, for longer than STALL_MS since the wait began). */
export const bootStalled = (waitingSince: number): boolean => Date.now() - Math.max(changedAt, waitingSince) > STALL_MS;
