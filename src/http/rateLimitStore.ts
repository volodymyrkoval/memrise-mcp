/**
 * Port for the rate-limit cooldown shared by every process on one cache folder. After Memrise
 * answers 429 and the client gives up, `record` stores when requests may resume; until then every
 * request fails fast without touching the network.
 */
export interface RateLimitStore {
  /** The recorded cooldown end (epoch ms), past or future; `undefined` when none is readable. Never rejects. */
  read(): Promise<number | undefined>;
  /** Stores the cooldown end. Never rejects: a cooldown that cannot be saved must not mask the 429 itself. */
  record(until: number): Promise<void>;
}
