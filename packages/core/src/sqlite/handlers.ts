// SQLite windows' reads (sqlite.*, docs/36): a database's schema, a table's rows, a read-only
// query, an export.

import type { CoreContext } from "../kernel/context.ts";
import { slice } from "../kernel/handlers.ts";

export const sqliteHandlers = (core: CoreContext) =>
  slice({
    "sqlite.schema": (p) => core.sqlite.schema(p.path),
    "sqlite.rows": (p) => core.sqlite.rows(p),
    "sqlite.query": (p) => core.sqlite.query(p),
    "sqlite.export": (p) => core.sqlite.export(p.path, p.table, p.file),
  });
