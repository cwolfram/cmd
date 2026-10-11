// core.hello, what a client asks first: the protocol the core speaks (PROTOCOL,
// DEVELOPMENT.md "Versions on the wire"), the app it came with, and the methods
// there are for the caller, so a client of another build asks has() instead of
// probing. Also who the core is: its pid, socket, build, state dir and code folder.

import path from "node:path";
import { PROTOCOL, type CoreHello, type Method } from "@cmd/protocol";
import { REMOTE_ACCESS } from "../remote/policy.ts";
import type { Connection } from "./connection.ts";

/**
 * A paired device hears of the methods a device may ever call: its scope can
 * change while it's connected, and a call beyond it is still refused (RemoteDenied).
 */
export function coreHello(handlers: object, o: { socketPath: string; build?: string; stateDir?: string }, conn: Connection | null): CoreHello {
  const methods = (Object.keys(handlers) as Method[]).filter((m) => !conn || conn.access === "local" || REMOTE_ACCESS[m] !== "never");
  return {
    protocol: PROTOCOL,
    app: process.env.CMD_APP_VERSION || "source",
    methods,
    pid: process.pid,
    socket: o.socketPath,
    build: o.build ?? "",
    stateDir: o.stateDir,
    root: path.resolve(import.meta.dirname, "../../../.."),
  };
}
