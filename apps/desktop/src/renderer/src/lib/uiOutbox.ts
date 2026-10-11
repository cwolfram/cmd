// Local writes to persisted UI state (ui.set) on their way to the core. A write
// applies locally at once and is sent debounced per key; its latest value shows
// over what the core sends (a reconnect's snapshot included) until a call carrying
// it is answered, and goes again after a reconnect when its call failed (a core
// restart), instead of being lost.

export class UiOutbox {
  /** Key → the latest local value the core hasn't confirmed. */
  #unsent = new Map<string, unknown>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #send: (key: string, value: unknown) => Promise<unknown>;
  #delayMs: number;

  constructor(send: (key: string, value: unknown) => Promise<unknown> = () => Promise.resolve(), delayMs = 250) {
    this.#send = send;
    this.#delayMs = delayMs;
  }

  /** A local write, sent after the delay (a newer one of the key restarts it). */
  set(key: string, value: unknown): void {
    this.#unsent.set(key, value);
    clearTimeout(this.#timers.get(key));
    this.#timers.set(key, setTimeout(() => this.#flushKey(key), this.#delayMs));
  }

  /** Send what is waiting for its delay now (the window unloads). */
  flush(): void {
    for (const key of [...this.#timers.keys()]) this.#flushKey(key);
  }

  /** After a reconnect: what the core hasn't confirmed goes again. */
  resend(): void {
    for (const key of this.#unsent.keys()) if (!this.#timers.has(key)) this.#flushKey(key);
  }

  /** The key's value to send now (null: nothing to send); done once the core answered it. */
  take(key: string): { value: unknown; done: () => void } | null {
    if (!this.#unsent.has(key)) return null;
    const value = this.#unsent.get(key);
    return {
      value,
      done: () => {
        if (this.#unsent.get(key) === value) this.#unsent.delete(key); // else a newer value is on its way
      },
    };
  }

  /** The core's UI state with the writes it hasn't confirmed over it. */
  over(ui: Record<string, unknown>): Record<string, unknown> {
    return this.#unsent.size ? { ...ui, ...Object.fromEntries(this.#unsent) } : ui;
  }

  keys(): string[] {
    return [...this.#unsent.keys()];
  }

  #flushKey(key: string): void {
    clearTimeout(this.#timers.get(key));
    this.#timers.delete(key);
    const send = this.take(key);
    if (send) void this.#send(key, send.value).then(send.done, () => {});
  }
}
