// Whether this cmd can talk to the core it reached (core.hello's protocol): a
// cmd from PATH, an SSH session or another install may be of another version
// than the app whose core it found. Methods added since are asked with has().

import path from "node:path";
import { PROTOCOL, type CoreHello } from "@cmd/protocol";

/** The line to print when the core speaks another protocol, null when they match (or the core is too old to say). */
export function skewMessage(hello: CoreHello | null): string | null {
  if (hello?.protocol === undefined || hello.protocol === PROTOCOL) return null;
  const app = hello.app && hello.app !== "source" ? `cmd ${hello.app}` : "built from source";
  const own = hello.stateDir ? ` Run ${path.join(hello.stateDir, "bin", "cmd")} instead, or update cmd.` : " Update cmd, or run the cmd that came with the app.";
  return `this cmd doesn't match the running app (${app}).${own}`;
}
