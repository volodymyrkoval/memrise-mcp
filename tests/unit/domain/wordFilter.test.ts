import { describe, expect, it } from 'vitest';
import type { WordRow } from '../../../src/domain/rows.js';
import { buildWordFilter } from '../../../src/domain/wordFilter.js';
import { UsageError } from '../../../src/errors.js';

function row(overrides: Partial<WordRow> = {}): WordRow {
  return {
    word: 'apple',
    translation: 'tr: apple',
    growth_level: 3,
    learned: true,
    known: false,
    difficult: false,
    heard: false,
    next_review: '2030-01-01T00:00:00.000Z',
    origin: 'lesson',
    lessons: ['Placeholder Lesson A'],
    topics: ['Food & Drink'],
    ...overrides,
  };
}

describe('buildWordFilter', () => {
  it('accepts every row when no filter is given', () => {
    expect(buildWordFilter({})(row())).toBe(true);
  });

  it.each(['difficult', 'learned', 'known', 'heard'] as const)('%s: true keeps only rows where it is true', (flag) => {
    const keep = buildWordFilter({ [flag]: true });

    expect(keep(row({ [flag]: true }))).toBe(true);
    expect(keep(row({ [flag]: false }))).toBe(false);
  });

  it.each(['difficult', 'learned', 'known', 'heard'] as const)('%s: false keeps only rows where it is false', (flag) => {
    const keep = buildWordFilter({ [flag]: false });

    expect(keep(row({ [flag]: false }))).toBe(true);
    expect(keep(row({ [flag]: true }))).toBe(false);
  });

  it('combines filters with AND', () => {
    const keep = buildWordFilter({ difficult: true, known: false });

    expect(keep(row({ difficult: true, known: false }))).toBe(true);
    expect(keep(row({ difficult: true, known: true }))).toBe(false);
    expect(keep(row({ difficult: false, known: false }))).toBe(false);
  });

  it('keeps growth levels inside the inclusive range', () => {
    const keep = buildWordFilter({ minGrowthLevel: 2, maxGrowthLevel: 4 });

    expect([1, 2, 3, 4, 5].map((growth_level) => keep(row({ growth_level })))).toEqual([false, true, true, true, false]);
  });

  it('accepts a range with only one end, and a single-level range', () => {
    expect(buildWordFilter({ minGrowthLevel: 3 })(row({ growth_level: 99 }))).toBe(true);
    expect(buildWordFilter({ maxGrowthLevel: 0 })(row({ growth_level: 0 }))).toBe(true);
    expect(buildWordFilter({ maxGrowthLevel: 0 })(row({ growth_level: 1 }))).toBe(false);
  });
});

describe('buildWordFilter by title', () => {
  it.each([
    ['food', ['Food & Drink'], true],
    ['FOOD', ['Food & Drink'], true],
    ['food', ['Seafood'], false],
    ['sea', ['Seafood'], false],
    ['drink', ['Food & Drink'], true],
    ['cafe', ['Un Café Bonito'], true],
    ['café', ['Cafe Talk'], true],
    ['food drink', ['Food & Drink'], true],
    ['drink food', ['Food & Drink'], false],
    ['food talk', ['Food Small Talk'], false],
    ['at the restaurant', ['At the Restaurant 1'], true],
    ['restaurant 1', ['At the Restaurant 1'], true],
    ['restaurant 2', ['At the Restaurant 1'], false],
  ])('topic %j against %j is %s', (query, topics, expected) => {
    expect(buildWordFilter({ topic: query })(row({ topics }))).toBe(expected);
  });

  it('matches the lesson filter against lesson titles, not topics', () => {
    const keep = buildWordFilter({ lesson: 'lesson a' });

    expect(keep(row({ lessons: ['Placeholder Lesson A'], topics: [] }))).toBe(true);
    expect(keep(row({ lessons: ['Other'], topics: ['Lesson A'] }))).toBe(false);
  });

  it('matches when any one of several titles matches', () => {
    expect(buildWordFilter({ topic: 'travel' })(row({ topics: ['Food', 'Travel Plans'] }))).toBe(true);
  });

  it('never matches a word that no lesson teaches', () => {
    const unlinked = row({ lessons: [], topics: [], origin: 'other' });

    expect(buildWordFilter({ topic: 'food' })(unlinked)).toBe(false);
    expect(buildWordFilter({ lesson: 'lesson' })(unlinked)).toBe(false);
  });

  it('does not drop a leading article from the filter', () => {
    expect(buildWordFilter({ topic: 'the food' })(row({ topics: ['Food'] }))).toBe(false);
  });

  it('rejects a filter with no letters or digits in plain words', () => {
    expect(() => buildWordFilter({ topic: ' & ' })).toThrow(new UsageError('topic " & " has no letters or digits to match.'));
    expect(() => buildWordFilter({ lesson: '' })).toThrow(new UsageError('lesson "" has no letters or digits to match.'));
  });
});

describe('buildWordFilter by due date', () => {
  const threshold = new Date('2030-01-01T00:00:00.000Z');

  it.each([
    ['2029-12-31T23:59:59.999Z', true],
    ['2030-01-01T00:00:00.000Z', true],
    ['2030-01-01T00:00:00.001Z', false],
  ])('keeps a word due at %s: %s', (next_review, expected) => {
    expect(buildWordFilter({ dueBefore: threshold })(row({ next_review }))).toBe(expected);
  });

  it('ignores words with no review date', () => {
    expect(buildWordFilter({ dueBefore: threshold })(row({ next_review: null }))).toBe(false);
  });

  it('compares instants, not text, so offsets are respected', () => {
    expect(buildWordFilter({ dueBefore: threshold })(row({ next_review: '2030-01-01T01:00:00+02:00' }))).toBe(true);
  });
});
