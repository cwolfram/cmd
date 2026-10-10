// Workbench stories (pnpm workbench videoview): the Video window on a real file, read
// by the real core: playing, trimming (saves work, or fail), a file that isn't a video,
// and every size. The sample is .cmd-dev/fixtures/sample.mp4 in the checkout (any short clip).

import type { TrimRange } from "@cmd/ui";
import { AllSizes, RefWindow, type SizeName } from "../../reference/RefWindow.tsx";
import { storyWindow, useRepoFile } from "../../reference/RepoFile.tsx";
import { VideoView, type VideoApi } from "./VideoView.tsx";

const works: VideoApi = { saveTrim: (p) => new Promise((r) => setTimeout(() => r(p.replace(/(\.\w+)$/, " (trimmed)$1")), 900)) };
const fails: VideoApi = { saveTrim: () => new Promise((_, no) => setTimeout(() => no(new Error("Couldn't save the trimmed video: the disk is full.")), 600)) };

function Vid({ rel = ".cmd-dev/fixtures/sample.mp4", size = "wide", trim, api = works }: { rel?: string; size?: SizeName; trim?: TrimRange; api?: VideoApi }) {
  const path = useRepoFile(rel);
  return (
    <RefWindow icon="film" name={rel.split("/").pop()!} size={size}>
      {path && <VideoView win={storyWindow("video", { path })} focused={false} api={api} initialTrim={trim} />}
    </RefWindow>
  );
}

export const Playing = () => <Vid />;
export const Trimming = () => <Vid trim={{ start: 6.2, end: 27.5 }} />;
export const TrimFails = () => <Vid trim={{ start: 6.2, end: 27.5 }} api={fails} />;
export const NotAVideo = () => <Vid rel="README.md" />;
export const Sizes = () => <AllSizes render={(s) => <Vid size={s} />} />;
export const TrimSizes = () => <AllSizes render={(s) => <Vid size={s} trim={{ start: 6.2, end: 27.5 }} />} />;
