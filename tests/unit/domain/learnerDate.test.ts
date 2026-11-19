import { describe, expect, it } from 'vitest';
import { parseLearnerDate } from '../../../src/domain/learnerDate.js';
import { UsageError } from '../../../src/errors.js';

const iso = (date: Date): string => date.toISOString();

describe('parseLearnerDate plain dates', () => {
  it.each([
    ['UTC', '2026-11-19', 'start', '2026-11-19T00:00:00.000Z'],
    ['UTC', '2026-11-19', 'end', '2026-11-19T23:59:59.999Z'],
    ['Pacific/Auckland', '2026-11-19', 'start', '2026-11-18T11:00:00.000Z'],
    ['Pacific/Auckland', '2026-11-19', 'end', '2026-11-19T10:59:59.999Z'],
    ['America/New_York', '2026-11-19', 'start', '2026-11-19T05:00:00.000Z'],
    ['America/New_York', '2026-11-19', 'end', '2026-11-20T04:59:59.999Z'],
  ] as const)('in %s, %s as the %s of the day is %s', (zone, input, bound, expected) => {
    expect(iso(parseLearnerDate(input, bound, zone, 'due_before'))).toBe(expected);
  });

  it.each([
    ['America/New_York', '2026-03-08', 'start', '2026-03-08T05:00:00.000Z'],
    ['America/New_York', '2026-03-08', 'end', '2026-03-09T03:59:59.999Z'],
    ['America/New_York', '2026-11-01', 'start', '2026-11-01T04:00:00.000Z'],
    ['America/New_York', '2026-11-01', 'end', '2026-11-02T04:59:59.999Z'],
    ['Pacific/Auckland', '2026-09-27', 'start', '2026-09-26T12:00:00.000Z'],
    ['Pacific/Auckland', '2026-09-27', 'end', '2026-09-27T10:59:59.999Z'],
    ['Pacific/Auckland', '2027-04-04', 'start', '2027-04-03T11:00:00.000Z'],
    ['Pacific/Auckland', '2027-04-04', 'end', '2027-04-04T11:59:59.999Z'],
  ] as const)('on the DST switch day in %s, %s %s is %s', (zone, input, bound, expected) => {
    expect(iso(parseLearnerDate(input, bound, zone, 'since'))).toBe(expected);
  });
});

describe('parseLearnerDate date-times', () => {
  it.each([
    ['2026-11-19T18:00:00+01:00', '2026-11-19T17:00:00.000Z'],
    ['2026-11-19T18:00:00Z', '2026-11-19T18:00:00.000Z'],
    ['2026-11-19T18:00Z', '2026-11-19T18:00:00.000Z'],
    ['2026-11-19T18:00:00.500-05:30', '2026-11-19T23:30:00.500Z'],
  ])('uses %s exactly as given, whatever the zone', (input, expected) => {
    expect(iso(parseLearnerDate(input, 'end', 'Pacific/Auckland', 'since'))).toBe(expected);
  });

  it('rejects a date-time without a time zone with a learner-readable message', () => {
    expect(() => parseLearnerDate('2026-11-19T18:00', 'end', 'UTC', 'due_before')).toThrow(
      new UsageError(
        'due_before "2026-11-19T18:00" has no time zone; add Z or an offset like +01:00, or pass just the date.',
      ),
    );
  });

  it('names the since parameter in its own messages', () => {
    expect(() => parseLearnerDate('2026-11-19T18:00:00', 'start', 'UTC', 'since')).toThrow(/^since "2026-11-19T18:00:00" has no time zone/);
  });
});

describe('parseLearnerDate invalid input', () => {
  it.each(['2026-13-01', '2026-02-30', '2026-11-19T25:00:00Z', '2026-02-30T10:00:00Z', 'last week', '', '19/11/2026'])(
    'rejects %j as not a date',
    (input) => {
      expect(() => parseLearnerDate(input, 'start', 'UTC', 'due_before')).toThrow(
        new UsageError(
          `due_before "${input}" is not a date. Use YYYY-MM-DD or a date-time with a time zone, e.g. 2026-11-19T18:00:00+01:00.`,
        ),
      );
    },
  );

  it('accepts a leap day only in a leap year', () => {
    expect(iso(parseLearnerDate('2028-02-29', 'start', 'UTC', 'since'))).toBe('2028-02-29T00:00:00.000Z');
    expect(() => parseLearnerDate('2027-02-29', 'start', 'UTC', 'since')).toThrow(UsageError);
  });
});
