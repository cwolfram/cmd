// electron-vite dev (pnpm dev, the UI Workbench) into apps/desktop/out-dev, not out/: out/
// is the build that pnpm e2e, pnpm dist and the packaged app run, and dev rewrites main and
// preload without a renderer, which broke e2e after a dev session and made agents stop the
// Workbench before every check. Electron starts from out-dev, so it gets a copy of the app's
// package.json (name, version, flavor, "type") with main pointed inside it.
//   node scripts/dev-electron.mjs [electron-vite dev options]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const desktop = path.resolve(import.meta.dirname, "../apps/desktop");
const out = path.join(desktop, "out-dev");
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ ...pkg, main: "main/index.js", scripts: undefined }, null, 2));

const child = spawn("pnpm", ["exec", "electron-vite", "dev", "--outDir", "out-dev", "--entry", "out-dev", ...process.argv.slice(2)], { cwd: desktop, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, sig) => process.exit(sig ? 1 : (code ?? 0)));
