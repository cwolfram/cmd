// Notifications' methods (notify.*): one from a program or the CLI, and Clear.

import type { CoreContext } from "../kernel/context.ts";
import { slice } from "../kernel/handlers.ts";
import { eventId } from "../data/ids.ts";

export const notifyHandlers = (core: CoreContext) =>
  slice({
    "notify.send": (p) => (core.notifications.send(p.paneId ?? null, p.title, p.body), null),
    "notify.clear": () => {
      core.data.record({ id: eventId("notification.clear"), at: Date.now(), type: "notification.clear", source: "user", data: {} });
      return null;
    },
  });
