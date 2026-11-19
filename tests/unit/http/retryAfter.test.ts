import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_AFTER_MS, retryAfterMs } from '../../../src/http/retryAfter.js';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

describe('retryAfterMs', () => {
  it.each([
    ['delay seconds', '5', 5_000],
    ['delay seconds with surrounding spaces', ' 7 ', 7_000],
    ['zero seconds', '0', 0],
    ['an HTTP-date 30 s ahead', 'Thu, 01 Jan 2026 00:00:30 GMT', 30_000],
    ['an HTTP-date in the past, which means no wait', 'Wed, 31 Dec 2025 23:59:00 GMT', 0],
    ['negative seconds, clamped to no wait', '-5', 0],
  ])('reads %s', (_name, header, expected) => {
    expect(retryAfterMs(header, NOW)).toBe(expected);
  });

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['text that is neither form', 'soon'],
    ['fractional seconds, which the header does not allow', '1.5'],
  ])('falls back to 60 s for %s', (_name, header) => {
    expect(retryAfterMs(header, NOW)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(DEFAULT_RETRY_AFTER_MS).toBe(60_000);
  });
});
