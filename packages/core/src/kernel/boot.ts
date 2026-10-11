// The core's boot report (docs/50-boot-work.md): what it does before it
// answers (migrating the event log, compacting it), written to
// `<home>/core.boot.json` for the app and the CLI, which can't ask a core that
// isn't listening yet. Synchronous on purpose: the steps run on a blocked
// thread, inside a transaction, and a write is a temp file and a rename. Until
// startBootReport() it does nothing (tests, the in-memory core).

import fs from "node:fs";
import path from "node:path";
import { BOOT_FILE, type BootReport, type BootStep } from "@cmd/protocol";

/** Writes at most this often, but always when a step starts or ends. */
const WRITE_MS = 250;

let file: string | null = null;
let report: BootReport = { pid: process.pid, at: 0, steps: [] };
let written = 0;

/** Reports from now on into `home` (main.ts, right after the pid file). */
export function startBootReport(home: string): void {
  file = path.join(home, BOOT_FILE);
  report = { pid: process.pid, at: Date.now(), steps: [] };
  fs.rmSync(file, { force: true });
}

/** The core answers (or exits): the report goes, and nothing is written after. */
export function endBootReport(): void {
  if (file) fs.rmSync(file, { force: true });
  file = null;
}

function write(now: boolean): void {
  if (!file) return;
  const t = Date.now();
  if (!now && t - written < WRITE_MS) return;
  written = report.at = t;
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(report));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // The state dir went away or is read-only: the report is a courtesy, the work goes on.
  }
}

export interface BootProgress {
  /** `done` of `total`, and what it does now when it can't count. */
  progress(done: number, total: number, detail?: string): void;
  /** What it does now, with no count (a VACUUM, a COMMIT: one statement that can't report while it runs). */
  detail(text: string): void;
  end(): void;
}

/** Starts a step of boot work, shown as `label` ("Updating recorded data"). */
export function bootStep(id: string, label: string): BootProgress {
  const step: BootStep = { id, label };
  report.steps = [...report.steps.filter((s) => s.id !== id), step];
  write(true);
  return {
    progress(done, total, detail) {
      // The first count at once: the sheet shows a bar from the start, not after the next write.
      const first = step.total === undefined;
      Object.assign(step, { done, total, detail });
      write(first);
    },
    detail(text) {
      Object.assign(step, { done: undefined, total: undefined, detail: text });
      write(true);
    },
    end() {
      step.ended = true;
      write(true);
    },
  };
}

/** Runs `fn` as a step, ended however it ends. */
export function inBootStep<T>(id: string, label: string, fn: (p: BootProgress) => T): T {
  const p = bootStep(id, label);
  try {
    return fn(p);
  } finally {
    p.end();
  }
}
