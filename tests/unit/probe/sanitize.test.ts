import { describe, expect, it } from 'vitest';
import { createSanitizer } from '../../../scripts/probe/sanitize.js';

const SECRET = 'fake-pass-word-42';
const EMAIL = ['someone', 'example.org'].join('@');

describe('createSanitizer', () => {
  it('redacts values of sensitive keys at any depth', () => {
    const { sanitize } = createSanitizer([]);

    const result = sanitize({ a: { b: [{ password: 'x', token: 'y', csrftoken: 'z' }] }, access_token: 't' });

    expect(result).toEqual({ a: { b: [{ password: '<redacted>', token: '<redacted>', csrftoken: '<redacted>' }] }, access_token: '<redacted>' });
  });

  it('masks known secrets and e-mails inside string values', () => {
    const { sanitize } = createSanitizer([SECRET]);

    expect(sanitize({ note: `pw ${SECRET} mail ${EMAIL}` })).toEqual({ note: 'pw <redacted> mail <email>' });
  });

  it('maps each distinct next_page_token to a stable placeholder', () => {
    const tokenA = 'a'.repeat(40);
    const tokenB = 'b'.repeat(40);
    const { sanitize } = createSanitizer([]);

    const result = sanitize([{ next_page_token: tokenA }, { next_page_token: tokenB }, { next_page_token: tokenA }]);

    expect(result).toEqual([
      { next_page_token: '<page-token-1>' },
      { next_page_token: '<page-token-2>' },
      { next_page_token: '<page-token-1>' },
    ]);
  });

  it('keeps the same placeholder across separate sanitize calls', () => {
    const token = 'c'.repeat(40);
    const { sanitize } = createSanitizer([]);

    sanitize({ next_page_token: 'd'.repeat(40) });

    expect(sanitize({ next_page_token: token })).toEqual({ next_page_token: '<page-token-2>' });
    expect(sanitize({ next_page_token: token })).toEqual({ next_page_token: '<page-token-2>' });
  });

  it('leaves a null next_page_token alone', () => {
    expect(createSanitizer([]).sanitize({ next_page_token: null })).toEqual({ next_page_token: null });
  });

  it('keeps static.memrise.com URLs but redacts other long space-free strings', () => {
    const url = `https://static.memrise.com/uploads/${'a'.repeat(40)}.mp3`;
    const other = `https://evil.example.com/${'a'.repeat(40)}`;

    const result = createSanitizer([]).sanitize({ audio: url, link: other, short: 'a'.repeat(31), spaced: `${'a'.repeat(20)} ${'b'.repeat(20)}` });

    expect(result).toEqual({ audio: url, link: '<redacted>', short: 'a'.repeat(31), spaced: `${'a'.repeat(20)} ${'b'.repeat(20)}` });
  });

  it('does not treat lookalike hosts as static.memrise.com', () => {
    const lookalike = `https://static.memrise.com.evil.example/${'a'.repeat(40)}`;

    expect(createSanitizer([]).sanitize(lookalike)).toBe('<redacted>');
  });

  it('sanitizes top-level string bodies', () => {
    expect(createSanitizer([SECRET]).sanitize(`<html>${SECRET} ${EMAIL}</html>`)).toBe('<html><redacted> <email></html>');
  });

  it('replaces a numeric user.id with 0 and keeps other ids', () => {
    const result = createSanitizer([]).sanitize({ user: { id: 123456, name: 'n' }, id: 7, learnable: { id: 1001 } });

    expect(result).toEqual({ user: { id: 0, name: 'n' }, id: 7, learnable: { id: 1001 } });
  });

  it('passes numbers, booleans and null through and does not mutate input', () => {
    const input = { n: 1, b: true, z: null, list: [1, 'two'], password: 'p' };
    const snapshot = structuredClone(input);

    const result = createSanitizer([]).sanitize(input);

    expect(result).toEqual({ n: 1, b: true, z: null, list: [1, 'two'], password: '<redacted>' });
    expect(input).toEqual(snapshot);
  });

  describe('with learnerData', () => {
    const sanitize = createSanitizer([], { learnerData: true }).sanitize;

    it('replaces learner text and media values with key-named placeholders', () => {
      const result = sanitize({
        target_value: 'the book',
        source_value: 'the book',
        title: 'Lesson Alpha',
        topic: { topic_id: 11, name: 'Topic One' },
        audios: ['https://static.memrise.example/a_m.mp3'],
        next_review: '2030-01-01T00:00:00Z',
      });

      expect(result).toEqual({
        target_value: '<target_value>',
        source_value: '<source_value>',
        title: '<title>',
        topic: { topic_id: '<topic_id-1>', name: '<name>' },
        audios: ['<audio>'],
        next_review: '<next_review>',
      });
    });

    it('maps each distinct id to a stable ordinal placeholder and keeps counts and flags', () => {
      const result = sanitize({ items: [{ scenario_id: 3001 }, { scenario_id: 3002 }, { scenario_id: 3001 }], sharedDetailIds: [5, 6], count: 3, known: true });

      expect(result).toEqual({
        items: [{ scenario_id: '<scenario_id-1>' }, { scenario_id: '<scenario_id-2>' }, { scenario_id: '<scenario_id-1>' }],
        sharedDetailIds: ['<sharedDetailIds-1>', '<sharedDetailIds-2>'],
        count: 3,
        known: true,
      });
    });

    it('still redacts secrets and leaves learner content alone when the option is off', () => {
      expect(createSanitizer([]).sanitize({ target_value: 'the book', scenario_id: 7 })).toEqual({ target_value: 'the book', scenario_id: 7 });
    });
  });

  it('replaces id-like object keys with stable placeholders, with or without learner data', () => {
    for (const options of [{}, { learnerData: true }]) {
      const { sanitize } = createSanitizer([], options);

      const result = sanitize({ learnables: { 65581081297154: { learned: true }, 65581081297155: { learned: false } }, other: { 65581081297154: 1 } });

      expect(result).toEqual({
        learnables: { '<id-key-1>': { learned: true }, '<id-key-2>': { learned: false } },
        other: { '<id-key-1>': 1 },
      });
      expect(JSON.stringify(result)).not.toMatch(/\d{8}/);
    }
  });
});
