// Failed handshakes, counted per source (the IP the relay or the direct listener
// reports): a source past its limit has its new channels dropped unread for the rest
// of the minute, while everyone else still gets in; a ceiling over all sources stops
// a flood from many. Memory stays bounded: a minute's entries, at most MAX_SOURCES.

/** Failures from one source in a minute before its channels are dropped. */
export const PER_SOURCE = 3;
/** Failures from all sources in a minute before every new channel is dropped. */
export const ALL_SOURCES = 30;
const WINDOW_MS = 60_000;
const MAX_SOURCES = 1000;

export class FailureLimiter {
  #bySource = new Map<string, number[]>();
  #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  failed(source: string): void {
    this.#prune();
    const list = this.#bySource.get(source) ?? [];
    this.#bySource.delete(source); // to the end: the oldest sources go first when there are too many
    this.#bySource.set(source, [...list, this.#now()]);
    while (this.#bySource.size > MAX_SOURCES) this.#bySource.delete(this.#bySource.keys().next().value!);
  }

  /** Whether a new channel from `source` is dropped unread. */
  blocked(source: string): boolean {
    this.#prune();
    if ((this.#bySource.get(source)?.length ?? 0) >= PER_SOURCE) return true;
    let all = 0;
    for (const l of this.#bySource.values()) all += l.length;
    return all >= ALL_SOURCES;
  }

  /** Sources with a failure in the last minute. */
  get sources(): number {
    this.#prune();
    return this.#bySource.size;
  }

  #prune(): void {
    const since = this.#now() - WINDOW_MS;
    for (const [s, l] of this.#bySource) {
      const kept = l.filter((t) => t > since);
      if (!kept.length) this.#bySource.delete(s);
      else if (kept.length !== l.length) this.#bySource.set(s, kept);
    }
  }
}
