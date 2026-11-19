import { describe, expect, it } from 'vitest';
import { HttpStatusError, NetworkError } from '../../../src/errors.js';
import { isTransientFailure, withRetry } from '../../../src/http/retry.js';

const THREE_ATTEMPTS = { attempts: 3, delaysMs: [500, 1500] } as const;

function recordingSleep() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}

describe('withRetry', () => {
  it('retries transient failures with the configured delays and returns the first success', async () => {
    const { sleeps, sleep } = recordingSleep();
    let calls = 0;
    const operation = async () => {
      calls += 1;
      if (calls < 3) throw new HttpStatusError(503, 'scenario_details');
      return 'ok';
    };

    const result = await withRetry(operation, { ...THREE_ATTEMPTS, sleep, isTransient: isTransientFailure });

    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 1500]);
  });
});

describe('withRetry when retries run out', () => {
  it('rethrows the last HTTP status failure with the total attempt count', async () => {
    const { sleeps, sleep } = recordingSleep();
    const operation = async () => {
      throw new HttpStatusError(503, 'scenario_details');
    };

    const failure = await withRetry(operation, { ...THREE_ATTEMPTS, sleep, isTransient: isTransientFailure }).catch(
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect(failure).toHaveProperty('status', 503);
    expect((failure as Error).message).toBe('scenario_details: HTTP 503 after 3 attempts');
    expect(sleeps).toEqual([500, 1500]);
  });

  it('rethrows the last network failure with the total attempt count', async () => {
    const { sleep } = recordingSleep();
    const operation = async () => {
      throw new NetworkError('scenario_details', 1);
    };

    const failure = await withRetry(operation, { ...THREE_ATTEMPTS, sleep, isTransient: isTransientFailure }).catch(
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(NetworkError);
    expect(failure).toHaveProperty('attempts', 3);
  });
});

describe('withRetry edge cases', () => {
  it.each([400, 401, 403, 404])('does not retry HTTP %i, because it will not succeed on its own', async (status) => {
    const { sleeps, sleep } = recordingSleep();
    let calls = 0;
    const operation = async () => {
      calls += 1;
      throw new HttpStatusError(status, 'scenario_details');
    };

    const failure = await withRetry(operation, { ...THREE_ATTEMPTS, sleep, isTransient: isTransientFailure }).catch(
      (err: unknown) => err,
    );

    expect(failure).toHaveProperty('status', status);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('never sleeps when the first attempt succeeds', async () => {
    const { sleeps, sleep } = recordingSleep();

    const result = await withRetry(async () => 'first try', {
      ...THREE_ATTEMPTS,
      sleep,
      isTransient: isTransientFailure,
    });

    expect(result).toBe('first try');
    expect(sleeps).toEqual([]);
  });
});

describe('isTransientFailure', () => {
  it('treats network failures and server errors as transient, and everything else (429 included) as final', () => {
    expect(isTransientFailure(new NetworkError('scenario_details', 1))).toBe(true);
    expect(isTransientFailure(new HttpStatusError(500, 'scenario_details'))).toBe(true);
    expect(isTransientFailure(new HttpStatusError(503, 'scenario_details'))).toBe(true);
    expect(isTransientFailure(new HttpStatusError(429, 'scenario_details'))).toBe(false);
    expect(isTransientFailure(new HttpStatusError(404, 'scenario_details'))).toBe(false);
    expect(isTransientFailure(new Error('boom'))).toBe(false);
  });
});
