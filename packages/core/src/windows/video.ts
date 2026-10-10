// Trimming a video window's file (video.trim): macOS's avconvert copies the kept
// range into a new file beside it, without re-encoding (AVFoundation's passthrough
// export, as QuickTime's Trim; edit lists keep the cut exact, not on a keyframe).
// AVFoundation reads MP4, M4V and MOV; WebM can't be trimmed.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expandHome } from "./builtin.ts";
import { freeName } from "../lib/fileops.ts";

export const AVCONVERT = "/usr/bin/avconvert";
/** What avconvert can read and write. */
export const TRIMMABLE = /\.(mp4|m4v|mov)$/i;

/** Writes `<name> (trimmed).<ext>` (or "(trimmed) 2", …) next to the file; resolves to its path. */
export function trimVideo(file: string, start: number, end: number, bin = AVCONVERT): Promise<string> {
  const from = path.resolve(expandHome(file));
  if (!TRIMMABLE.test(from)) return Promise.reject(new Error("Only MP4, M4V and MOV videos can be trimmed."));
  if (!fs.statSync(from).isFile()) return Promise.reject(new Error(`not a file: ${from}`));
  if (!(start >= 0) || !(end > start)) return Promise.reject(new Error("The trim's end has to come after its start."));
  const ext = path.extname(from);
  const to = freeName(path.dirname(from), `${path.basename(from, ext)} (trimmed)`, ext);
  const args = ["--source", from, "--output", to, "--preset", "PresetPassthrough", "--start", start.toFixed(3), "--duration", (end - start).toFixed(3)];
  return new Promise((resolve, reject) =>
    execFile(bin, args, { timeout: 10 * 60_000 }, (err, _out, stderr) => {
      if (!err && fs.existsSync(to)) return resolve(to);
      fs.rmSync(to, { force: true });
      reject(new Error(`Couldn't trim the video${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : "."}`));
    }),
  );
}
