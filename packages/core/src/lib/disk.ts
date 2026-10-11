// Free space where a file goes, for work that needs room before it starts
// (docs/50): a VACUUM INTO copies the event log, a VACUUM rewrites it. Saying
// so up front beats failing minutes in with the disk full.

import fs from "node:fs";

/** Bytes free to this user on the volume of `dir`; Infinity when it can't tell. */
export function freeBytes(dir: string): number {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

/** "4.2 GB": a size for people. */
export const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;
