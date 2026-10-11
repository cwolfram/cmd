// Foreground-process inspection via the native `procinfo` helper (native/procinfo.c).
// Port of the ghostty-agents fork's AgentProcess.swift: classify by full argv so
// wrappers like `bash …/safehouse … claude`, `sandbox-exec … claude` and
// `node …/bin/codex` are recognized.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { lineSplitter } from "@cmd/protocol";
import { logger } from "@cmd/protocol/node";

const log = logger("procinfo");

export interface ForegroundInfo {
  /** Foreground process group leader of the terminal. */
  pid: number;
  /** Process start time, unix ms. */
  startedAt: number;
  path: string;
  argv: string[];
}

export type Classification =
  | { kind: "agent"; agent: string }
  | { kind: "shell" }
  | { kind: "other"; name: string };

const KNOWN_AGENTS = [
  "claude",
  "codex",
  "gemini",
  "aider",
  "opencode",
  "amp",
  "cursor-agent",
  "goose",
  "crush",
  "qwen",
  "droid",
  "copilot",
] as const;

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "xonsh", "elvish", "pwsh", "powershell", "login"]);
// Only on Windows: elsewhere `cmd` is this app's own CLI.
if (process.platform === "win32") SHELLS.add("cmd");

/** Last path component, either separator, without a Windows `.exe`. */
const basename = (s: string) => (s.split(/[\\/]/).pop() ?? s).replace(/\.exe$/i, "");

/**
 * Agents are checked before shells because wrapper scripts start with a shell
 * (`bash …/safehouse … claude`). Native Claude installs run from
 * `…/claude/versions/<v>`, so path components are checked too.
 */
export function classify(info: Pick<ForegroundInfo, "path" | "argv">): Classification {
  const candidates = [...info.argv.map(basename), basename(info.path), ...info.path.split(/[\\/]/)];
  for (const c of candidates) {
    const hit = KNOWN_AGENTS.find((a) => a === c);
    if (hit) return { kind: "agent", agent: hit };
  }
  const first = basename(info.argv[0] ?? info.path).replace(/^-+/, "");
  if (SHELLS.has(first)) return { kind: "shell" };
  return { kind: "other", name: first || basename(info.path) };
}

const VERSION = /(?:^|[/@_-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?=$|[/_-])/;
const versions = new Map<string, string | null>();

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, name);
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * An agent's version from its executable, best effort and the same for every
 * agent: a version in the real path (Claude's …/versions/2.1.289, Homebrew's
 * Caskroom/codex/0.144.5/…), else the nearest package.json (npm installs).
 */
export function agentVersion(info: Pick<ForegroundInfo, "path" | "argv">, agent: string): string | null {
  const mine = (s: string) => s.split("/").some((c) => c === agent || c.startsWith(`${agent}-`) || c.startsWith(`${agent}.`) || c === `@${agent}`);
  for (const c of [info.path, ...info.argv].filter((s): s is string => !!s && mine(s))) {
    const found = c.includes("/") ? c : onPath(c);
    if (!found) continue;
    let real = found;
    try {
      real = fs.realpathSync(found);
    } catch {}
    if (versions.has(real)) return versions.get(real)!;
    let v = real.match(VERSION)?.[1] ?? null;
    for (let d = path.dirname(real), i = 0; !v && i < 6 && d !== path.dirname(d); d = path.dirname(d), i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")) as { version?: unknown };
        if (typeof pkg.version === "string") v = pkg.version;
        break;
      } catch {}
    }
    versions.set(real, v);
    if (v) return v;
  }
  return null;
}

/**
 * node-pty starts a terminal's shell through its spawn-helper, which then execs the
 * shell. Caught in between, nothing runs yet: not a program ⌘W should ask about.
 */
export function isSpawnHelper(info: Pick<ForegroundInfo, "path" | "argv">): boolean {
  return basename(info.argv[0] ?? info.path) === "spawn-helper" || basename(info.path) === "spawn-helper";
}

/** Name shown for a pane's foreground process. */
export function displayName(c: Classification, info: Pick<ForegroundInfo, "path" | "argv">): string {
  if (c.kind === "agent") return c.agent;
  return basename(info.argv[0] ?? info.path).replace(/^-+/, "");
}

export function procinfoBinary(): string {
  return path.resolve(import.meta.dirname, "../../native/build/procinfo");
}

/** Resource usage of one process tree (see procinfo.c, `t` command). */
export interface TreeUsage {
  pid: number;
  /** Physical footprint in bytes (Activity Monitor's "Memory"). */
  mem: number;
  /** Cumulative user+system CPU time, ns. */
  cpu: number;
  procs: number;
  top: { pid: number; name: string; path: string; mem: number }[];
}

