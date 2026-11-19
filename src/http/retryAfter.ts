/** Reads the `Retry-After` header of a 429 response as a wait in milliseconds. */

/** The wait assumed when the server sends no usable `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

const DELAY_SECONDS = /^-?\d+$/;
/** HTTP-dates always name a weekday or month; this keeps bare numbers like `1.5` away from `Date.parse`. */
const HAS_LETTERS = /[a-z]/i;

/**
 * Delay-seconds or an HTTP-date, never below zero (a past date or negative count means "now").
 * Anything else, including a missing header, is `DEFAULT_RETRY_AFTER_MS`.
 */
export function retryAfterMs(header: string | undefined, nowMs: number): number {
  const value = header?.trim() ?? '';
  if (DELAY_SECONDS.test(value)) return Math.max(0, Number(value) * 1000);
  const date = HAS_LETTERS.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isNaN(date) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, date - nowMs);
}
