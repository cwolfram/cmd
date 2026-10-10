// The Navigator (renderer half): the sidebar of workspaces, windows and agents, as a window type.

import { NavigatorView } from "./Navigator.tsx";
import { registerWindowView } from "../registry.ts";

registerWindowView({
  kind: "navigator",
  View: NavigatorView,
  describe: () => ({ kind: null }),
});
