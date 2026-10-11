// The sheet while the core does work before it answers (docs/50), in the steps a
// first launch after an update goes through: the event log's migration (a copy
// aside, its rows, saving), then the one-time compaction (its rows, tidying up,
// freeing disk space). Labels and details as the core reports them.
import type { BootStep } from "@cmd/protocol";
import { BootSheet } from "./BootSheet.tsx";

const at = Date.now();
const migrate = (s: Partial<BootStep> = {}): BootStep => ({ id: "migrate", label: "Updating recorded data", ...s });
const compact = (s: Partial<BootStep> = {}): BootStep => ({ id: "compact", label: "Shrinking recorded data", ...s });
const sheet = (...steps: BootStep[]) => <BootSheet report={{ pid: 1, at, steps }} />;

/** The migration's copy aside: one statement, so no count. */
export const Copying = () => sheet(migrate({ detail: "Making a copy first" }));
/** The migration counting its rows. */
export const Migrating = () => sheet(migrate({ done: 412_000, total: 1_004_000 }));
/** Migrated; the compaction counting the transcript lines it trims. */
export const Shrinking = () => sheet(migrate({ ended: true }), compact({ done: 61_000, total: 183_009 }));
/** The compaction's vacuum: one statement again, the last step. */
export const Freeing = () => sheet(migrate({ ended: true }), compact({ detail: "Freeing disk space" }));
/** A launch with only the compaction to do (the log was already on this schema). */
export const CompactionOnly = () => sheet(compact({ done: 8_192, total: 183_009 }));
