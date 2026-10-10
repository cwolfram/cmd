// Notifications (renderer half): a list widget, scoped, with Clear Notifications.

import { cmd } from "../../bridge.ts";
import { NotificationsView } from "./NotificationsView.tsx";
import { scopeLabel, scoped } from "../../widgets.ts";
import { registerWindowView } from "../registry.ts";

const notificationsMenu = scoped(() => [{ label: "Clear Notifications", run: () => void cmd.call("notify.clear", {}).catch(() => {}) }]);

registerWindowView({
  kind: "notifications",
  View: NotificationsView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: scopeLabel(w), entries: notificationsMenu(w) }),
  menu: notificationsMenu,
});
