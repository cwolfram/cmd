// Tabs as views use them: pills over a panel (a sheet's sections), and underlined with
// icons (a window's pages). A badge is a count; a dot means something there wants you.
import { useState } from "react";
import { Tabs } from "./choice.tsx";

/** Pills, with a count and a dot that wants attention. Arrow keys move between tabs. */
export const Pills = () => {
  const [tab, setTab] = useState("changes");
  return (
    <Tabs
      value={tab}
      onChange={setTab}
      items={[
        { id: "changes", label: "Changes" },
        { id: "settings", label: "Settings" },
        { id: "files", label: "Files", badge: 6 },
        { id: "health", label: "Health", badge: "dot", tone: "warning" },
      ]}
    />
  );
};

/** Underlined, with icons: a window's pages. */
export const Underline = () => {
  const [tab, setTab] = useState("general");
  return (
    <Tabs
      variant="underline"
      value={tab}
      onChange={setTab}
      items={[
        { id: "general", label: "General", icon: "gearshape" },
        { id: "appearance", label: "Appearance", icon: "paintpalette" },
        { id: "keyboard", label: "Keyboard", icon: "keyboard" },
      ]}
    />
  );
};
