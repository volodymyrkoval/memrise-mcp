import type { LessonFailure } from './learnerDataLoader.js';

/** A result that carries a `warnings` key only when some lesson could not be read. */
export type WithWarnings<T> = T & { warnings?: string[] };

/** The one user-facing sentence for a lesson whose words lost their links. */
export function formatLessonWarning(failure: LessonFailure): string {
  const reason = failure.reason.startsWith('HTTP') ? `Memrise error ${failure.reason}` : failure.reason;
  return `Could not read lesson ${failure.scenarioId} "${failure.title}" (${reason}), so its words show no lesson or topic in this result.`;
}

/** Added to word results when a lesson failed: it explains why unlinked words are `unknown`. */
export const LINKS_INCOMPLETE_WARNING =
  'Lesson links are incomplete in this result, so words with no lesson link have origin "unknown" instead of "other".';

/**
 * Adds `warnings` only when there is something to say, so a clean result has no such key at all:
 * one per failed lesson then the notes (only when a lesson failed), then the hints (always).
 */
export function withWarnings<T extends object>(
  result: T,
  failures: readonly LessonFailure[],
  notes: readonly string[] = [],
  hints: readonly string[] = [],
): WithWarnings<T> {
  const failureWarnings = failures.length === 0 ? [] : [...failures.map(formatLessonWarning), ...notes];
  const warnings = [...failureWarnings, ...hints];
  return warnings.length === 0 ? result : { ...result, warnings };
}
