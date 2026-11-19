import { describe, expect, it } from 'vitest';
import { scanForSecrets } from '../../../src/security/scanForSecrets.js';

// Fake values only. Pattern samples are joined at runtime so this file never
// contains a contiguous secret-looking string that the repo scanner would flag.
const FAKE_PASSWORD = 'fake-pass-word-42';

describe('scanForSecrets', () => {
  it('reports a known secret found verbatim, with its 1-based line number', () => {
    const text = `first line\nlogged in with ${FAKE_PASSWORD}\n`;

    expect(scanForSecrets(text, [FAKE_PASSWORD])).toEqual([{ kind: 'known-secret', line: 2 }]);
  });

  it('finds a known secret that appears only URL-encoded', () => {
    const secret = 'p@ss w/rd-7';
    const text = `body=user&pw=${encodeURIComponent(secret)}`;

    expect(scanForSecrets(text, [secret])).toEqual([{ kind: 'known-secret', line: 1 }]);
  });

  it('finds a known secret that appears only JSON-escaped', () => {
    const secret = 'quo"te\\slash-9';
    const text = JSON.stringify({ password: secret });

    expect(scanForSecrets(text, [secret])).toEqual([{ kind: 'known-secret', line: 1 }]);
  });

  it('finds a known secret that appears only form-encoded with + for spaces', () => {
    const secret = 'p@ss w/rd-7';
    const text = `body=user&pw=${encodeURIComponent(secret).replaceAll('%20', '+')}`;

    expect(scanForSecrets(text, [secret])).toEqual([{ kind: 'known-secret', line: 1 }]);
  });

  it('finds a known secret that appears only base64-encoded', () => {
    const secret = 'p@ss w/rd-7';
    const text = `authorization: ${Buffer.from(secret).toString('base64')}`;

    expect(scanForSecrets(text, [secret])).toEqual([{ kind: 'known-secret', line: 1 }]);
  });

  it('ignores known secrets shorter than 3 characters', () => {
    expect(scanForSecrets('ab cd ab', ['ab'])).toEqual([]);
  });

  it('returns no findings for empty text', () => {
    expect(scanForSecrets('', [FAKE_PASSWORD])).toEqual([]);
  });

  it('still runs pattern checks when the known-secret list is empty', () => {
    const text = 'Bearer ' + 'AbC123_-.'.repeat(3);

    expect(scanForSecrets(text, []).map((f) => f.kind)).toEqual(['bearer-token']);
  });

  it.each([
    ['session cookie', 'sessionid_2=<redacted>'],
    ['csrf cookie', 'csrftoken=<redacted>'],
    ['access token JSON', '"access_token": "<redacted>"'],
    ['escaped access token JSON', '\\"access_token\\": \\"<redacted>\\"'],
    ['bearer token', 'Bearer <redacted>'],
    ['paseto token', 'v4.local.<redacted>'],
    ['email', '<email>'],
    ['page token', 'next_page_token=<page-token-1>'],
  ])('does not flag the placeholder form of a %s', (_label, text) => {
    expect(scanForSecrets(text, [])).toEqual([]);
  });

  it.each([
    ['session-cookie', ['sessionid_2', 'abc123'].join('=')],
    ['csrf-cookie', ['csrftoken', 'Xy12Qz34'].join('=')],
    ['access-token-json', '"access_token": "' + 'abcdEF12'],
    ['bearer-token', 'Bearer ' + 'AbC123_-.'.repeat(3)],
    ['paseto-token', 'v4.local.' + 'AbCdEf0123_-'],
    ['email', ['tester', 'example.test'].join('@')],
  ])('flags a %s sample without any known secrets', (kind, sample) => {
    expect(scanForSecrets(sample, []).map((f) => f.kind)).toEqual([kind]);
  });

  it('flags a lowercase bearer token', () => {
    const text = 'authorization: bearer ' + 'AbC123_-.'.repeat(3);

    expect(scanForSecrets(text, []).map((f) => f.kind)).toEqual(['bearer-token']);
  });

  it('flags an access token inside escaped JSON', () => {
    const text = '{"body":"{\\"access_token\\":\\"' + 'abcdEF12' + '\\"}"}';

    expect(scanForSecrets(text, []).map((f) => f.kind)).toEqual(['access-token-json']);
  });
});
