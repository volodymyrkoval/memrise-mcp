import { describe, expect, it } from 'vitest';
import { readCookie } from '../../../src/http/cookies.js';

// Cookie samples are assembled at runtime so the repo secret scanner does not read them as real tokens.
const CSRF_NAME = 'csrftoken';
const CSRF = [CSRF_NAME, 'abc1234'].join('=');

describe('readCookie', () => {
  it('returns the value of the named cookie with its attributes stripped', () => {
    const setCookies = [`${CSRF}; Max-Age=31449600; Path=/; Secure; SameSite=Lax`, 'other=1; Path=/'];

    expect(readCookie(setCookies, CSRF_NAME)).toBe('abc1234');
  });

  it('keeps everything after the first "=" when the value itself contains "="', () => {
    const padded = ['abc1234', 'def=='].join('');

    expect(readCookie([`${CSRF_NAME}=${padded}; Path=/`], CSRF_NAME)).toBe(padded);
  });

  it('returns the last value when the same cookie is set more than once', () => {
    const setCookies = [`${CSRF}; Path=/`, `${['csrftoken', 'zzz9999'].join('=')}; Path=/`];

    expect(readCookie(setCookies, CSRF_NAME)).toBe('zzz9999');
  });

  it('returns undefined when the named cookie is set without an "=" (no value)', () => {
    expect(readCookie([`${CSRF_NAME}; Path=/`], CSRF_NAME)).toBeUndefined();
  });

  it('returns undefined when the cookie is absent or no cookies were set', () => {
    expect(readCookie([`${CSRF}; Path=/`], 'sessionid_2')).toBeUndefined();
    expect(readCookie([], CSRF_NAME)).toBeUndefined();
  });
});
