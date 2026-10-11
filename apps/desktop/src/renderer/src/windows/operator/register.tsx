// The Operator (renderer half, docs/51): its widget, loaded when first shown; its title menu
// starts over. Importing operator.ts here, at startup, keeps the board's marks current even
// while no Operator window is open.

import "./commands.ts";
import type { AppWindow } from "@cmd/protocol";
import type { MenuEntry } from "../../lib/context.ts";
import { lazyView, registerWindowView } from "../registry.ts";
import { operatorCall } from "./operator.ts";

const menu = (w: AppWindow): MenuEntry[] => [{ label: "New Conversation", run: () => void operatorCall.reset(w.workspaceId).catch(() => {}) }];

registerWindowView({
  kind: "operator",
  View: lazyView(() => import("./OperatorView.tsx").then((m) => m.OperatorView)),
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: "Operator", entries: menu(w) }),
  menu,
});
