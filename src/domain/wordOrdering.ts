import type { WordRow } from './rows.js';

/** A word row with its learnable id, the tiebreak and paging key. */
export interface IdentifiedRow {
  id: number;
  row: WordRow;
}

/**
 * Most overdue first: ascending `next_review`, ties by id so the order is stable across calls
 * (paging depends on it). Rows with no review date go last; they are never due anyway.
 */
export function sortMostOverdueFirst<T extends IdentifiedRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => reviewTime(a) - reviewTime(b) || a.id - b.id);
}

function reviewTime({ row }: IdentifiedRow): number {
  return row.next_review === null ? Number.POSITIVE_INFINITY : Date.parse(row.next_review);
}
