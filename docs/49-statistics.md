# Statistics

**Status:** proposal: a stats registry in the core, a chart kit for it, and a Statistics widget; nothing built.

> Status (2026-10-11): plan, not started. From a request by the user: "a statistics widget that presents data about use of cmd … a properly managed low level system that we can register new stats into that get cached/updated properly … extend/redesign the available chart types … apple-like design but still with a utilitarian terminal feeling, not kitschy: efficient, condensed, clear." Not to be confused with `kernel/usage.ts`, the anonymous telemetry: nothing here leaves the Mac.

How much cmd was used, by whom (you or your agents), on what and with what result, shown as numbers and charts that read at a glance. Three parts, each useful alone:

1. **Stats** (`packages/core/src/stats/`): features declare stats; the core computes them from the event log into time buckets, keeps them current as events arrive, rebuilds them when their rules change, and answers one query shape (`stats.query`, live with `stats.subscribe`, `cmd stats`).
2. **Charts** (`packages/ui/src/charts/`): a small grammar of marks (bars, lines, areas, rules, cells) with shared scales, axes, a scrubbing cursor and formatting, and the presets dashboards need (time bars, calendar, punch card, ranking, meter, proportion, distribution). Today's `Chart` and `Sparkline` become presets of it.
3. **The Statistics widget**: an overview, then a section per area (agents, terminals, you, projects, model calls, cmd itself), every number drillable to a chart and a table.

