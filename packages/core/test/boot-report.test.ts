// What a core says it does before it answers (docs/50): the boot report
// (kernel/boot.ts) and who writes into it (the event log's migration, the
// compaction), readBoot's trust rules, the free-space checks, and progress
// on startup jobs.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_FILE, runningStep, stepLine, type BootReport } from "@cmd/protocol";
import { coreRefusal, coreRefusalLine, readBoot } from "@cmd/protocol/node";
import { bootStep, endBootReport, inBootStep, startBootReport } from "../src/kernel/boot.ts";
import { acquireLock } from "../src/kernel/lock.ts";
import { Scheduler } from "../src/kernel/scheduler.ts";
import { migrate, NoSpaceForMigration } from "../src/data/migrations.ts";
import { DataStore } from "../src/data/store.ts";
import { compactLog } from "../src/data/compact.ts";
import { eventsV1, insertV1 } from "./events-v1.ts";
import { rmTemp } from "./tmp.ts";

let dir: string;
beforeEach(() => void (dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmd-boot-")))));
afterEach(() => {
  endBootReport();
  vi.restoreAllMocks();
  rmTemp(dir);
});

const file = () => path.join(dir, BOOT_FILE);
const report = (): BootReport => JSON.parse(fs.readFileSync(file(), "utf8")) as BootReport;
/** Every report written, in order (writes are throttled, but each step's start and end always lands). */
function recordWrites(): BootReport[] {
  const seen: BootReport[] = [];
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    rename(from, to);
    if (String(to).endsWith(BOOT_FILE)) seen.push(report());
  });
  return seen;
}

describe("the boot report", () => {
  it("does nothing until it's started, then says each step, and goes when the core answers", () => {
    bootStep("early", "Not reported").end();
    expect(fs.existsSync(file())).toBe(false);
    startBootReport(dir);
    const p = bootStep("migrate", "Updating records");
    expect(report()).toMatchObject({ pid: process.pid, steps: [{ id: "migrate", label: "Updating records" }] });
    p.detail("Making a backup");
    expect(runningStep(report())).toMatchObject({ detail: "Making a backup" });
    p.end();
    inBootStep("compact", "Slimming down records", (b) => b.progress(5, 10));
    expect(report().steps.map((s) => [s.id, s.ended])).toEqual([["migrate", true], ["compact", true]]);
    endBootReport();
    expect(fs.existsSync(file())).toBe(false);
  });

  it("reads in one line, like the footer: a count as a percentage, else what it does", () => {
    expect(stepLine({ id: "m", label: "Updating records", done: 41, total: 100 })).toBe("Updating records · 41%");
    expect(stepLine({ id: "c", label: "Slimming down records", detail: "Freeing up space" })).toBe("Slimming down records · Freeing up space");
  });

  it("is trusted only from the live core: its pid in core.pid, alive, holding the lock", () => {
    startBootReport(dir);
    bootStep("migrate", "Updating records");
    expect(readBoot(dir)).toBeNull(); // no core.pid
    fs.writeFileSync(path.join(dir, "core.pid"), String(process.pid));
    expect(readBoot(dir)).toBeNull(); // nobody holds the lock: a crashed core's leftover
    const lock = acquireLock(path.join(dir, "core.lock"))!;
    try {
      expect(readBoot(dir)?.steps[0]?.label).toBe("Updating records");
      fs.writeFileSync(path.join(dir, "core.pid"), String(process.pid + 1_000_000));
      expect(readBoot(dir)).toBeNull(); // another core's
    } finally {
      lock.release();
    }
  });
});

describe("who reports", () => {
  it("the event log's migration: the copy aside, its rows, the commit", () => {
    const log = path.join(dir, "events.sqlite");
    const old = eventsV1(log);
    insertV1(old, { seq: 1, id: "a", at: 1000, type: "command", text: "ls" });
    startBootReport(dir);
    const seen = recordWrites();
    migrate(old, log);
    old.close();
    const steps = seen.map((r) => runningStep(r)).filter(Boolean);
    expect(steps.map((s) => s!.detail).filter(Boolean)).toEqual(["Making a backup", "Saving"]);
    expect(seen.at(-1)!.steps).toEqual([expect.objectContaining({ id: "migrate", ended: true })]);
  });

  it("a migration without room for its copy doesn't start, and the file stays as it was", () => {
    const log = path.join(dir, "events.sqlite");
    const old = eventsV1(log);
    insertV1(old, { seq: 1, id: "a", at: 1000, type: "command", text: "ls" });
    vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 1, bsize: 1 } as fs.StatsFs);
    expect(() => migrate(old, log)).toThrow(NoSpaceForMigration);
    expect(fs.existsSync(`${log}.bak-v1`)).toBe(false);
    old.close();
    // The app shows why: the refusal line carries the reason.
    expect(coreRefusal([coreRefusalLine("disk", "There isn't enough free space")])).toEqual({ reason: "disk", text: "There isn't enough free space" });
  });

  it("the compaction of a big log, with its rows counted; without room it skips the vacuum and tries again next launch", () => {
    const store = new DataStore(path.join(dir, "events.sqlite"));
    // Big enough to be reported (over 1000 pages): signatures that don't compress.
    for (let i = 0; i < 300; i++) store.record({ id: `t${i}`, at: i, type: "transcript.message", source: "transcript:claude", data: {}, content: JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: randomBytes(16_000).toString("base64") }] } }) });
    store.db.exec(`DELETE FROM meta WHERE key = 'compact'`);
    startBootReport(dir);
    const seen = recordWrites();
    vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: 1, bsize: 1 } as fs.StatsFs);
    expect(compactLog(store)).toBe(true);
    expect(store.meta("compact")).toBeNull(); // not vacuumed: again next launch
    expect(seen.some((r) => runningStep(r)?.total === 300)).toBe(true);
    expect(seen.at(-1)!.steps).toEqual([expect.objectContaining({ id: "compact", label: "Slimming down records", ended: true })]);
    vi.mocked(fs.statfsSync).mockRestore();
    expect(compactLog(store)).toBe(true);
    expect(store.meta("compact")).not.toBeNull();
    store.close();
  });
});

describe("startup jobs", () => {
  it("carry how far they are while they run", async () => {
    const s = new Scheduler({ watchdog: false });
    let release!: () => void;
    s.startup("sessions", "Indexing sessions", () => new Promise<void>((r) => (release = r)));
    while (!release) await new Promise((r) => setImmediate(r));
    s.progress("sessions", 41, 100);
    expect(s.status().tasks).toEqual([{ id: "sessions", label: "Indexing sessions", done: 41, total: 100 }]);
    s.progress("other", 1, 2); // not a running job: ignored
    release();
    await s.idle();
    expect(s.status().tasks).toEqual([]);
    s.dispose();
  });
});

describe("the watchdog", () => {
  it("doesn't count boot work as a stall", async () => {
    const s = new Scheduler();
    // Twice the stall threshold (STALL_MS, 100 ms), then a few ticks for the watchdog to look.
    s.unwatched(() => {
      for (const t0 = Date.now(); Date.now() - t0 < 200; );
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(s.stalls()).toEqual([]);
    s.dispose();
  });
});
