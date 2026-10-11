// The stats cmd keeps out of the box (docs/49 "What we can show"): agents from the turns and
// sessions views and transcripts, terminals from command events, you from focus, palette
// commands and looks, git, pages, files, windows and cmd's own model calls. Each is one
// declaration; a feature with stats of its own declares them in its folder the same way.

import fs from "node:fs";
import { Acc, HOUR, hourOf, projectLabel, rows, spanHours, type DimDef, type StatDef } from "./stat.ts";

const DAY = 24 * HOUR;

const project: DimDef = { id: "project", title: "Project", label: projectLabel };
const workspace: DimDef = { id: "workspace", title: "Workspace", label: (k, c) => c.workspaceName(k) ?? "Other" };
const agent: DimDef = { id: "agent", title: "Agent", label: (k) => AGENTS[k] ?? (k ? k[0]!.toUpperCase() + k.slice(1) : "Unknown") };
const AGENTS: Record<string, string> = { claude: "Claude", codex: "Codex", qwen: "Qwen", copilot: "Copilot", gemini: "Gemini" };
const labels = (m: Record<string, string>) => (k: string) => m[k] ?? (k || "Unknown");

const RESULTS = { ok: "Passed", fail: "Failed", running: "Running", unknown: "Unknown" };
const OUTCOMES = { done: "Done", failed: "Failed", interrupted: "Interrupted", waiting: "Waiting", working: "Working" };
const TOKENS = { in: "Input", out: "Output", cacheRead: "Cache read", cacheWrite: "Cache write" };

/** Programs whose first argument says what ran: `pnpm test`, `git status`, `docker compose`. */
const SUBCOMMANDS = new Set(["git", "pnpm", "npm", "yarn", "bun", "npx", "cargo", "go", "docker", "kubectl", "gh", "brew", "uv", "pip", "deno", "make", "just", "task", "mise", "swift", "xcodebuild", "terraform", "pnpx", "cmd", "claude", "codex"]);

/** A command line as what it runs, for rankings: "FOO=1 pnpm -r test --watch" → "pnpm test". */
export function commandName(line: string | null): string {
  if (!line) return "";
  const words = line.trim().split(/\s+/).filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w));
  const [first, ...rest] = words;
  if (!first) return "";
  const prog = first.replace(/^.*\//, "");
  if (!SUBCOMMANDS.has(prog)) return prog;
  const sub = rest.find((w) => !w.startsWith("-"));
  return sub && /^[\w:.@-]+$/.test(sub) ? `${prog} ${sub}` : prog;
}

/** A URL's host without "www.", or "". */
function hostOf(url: string | null): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

interface Turn {
  agent_id: string;
  s: number;
  cwd: string | null;
  e: number | null;
  o: string | null;
  k: string | null;
  auto: number | null;
  nxt?: number | null;
  nxtAuto?: number | null;
}

const TURNS = `SELECT agent_id, started_at AS s, cwd, json_extract(doc, '$.endedAt') AS e, json_extract(doc, '$.outcome') AS o, json_extract(doc, '$.agentKind') AS k, json_extract(doc, '$.auto') AS auto FROM turns`;

