// Onboarding (renderer/src/onboarding): which steps this Mac has been through,
// kept in the UI state dir. The first app window that asks after a launch gets
// them, and whether this is a new install, so the sheet opens once, in one
// window; later windows and later asks get nothing. Steps are recorded when
// the sheet closes, done or skipped, so a quit halfway shows the rest again.

import fs from "node:fs";
import path from "node:path";
import type { OnboardingClaim } from "../shared/ipc.ts";
export type { OnboardingClaim } from "../shared/ipc.ts";

let claimed = false;
const fileIn = (dir: string) => path.join(dir, "onboarding.json");

function readSeen(dir: string): string[] | null {
  try {
    const v = JSON.parse(fs.readFileSync(fileIn(dir), "utf8")) as { seen?: unknown };
    return Array.isArray(v.seen) ? v.seen.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return null;
  }
}

/** @param existingUser the state dir was there before this launch. */
export function claimOnboarding(dir: string, existingUser: boolean): OnboardingClaim | null {
  if (claimed) return null;
  claimed = true;
  const seen = readSeen(dir);
  return { seen: seen ?? [], newInstall: !existingUser && seen === null };
}

export function recordOnboarding(dir: string, ids: string[]): void {
  const seen = [...new Set([...(readSeen(dir) ?? []), ...ids])];
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileIn(dir), JSON.stringify({ seen }) + "\n");
  } catch {}
}
