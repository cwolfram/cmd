// The Files window on this checkout,
// through the Workbench's real core: a window at every size, the sidebar's dense
// version, a folder that can't be read, and one file of every kind (their icons).

import { AllSizes, RefWindow, type SizeName } from "../../reference/RefWindow.tsx";
import { storyWindow, useRepoFile } from "../../reference/RepoFile.tsx";
import { PlacementContext } from "../registry.ts";
import { FilesView } from "./FilesView.tsx";

function W({ rel = "packages/ui", size = "regular" }: { rel?: string; size?: SizeName | readonly [number, number] }) {
  const path = useRepoFile(rel);
  return (
    <RefWindow icon="folder" name="Files" size={size}>
      {path && <FilesView key={path} win={storyWindow("files", { path })} focused={false} />}
    </RefWindow>
  );
}

export const Default = () => <W />;
export const Sidebar = () => (
  <PlacementContext.Provider value="sidebar">
    <W size={[260, 520]} />
  </PlacementContext.Provider>
);
/** One (empty) file of each kind: each shows its viewer's icon, or what it holds. */
export const Kinds = () => <W rel="apps/desktop/src/renderer/src/reference/fixtures/kinds" />;
export const Unreadable = () => <W rel="no-such-folder" />;
export const Sizes = () => <AllSizes render={(s) => <W size={s} />} />;
