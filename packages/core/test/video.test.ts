// video.trim: avconvert copies the kept range into a new file beside the video.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AVCONVERT, trimVideo } from "../src/windows/video.ts";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-video-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A stand-in avconvert that writes its --output (or fails, saying why). */
function fakeBin(ok: boolean): string {
  const bin = path.join(dir, "avconvert");
  fs.writeFileSync(bin, ok ? `#!/bin/sh\nwhile [ "$1" != "--output" ]; do shift; done\necho "$@" > "$2"\n` : `#!/bin/sh\necho "AVFoundationErrorDomain: cannot open" >&2\nexit 1\n`, { mode: 0o755 });
  return bin;
}

describe("trimVideo", () => {
  it("writes '<name> (trimmed)' beside the file, then '(trimmed) 2'", async () => {
    const src = path.join(dir, "clip.mov");
    fs.writeFileSync(src, "");
    const bin = fakeBin(true);
    expect(await trimVideo(src, 1, 3.5, bin)).toBe(path.join(dir, "clip (trimmed).mov"));
    expect(fs.readFileSync(path.join(dir, "clip (trimmed).mov"), "utf8")).toContain("--start 1.000 --duration 2.500");
    expect(await trimVideo(src, 1, 3.5, bin)).toBe(path.join(dir, "clip (trimmed) 2.mov"));
  });

  it("refuses WebM, a backwards range, and says why avconvert failed", async () => {
    fs.writeFileSync(path.join(dir, "a.webm"), "");
    fs.writeFileSync(path.join(dir, "a.mp4"), "");
    await expect(trimVideo(path.join(dir, "a.webm"), 0, 1, fakeBin(true))).rejects.toThrow(/MP4, M4V and MOV/);
    await expect(trimVideo(path.join(dir, "a.mp4"), 2, 1, fakeBin(true))).rejects.toThrow(/after its start/);
    await expect(trimVideo(path.join(dir, "a.mp4"), 0, 1, fakeBin(false))).rejects.toThrow(/cannot open/);
    expect(fs.existsSync(path.join(dir, "a (trimmed).mp4"))).toBe(false);
  });

  it.skipIf(!fs.existsSync(AVCONVERT) || !fs.existsSync("/opt/homebrew/bin/ffmpeg"))("trims a real video to the frame, without re-encoding", async () => {
    const src = path.join(dir, "real.mp4");
    execFileSync("/opt/homebrew/bin/ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=duration=6:size=320x240:rate=30", "-c:v", "libx264", "-g", "60", src]);
    const out = await trimVideo(src, 1.3, 4.1);
    const probe = execFileSync("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "compact", out], { encoding: "utf8" });
    expect(probe).toContain("codec_name=h264");
    expect(Number(/duration=([\d.]+)/.exec(probe)![1])).toBeCloseTo(2.8, 1);
  });
});
