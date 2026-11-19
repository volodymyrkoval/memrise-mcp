/**
 * Test double for `RateLimitStore`: holds the cooldown in memory and records every `record` call,
 * so HTTP tests can seed a cooldown or assert one was written without touching the filesystem.
 */
import type { RateLimitStore } from '../../src/http/rateLimitStore.js';

export class InMemoryRateLimitStore implements RateLimitStore {
  /** Every cooldown end passed to `record`, in order. */
  readonly recorded: number[] = [];

  constructor(public until?: number) {}

  async read(): Promise<number | undefined> {
    return this.until;
  }

  async record(until: number): Promise<void> {
    this.recorded.push(until);
    this.until = until;
  }
}