export const BUILTIN_STATS: StatDef[] = [
  // Agents
  {
    id: "agents.time",
    version: 1,
    title: "Agent time",
    description: "How long agents worked: every turn from its prompt to its end.",
    kind: "duration",
    unit: "ms",
    dims: [agent, project, workspace],
    class: "agents",
    inputs: { turns: true },
    span: DAY,
    live: true,
    compute(from, to, c) {
      const acc = new Acc();
      for (const t of rows<Turn>(c.views, `${TURNS} WHERE started_at >= ? AND started_at < ?`, from - DAY, to)) {
        const end = t.e ?? (t.o === "working" ? c.now : t.s);
        spanHours(t.s, end, from, to, (h, ms) => acc.add(h, [t.k, c.projectOf(t.cwd), c.workspaceOf(t.cwd)], ms));
      }
      return acc.rows();
    },
  },
  {
    id: "agents.turns",
    version: 1,
    title: "Turns",
    description: "Prompts agents worked on, and how each ended.",
    kind: "count",
    unit: "count",
    dims: [agent, { id: "outcome", title: "Outcome", label: labels(OUTCOMES) }, project, workspace],
    class: "agents",
    inputs: { turns: true },
    compute(from, to, c) {
      const acc = new Acc();
      for (const t of rows<Turn>(c.views, `${TURNS} WHERE started_at >= ? AND started_at < ?`, from, to)) acc.count(hourOf(t.s), [t.k, t.o, c.projectOf(t.cwd), c.workspaceOf(t.cwd)]);
      return acc.rows();
    },
  },
  {
    id: "agents.turn.duration",
    version: 1,
    title: "Turn length",
    description: "How long a turn takes, from the prompt to the agent's answer.",
    kind: "distribution",
    unit: "ms",
    dims: [agent, project, workspace],
    class: "agents",
    inputs: { turns: true },
    compute(from, to, c) {
      const acc = new Acc();
      for (const t of rows<Turn>(c.views, `${TURNS} WHERE started_at >= ? AND started_at < ?`, from, to)) if (t.e && t.e >= t.s) acc.value(hourOf(t.s), [t.k, c.projectOf(t.cwd), c.workspaceOf(t.cwd)], t.e - t.s, true);
      return acc.rows();
    },
  },
  {
    id: "agents.waiting",
    version: 1,
    title: "Waiting on you",
    description: "How long agents waited for your next prompt after a turn ended (gaps under an hour).",
    kind: "distribution",
    unit: "ms",
    measure: "sum",
    good: "down",
    dims: [agent, project, workspace],
    class: "agents",
    inputs: { turns: true },
    compute(from, to, c) {
      const acc = new Acc();
      const sql = `SELECT * FROM (SELECT agent_id, started_at AS s, cwd, json_extract(doc, '$.endedAt') AS e, json_extract(doc, '$.outcome') AS o, json_extract(doc, '$.agentKind') AS k, json_extract(doc, '$.auto') AS auto,
        LEAD(started_at) OVER w AS nxt, LEAD(json_extract(doc, '$.auto')) OVER w AS nxtAuto
        FROM turns WHERE started_at >= ? AND started_at < ? WINDOW w AS (PARTITION BY agent_id ORDER BY idx)) WHERE e >= ? AND e < ?`;
      for (const t of rows<Turn>(c.views, sql, from - DAY, to + HOUR, from, to)) {
        if (!t.e || !t.nxt || t.nxtAuto || t.o === "working") continue;
        const gap = t.nxt - t.e;
        if (gap > 0 && gap < HOUR) acc.value(hourOf(t.e), [t.k, c.projectOf(t.cwd), c.workspaceOf(t.cwd)], gap, true);
      }
      return acc.rows();
    },
  },
  {
    id: "agents.sessions",
    version: 1,
    title: "Sessions",
    description: "Agent sessions started.",
    kind: "count",
    unit: "count",
    dims: [agent, project],
    class: "transcripts",
    inputs: { sessions: true },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ started: number; agent: string; project_id: string | null }>(c.views, `SELECT started, agent, project_id FROM sessions WHERE started >= ? AND started < ?`, from, to)) acc.count(hourOf(r.started), [r.agent, r.project_id]);
      return acc.rows();
    },
  },
  {
    id: "agents.tools",
    version: 1,
    title: "Tool calls",
    description: "The tools agents called, and how often a call failed.",
    kind: "count",
    unit: "count",
    dims: [{ id: "tool", title: "Tool", many: true }, { id: "result", title: "Result", label: labels({ ok: "Worked", fail: "Failed" }) }, agent, project],
    class: "agents",
    inputs: { turns: true },
    compute(from, to, c) {
      const acc = new Acc();
      const sql = `SELECT started_at AS s, cwd, json_extract(doc, '$.agentKind') AS k, json_extract(t.value, '$.name') AS name, json_extract(t.value, '$.count') AS n, json_extract(t.value, '$.failed') AS f FROM turns, json_each(json_extract(doc, '$.tools')) t WHERE started_at >= ? AND started_at < ?`;
      for (const r of rows<{ s: number; cwd: string | null; k: string | null; name: string; n: number; f: number }>(c.views, sql, from, to)) {
        const p = c.projectOf(r.cwd);
        if (r.n - (r.f ?? 0) > 0) acc.count(hourOf(r.s), [r.name, "ok", r.k, p], r.n - (r.f ?? 0));
        if (r.f) acc.count(hourOf(r.s), [r.name, "fail", r.k, p], r.f);
      }
      return acc.rows();
    },
  },
  {
    id: "agents.files",
    version: 1,
    title: "Files changed",
    description: "Files agents changed, from git and the folders they watched.",
    kind: "count",
    unit: "count",
    dims: [{ id: "path", title: "File", many: true, label: (k) => k.slice(k.lastIndexOf("/") + 1) || k }, { id: "change", title: "Change", label: labels({ A: "Added", M: "Modified", D: "Deleted", R: "Renamed" }) }, agent, project],
    class: "agents",
    inputs: { turns: true },
    compute(from, to, c) {
      const acc = new Acc();
      const sql = `SELECT started_at AS s, cwd, json_extract(doc, '$.agentKind') AS k, json_extract(f.value, '$.path') AS path, json_extract(f.value, '$.change') AS change FROM turns, json_each(json_extract(doc, '$.files')) f WHERE started_at >= ? AND started_at < ?`;
      for (const r of rows<{ s: number; cwd: string | null; k: string | null; path: string; change: string | null }>(c.views, sql, from, to)) acc.count(hourOf(r.s), [r.path, (r.change ?? "M").slice(0, 1), r.k, c.projectOf(r.cwd)]);
      return acc.rows();
    },
  },
  {
    id: "agents.tokens",
    version: 1,
    title: "Agent tokens",
    description: "Tokens agents' models read and wrote, from their transcripts (Claude Code today).",
    kind: "sum",
    unit: "tokens",
    dims: [{ id: "token", title: "Kind", label: labels(TOKENS) }, { id: "model", title: "Model" }, project],
    class: "transcripts",
    inputs: { types: ["transcript.message"] },
    compute(from, to, c) {
      const acc = new Acc();
      const sql = `SELECT at / ${HOUR} AS h, project_id AS p, json_extract(data, '$.model') AS m,
        sum(ifnull(json_extract(data, '$.usage.input_tokens'), 0)) AS i, sum(ifnull(json_extract(data, '$.usage.output_tokens'), 0)) AS o,
        sum(ifnull(json_extract(data, '$.usage.cache_read_input_tokens'), 0)) AS cr, sum(ifnull(json_extract(data, '$.usage.cache_creation_input_tokens'), 0)) AS cw, count(*) AS n
        FROM events WHERE type = 'transcript.message' AND at >= ? AND at < ? AND json_extract(data, '$.usage') IS NOT NULL GROUP BY 1, 2, 3`;
      for (const r of rows<{ h: number; p: string | null; m: string | null; i: number; o: number; cr: number; cw: number; n: number }>(c.events, sql, from, to)) {
        const h = Math.floor(r.h);
        for (const [k, v] of [["in", r.i], ["out", r.o], ["cacheRead", r.cr], ["cacheWrite", r.cw]] as const) if (v) acc.add(h, [k, r.m, r.p], v, r.n);
      }
      return acc.rows();
    },
  },

  // Terminals
  {
    id: "commands.runs",
    version: 1,
    title: "Commands",
    description: "Commands your terminals ran, and how many failed.",
    kind: "count",
    unit: "count",
    dims: [{ id: "result", title: "Result", label: labels(RESULTS) }, { id: "command", title: "Command", many: true }, project, workspace],
    class: "output",
    inputs: { types: ["command"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; until: number | null; p: string | null; w: string | null; x: number | null; cmd: string | null }>(c.events, `SELECT at, until, project_id AS p, workspace_id AS w, json_extract(data, '$.exitCode') AS x, json_extract(data, '$.command') AS cmd FROM events WHERE type = 'command' AND at >= ? AND at < ?`, from, to)) {
        const result = r.until === null ? "running" : r.x === null ? "unknown" : r.x === 0 ? "ok" : "fail";
        acc.count(hourOf(r.at), [result, commandName(r.cmd), r.p, r.w]);
      }
      return acc.rows();
    },
  },
  {
    id: "commands.failrate",
    version: 1,
    title: "Failed commands",
    description: "The share of finished commands that exited with an error.",
    kind: "gauge",
    unit: "percent",
    good: "down",
    dims: [{ id: "command", title: "Command", many: true }, project, workspace],
    class: "output",
    inputs: { types: ["command"] },
    ratio: { of: "commands.runs", where: { result: "fail" }, among: { result: ["ok", "fail"] } },
  },
  {
    id: "commands.duration",
    version: 1,
    title: "Command time",
    description: "How long commands took to finish.",
    kind: "distribution",
    unit: "ms",
    dims: [{ id: "command", title: "Command", many: true }, project, workspace],
    class: "output",
    inputs: { types: ["command"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; until: number; p: string | null; w: string | null; cmd: string | null }>(c.events, `SELECT at, until, project_id AS p, workspace_id AS w, json_extract(data, '$.command') AS cmd FROM events WHERE type = 'command' AND at >= ? AND at < ? AND until IS NOT NULL`, from, to)) acc.value(hourOf(r.at), [commandName(r.cmd), r.p, r.w], Math.max(0, r.until - r.at), true);
      return acc.rows();
    },
  },

  // You
  {
    id: "you.focus",
    version: 1,
    title: "Your focus",
    description: "Time a terminal, agent or window had your focus in cmd (each stretch counted up to an hour).",
    kind: "duration",
    unit: "ms",
    dims: [{ id: "kind", title: "What", label: labels({ agent: "Agents", terminal: "Terminals" }) }, workspace],
    class: "actions",
    inputs: { types: ["user.focus"] },
    span: HOUR,
    live: true,
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; until: number | null; w: string | null; a: string | null; p: string | null; win: string | null }>(c.events, `SELECT at, until, workspace_id AS w, agent_id AS a, pane_id AS p, window_id AS win FROM events WHERE type = 'user.focus' AND at >= ? AND at < ?`, from - HOUR, to)) {
        // Spans stay open while cmd is in the background (docs/49 "Gaps"): an hour at most.
        const end = Math.min(r.until ?? c.now, r.at + HOUR);
        const kind = r.a ? "agent" : r.p ? "terminal" : r.win ? (c.windowKind(r.win) ?? "window") : "window";
        spanHours(r.at, end, from, to, (h, ms) => acc.add(h, [kind, r.w], ms));
      }
      return acc.rows();
    },
  },
  {
    id: "you.active",
    version: 1,
    title: "Active time",
    description: "Time you were doing something in cmd: five-minute stretches with a command, a prompt, a focus change or a page.",
    kind: "duration",
    unit: "ms",
    dims: [],
    class: "actions",
    inputs: { types: ["user.", "command", "browser.visit", "file.open"], turns: true },
    compute(from, to, c) {
      const SLOT = 5 * 60_000;
      const slots = new Set<number>();
      for (const r of rows<{ at: number }>(c.events, `SELECT at FROM events WHERE type IN ('user.focus', 'user.command', 'user.look', 'command', 'browser.visit', 'file.open') AND at >= ? AND at < ?`, from, to)) slots.add(Math.floor(r.at / SLOT));
      for (const t of rows<{ s: number }>(c.views, `SELECT started_at AS s FROM turns WHERE started_at >= ? AND started_at < ? AND ifnull(json_extract(doc, '$.auto'), 0) = 0`, from, to)) slots.add(Math.floor(t.s / SLOT));
      const acc = new Acc();
      for (const s of slots) acc.add(hourOf(s * SLOT), [], SLOT);
      return acc.rows();
    },
  },
  {
    id: "you.commands",
    version: 1,
    title: "App commands",
    description: "Commands you ran from the menus, the palette and shortcuts.",
    kind: "count",
    unit: "count",
    dims: [{ id: "command", title: "Command", many: true }, { id: "via", title: "From", label: labels({ menu: "Menu or shortcut", palette: "Palette", key: "Shortcut" }) }],
    class: "actions",
    inputs: { types: ["user.command"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; cmd: string | null; via: string | null }>(c.events, `SELECT at, json_extract(data, '$.command') AS cmd, json_extract(data, '$.via') AS via FROM events WHERE type = 'user.command' AND at >= ? AND at < ?`, from, to)) acc.count(hourOf(r.at), [r.cmd, r.via]);
      return acc.rows();
    },
  },
  {
    id: "you.notifications",
    version: 1,
    title: "Notifications",
    description: "Notifications cmd showed you, by what sent them.",
    kind: "count",
    unit: "count",
    dims: [{ id: "source", title: "From" }, workspace],
    class: "notes",
    inputs: { types: ["notification"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; src: string | null; w: string | null }>(c.events, `SELECT at, json_extract(data, '$.source') AS src, workspace_id AS w FROM events WHERE type = 'notification' AND at >= ? AND at < ?`, from, to)) acc.count(hourOf(r.at), [r.src, r.w]);
      return acc.rows();
    },
  },

  // Projects and git
  {
    id: "git.commits",
    version: 1,
    title: "Commits",
    description: "Commits made in your repositories.",
    kind: "count",
    unit: "count",
    dims: [project, { id: "branch", title: "Branch", many: true }],
    class: "git",
    inputs: { types: ["git.commit"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; p: string | null; b: string | null }>(c.events, `SELECT at, project_id AS p, json_extract(data, '$.branch') AS b FROM events WHERE type = 'git.commit' AND at >= ? AND at < ?`, from, to)) acc.count(hourOf(r.at), [r.p, r.b]);
      return acc.rows();
    },
  },
  {
    id: "git.merges",
    version: 1,
    title: "Merges",
    description: "Merges in your repositories.",
    kind: "count",
    unit: "count",
    dims: [project],
    class: "git",
    inputs: { types: ["git.merge"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; p: string | null }>(c.events, `SELECT at, project_id AS p FROM events WHERE type = 'git.merge' AND at >= ? AND at < ?`, from, to)) acc.count(hourOf(r.at), [r.p]);
      return acc.rows();
    },
  },

  // Browsing, files, windows
  {
    id: "web.visits",
    version: 1,
    title: "Pages",
    description: "Pages browser windows showed, by site.",
    kind: "count",
    unit: "count",
    dims: [{ id: "host", title: "Site", many: true }, workspace],
    class: "browsing",
    inputs: { types: ["browser.visit"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; url: string | null; w: string | null }>(c.events, `SELECT at, json_extract(data, '$.url') AS url, workspace_id AS w FROM events WHERE type = 'browser.visit' AND at >= ? AND at < ?`, from, to)) acc.count(hourOf(r.at), [hostOf(r.url), r.w]);
      return acc.rows();
    },
  },
  {
    id: "files.opened",
    version: 1,
    title: "Files opened",
    description: "Files opened in cmd's windows, by type.",
    kind: "count",
    unit: "count",
    dims: [{ id: "ext", title: "Type", label: (k) => (k ? `.${k}` : "None") }, { id: "window", title: "Window" }, workspace],
    class: "browsing",
    inputs: { types: ["file.open"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; path: string | null; kind: string | null; w: string | null }>(c.events, `SELECT at, json_extract(data, '$.path') AS path, json_extract(data, '$.windowKind') AS kind, workspace_id AS w FROM events WHERE type = 'file.open' AND at >= ? AND at < ?`, from, to)) {
        const base = r.path?.slice(r.path.lastIndexOf("/") + 1) ?? "";
        acc.count(hourOf(r.at), [base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "", r.kind, r.w]);
      }
      return acc.rows();
    },
  },
  {
    id: "app.windows",
    version: 1,
    title: "Windows opened",
    description: "Windows and widgets opened, by kind.",
    kind: "count",
    unit: "count",
    dims: [{ id: "kind", title: "Kind" }, workspace],
    class: "browsing",
    inputs: { types: ["window.open"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; kind: string | null; w: string | null }>(c.events, `SELECT at, json_extract(data, '$.kind') AS kind, workspace_id AS w FROM events WHERE type = 'window.open' AND at >= ? AND at < ?`, from, to)) acc.count(hourOf(r.at), [r.kind, r.w]);
      return acc.rows();
    },
  },

  // cmd itself: gauges sampled by the stats service, stalls as the scheduler's watchdog sees them
  {
    id: "core.memory",
    version: 1,
    title: "Core memory",
    description: "How much memory cmd's core process used, sampled every minute.",
    kind: "gauge",
    unit: "bytes",
    good: "down",
    dims: [],
    class: "system",
    inputs: {},
    sample: { every: 60_000, read: () => [{ keys: [], value: process.memoryUsage().rss }] },
  },
  {
    id: "core.stalls",
    version: 1,
    title: "Core stalls",
    description: "Times the core's thread was blocked for 100 ms or more, and what ran then.",
    kind: "distribution",
    unit: "ms",
    measure: "n",
    good: "down",
    dims: [{ id: "activity", title: "What ran", many: true }],
    class: "system",
    inputs: {},
  },
  {
    id: "data.size",
    version: 1,
    title: "Event log size",
    description: "How much disk cmd's event log and its views take, sampled every six hours.",
    kind: "gauge",
    unit: "bytes",
    measure: "max",
    dims: [{ id: "file", title: "File", label: labels({ events: "Event log", views: "Views" }) }],
    class: "system",
    inputs: {},
    sample: {
      every: 6 * HOUR,
      read: (c) =>
        (
          [
            ["events", c.eventsFile],
            ["views", c.viewsFile],
          ] as const
        ).flatMap(([k, f]) => (f && fs.existsSync(f) ? [{ keys: [k], value: fs.statSync(f).size + (fs.existsSync(`${f}-wal`) ? fs.statSync(`${f}-wal`).size : 0) }] : [])),
    },
  },

  // cmd's own model calls
  {
    id: "ai.calls",
    version: 1,
    title: "Model calls",
    description: "Calls cmd's own features made to a model (names, summaries, the journal…).",
    kind: "count",
    unit: "count",
    dims: [{ id: "purpose", title: "Feature" }, { id: "model", title: "Model" }, { id: "result", title: "Result", label: labels({ ok: "Worked", fail: "Failed" }) }],
    class: "ai",
    inputs: { types: ["ai.call"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; pu: string | null; m: string | null; ok: number | null }>(c.events, `SELECT at, json_extract(data, '$.purpose') AS pu, json_extract(data, '$.model') AS m, json_extract(data, '$.ok') AS ok FROM events WHERE type = 'ai.call' AND at >= ? AND at < ?`, from, to)) acc.count(hourOf(r.at), [r.pu, r.m, r.ok ? "ok" : "fail"]);
      return acc.rows();
    },
  },
  {
    id: "ai.tokens",
    version: 1,
    title: "cmd's tokens",
    description: "Tokens cmd's own features sent and got back.",
    kind: "sum",
    unit: "tokens",
    dims: [{ id: "token", title: "Kind", label: labels(TOKENS) }, { id: "purpose", title: "Feature" }, { id: "model", title: "Model" }],
    class: "ai",
    inputs: { types: ["ai.call"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; pu: string | null; m: string | null; i: number | null; o: number | null }>(c.events, `SELECT at, json_extract(data, '$.purpose') AS pu, json_extract(data, '$.model') AS m, json_extract(data, '$.tokens.in') AS i, json_extract(data, '$.tokens.out') AS o FROM events WHERE type = 'ai.call' AND at >= ? AND at < ?`, from, to)) {
        if (r.i) acc.add(hourOf(r.at), ["in", r.pu, r.m], r.i);
        if (r.o) acc.add(hourOf(r.at), ["out", r.pu, r.m], r.o);
      }
      return acc.rows();
    },
  },
  {
    id: "ai.latency",
    version: 1,
    title: "Model latency",
    description: "How long cmd's model calls took to answer.",
    kind: "distribution",
    unit: "ms",
    good: "down",
    dims: [{ id: "purpose", title: "Feature" }, { id: "model", title: "Model" }],
    class: "ai",
    inputs: { types: ["ai.call"] },
    compute(from, to, c) {
      const acc = new Acc();
      for (const r of rows<{ at: number; pu: string | null; m: string | null; ms: number | null }>(c.events, `SELECT at, json_extract(data, '$.purpose') AS pu, json_extract(data, '$.model') AS m, json_extract(data, '$.ms') AS ms FROM events WHERE type = 'ai.call' AND at >= ? AND at < ? AND json_extract(data, '$.ms') IS NOT NULL`, from, to)) acc.value(hourOf(r.at), [r.pu, r.m], r.ms!, true);
      return acc.rows();
    },
  },
];
