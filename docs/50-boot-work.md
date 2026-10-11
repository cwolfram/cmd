# Boot work people can see

**Status:** built: the core's boot report (`kernel/boot.ts`, `<home>/core.boot.json`), the app's wait on it (`main/boot.ts`), the sheet (`shell/BootSheet.tsx`), progress on startup jobs, the CLI's wait line, the free-space check.

> Decided (2026-10-11, the user, after a review of the first plan): no registry of boot steps and no ledger table; one progress report the existing pieces call; a file beside `core.pid` as the channel before the core listens; a sheet only when blocking work lasts; progress counts on the startup jobs.

## Why

The first launch of a version can do minutes of work before the core answers: the event log's schema migration (a copy aside with `VACUUM INTO`, then the steps: about a minute on 1.9 GB), the one-time compaction (`data/compact.ts`: about 20 s on 2.9 GB). All the app said meanwhile was "Connecting to core…", for up to ten minutes, and then it gave up. The work after `listen()` (docs/34's startup jobs) showed one label in the footer and no progress. People saw an app that seemed stuck, with no idea why or for how long.

What others do (researched 2026-10-11):

- **Split by whether the app can run meanwhile.** GitLab has regular migrations (schema, under 3 minutes, the deploy waits), post-deployment ones, and batched background migrations (data only, never schema, in batches, with a status page, pause and retry) ([style guide](https://docs.gitlab.com/development/migration_style_guide/), [background migrations](https://archives.docs.gitlab.com/16.11/ee/update/background_migrations.html)). Mastodon runs pre- and post-deployment migrations as separate steps. docs/34 already made that split for cmd: almost nothing before the socket, everything else behind it.
- **When it blocks, show a window, a reason and a count.** Seed's desktop app showed no window during a long migration and people thought it was broken ([note](https://delibera.ethosfera.org/hm/z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/discussions/enhancement-note-improve-ux-during-desktop-app-migrations)). Signal Desktop showed "Optimizing messages… 0 of 6,582" ([#2627](https://github.com/signalapp/Signal-Desktop/issues/2627)). Fusion's launch screen shows migration status and doesn't time out while one runs ([v0.71.0](https://newreleases.io/project/github/Runfusion/Fusion/release/v0.71.0)).
- **Maintenance goes to idle time.** Firefox's Places runs an incremental vacuum and integrity checks in idle maintenance ([PlacesDBUtils](https://searchfox.org/firefox-main/source/toolkit/components/places/PlacesDBUtils.sys.mjs)); Chromium posts deferred startup work at best-effort priority ([after_startup_task_utils.h](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/after_startup_task_utils.h)). cmd's retention and reclaim already work that way.

## What's built

### One report, called by what exists

No registry of steps: the blocking work is already a sequence (`main.ts` → `prepareStateDir` → `new Core`), and the work behind the socket already a registry (`scheduler.startup`). Each store keeps its own "done" marker (`meta('schema')`, `meta('compact')`, view formats, `needsFtsRebuild`), which is the only truth about what's done: a ledger in `cmd.sqlite` saying the event log was compacted could lie once the two files are copied apart. What was missing is a way to say what's running.

`kernel/boot.ts` is that: `bootStep(id, label)` starts a step and returns `progress(done, total, detail?)` and `end()`. Until `startBootReport(home)` (main.ts, right after the pid file) it does nothing, so tests and the in-memory core pay nothing. It writes `<home>/core.boot.json`: `{ pid, at, steps: [{ id, label, done?, total?, detail?, ended? }] }`, with a temp file and a rename, synchronously (it runs inside a migration's transaction, on a thread that's blocked anyway), at most four times a second except when a step starts or ends. `listen()` succeeding deletes it, and so does the core's exit.

Reported now: the event log's migration ("Updating records": the copy aside, each step with its rows, the commit) and the compaction ("Slimming down records": the rows, then the vacuum). A single `VACUUM`, `VACUUM INTO`, `CREATE INDEX` or `COMMIT` can't report while it runs; the step says what it's doing before it starts (`detail`), with no count, and the app's wait allows for that (below). `cmd.sqlite`'s migration is milliseconds and isn't reported.

### The app waits on it

`main/boot.ts` reads the file while `waitForCore` waits (it moved there from `index.ts`). It trusts it only when its `pid` is `core.pid`'s, that process is alive and the lock is held: a core that crashed mid-step leaves a file nobody reads. It's read only while the app waits for a core: at launch, after Restart Core and after an update restarts an old core, whoever started the core (the app, `pnpm core`). A core restarted behind the app's back later (stopped and started from a terminal while the app stays open) reconnects with "Connecting to core…" and no sheet: rare, and only in development, so the preload doesn't read the file too. Worktrees and `CMD_HOME` are separate by construction.

The fixed ten minutes are gone: the app waits as long as the file changes, and gives up after `STALL_MS` (10 minutes, longer than any single statement on a big log) without a new write. Each read goes to the windows as `core-boot` (null once the core answers); a window that opens meanwhile asks with `core-boot` too.

### The sheet

`shell/BootSheet.tsx`: shown when the core isn't connected yet, a report says work is running, and it has run for a second (no flash for a quick migration). One row per step: done, running with its count or detail, all drawn by one `ProgressRing` (filling, turning, done, failed) so the rows line up. It goes when the core answers; What's New opens after it, as before. A core that fails to start gets the existing dialog (`coreFailed`: Try Again, Show Log), with the backup path in the log, not the sheet.

### Progress on startup jobs

`scheduler.progress(id, done, total)` adds a count to a running startup job; `StartupStatus.tasks[i]` carries `done`/`total` and the footer says "Indexing sessions · 41%". Reporting: the sessions rebuild, the full-text rebuild, the turns rebuild (agents replayed), the token backfill ("Counting tokens", transcript messages read) and the stats build ("Counting stats", hours built). A job is shown only while it runs, so work a job merely starts was invisible: the stats job now waits for every stat to have its history (`StatsService.built`), and the full-text job for its rebuild. The transcript reader's passes have their own progress (`search.status`: the ring in search fields, Settings → Search), so its job only starts it. Not counted, being short or bounded: the legacy import, the command-output index, the journal's git sync, agent home discovery.

### No space, said up front

`VACUUM INTO` needs about the log's size free, `VACUUM` about twice its live pages. `lib/disk.ts` `freeBytes(dir)` (statfs) is checked first: a migration without room refuses to start (`StateDirRefused("disk")`, the app's refusal dialog says how much is needed), the compaction skips its vacuum and tries again next launch (its row work is idempotent).

### The CLI

`cmd` against a core that isn't listening yet reads the same file and says "cmd is getting ready: Updating records · 41%…", waiting up to 10 minutes (`BOOT_WAIT_MS`), instead of "no core running". So a script that runs `cmd` right after an update waits too, rather than failing. Hooks never wait: `cmd hook` returns before connecting.

## Crashes and other cases

- **Crash mid-step.** A migration is one transaction: the file is as it was, and runs it again. The compaction's row work is one transaction and its vacuum is atomic; its marker is written after the vacuum, so a crash between them runs the pass again, which changes nothing the second time.
- **Downgrade.** A log from a newer schema is refused as before (`StateDirRefused("too-new")`). The compaction bumps no schema: an older cmd reads a compacted log.
- **An update while an old core serves.** `checkCoreBuild` restarts it, and the new core's work shows the same way: the sheet doesn't depend on a cold launch.

## Not built

- Listening early in a "booting" mode (only `core.hello` and a status): cleaner, but every client (CLI, hooks, widgets, preload) would have to handle a core that answers nothing else. The file does the job.
- A worker for `VACUUM` so the core could keep a heartbeat: a vacuum needs the file to itself anyway.
