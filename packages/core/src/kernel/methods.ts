// The kernel's own methods: the core's processes, usage stats, settings, secrets and the UI's
// state (core.hello, core.info and events.subscribe are Core's, in core.ts).

import type { CoreContext } from "./context.ts";
import { slice } from "./handlers.ts";

export const kernelHandlers = (core: CoreContext) =>
  slice({
    "core.processes": async () => {
      const host = core.panes.backend.info?.()?.pid ?? null;
      const stats = (await core.processes?.sample(host ? [process.pid, host] : [process.pid])) ?? new Map();
      return { core: stats.get(process.pid) ?? null, ptyHost: host ? (stats.get(host) ?? null) : null };
    },
    "usage.launch": () => (core.usage.launch(), null),
    "settings.get": () => core.settings.snapshot(),
    "settings.set": (p) => core.settings.set(p.key, p.value),
    "settings.reset": (p) => core.settings.reset(p.key),
    "secrets.status": () => core.secrets.status(),
    "secrets.set": (p) => core.secrets.set(p.key, p.value),
    "ui.get": () => core.store.uiState(),
    "ui.set": (p) => {
      if (typeof p.key !== "string" || !p.key || p.key.length > 200) throw new Error("ui.set: invalid key");
      if (JSON.stringify(p.value ?? null).length > 64 * 1024) throw new Error("ui.set: value too large");
      core.store.setUiState(p.key, p.value);
      return null;
    },
  });
