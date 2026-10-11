// Event ids (docs/28 §2: an id is never minted twice for two things, nor twice for
// one): `<type>:<key>` from what the source knows that's stable (a hook's spool file,
// a notification's id), so the same thing recorded again dedupes; a random key for the
// rest, so two events in the same millisecond don't merge into one row.

import { randomUUID } from "node:crypto";

export function eventId(type: string, key?: string | null): string {
  return `${type}:${key ?? randomUUID()}`;
}
