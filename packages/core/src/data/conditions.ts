// A log query's WHERE clause and its arguments (DataStore.query, delete, affected):
// types as exact names or prefixes, each branch with the time range so SQLite takes the
// (type, at) index, the identity columns, a seq cursor and full text.

import type { DataQuery } from "@cmd/protocol";

const COL = { sessionId: "session_id", agentId: "agent_id", projectId: "project_id", workspaceId: "workspace_id", paneId: "pane_id", windowId: "window_id", parentId: "parent_id" } as const;

/** WHERE clause and arguments for a query (without ORDER and LIMIT). */
export function conditions(q: DataQuery, text: (expression: string) => string = (t) => t): [string, (string | number)[]] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.types?.length) {
    const exact = q.types.filter((t) => !t.endsWith("."));
    const prefixes = q.types.filter((t) => t.endsWith("."));
    // With a type filter the (type, at) index is the narrow one: each branch carries the time range, so a
    // type looks up only its rows in range (one shared range outside the ORs walks every row of the types).
    const at = q.at ? ` AND at >= ? AND at < ?` : "";
    const range = q.at ? [q.at[0], q.at[1]] : [];
    // A range, not LIKE: LIKE is case-insensitive by default and skips the index.
    const parts = [...(exact.length ? [`(type IN (${exact.map(() => "?").join(",")})${at})`] : []), ...prefixes.map(() => `(type >= ? AND type < ?${at})`)];
    if (exact.length) args.push(...exact, ...range);
    for (const p of prefixes) args.push(p, `${p}￿`, ...range);
    where.push(`(${parts.join(" OR ")})`);
  } else if (q.at) where.push(`at >= ? AND at < ?`), args.push(q.at[0], q.at[1]);
  for (const k of ["sessionId", "agentId", "projectId", "workspaceId", "paneId", "windowId", "parentId"] as const) {
    const v = q[k];
    if (v) where.push(`${COL[k]} = ?`), args.push(v);
  }
  if (q.after) where.push(`seq > ?`), args.push(q.after);
  if (q.text) where.push(`seq IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?)`), args.push(text(q.text));
  return [where.join(" AND "), args];
}
