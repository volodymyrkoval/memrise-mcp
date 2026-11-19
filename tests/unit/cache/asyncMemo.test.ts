import { describe, expect, it } from 'vitest';
import { AsyncMemo } from '../../../src/cache/asyncMemo.js';

describe('AsyncMemo', () => {
  it('runs the factory once for repeated gets of the same key', async () => {
    const memo = new AsyncMemo<string, number>();
    let calls = 0;
    const factory = async () => {
      calls += 1;
      return 42;
    };

    const [first, second] = await Promise.all([memo.get('answer', factory), memo.get('answer', factory)]);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(calls).toBe(1);
  });

  it('runs the factory again after the promise for a key rejects', async () => {
    const memo = new AsyncMemo<string, number>();
    let calls = 0;
    const factory = async () => {
      calls += 1;
      if (calls === 1) throw new Error('upstream down');
      return 7;
    };

    await expect(memo.get('lesson', factory)).rejects.toThrow('upstream down');

    expect(await memo.get('lesson', factory)).toBe(7);
    expect(calls).toBe(2);
  });
});
