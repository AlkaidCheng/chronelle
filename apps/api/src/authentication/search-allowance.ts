/**
 * Calls per key in the last minute, kept in memory per process: an account
 * id for a signed-in search, `ip:<address>` for a lookup that needs no
 * session.
 */
export class SearchAllowance {
  readonly #limit: number;
  readonly #recent = new Map<string, number[]>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  take(key: string, now: number): boolean {
    const since = now - 60_000;
    const times = (this.#recent.get(key) ?? []).filter((at) => at > since);
    if (times.length >= this.#limit) {
      this.#recent.set(key, times);
      return false;
    }
    times.push(now);
    this.#recent.set(key, times);
    if (this.#recent.size > 10_000) this.#recent.clear();
    return true;
  }
}
