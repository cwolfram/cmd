// Jam's method: change a pattern's code as asked, with the model (jam/change.ts).

import type { CoreContext } from "../kernel/context.ts";
import { slice } from "../kernel/handlers.ts";
import { changeCode } from "./change.ts";

export const jamHandlers = (core: CoreContext) =>
  slice({
    "jam.change": (p) => changeCode((o) => core.ai.object(o), p),
  });
