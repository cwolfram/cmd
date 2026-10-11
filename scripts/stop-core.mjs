// Stops cmd cores. Cores are detached and outlive the app on purpose, so dev and
// test runs leave them behind. Their terminals run in a PTY host that outlives
// the core too (packages/core/src/terminals/host.ts): stopping a core keeps them,
// --terminals stops its host as well. The installed app's core is only stopped
// when asked for, so this is safe to run in its terminals.
//   node scripts/stop-core.mjs                        the core of $CMD_HOME, else the dev instance's (a worktree's own),
//                                                     and those of the instances inside it (a worktree's .cmd-dev/e2e-*, workbench…)
//   node scripts/stop-core.mjs --terminals            … and their PTY hosts (their terminals close)
//   node scripts/stop-core.mjs --release              the installed app's core
//   node scripts/stop-core.mjs --all                  every dev and test core and PTY host on this machine
//   node scripts/stop-core.mjs --all --include-release  … and the installed app's
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { cmdHome, connect, enterInstance } from "../packages/protocol/src/node.ts";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

/** Pids that were alive but not ours to signal (EPERM). */
export const refused = [];
/** Pids a pid file named that nothing could confirm are a core or PTY host (no ps, no answer on the socket): left alone. */
export const unverified = [];

/** SIGTERM (the core shuts down cleanly), then SIGKILL after `graceMs`. */
export async function stopPid(pid, graceMs = 3000) {
  if (!alive(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    // Alive, but not ours to signal (a sandboxed agent's shell, another user): say so, don't crash.
    if (err.code !== "EPERM") throw err;
    refused.push(pid);
    return false;
  }
  for (let t = 0; t < graceMs && alive(pid); t += 100) await new Promise((r) => setTimeout(r, 100));
  if (alive(pid)) process.kill(pid, "SIGKILL");
  return true;
}

/** The pid in `<home>/<name>.pid` (core, ptyhost), if any. */
export function corePid(home = cmdHome(), name = "core") {
  try {
    const pid = Number(fs.readFileSync(path.join(home, `${name}.pid`), "utf8"));
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

const isCore = (cmdline) => /packages\/core\/src\/(main|terminals\/host-main)\.ts/.test(cmdline.replaceAll("\\", "/"));

/**
 * The installed app's core: started with --instance=release, or, by cores from
 * before that flag, run from the release state dir's runtime copy.
 */
const isReleaseCore = (cmdline) => {
  const c = cmdline.replaceAll("\\", "/");
  return c.includes("--instance=release") || (!c.includes("--instance=") && /\/cmd\/runtime\//.test(c));
};

const psCommand = (pid) => execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });

/**
 * A pid file left by a crash or a reboot may name a reused pid: whether `pid` is a
 * core or PTY host by its command line; null when ps can't say (a sandbox denies it).
 */
function looksLikeCore(pid, ps = psCommand) {
  if (process.platform === "win32") return true;
  try {
    return isCore(ps(pid));
  } catch {
    return alive(pid) ? null : false;
  }
}

/** Instance homes inside `home`, two levels down (a worktree's .cmd-dev holds e2e-*, workbench, test homes): any folder with a core's pid file or socket. */
export function nestedHomes(home) {
  const out = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (!e.isDirectory() || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (["core.pid", "ptyhost.pid", "core.sock"].some((f) => fs.existsSync(path.join(p, f)))) out.push(p);
      if (depth < 2) walk(p, depth + 1);
    }
  };
  walk(home, 1);
  return out;
}

/** A core's pid and its PTY host's, asked over its socket: for a home whose pid files were deleted (a worktree removed while its core ran). */
export async function askPids(home) {
  try {
    const c = await Promise.race([connect(path.join(home, "core.sock")), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 1000))]);
    try {
      const hello = await c.client.call("core.hello", {});
      const info = await c.client.call("core.info", {}).catch(() => null);
      return { core: hello.pid, host: info?.ptyHost?.pid ?? null };
    } finally {
      c.close();
    }
  } catch {
    return null;
  }
}

async function stopOne(home, terminals, ps) {
  let pid = corePid(home);
  let host = terminals ? corePid(home, "ptyhost") : null;
  let asked;
  const ask = async () => (asked ??= await askPids(home));
  if (!pid || (terminals && !host)) {
    pid ??= (await ask())?.core ?? null;
    if (terminals) host ??= (await ask())?.host ?? null;
  }
  // Signalled only when its command line says it's one, or (without ps) the core on the socket names that pid.
  const verified = async (p, which) => {
    const byPs = looksLikeCore(p, ps);
    if (byPs !== null) return byPs;
    if ((await ask())?.[which] === p) return true;
    unverified.push(p);
    return false;
  };
  const stopped = pid && (await verified(pid, "core")) ? await stopPid(pid) : false;
  return (host && (await verified(host, "host")) ? await stopPid(host) : false) || stopped;
}

/** Stops the core whose state dir is `home` and those of the instances inside it (with `terminals`, their PTY hosts too); true if one was running. `ps`: tests. */
export async function stopCore(home = cmdHome(), { terminals = false, ps = psCommand } = {}) {
  let stopped = false;
  for (const h of [home, ...nestedHomes(home)]) stopped = (await stopOne(h, terminals, ps)) || stopped;
  return stopped;
}

/** Pids of running cmd cores and PTY hosts: dev (any checkout), tests, and with `release` the installed app's. */
function allCores(release) {
  const lines =
    process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"], { encoding: "utf8" })
      : execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return lines
    .split(/\r?\n/)
    .filter((l) => isCore(l) && (release || !isReleaseCore(l)))
    .map((l) => Number(l.trim().split(/\s+/)[0]));
}

if (path.resolve(process.argv[1] ?? "") === import.meta.filename) {
  const args = process.argv.slice(2);
  // $CMD_INSTANCE may be inherited from a pane; the flags decide. In a linked
  // worktree the dev instance is the worktree's own (instance.ts, worktreeHome).
  enterInstance(args.includes("--release") ? "release" : "dev", path.resolve(import.meta.dirname, ".."));
  if (args.includes("--all")) {
    const pids = allCores(args.includes("--include-release")).filter((p) => p !== process.pid);
    for (const pid of pids) await stopPid(pid);
    console.log(pids.length ? `stopped ${pids.length} core${pids.length === 1 ? "" : "s"} and PTY host${pids.length === 1 ? "" : "s"}: ${pids.join(", ")}` : "no cores running");
  } else {
    const home = cmdHome();
    const terminals = args.includes("--terminals");
    const what = terminals ? "the core and terminals" : "the core (its terminals keep running; --terminals stops them)";
    const stopped = await stopCore(home, { terminals });
    if (unverified.length) console.error(`left pid ${unverified.join(", ")} alone: its pid file says it's ${home}'s core or PTY host, but ps isn't allowed here and the core doesn't answer to confirm it (a pid reused after a crash or a reboot?)`);
    if (refused.length) {
      console.error(`couldn't stop pid ${refused.join(", ")} of ${home}: not allowed from here (a sandbox?), run this outside it`);
      process.exitCode = 1;
    } else console.log(stopped ? `stopped ${what} of ${home}` : `no core running for ${home}`);
  }
}
