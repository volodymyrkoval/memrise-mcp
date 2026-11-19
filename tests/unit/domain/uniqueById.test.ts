import { describe, expect, it } from 'vitest';
import { uniqueById } from '../../../src/domain/uniqueById.js';

describe('uniqueById', () => {
  it('keeps the first item for each id and drops later duplicates', () => {
    const items = [
      { id: 1, label: 'first' },
      { id: 2, label: 'second' },
      { id: 1, label: 'duplicate' },
    ];

    expect(uniqueById(items)).toEqual([
      { id: 1, label: 'first' },
      { id: 2, label: 'second' },
    ]);
  });

  it('keeps the original order of the surviving items', () => {
    const items = [{ id: 3 }, { id: 1 }, { id: 3 }, { id: 2 }, { id: 1 }];

    expect(uniqueById(items).map((item) => item.id)).toEqual([3, 1, 2]);
  });

  it('returns an empty list when given no items', () => {
    expect(uniqueById([])).toEqual([]);
  });
});
