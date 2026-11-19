/** Typed errors shared by every layer; messages name the step and status, never secrets. */

/**
 * `attempts` is set only when retries ran out; it is a count, never a credential. `retryAfter` is the
 * raw `Retry-After` header of the response, kept for the 429 handling and never put in the message.
 */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly label: string,
    readonly attempts?: number,
    readonly retryAfter?: string,
  ) {
    super(`${label}: HTTP ${status}${attempts === undefined ? '' : ` after ${attempts} attempts`}`);
    this.name = 'HttpStatusError';
  }
}

export class NetworkError extends Error {
  constructor(
    readonly label: string,
    readonly attempts: number,
  ) {
    super(`${label}: network error after ${attempts} attempts`);
    this.name = 'NetworkError';
  }
}

export class MalformedResponseError extends Error {
  constructor(readonly label: string) {
    super(`${label}: malformed response`);
    this.name = 'MalformedResponseError';
  }
}

/**
 * Memrise answered 429 and we stopped asking. `until` (epoch ms) is when requests may resume; the
 * message carries only that time. Never a per-lesson failure: every other request would hit it too.
 */
export class RateLimitedError extends Error {
  constructor(readonly until: number) {
    super(`Memrise is rate-limiting requests (HTTP 429); try again after ${utcSeconds(until)}`);
    this.name = 'RateLimitedError';
  }
}

/**
 * Another process on the same cache folder held the request lock for longer than this one would
 * wait. The message names the lock file but never the folder, which can contain a home path.
 */
export class PacerLockTimeoutError extends Error {
  constructor() {
    super('timed out waiting for another memrise-mcp process to finish its request (lock file pacer.lock in the cache folder)');
    this.name = 'PacerLockTimeoutError';
  }
}

/**
 * A request was dropped once it got its turn, because its result had appeared meanwhile (another
 * process stored it). Never sent, so never a failure: the caller picks up the stored result.
 */
export class RequestNotNeededError extends Error {
  constructor() {
    super('request no longer needed');
    this.name = 'RequestNotNeededError';
  }
}

/** ISO 8601 in UTC, to the second. */
export function utcSeconds(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A failure whose message is already written for the user (for example a file that cannot be written); shown as is. */
export class UserMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserMessageError';
  }
}

/** `step` is one of the login steps (e.g. `csrf`, `access_token`); `detail` is a status or failure kind, never a credential. */
export class AuthError extends Error {
  constructor(
    readonly step: string,
    readonly detail?: string,
    options?: { cause?: unknown },
  ) {
    super(`Memrise login failed at step ${step}${detail ? `: ${detail}` : ''}`, options);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends Error {
  /** `id` is the id that was asked for, when the request had one. */
  constructor(
    readonly label: string,
    readonly id?: number,
  ) {
    super(`${label}: not found`);
    this.name = 'NotFoundError';
  }
}

/** The exact text `loadConfig` throws when no credentials are set; `errorMessages` rewrites it for the learner. */
export const MISSING_CREDENTIALS_MESSAGE = 'MEMRISE_USERNAME and MEMRISE_PASSWORD must be set';

const LESSON_FETCH_FAILURES = [HttpStatusError, NetworkError, MalformedResponseError, NotFoundError];

/** True when only one lesson's details failed; auth and config errors would fail every lesson, so they are never tolerated. */
export function isLessonFetchFailure(err: unknown): boolean {
  return LESSON_FETCH_FAILURES.some((failureClass) => err instanceof failureClass);
}

/** Short, secret-free reason for a failed lesson fetch; anything unrecognised is generic. */
export function describeFailure(err: unknown): string {
  if (err instanceof HttpStatusError) return `HTTP ${err.status}`;
  if (err instanceof NetworkError) return 'network error';
  if (err instanceof MalformedResponseError) return 'malformed response';
  if (err instanceof NotFoundError) return 'not found';
  return 'unexpected error';
}
