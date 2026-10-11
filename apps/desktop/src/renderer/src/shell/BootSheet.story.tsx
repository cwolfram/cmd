// The sheet while the core does work before it answers (docs/50).
import { BootSheet } from "./BootSheet.tsx";

const at = Date.now();

/** The migration counting its rows. */
export const Counting = () => <BootSheet report={{ pid: 1, at, steps: [{ id: "migrate", label: "Updating recorded data", done: 412_000, total: 1_004_000 }] }} />;
/** One statement that can't count (a VACUUM): what it does instead of a number, the bar indeterminate. */
export const Detail = () => <BootSheet report={{ pid: 1, at, steps: [{ id: "compact", label: "Shrinking recorded data", detail: "Freeing disk space" }] }} />;
/** A step done, the next one running. */
export const Several = () => (
  <BootSheet
    report={{
      pid: 1,
      at,
      steps: [
        { id: "migrate", label: "Updating recorded data", ended: true },
        { id: "compact", label: "Shrinking recorded data", done: 61_000, total: 150_000 },
      ],
    }}
  />
);
