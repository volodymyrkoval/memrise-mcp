import { describe, expect, it } from 'vitest';
import { redactString } from '../../../src/security/redactString.js';

// Fake values only; pattern samples are joined at runtime so the repo scanner stays quiet.
const FAKE_PASSWORD = 'fake-pass-word-42';

describe('redactString', () => {
  it('replaces a known secret in raw, URL-encoded and JSON-escaped form', () => {
    const secret = 'p@ss w"rd-7';
    const text = [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)].join(' | ');

    expect(redactString(text, [secret])).toBe('<redacted> | <redacted> | <redacted>');
  });

  it('replaces a known secret in form-encoded and base64 form', () => {
    const secret = 'p@ss w"rd-7';
    const formEncoded = encodeURIComponent(secret).replaceAll('%20', '+');
    const base64 = Buffer.from(secret).toString('base64');

    expect(redactString(`${formEncoded} | ${base64}`, [secret])).toBe('<redacted> | <redacted>');
  });

  it('replaces e-mail addresses with <email>', () => {
    const address = ['someone', 'example.org'].join('@');

    expect(redactString(`contact ${address} now`, [])).toBe('contact <email> now');
  });

  it('replaces pattern hits such as session cookies and bearer tokens with <redacted>', () => {
    const cookie = ['sessionid_2', 'abcd1234efgh'].join('=');
    const bearer = ['Bearer', 'x'.repeat(24)].join(' ');

    expect(redactString(`${cookie}; ${bearer}`, [])).toBe('<redacted>; <redacted>');
  });

  it('leaves placeholders, short secrets and clean text untouched', () => {
    const text = 'ab <redacted> <page-token-1> <email> plain text';

    expect(redactString(text, ['ab', FAKE_PASSWORD])).toBe(text);
  });

  it('redacts a known secret that is itself an e-mail as <redacted>', () => {
    const address = ['me', 'example.org'].join('@');

    expect(redactString(`user ${address}`, [address])).toBe('user <redacted>');
  });
});
