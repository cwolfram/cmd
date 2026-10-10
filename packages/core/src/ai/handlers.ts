// The AI service's methods (ai.*, docs/17): status, connecting a provider, its models.

import type { CoreContext } from "../kernel/context.ts";
import { slice } from "../kernel/handlers.ts";

export const aiHandlers = (core: CoreContext) =>
  slice({
    "ai.status": () => core.ai.status(),
    "ai.connect": (p) => core.ai.connect(p.provider, p.key),
    "ai.models": (p) => core.ai.models(p.provider, p.refresh),
  });