Read first: docs/28-data-plan.md (events, views, cursors, subscriptions, retention), docs/30-data-capabilities.md (what the log knows; "Usage and cost" and "Time per project" are this doc's ancestors), docs/40-window-design.md §4 (charts), the window-design skill, docs/16-widgets.md (built-in widgets), docs/34-startup-scheduler.md (jobs and yielding).

## Why

cmd records nearly everything you and your agents do (docs/30: agent turns, commands with exit codes and durations, git, focus, pages, model calls), but shows almost none of it as numbers. The questions people ask are simple and today need SQL: how many hours did agents work this week, and on what? How often do my tests fail? Where did my time go? How many tokens did that cost? Is the core getting slower? Screen Time, WakaTime and GitHub's contribution graph prove the appeal of the same shape: a headline number, a change against last period, a bar over time, a ranked list.

Today each feature that wants a number writes its own aggregation: `cmd data ai` loads 100k events into the CLI and sums them, Workspace Actions counts command runs on its own, `data.stats` scans every row in a worker. There is no aggregate query, no cache, no history for gauges (CPU, memory and stalls live in memory only), and the `counters.daily` view docs/28 planned was never built. A registry fixes that once.

## Prior art

| Tool | What it shows | Take |
|---|---|---|
| Apple Screen Time | Daily average as the headline, "12% up from last week", hourly/daily bars stacked by category, most-used apps as a ranked list with a bar per row | The page shape: headline, delta, bars, ranking. Today's bar in the accent, past bars neutral |
| Apple Health / Fitness | One big number with its unit, scrubbing a chart replaces the headline with the selected value; D/W/M/6M/Y segments | Readout in the header while scrubbing, not a floating tooltip |
| Swift Charts | Marks (Bar, Line, Area, Point, Rule, Rectangle, Sector), y axis trailing, faint dashed grid, `RuleMark` for averages and selection | The mark grammar and its defaults; we already put the y axis on the right |
| WakaTime | Heartbeats rolled into durations (gaps under 15 min count as work), time by project, language, editor; best day; weekly email | Span merging with a gap rule; a weekly summary (the journal's week could carry it) |
| ActivityWatch | Buckets of `{timestamp, duration, data}`, heartbeats merged within `pulsetime`; timeline, top apps and titles | Spans are the right unit for time stats; known weakness: UTC days |
| Atuin `stats` | Top commands with counts, totals and uniques per period, plain text | `cmd stats` in the terminal, dense and text-first |
| GitHub contributions | Weeks × weekdays, 5 levels of one hue, empty days as visible cells, "Less → More" | The calendar: quantile levels, one hue, neutral empty cells |
| btop / spark | Braille and eighth-block graphs, meters as bar + number + unit on one line, no legends | The terminal half of the look; the CLI's rendering |
| Stephen Few's bullet graph | One bar, a target tick, 2–5 muted bands | Meters for budgets and limits instead of gauges |
| Linear Insights, Vercel Analytics | Dense dashboards, hairline grids, mono numerals, drill from a number to its rows | Click a number, get its chart and its rows |

On the system side: Prometheus metric kinds and naming (counter, gauge, histogram; base units; few-valued labels), OpenTelemetry delta aggregation (stateless buckets that merge), dbt MetricFlow and Cube (measures, dimensions, time grains, pre-aggregations with a cheap refresh check), TimescaleDB continuous aggregates (materialise closed buckets, recompute invalidated ones, combine with raw rows past the watermark at query time). The design below is the last one on SQLite.

Sources: prometheus.io/docs/practices/naming, opentelemetry.io/docs/specs/otel/metrics/data-model, docs.getdbt.com/docs/build/semantic-models, cube.dev/docs/product/caching/using-pre-aggregations, tigerdata.com/docs (continuous aggregates, real-time aggregation), docs.activitywatch.net (buckets and events), wakatime.com/developers#heartbeats, docs.atuin.sh/reference/stats, developer.apple.com/design/human-interface-guidelines/charts and charting-data, WWDC22 "Design an effective chart", perceptualedge.com (bullet graph spec), edwardtufte.com (sparklines), vis.stanford.edu/papers/horizon, w3.org/TR/graphics-aria-1.0, WCAG 1.4.1 and 1.4.11. Research notes from 2026-10-11.

## What we can show

What cmd records today (docs/30) and what each area can answer. "From" names the events or view; **needs** marks new capture (see "Gaps to close").

### Agents

| Stat | Answers | From | Measure, dimensions |
|---|---|---|---|
| `agents.time` | How long agents worked | `turns` view (startedAt→endedAt) | duration; agent kind, model, project, workspace |
| `agents.parallel` | How many worked at once (peak, average) | turn spans, overlapped | gauge: max and mean per bucket |
| `agents.turns` | Turns and how they ended | `turns` | count; outcome (done, failed, interrupted), agent kind, project |
| `agents.turn.duration` | Typical and long turns (p50, p90) | `turns` | distribution; agent kind |
| `agents.waiting` | How long agents waited on you, and how fast you answered | `turns` outcome `waiting` → next prompt, `agent.hook` permission requests | duration and distribution; project |
| `agents.sessions` | Sessions started | `sessions` view | count; agent kind, project |
| `agents.tools` | Which tools, how often, how often they failed | `turns.tools` | count, failed; tool, agent kind |
| `agents.files` | Files agents changed, the most-touched ones | `turns.files` | count; project, change kind; ranking by path |
| `agents.tokens` | Tokens in, out, cached, by model | `transcript.message` `usage` (Claude); Codex `token_count` **needs** keeping | sum; model, agent kind, project |
| `agents.cost` | What that would cost at list prices | `agents.tokens` × a price table, **needs** prices | sum (estimated); model, project |

### Terminals

| Stat | Answers | From | Measure, dimensions |
|---|---|---|---|
| `commands.runs` | Commands run, and how many failed | `command` (exitCode) | count; result, project, workspace |
| `commands.failrate` | Failure rate over time | derived: failed / runs | ratio |
| `commands.duration` | How long commands take; the slowest | `command` (`until − at`) | distribution; ranking by command |
| `commands.top` | What you run most (`pnpm test`, `git status`) | `command`, normalised to program + subcommand | ranking; project |
| `commands.waited` | Time spent waiting on commands over 10 s (builds, tests, installs) | `command` | duration; project, command |
| `terminals.opened` | Terminals opened, how long they lived | pane entities (created, seen) | count, duration; shell, workspace |

### You

| Stat | Answers | From | Measure, dimensions |
|---|---|---|---|
| `you.focus` | Where your attention went | `user.focus` spans, **needs** closing on app blur | duration; window kind, project, workspace |
| `you.active` | When you work (hour × weekday), streaks, active days | focus spans and command starts, merged with a 15 min gap rule (WakaTime) | duration per hour; punch card, calendar |
| `you.looks` | Agents you checked on | `user.look` | count; agent kind |
| `you.notifications` | Notifications you got, from what | `notification` | count; source |

### Projects and git

| Stat | Answers | From | Measure, dimensions |
|---|---|---|---|
| `projects.time` | Time per project: yours and agents' | `you.focus` + `agents.time` by `projectId` | duration; project, who |
| `git.commits` | Commits per project and branch; made during an agent turn or not | `git.commit`, turn spans in the same worktree | count; project, by (you, agent) |
| `git.branches` | Branches and worktrees made and merged | `git.branch`, `git.merge`, `git.checkout` | count; project |

### Browsing and files

| Stat | Answers | From | Measure, dimensions |
|---|---|---|---|
| `web.visits` | Pages read in cmd, top hosts | `browser.visit` | count; host (ranking) |
| `files.opened` | Files opened, in which window kind | `file.open` | count; window kind, extension |

### cmd's own model calls

| Stat | Answers | From | Measure, dimensions |
|---|---|---|---|
| `ai.calls` | Calls by feature and model, failures, latency | `ai.call` | count, distribution of `ms`; purpose, model, ok |
| `ai.tokens` / `ai.cost` | Tokens and estimated cost of cmd's own features | `ai.call.tokens` × prices | sum; purpose, model |
| `ai.cut` | How often input was cut to fit | `ai.call.context` | ratio; purpose |

### cmd itself

| Stat | Answers | From | Measure, dimensions |
|---|---|---|---|
| `app.windows` | Windows and widgets opened, by kind | `window.open` | count; kind |
| `app.uptime` | Core uptime, restarts | `core.info.startedAt`, **needs** a sample | gauge |
| `core.stalls` | Stalls of the core's thread per day, worst one | `core.info.stalls`, **needs** keeping (now the last 20 in memory) | count, max; activity |
| `core.memory` | Core and PTY host memory over time | `core.processes`, **needs** a sample | gauge: mean, max |
| `data.size` | The log's size by class, growth per week | `data.stats`, sampled daily | gauge; class |
| `panes.cpu` | CPU-minutes and peak memory per terminal and agent | `ResourceMonitor`, **needs** keeping as stats | sum, max; pane kind, agent kind |

Three things worth leading with, because no other tool can show them: **agent time against your time** (how much work ran while you did something else), **waiting on you** (agents idle because they need an answer), and **what failed** (commands and turns, per project, trending).

## The stats system

### Concepts

- A **stat** is a named, versioned measure of the event log over time, declared once by the feature that owns the events. It has a **kind** (what is measured), a **unit**, the **dimensions** it can be split by, and a **compute** function from events in a time range to rows.
- A **bucket** is one stat's value for one hour (and one dimension value). Hours are the base grain; days, weeks, months and years are sums of hours at query time. Buckets are derived: deleting them costs a rebuild.
- A **derived stat** (rates, ratios, averages, cost) is computed from other stats' buckets when read, never stored.

Kinds, after Prometheus and OpenTelemetry, with what a bucket keeps so buckets merge exactly:

| Kind | Example | A bucket keeps | Merges by |
|---|---|---|---|
| `count` | commands run | `n` | sum |
| `sum` | tokens | `sum` | sum |
| `duration` | agent time, focus | ms of the span inside the hour (spans are split at hour edges) | sum |
| `gauge` | memory, parallel agents | `min`, `max`, `sum`, `n` of samples | min, max, mean |
| `distribution` | command duration, turn length | `n`, `sum`, and counts in fixed log-scale bins (×√2 steps, 1 ms to 1 day: ~55 bins, sparse) | add bins; p50/p90 from the merged bins, ±20% |
| `ranking` | top commands, top files, hosts | `n` per key, at most 200 keys per stat per day, the rest in `other` | sum per key, then top N |

### Declaring a stat

Stats are registered the way transcript sources and window types are: a registry (`stats/registry.ts`) and a built-in list (`stats/builtin.ts`), with stats that belong to a feature declared in that feature's folder and listed by it (`actions/stats.ts`, `journal/stats.ts`), so a new stat is one module.

```ts
// packages/core/src/stats/stat.ts
export interface StatDef {
  id: string;                         // "commands.runs": area.measure, lower case
  version: number;                    // raise when compute changes: its buckets are rebuilt
  title: string;                      // "Commands" (copywriting skill)
  description: string;                // one line, shown in the catalogue and as the chart's summary
  kind: "count" | "sum" | "duration" | "gauge" | "distribution" | "ranking";
  unit: "count" | "ms" | "bytes" | "tokens" | "usd" | "percent";
  dims: DimDef[];                     // bounded: project, workspace, agentKind, model, result…; never an unbounded id
  class: DataClass;                   // the data class it reads: policy, retention and data.record.* follow it
  inputs: { types?: string[]; views?: ("turns" | "sessions")[] };   // what invalidates it
  compute(range: Range, q: StatQueryCtx): StatRow[] | Promise<StatRow[]>;   // events in [from, to) → rows
  sample?: { every: number; read(ctx): StatRow[] };                          // gauges with no events: sampled
  good?: "up" | "down";               // which direction a delta is good, if either (colours the delta)
}
```

`compute` is a pure function of the events in a range, so one function serves the first build, an incremental update and a rebuild. Most are one SQL statement over `events.sqlite` (`GROUP BY` with `json_extract`, hour-bucketed with `at / 3600000`), which the spike measured at 33 ms for 30 days of events per type per day; JSON is never parsed in JS on this path (the spike's 700 ms for 62k rows). Spans are clipped to the range (`max(at, from)`, `min(until, to)`), so a three-hour turn lands as three hours in three buckets. Stats over views (turns, sessions) read `views.sqlite` the same way.

Derived stats declare `derive: { from: ["commands.runs"], fn }` instead of `compute` and cost nothing to keep.

### Storage

In `views.sqlite` (derived, rebuildable, docs/28 §1):

```sql
CREATE TABLE stat_buckets (
  stat TEXT NOT NULL, hour INTEGER NOT NULL,         -- UTC hour (ms / 3600000)
  dims TEXT NOT NULL DEFAULT '',                     -- canonical "project=…;result=fail", '' for the total
  n INTEGER, sum REAL, min REAL, max REAL, bins BLOB,
  PRIMARY KEY (stat, hour, dims)
) WITHOUT ROWID;
CREATE TABLE stat_dirty (stat TEXT NOT NULL, hour INTEGER NOT NULL, PRIMARY KEY (stat, hour)) WITHOUT ROWID;
```

Each stat's version and progress live in `view_versions` as `stat:<id>` (`ViewsStore.ensure`), so a version bump drops only its rows.

**Time zones.** Buckets are UTC hours; days and weeks are cut at query time with the person's time zone (and `stats.weekStart`), so changing zone or travelling needs no rebuild. Zones with a :30 or :45 offset get days shifted by that much; accepted, noted in the code.

### Keeping buckets current

The TimescaleDB pattern: materialise closed hours, recompute the ones that change, compute the open hour from raw events when asked.

1. **On commit.** The data service already tells subscriptions what each commit touched (`data/subscriptions.ts`). The stats service listens too: for every recorded or updated event, each stat whose `inputs` match marks `(stat, hour of at … hour of until)` dirty. Updates matter: a `command` event is written at its start and rewritten at its end with the exit code, and a `user.focus` span gets its `until` later, so a cursor over `seq` alone would miss them.
2. **Recompute.** A debounced job (1 s after the last commit, at most every 5 s) recomputes dirty buckets: delete the stat's rows for those hours, insert `compute(hours)`. It runs through `scheduler.yield()` and is small: a busy hour is a few hundred events.
3. **The open hour** is never trusted from storage: queries whose range includes it recompute it on the fly (cached 2 s), so a number on screen moves with the work.
4. **Build and rebuild.** A missing or bumped stat builds newest-first, a week per step with a yield between, as a startup job ("Counting stats…" in the footer); the newest week is ready in under a second, the rest fills in while queries answer `partial: { since }`.
5. **Repair.** A dirty mark lost in a crash (views and events are separate files) leaves a stale bucket; a nightly job recomputes the last 48 hours of every stat. Retention pruning and `cmd data forget` mark their ranges dirty (forget: every bucket of the forgotten project or session's span).
6. **Samples.** Gauges with no events (core memory, data size, pane CPU) are sampled by the stats service on their `every` and written straight into buckets (min/max/sum/n). They have no raw facts, so they are the one kind a rebuild can't recover; they live in their own table, `stat_samples`, that rebuilds skip.

**Retention.** Buckets follow their class: when raw events are pruned (output after 90 days), their buckets stay, flagged as from pruned events, and a rebuild keeps flagged hours instead of recomputing them to zero (the journal does the same with days from pruned events). Forget always deletes. So a year of command counts survives the 90-day output limit, at a few MB.

**Cost budget** (to be checked in phase 0 against a copy of a real log, `data/` only): a query over a year at day grain answers in under 5 ms from buckets; a recompute of one dirty hour for all stats under 10 ms; a full rebuild of every stat over a year under a minute of background time, never blocking the thread over 12 ms; `stat_buckets` under 20 MB for a year of heavy use.

### Query

One shape for the widget, the CLI, Magic widgets and remote devices, typed in `packages/protocol/src/stats.ts` (`StatsMethods`, `StatsEvent`, `STATS_SETTINGS`, taken in by `Methods`, `CoreEvent` and `SETTINGS_SCHEMA` the way Workspace Actions does):

```ts
stats.catalog() → StatInfo[]                            // id, title, description, kind, unit, dims, good, available | off (class not recorded) 
stats.query({
  stat: "commands.runs",
  range: "7d" | "today" | "week" | "month" | "year" | { from, to },
  grain?: "hour" | "day" | "week" | "month",           // default from the range
  by?: "project" | "result" | …,                        // one dimension: one series per value, top 6 + "Other"
  filter?: { projectId?, workspaceId?, agentKind?, … },
  compare?: "previous",                                 // the same length just before: totals and per-bucket
  top?: number,                                         // rankings
}) → {
  stat: StatInfo, grain, buckets: number[],             // bucket starts, local time
  series: { key, label, values: (number | null)[] }[],  // null: no data (before the log starts), 0: nothing happened
  total: number, previous?: number, p50?, p90?,
  ranking?: { key, label, value }[],
  partial?: { since: number },                          // still building, or the log is younger than the range
  asOf: number,
}
stats.subscribe({ stats: string[], filter? }) / stats.unsubscribe → stats.changed { stats: string[] }, debounced 1 s
```

The widget asks for several stats in one call (`stats.queryMany`). Answers are stale-while-revalidate at the edge: the renderer shows the last answer at once and replaces it in place.

**Policy.** Stats are aggregates, so `data/policy.ts` gets a `stats` row: a stat is readable by a client that may read its class (remote devices: no transcripts, so no `agents.tokens`; Magic widgets: their workspace, and the classes their manifest declares). Rankings whose keys are text a class hides (command lines, hosts) are dropped for clients that can't read that class.

**CLI.** `cmd stats` prints the overview the widget shows, in the terminal's own idiom: one line per stat with value, delta and an eighth-block sparkline (`▁▂▃▅▇`), rankings as `█▋` bars with right-aligned numbers, `--json` for scripts. `cmd stats <id> --range 30d --by project`, `cmd stats ls`, `cmd stats rebuild [id]`.

### Gaps to close

| Gap | Fix | For |
|---|---|---|
| Turns carry no tokens | Sum `transcript.message` `usage` per turn into `AgentTurn.tokens {in, out, cacheRead, cacheWrite}`; keep Codex's `token_count` lines as a counter instead of skipping them (docs/28 §11 said "map to counters") | `agents.tokens`, `agents.cost` |
| No cost anywhere | A price table per model (`stats/prices.ts`, dated, overridable with `stats.prices`), applied at query time so a price change needs no rebuild; always labelled "est." | `agents.cost`, `ai.cost` |
| `user.focus` spans stay open while the app is in the background, one per workspace | End the span on app blur and sleep, start it on focus (main → `ui.focus` RPC) | `you.focus`, `you.active`, `projects.time` |
| Stalls, core memory, pane CPU and memory are in memory only | Gauge samples (above): core every minute, panes as CPU-ms and peak memory per minute while sampled | `core.*`, `panes.cpu` |
| `user.command` is declared but never recorded | Record palette and menu commands (id, via) | "commands you use", shortcut hints later |

## Charts

### What's there

`packages/ui/src/chart.tsx`: hand-written SVG; `Chart` draws line, area or grouped bars with three grid lines, y ticks on the right, the first and last x label; `Sparkline` a line with an area; `Legend`; series colours `--chart-1…6` from the theme's ANSI colours. No hover, tooltip or keyboard; no stacking, time axis, negative values, gaps, empty state or fill-height; `Stat` takes its trend arrow as typed text. Magic's `cmd.chart` and `cmd.spark` (`magic/prompt/host.js`) are a separate copy with the same limits, and in kit 3 a series without its own colour gets `var(--c1)`, which only kit 1 defines: **Magic chart series are colourless today** (a one-line fix, independent of this plan: fall back to `--chart-N`).

### Look

Apple's discipline, a terminal's density. Concretely:

- **Numbers are the interface.** Values, ticks and readouts in `--font-mono` with tabular numerals; labels in `--font-ui`. The headline number is large (`--text-lg` or a new `--text-xl`), its unit small and dim beside it.
- **Hairlines, few.** Grid lines 1px `--chart-grid`, three at most, horizontal only; no frame, no axis line except the baseline; ticks `--text-2xs` dim, the y axis on the right (as today and Swift Charts).
- **One accent, the rest context.** A single series is neutral with the current period (today, this week) in the accent, as Screen Time does; comparison series (last period) are a dashed line or a hollow bar in `--chart-neutral`. Several series take `--chart-1…6`, at most six, then "Other" in neutral.
- **Square, dense marks.** Bars with a 1px radius (not pills), 1–2px gaps, widths from the band, not fixed; lines 1.5px, no dots except the selected and the last point; areas at 12% fill under a line, gradients never.
- **Say it in words.** Every chart has a one-line summary above it ("14 h 20 m · +18% vs last week"), which is also its accessible name; direct labels at line ends instead of a legend when there's room.
- **Honest empty.** A bucket with nothing is a faint tick on the baseline, a bucket with no data (before the log starts) is blank, the open bucket is drawn lighter (hatched for bars) and called "so far".
- **Scrub, don't hover-pop.** Moving over a time chart draws a vertical rule and puts the bucket's values in the chart's header in place of the summary (Health, Stocks); leaving restores it. Floating tooltips only where there's no header (calendar, punch card cells). Charts in one widget share the cursor (Grafana's shared crosshair), so scrubbing one week scrubs them all.
- **Motion** only when data changes in place (bars and lines glide to new values on `--glide`, via the motion system's rules), never on mount or every refresh; none with reduced motion.

### Pieces

A small grammar, after Swift Charts and Observable Plot, so presets are compositions and a new chart is rarely a new component:

```tsx
<Plot data={rows} x="t" y="value" xScale="time" grain="day" height="fill" summary="…">
  <Bars color="series" stack />
  <Rule y={avg} label="avg" dashed />
  <Cursor />                      {/* scrubbing rule + header readout + keyboard */}
</Plot>
```

- `Plot`: scales (linear, log, band, time with local-day ticks), axes, the plot area, sizing (width from ResizeObserver as today, height fixed or `fill`), the header slot and the cursor context. `PlotGroup` shares a cursor and an x domain across plots.
- Marks: `Bars` (vertical or horizontal, stacked, grouped), `Line`, `Area` (stacked), `Points`, `Rule` (averages, targets, thresholds, the selection), `Cells` (heat grids), `Label`.
- `format.ts`: one formatter per unit, shared with the CLI: counts compact (`1.2K`), durations `3h 12m` / `48s` / `120ms`, bytes `1.4 GB`, tokens `2.3M`, money `$4.20 est.`, percent; deltas `+18%` with `signDisplay: "exceptZero"`, "new" when the baseline is zero; ticks in a unit's own steps (15 min, 1 h, 1 d for durations). `Intl.NumberFormat` and `Intl.DateTimeFormat`, the system's locale.

Presets, each a kit component with JSDoc and a story (the UI Workbench shows them):

| Preset | Built from | For |
|---|---|---|
| `TimeBars` | Bars over time buckets, current bucket in accent, average rule, compare series | Most stats: per day, per hour |
| `TimeSeries` | Line/Area over time, compare as dashed | Gauges, cumulative totals, rates |
| `StackedBars` | Bars stacked by a dimension, legend or direct labels | Agent time by kind, commands by result |
| `Calendar` | Cells, weeks × weekdays, 5 quantile levels of `--chart-seq-*`, empty days visible | A year of activity |
| `PunchCard` | Cells or sized points, weekday × hour | When you (and your agents) work |
| `Ranking` | Horizontal bars in rows: label, bar, value, optional share | Top commands, projects, files, hosts; also as a `DataGrid` cell |
| `Meter` | One bar, a target rule, 2–3 muted bands (Few's bullet graph) | Budgets: tokens against a limit, disk, a goal |
| `Proportion` | One 100% bar split by a dimension, labels below | Shares: outcomes, models; instead of pies and donuts |
| `Distribution` | Histogram from log bins with p50/p90 rules | Command and turn durations |
| `Sparkline` | Line, min/max/last dots, gaps for nulls | `Stat` and table cells |
| `Horizon` (later) | Folded bands, 24px rows | CPU across many panes |

`Stat` grows a `delta` that takes a number and the stat's `good` direction (arrow and tone from them, not typed text), `size` (`md`, `lg`), a loading state (a dim placeholder, no spinner), and `onSelect` for drilling. `Chart`, `Sparkline` and `Legend` keep their props and render through `Plot`, so Resources and the Chart reference window move over untouched, then onto presets.

**Rendering.** Hand-written SVG as today, now on `d3-scale`, `d3-shape`, `d3-array` and `d3-time` (tree-shaken, ~15 KB: nice ticks, time intervals, curves, stacking, bins are solved problems), with no chart library: Recharts' defaults and DOM depth fight the tokens, Observable Plot is imperative and large, owning a library's look is the expense docs/40 warned about. Canvas only if a chart ever needs more than ~5k points (Horizon over a day of samples), behind the same props.

**Tokens** (`theme.tokens.json`, with `$description`s): `chart.grid`, `chart.axis`, `chart.neutral` (context and comparison), `chart.current` (the accent, named for its role), `chart.seq.0…4` (a sequential ramp from the accent hue, built in OKLCH per theme), `chart.radius`. `chart.1…6` stay the terminal's ANSI colours: that is the terminal half of the look. A token test checks every series and ramp colour against the theme's background for 3:1 (WCAG 1.4.11) and fails a theme whose ANSI colour can't be used, with the colour it would adjust to.

**Accessibility.** `role="graphics-document"` with the summary as its name; the cursor is keyboard-driven (focus the chart, ←/→ by bucket, ↑/↓ by series, values announced through an `aria-live` region); every chart can switch to its table (the drill view's `DataGrid`); series differ by more than colour where it matters (dashed comparison, direct labels).

**Magic.** Kit 4 exposes the presets to Magic widgets as `cmd.chart(el, { type: "timebars" | "series" | "stacked" | "calendar" | "ranking" | "meter" | "proportion", … })` drawing with the same code, and `stats()` in `data.ts` reads `stats.query` under the widget's policy. Kits 1–3 stay frozen.

## The Statistics widget

A built-in widget (`windows/stats/`, role `widget`, "Statistics"), React, scoped like the others (This Workspace / All Workspaces), built from the window-design pieces (`View`, `Panes`, `Tiles`, `Stat`, the presets, `DataGrid`). Read top to bottom like Screen Time:

```
 Statistics                      [Today  Week  Month  Year]   This Workspace ▾
 ─────────────────────────────────────────────────────────────────────────────
 This week: agents worked 14 h 20 m across 3 projects, 18% more than last week.

 Agent time      Your focus     Commands       Failed       Tokens (est.)
 14h 20m ▲18%   9h 05m ▼4%    1,284 ▲9%     6.1% ▼1.2    3.4M · $21
 ▁▂▅▃▇▆▂        ▃▄▄▅▃▂▁        ▂▃▃▅▄▆▃        ▅▃▂▂▃▁▂      ▁▃▂▆▅▇▃

 Agents  ────────────────────────────────────────────── h · by kind
 ▇ ▅ ▆ ▃ █ ▂ ▁   stacked bars per day, today in accent, avg rule
 Done 82% ████████████████▌▍▏ Interrupted 11% Failed 7%     (Proportion)
 Waited on you 1h 52m · median answer 1m 40s

 Terminals ─────────────────────────────────────────── runs · by result
 pnpm test        ████████████  212   9% fail
 git status       ████████      148
 pnpm typecheck   █████          91   3% fail

 When you work ───────────── punch card, weekday × hour, you and agents
 Projects ────────────────── ranking: cmd 21h · cmd-stats 4h · site 1h
 Model calls ─────────────── by purpose: journal, names, summaries; tokens, failures
 cmd ─────────────────────── data size, stalls per day, core memory
```

- **Overview first**: a sentence (generated from the numbers, no model), then five `Stat`s with deltas and sparklines. At narrow sizes only the overview and one chart; regular adds the sections; wide puts sections in two columns (`Panes`).
- **Year** swaps the overview's bars for a `Calendar` of active hours.
- **Every number drills**: clicking a stat or a bar opens its detail in the widget (back with ⌘[): a large `TimeBars` or `TimeSeries`, a `by` picker from the stat's dimensions, compare on/off, and the rows as a `DataGrid` (the buckets, or for rankings the keys). From a command or a project row, a context menu goes to the thing itself (run again, open the project's workspace, search its sessions).
- **Arrangement**: the sections and their order live in the widget's state; "Add Stat…" lists the catalogue (`stats.catalog`), so a stat a feature registers is available without UI work. A **Stat** widget (one stat, one chart, small) docks in a sidebar for the one number someone wants always visible.
- **States**: "Counting…" with the newest week shown while older weeks build; a stat whose class is off says so with a link to Settings → Data; a range longer than the log says "Since 3 Oct".
- **Live**: `stats.subscribe` for what's on screen; the open hour moves as you work, the rest only when invalidated.

Settings → Data gets its numbers from the same place: `data.size` as a `TimeSeries` and per-class `Ranking` (docs/28 §7's "Stats" page, never built).

## Phases

One worktree each, `pnpm typecheck && pnpm test` green, e2e once at the end of each.

| # | Phase | What | Days |
|---|---|---|---|
| 0 | Measure | On a copy of a real `data/` (never `cmd.sqlite`): the SQL for ten stats, bucket build time for a year, recompute cost per hour, table size. Settle the budget above or change the design | 1 |
| 1 | Stats core | `stats/` feature (registry, buckets, dirty marks, recompute job, build and rebuild as a startup job, repair, samples), `protocol/stats.ts`, `stats.*` RPC, policy row, `cmd stats` with block sparklines; the stats that need no new capture (agents time/turns/sessions/tools/files, commands, focus, git, web, files, ai, windows) | 4–5 |
| 2 | Chart kit | `charts/`: `Plot`, marks, cursor, `format.ts`, tokens and the contrast test, presets with stories, `Stat` changes; `Chart`/`Sparkline`/`Legend` on `Plot`; the Chart reference window on presets | 5–6 |
| 3 | The widget | Statistics and Stat widgets, drill view, arrangement, states, narrow/regular/wide stories, e2e: opens, shows numbers from fixture events, drills | 3–4 |
| 4 | Gaps | Tokens per turn and Codex counters, prices, focus on blur, gauge samples, `user.command`; the stats that use them | 3 |
| 5 | Out | Magic kit 4 and `stats()` in data.ts, Settings → Data on stats, remote access's "Now" tab with a few stats, the journal's week with its numbers | 3 |

Now, independent of all of it: the Magic `--c1…6` fix in `host.js`.

## Open questions

1. **Cost.** Show estimated dollars at list prices (subscriptions make them fictional for many people) or tokens only, with dollars opt-in? Proposal: tokens by default, `stats.showCost` off.
2. **Arrangement.** A fixed, well-designed page, or sections people add and reorder from the catalogue? Proposal: fixed sections first, "Add Stat…" in phase 3 only if cheap.
3. **Aggregates past retention.** Keep buckets of pruned events (counts outlive the raw rows, as above) or let stats forget with the log?
4. **Dependency.** The four small d3 modules in `@cmd/ui`, or keep scales and ticks hand-written?
5. **Name.** "Statistics" (macOS: Activity Monitor, Screen Time) or something in cmd's voice ("Activity", "Insights")? `Insights` reads like analytics; "Statistics" is plain.
