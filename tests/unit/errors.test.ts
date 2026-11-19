import { describe, expect, it } from 'vitest';
import {
  AuthError,
  ConfigError,
  HttpStatusError,
  MalformedResponseError,
  NetworkError,
  NotFoundError,
  RateLimitedError,
  describeFailure,
  UsageError,
  isLessonFetchFailure,
} from '../../src/errors.js';

describe('UsageError', () => {
  it('keeps the usage hint as its message', () => {
    const err = new UsageError('unknown command: foo');

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('unknown command: foo');
  });
});

describe('AuthError', () => {
  it('names the login step and an optional detail without any credential', () => {
    expect(new AuthError('access_token', 'HTTP 400').message).toBe(
      'Memrise login failed at step access_token: HTTP 400',
    );
  });
});

describe('RateLimitedError', () => {
  it('tells the user Memrise is rate-limiting and when to try again, as a UTC time', () => {
    const err = new RateLimitedError(Date.parse('2026-01-01T00:01:00.000Z'));

    expect(err.message).toBe('Memrise is rate-limiting requests (HTTP 429); try again after 2026-01-01T00:01:00Z');
    expect(err.until).toBe(Date.parse('2026-01-01T00:01:00.000Z'));
  });
});

describe('isLessonFetchFailure', () => {
  it.each([
    ['HTTP status', new HttpStatusError(503, 'scenario_details')],
    ['network', new NetworkError('scenario_details', 3)],
    ['malformed response', new MalformedResponseError('scenario_details')],
    ['not found', new NotFoundError('scenario_details')],
  ])('is true for a %s failure of one lesson', (_name, err) => {
    expect(isLessonFetchFailure(err)).toBe(true);
  });

  it.each([
    ['auth', new AuthError('csrf')],
    ['config', new ConfigError('MEMRISE_USERNAME and MEMRISE_PASSWORD must be set')],
    ['rate-limit', new RateLimitedError(Date.parse('2026-01-01T00:01:00.000Z'))],
    ['unknown', new Error('boom')],
  ])('is false for a %s failure, which must never be tolerated', (_name, err) => {
    expect(isLessonFetchFailure(err)).toBe(false);
  });
});

describe('describeFailure', () => {
  it('describes an HTTP status failure by its status code', () => {
    expect(describeFailure(new HttpStatusError(503, 'scenario_details'))).toBe('HTTP 503');
  });

  it('describes a network failure without repeating any URL or detail', () => {
    expect(describeFailure(new NetworkError('scenario_details', 3))).toBe('network error');
  });

  it('describes an unparseable response as malformed', () => {
    expect(describeFailure(new MalformedResponseError('scenario_details'))).toBe('malformed response');
  });

  it('describes a missing resource as not found', () => {
    expect(describeFailure(new NotFoundError('scenario_details'))).toBe('not found');
  });
});
