/** A tiny time-to-live cache: the same profile is not looked up again for `ttlMs` unless the tab regains focus. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; storedAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, now: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, now: number): void {
    this.entries.set(key, { value, storedAt: now });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}
