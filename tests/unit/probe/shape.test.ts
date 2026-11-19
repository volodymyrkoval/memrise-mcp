import { describe, expect, it } from 'vitest';
import { summarizeShape } from '../../../scripts/probe/shape.js';

describe('summarizeShape', () => {
  it('lists top-level keys with value types, array lengths and first-element keys, never values', () => {
    const shape = summarizeShape({
      count: 3,
      name: 'secret-looking-value',
      active: true,
      nothing: null,
      profile: { email: 'x', id: 1 },
      pairs: [{ pair_id: 7, title: 'T' }, { pair_id: 8 }],
      tags: ['a', 'b'],
      empty: [],
    });

    expect(shape).toBe(
      '{ count: number, name: string, active: boolean, nothing: null, profile: object{email, id}, pairs: array[2] of {pair_id, title}, tags: array[2] of string, empty: array[0] }',
    );
    expect(shape).not.toContain('secret-looking-value');
  });

  it('describes a top-level array and primitives', () => {
    expect(summarizeShape([{ id: 1, name: 'x' }])).toBe('array[1] of {id, name}');
    expect(summarizeShape('text')).toBe('string');
    expect(summarizeShape(null)).toBe('null');
  });

  it('never prints a key that is a bare number: it is an id, shown as <id-key> with a count', () => {
    const shape = summarizeShape({ learnables: { 65581081297154: { learned: true } }, groups: { 11111111: 1, 22222222: 2, label: 3 } });

    expect(shape).toBe('{ learnables: object{<id-key> x 1}, groups: object{<id-key> x 2, label} }');
    expect(shape).not.toMatch(/\d{4}/);
  });

  it('hides id-like keys at the top level and inside array items, and uuid or token-like keys too', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const longToken = 'abcdefghijklmnopqrstuvwxyz0123456789';

    expect(summarizeShape({ 424242: 1, name: 'x' })).toBe('{ <id-key>: number, name: string }');
    expect(summarizeShape([{ 99999999: 1, ok: 2 }])).toBe('array[1] of {<id-key> x 1, ok}');
    expect(summarizeShape({ item: { [uuid]: 1, [longToken]: 2 } })).toBe('{ item: object{<id-key> x 2} }');
  });
});
