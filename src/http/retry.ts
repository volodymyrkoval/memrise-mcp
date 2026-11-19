import { HttpStatusError, NetworkError } from '../errors.js';
import type { Sleep } from './transport.js';

export interface RetryPolicy {
  /** Total tries, including the first. */
  attempts: number;
  /** Pause before each retry; `delaysMs[i]` is the wait after failed attempt `i + 1`. */
  delaysMs: readonly number[];
  sleep: Sleep;
  isTransient: (err: unknown) => boolean;
}

/** Runs `operation`, retrying transient failures with the policy's delays; rethrows the last failure. */
export async function withRetry<T>(operation: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (!policy.isTransient(err)) throw err;
      if (attempt >= policy.attempts) throw withAttemptCount(err, attempt);
      await policy.sleep(policy.delaysMs[attempt - 1]);
    }
  }
}

/** Restates an exhausted failure with the number of attempts that were made. */
function withAttemptCount(err: unknown, attempts: number): unknown {
  if (err instanceof NetworkError) return new NetworkError(err.label, attempts);
  if (err instanceof HttpStatusError) return new HttpStatusError(err.status, err.label, attempts);
  return err;
}

/** Network failures and server errors (5xx) are worth another quick try; rate limiting (429) has its own handling. */
export function isTransientFailure(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  return err instanceof HttpStatusError && err.status >= 500;
}
