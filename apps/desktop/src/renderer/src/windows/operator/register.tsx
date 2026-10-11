// The Operator (renderer half, docs/51): its widget, loaded when first shown; its title is the
// conversation's name (the core sets it). Importing operator.ts here, at startup, keeps the
// board's marks current even while no Operator window is open.

import "./commands.ts";
import { lazyView, registerWindowView } from "../registry.ts";
import "./operator.ts";
// The board's side of workspace.arrange (the Operator's arrange tool).
import "../../shell/board/arrange.ts";

registerWindowView({
  kind: "operator",
  View: lazyView(() => import("./OperatorView.tsx").then((m) => m.OperatorView)),
  describe: () => ({ kind: null }),
});
