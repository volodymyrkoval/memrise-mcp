import { describe, expect, it } from 'vitest';
import { Redactor } from '../../../src/log/redactor.js';

// Fake values only; built at runtime so the repo secret scanner stays quiet.
const FAKE_PASSWORD = ['fake', 'pass', 'word', '42'].join('-');

describe('Redactor', () => {
  it('masks a registered secret wherever it appears in text', () => {
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);

    expect(redactor.redact(`login with ${FAKE_PASSWORD} failed`)).toBe('login with <redacted> failed');
  });

  it('also masks secret-looking patterns such as bearer tokens without registration', () => {
    const bearer = ['Bearer', 'x'.repeat(24)].join(' ');

    expect(new Redactor().redact(`authorization: ${bearer}`)).toBe('authorization: <redacted>');
  });

  it('masks a secret echoed in the cause chain of an error', () => {
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);
    const err = new Error('login failed', { cause: new Error(`server echoed ${FAKE_PASSWORD}`) });

    expect(redactor.redactError(err)).toBe('login failed: server echoed <redacted>');
  });

  it('does not register secrets shorter than three characters', () => {
    const redactor = new Redactor();
    redactor.addSecret('ab');

    expect(redactor.redact('ab cd')).toBe('ab cd');
  });

  it('masks every occurrence of a registered secret', () => {
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);

    expect(redactor.redact(`${FAKE_PASSWORD} and ${FAKE_PASSWORD}`)).toBe('<redacted> and <redacted>');
  });

  it('masks a secret found three causes deep', () => {
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);
    const deep = new Error('outer', {
      cause: new Error('middle', { cause: new Error(`inner ${FAKE_PASSWORD}`) }),
    });

    expect(redactor.redactError(deep)).toBe('outer: middle: inner <redacted>');
  });

  it('terminates on an error whose cause points at itself and still masks its message', () => {
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);
    const err = new Error(`self loop ${FAKE_PASSWORD}`);
    err.cause = err;

    expect(redactor.redactError(err)).toBe('self loop <redacted>');
  });

  it('terminates on a two-error cause cycle and still masks both messages', () => {
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);
    const first = new Error(`first ${FAKE_PASSWORD}`);
    const second = new Error(`second ${FAKE_PASSWORD}`, { cause: first });
    first.cause = second;

    expect(redactor.redactError(first)).toBe('first <redacted>: second <redacted>');
  });

  it('stops walking the cause chain after ten messages', () => {
    const redactor = new Redactor();
    let err: Error | undefined;
    for (let i = 11; i >= 0; i--) {
      err = new Error(`level ${i}`, err === undefined ? undefined : { cause: err });
    }

    const expected = Array.from({ length: 10 }, (_, i) => `level ${i}`).join(': ');
    expect(redactor.redactError(err)).toBe(expected);
  });

  it('masks a secret inside a thrown string and describes a thrown object by type only without leaking it', () => {
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);

    expect(redactor.redactError(`thrown ${FAKE_PASSWORD}`)).toBe('thrown <redacted>');
    expect(redactor.redactError({ token: FAKE_PASSWORD })).toBe('object');
  });

  it('never throws, even for a cause with a hostile toString, a symbol, or an error whose message getter throws', () => {
    const redactor = new Redactor();
    const hostile = {
      toString: () => {
        throw new Error('boom');
      },
    };
    const brokenError = new Error('x');
    Object.defineProperty(brokenError, 'message', {
      get() {
        throw new Error('boom');
      },
    });

    expect(redactor.redactError(hostile)).toBe('object');
    expect(redactor.redactError(Symbol('s'))).toBe('symbol');
    expect(() => redactor.redactError(brokenError)).not.toThrow();
  });

  it('keeps a registered secret masked after the same value is registered repeatedly', () => {
    const redactor = new Redactor();
    for (let i = 0; i < 5; i += 1) redactor.addSecret(FAKE_PASSWORD);

    expect(redactor.redact(`x ${FAKE_PASSWORD}`)).toBe('x <redacted>');
  });

  it('masks a registered secret that appears form-encoded or base64-encoded', () => {
    const redactor = new Redactor();
    const secret = 'pass word-42';
    redactor.addSecret(secret);

    const text = `${encodeURIComponent(secret).replaceAll('%20', '+')} ${Buffer.from(secret).toString('base64')}`;

    expect(redactor.redact(text)).toBe('<redacted> <redacted>');
  });
});