/** Resource usage of one process alone (see procinfo.c, `p` command). */
export interface ProcUsage {
  pid: number;
  mem: number;
  cpu: number;
}

/** A helper that hasn't answered in this long is stuck: it is killed and started again on the next request. */
const TIMEOUT_MS = 1000;
/** Pids per `t`/`p` line, so a request stays well inside the line buffer of a helper built before it read lines of any length. */
const PIDS_PER_LINE = 500;

/**
 * Long-lived helper process; one request/response line per query, answered in
 * order. Every request has a deadline: a helper that misses one is killed, and
 * what was waiting gets nothing, so a stuck helper costs one poll, not every
 * one after it, and answers never shift to the wrong caller.
 */
export class ProcInfo {
  #child: ChildProcessWithoutNullStreams | null = null;
  /** Pending requests, answered in order; each parses its own response line. */
  #queue: ((line: string | null) => void)[] = [];
  #binary: string;
  #timeoutMs: number;
  /** Helpers killed for missing a deadline. */
  stalls = 0;

  constructor(binary = procinfoBinary(), o: { timeoutMs?: number } = {}) {
    this.#binary = binary;
    this.#timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  }

  get available(): boolean {
    return fs.existsSync(this.#binary);
  }

  /** Foreground process of the terminal whose shell is `shellPid`. */
  query(shellPid: number): Promise<ForegroundInfo | null> {
    return this.#ask(`${shellPid}`, null, (line) => {
      const r = JSON.parse(line) as { fg?: number; start?: number; path?: string; argv?: string[]; error?: string };
      return r.error || !r.fg ? null : { pid: r.fg, startedAt: Math.round((r.start ?? 0) * 1000), path: r.path ?? "", argv: r.argv ?? [] };
    });
  }

  /** Memory/CPU of each pid's process tree, from one scan of the process table (per line of pids). */
  trees(pids: number[]): Promise<TreeUsage[]> {
    return this.#each("t", pids, (line) => JSON.parse(line) as TreeUsage[]);
  }

  /** Memory/CPU of each pid on its own; pids that are gone are left out. */
  procs(pids: number[]): Promise<ProcUsage[]> {
    return this.#each("p", pids, (line) => {
      const r: unknown = JSON.parse(line);
      // A helper built before `p` existed answers with an error object.
      return Array.isArray(r) ? (r as ProcUsage[]) : [];
    });
  }

  close(): void {
    if (this.#child) this.#drop(this.#child);
  }

  async #each<T>(cmd: string, pids: number[], parse: (line: string) => T[]): Promise<T[]> {
    const lines: Promise<T[]>[] = [];
    for (let i = 0; i < pids.length; i += PIDS_PER_LINE) lines.push(this.#ask(`${cmd} ${pids.slice(i, i + PIDS_PER_LINE).join(" ")}`, [], parse));
    return (await Promise.all(lines)).flat();
  }

  /** One request line; `fallback` when the helper is missing, stuck, gone, or answers what can't be parsed. */
  #ask<T>(request: string, fallback: T, parse: (line: string) => T): Promise<T> {
    const child = this.#ensure();
    if (!child) return Promise.resolve(fallback);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.stalls++;
        log.warn(`procinfo helper didn't answer in ${this.#timeoutMs} ms; starting it again`, { request: request.slice(0, 80), stalls: this.stalls });
        this.#drop(child);
      }, this.#timeoutMs);
      timer.unref();
      this.#queue.push((line) => {
        clearTimeout(timer);
        try {
          resolve(line ? parse(line) : fallback);
        } catch {
          resolve(fallback);
        }
      });
      child.stdin.write(`${request}\n`);
    });
  }

  /** Forget a helper (stuck, exited) and answer everything it owed with nothing. */
  #drop(child: ChildProcessWithoutNullStreams): void {
    if (this.#child !== child) return;
    this.#child = null;
    child.kill();
    for (const r of this.#queue.splice(0)) r(null);
  }

  #ensure(): ChildProcessWithoutNullStreams | null {
    if (this.#child) return this.#child;
    if (!this.available) return null;
    const child = spawn(this.#binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on(
      "data",
      lineSplitter((line) => {
        if (this.#child === child) this.#queue.shift()?.(line);
      }),
    );
    const fail = () => this.#drop(child);
    child.on("exit", fail);
    child.on("error", fail);
    child.stdin.on("error", fail); // EPIPE from a helper that died between requests
    child.unref();
    (child.stdin as unknown as { unref?: () => void }).unref?.();
    (child.stdout as unknown as { unref?: () => void }).unref?.();
    this.#child = child;
    return child;
  }
}
