/** HTTP 429 handling: honour `Retry-After` once, then give up and record a cooldown for everyone on the cache folder. */
import { HttpStatusError, RateLimitedError } from '../errors.js';
import type { RateLimitStore } from './rateLimitStore.js';
import { retryAfterMs } from './retryAfter.js';
import type { Now, Sleep } from './transport.js';

/** The longest `Retry-After` worth waiting out in-process; a longer one fails the request instead. */
export const MAX_RETRY_AFTER_WAIT_MS = 120_000;
/** The longest cooldown recorded, whatever the header says; a bogus value must not lock requests out for years. */
export const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface RateLimitPolicy {
  now: Now;
  sleep: Sleep;
  store: RateLimitStore;
}

/**
 * Runs `operation`; on a 429 waits the server's `Retry-After` (up to the cap) and runs it once more.
 * A second 429, or a wait above the cap, records a cooldown and rejects with `RateLimitedError`.
 */
export async function withRateLimitBackoff<T>(operation: () => Promise<T>, policy: RateLimitPolicy): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    const waitMs = requestedWaitMs(err, policy);
    if (waitMs > MAX_RETRY_AFTER_WAIT_MS) throw await giveUp(waitMs, policy);
    await policy.sleep(waitMs);
  }
  try {
    return await operation();
  } catch (err) {
    throw await giveUp(requestedWaitMs(err, policy), policy);
  }
}

/** The wait a 429 asks for; any other failure is rethrown unchanged. */
function requestedWaitMs(err: unknown, policy: RateLimitPolicy): number {
  if (!(err instanceof HttpStatusError && err.status === 429)) throw err;
  return retryAfterMs(err.retryAfter, policy.now());
}

/** Records the cooldown for every request and process on this cache folder, and returns the error to throw. */
async function giveUp(waitMs: number, policy: RateLimitPolicy): Promise<RateLimitedError> {
  const until = policy.now() + Math.min(waitMs, MAX_COOLDOWN_MS);
  await policy.store.record(until);
  return new RateLimitedError(until);
}
