import { describe, expect, it } from 'vitest';
import { parseScenariosPage } from '../../../src/api/schemas.js';
import { filterCompletedSince, sortByRecency } from '../../../src/domain/scenarioOrdering.js';
import { toScenarioRow, type ScenarioRow } from '../../../src/domain/rows.js';
import { loadFixture } from '../../helpers/fixtures.js';

function row(id: number, dates: { started?: string | null; completed?: string | null } = {}): ScenarioRow {
  return {
    scenario_id: id,
    title: `Lesson ${id}`,
    topic: null,
    number_of_learnables: 0,
    items_learned: 0,
    progress_percent: 0,
    date_started: dates.started ?? null,
    date_completed: dates.completed ?? null,
  };
}

const ids = (rows: readonly ScenarioRow[]) => rows.map((r) => r.scenario_id);

describe('sortByRecency', () => {
  it('puts the most recently completed lesson first', () => {
    const rows = [
      row(1, { completed: '2030-01-01T10:00:00Z' }),
      row(2, { completed: '2030-01-03T10:00:00Z' }),
      row(3, { completed: '2030-01-02T10:00:00Z' }),
    ];

    expect(ids(sortByRecency(rows))).toEqual([2, 3, 1]);
  });

  it('puts lessons without a completion date after the completed ones', () => {
    const rows = [row(1, { started: '2030-02-01T00:00:00Z' }), row(2, { completed: '2030-01-01T10:00:00Z' })];

    expect(ids(sortByRecency(rows))).toEqual([2, 1]);
  });

  it('breaks completion ties by most recently started first, nulls last', () => {
    const rows = [
      row(1, { started: null, completed: '2030-01-01T10:00:00Z' }),
      row(2, { started: '2029-12-01T00:00:00Z', completed: '2030-01-01T10:00:00Z' }),
      row(3, { started: '2029-12-15T00:00:00Z', completed: '2030-01-01T10:00:00Z' }),
    ];

    expect(ids(sortByRecency(rows))).toEqual([3, 2, 1]);
  });

  it('keeps the input order for equal timestamps', () => {
    const same = '2030-01-01T10:00:00Z';
    const rows = [row(5, { completed: same }), row(4, { completed: same }), row(6, { completed: same })];

    expect(ids(sortByRecency(rows))).toEqual([5, 4, 6]);
  });

  it('does not reorder the array it was given', () => {
    const rows = [row(1, { completed: '2030-01-01T10:00:00Z' }), row(2, { completed: '2030-01-03T10:00:00Z' })];

    sortByRecency(rows);

    expect(ids(rows)).toEqual([1, 2]);
  });
});

describe('filterCompletedSince', () => {
  it('keeps every row when no since date is given, including lessons never completed', () => {
    const rows = [row(1, { completed: '2030-01-01T10:00:00Z' }), row(2)];

    expect(ids(filterCompletedSince(rows, undefined))).toEqual([1, 2]);
  });

  it('drops lessons with no completion date when since is given', () => {
    const rows = [row(1, { completed: '2030-01-01T10:00:00Z' }), row(2)];

    expect(ids(filterCompletedSince(rows, new Date('2026-01-01T00:00:00Z')))).toEqual([1]);
  });

  it('keeps lessons completed exactly at the since instant and drops earlier ones', () => {
    const rows = [
      row(1, { completed: '2029-12-30T23:59:59Z' }),
      row(2, { completed: '2030-01-01T00:00:00Z' }),
      row(3, { completed: '2030-01-02T00:00:00Z' }),
    ];

    expect(ids(filterCompletedSince(rows, new Date('2030-01-01T00:00:00Z')))).toEqual([2, 3]);
  });
});

describe('ordering on the sanitized scenario fixtures', () => {
  const rows = parseScenariosPage(loadFixture<unknown>('scenarios-completed-page-1.json')).items.map((scenario) =>
    toScenarioRow(scenario, undefined),
  );

  it('keeps the page order when no lesson has a date (all dates unknown)', () => {
    expect(ids(sortByRecency(rows))).toEqual([2005, 2004, 2003, 2002, 2001]);
  });

  it('drops every undated lesson when filtering by since', () => {
    expect(filterCompletedSince(rows, new Date('2026-01-01T00:00:00Z'))).toEqual([]);
  });
});
