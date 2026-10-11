// Asking the app (its renderer windows) for something only it has or does: a browser page's
// content (pages.ts), a move on a workspace's board (workspace.arrange). The core sends an event
// with a request id; the app window concerned answers through a method with that id; the first
// answer wins, and none in time fails with a message saying why.

import { randomUUID } from "node:crypto";
import type { CoreEvent } from "@cmd/protocol";
import type { CoreContext } from "../kernel/context.ts";

export class AppAsk {
  #broadcast: (e: CoreEvent) => void;
  #waiting = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  constructor(broadcast: (e: CoreEvent) => void) {
    this.#broadcast = broadcast;
  }

  /** Send `event(reqId)`; resolves with the answer, or fails with `silence` after `ms`. */
  ask<T>(event: (reqId: string) => CoreEvent, ms: number, silence: string): Promise<T> {
    const reqId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(reqId);
        reject(new Error(silence));
      }, ms);
      this.#waiting.set(reqId, { resolve: resolve as (r: unknown) => void, reject, timer });
      this.#broadcast(event(reqId));
    });
  }

  /** The app's answer; a late or second one is dropped. */
  answer(reqId: string, result: unknown, error: string | undefined): void {
    const w = this.#waiting.get(reqId);
    if (!w) return;
    this.#waiting.delete(reqId);
    clearTimeout(w.timer);
    if (error) w.reject(new Error(error));
    else w.resolve(result);
  }
}

const asks = new WeakMap<object, AppAsk>();

/** The core's AppAsk, made on first use. */
export function appAsk(core: Pick<CoreContext, "broadcast">): AppAsk {
  let a = asks.get(core);
  if (!a) asks.set(core, (a = new AppAsk((e) => core.broadcast(e))));
  return a;
}
