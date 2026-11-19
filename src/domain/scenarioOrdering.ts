/**
 * Recency rules for scenario rows: most recently completed first, then most recently started.
 * Lessons without a date sort last. `since` filters by completion date.
 */
import type { ScenarioRow } from './rows.js';

export function sortByRecency(rows: readonly ScenarioRow[]): ScenarioRow[] {
  return [...rows].sort(
    (a, b) =>
      compareDescNullsLast(a.date_completed, b.date_completed) ||
      compareDescNullsLast(a.date_started, b.date_started),
  );
}

/** Keeps lessons completed at or after `since`. With no `since`, every row is kept. */
export function filterCompletedSince(rows: readonly ScenarioRow[], since: Date | undefined): ScenarioRow[] {
  if (since === undefined) return [...rows];
  const threshold = since.getTime();
  return rows.filter((row) => row.date_completed !== null && Date.parse(row.date_completed) >= threshold);
}

function compareDescNullsLast(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return Date.parse(b) - Date.parse(a);
}
