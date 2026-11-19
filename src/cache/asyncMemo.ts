/** Single-flight memo for async lookups: one in-flight or settled promise per key. */
export class AsyncMemo<K, V> {
  readonly #entries = new Map<K, Promise<V>>();

  get(key: K, factory: () => Promise<V>): Promise<V> {
    const cached = this.#entries.get(key);
    if (cached !== undefined) return cached;
    const promise = factory();
    this.#entries.set(key, promise);
    promise.catch(() => this.#entries.delete(key));
    return promise;
  }
}
