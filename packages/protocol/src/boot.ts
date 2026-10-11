// What a core does before it answers (docs/50-boot-work.md): the steps of its
// boot report, written to `<home>/core.boot.json` (BOOT_FILE) by core/src/kernel/boot.ts
// while it migrates or compacts data, read by the app (main/boot.ts) and the CLI
// (readBoot in instance.ts) to say what's going on instead of "connecting".

/** One piece of work: its count when it has one, else a line on what it does now. */
export interface BootStep {
  id: string;
  /** For people: "Upgrading your history". */
  label: string;
  done?: number;
  total?: number;
  /** What it does right now, when it can't count ("Copying it aside first"). */
  detail?: string;
  ended?: boolean;
}

export interface BootReport {
  /** The core writing it: a report whose core isn't the instance's live one is stale. */
  pid: number;
  /** Epoch ms of the last write: the app gives up on a core that stops writing (STALL_MS). */
  at: number;
  steps: BootStep[];
}

export const BOOT_FILE = "core.boot.json";

/** The step running now (the last one not ended), or null. */
export const runningStep = (r: BootReport | null): BootStep | null => r?.steps.findLast((s) => !s.ended) ?? null;

/** "Upgrading your history (41%)", "Making your history smaller: Vacuuming": a step in one line. */
export function stepLine(s: BootStep): string {
  if (s.total) return `${s.label} (${Math.min(100, Math.floor(((s.done ?? 0) / s.total) * 100))}%)`;
  return s.detail ? `${s.label}: ${s.detail}` : s.label;
}
