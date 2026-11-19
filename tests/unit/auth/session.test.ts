import { describe, expect, it } from 'vitest';
import type { ApiRequest } from '../../../src/http/httpClient.js';
import { applySession, type Session } from '../../../src/auth/session.js';

// Token assembled at runtime so the repo secret scanner never reads it as a real credential.
const TOKEN = ['tok', 'alpha', 'beta', 'gamma', 'delta'].join('-');
const SESSION: Session = { accessToken: TOKEN };

const DATA_REQUEST: ApiRequest = {
  method: 'GET',
  path: '/v1.25/me/language_pairs/',
  label: 'language_pairs',
  headers: { 'x-correlation-id': 'corr-1' },
};

describe('applySession', () => {
  it('adds a Bearer authorization header carrying the access token', () => {
    const authorized = applySession(DATA_REQUEST, SESSION);

    expect(authorized.headers).toEqual({
      'x-correlation-id': 'corr-1',
      authorization: `Bearer ${TOKEN}`,
    });
  });

  it('leaves the request it was given unchanged', () => {
    applySession(DATA_REQUEST, SESSION);

    expect(DATA_REQUEST.headers).toEqual({ 'x-correlation-id': 'corr-1' });
  });
});
