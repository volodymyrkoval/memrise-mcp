/**
 * The file `export` writes: the learner's words with their lessons and topics, the lessons with
 * their progress and dates, and when the data was fetched. Built from the same queries the tools use.
 */
import type { LearnerQueries } from '../app/learnerQueries.js';
import type { ScenarioRow, WordRow } from '../domain/rows.js';
import { LESSON_INDEX_TYPES, type StateKey } from '../domain/types.js';

export interface ExportOptions {
  state: StateKey;
  includeAudio: boolean;
}

export interface ExportDocument {
  fetched_at: string;
  language_pair_id: number;
  state: StateKey;
  words: WordRow[];
  lessons: ScenarioRow[];
  /** Present only when some lesson could not be read. */
  warnings?: string[];
}

/** Reads every word (no `limit`) and every lesson the join uses; `now` supplies `fetched_at`. */
export async function buildExportDocument(
  queries: Pick<LearnerQueries, 'pairId' | 'listWords' | 'listScenarios'>,
  options: ExportOptions,
  now: () => number,
): Promise<ExportDocument> {
  const languagePairId = await queries.pairId();
  const words = await queries.listWords({
    state: options.state,
    limit: Number.POSITIVE_INFINITY,
    includeAudio: options.includeAudio,
  });
  const lessons = await queries.listScenarios({ types: LESSON_INDEX_TYPES });
  const warnings = mergeWarnings(words.warnings, lessons.warnings);
  return {
    fetched_at: new Date(now()).toISOString(),
    language_pair_id: languagePairId,
    state: options.state,
    words: words.words,
    lessons: lessons.scenarios,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** The words and the lessons both read the same failed lessons, so each warning appears once. */
function mergeWarnings(...lists: (readonly string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}
