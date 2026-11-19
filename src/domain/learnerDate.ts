/**
 * Dates the learner types into a tool: `YYYY-MM-DD` (a whole day in the learner's time zone) or a
 * date-time that carries its own `Z` / offset. A date-time without a zone is ambiguous and rejected.
 * The time zone is a parameter so nothing here depends on the machine it runs on.
 */
import { UsageError } from '../errors.js';

export type DayBound = 'start' | 'end';

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * `bound` picks the start (00:00:00.000) or end (23:59:59.999) of a plain date's day in `timeZone`
 * (an IANA name); date-times are used as given. `field` names the parameter in error messages.
 */
export function parseLearnerDate(input: string, bound: DayBound, timeZone: string, field = 'date'): Date {
  const plain = PLAIN_DATE.exec(input);
  if (plain !== null) {
    const [year, month, day] = [Number(plain[1]), Number(plain[2]), Number(plain[3])];
    if (!isCalendarDate(year, month, day)) throw notADate(field, input);
    return zonedDayBound(year, month, day, bound, timeZone);
  }
  const dateTime = DATE_TIME.exec(input);
  if (dateTime === null || !isCalendarDate(Number(dateTime[1]), Number(dateTime[2]), Number(dateTime[3]))) {
    throw notADate(field, input);
  }
  if (dateTime[7] === undefined) throw noTimeZone(field, input);
  const parsed = new Date(input.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) throw notADate(field, input);
  return parsed;
}

function notADate(field: string, input: string): UsageError {
  return new UsageError(
    `${field} "${input}" is not a date. Use YYYY-MM-DD or a date-time with a time zone, e.g. 2026-11-19T18:00:00+01:00.`,
  );
}

function noTimeZone(field: string, input: string): UsageError {
  return new UsageError(`${field} "${input}" has no time zone; add Z or an offset like +01:00, or pass just the date.`);
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** The end is the instant before the next day's start, so a 23- or 25-hour day needs no special case. */
function zonedDayBound(year: number, month: number, day: number, bound: DayBound, timeZone: string): Date {
  if (bound === 'start') return new Date(zonedMidnight(year, month, day, timeZone));
  return new Date(zonedMidnight(year, month, day + 1, timeZone) - 1);
}

/** Epoch ms of 00:00 on the given local calendar day (day overflow rolls into the next month). */
function zonedMidnight(year: number, month: number, day: number, timeZone: string): number {
  const asUtc = Date.UTC(year, month - 1, day);
  const first = asUtc - offsetAt(asUtc, timeZone);
  // One re-check: the offset at the first guess may differ across a DST switch.
  return asUtc - offsetAt(first, timeZone);
}

/** Zone offset (local minus UTC, in ms) at the instant `epochMs`. */
function offsetAt(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(epochMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  const localAsUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return localAsUtc - Math.floor(epochMs / 1000) * 1000;
}
