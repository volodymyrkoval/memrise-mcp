/** `language_pairs_list`: the language pairs the account can learn, so a caller can pick one. */
import type { LearnerQueries } from '../../app/learnerQueries.js';
import type { Redactor } from '../../log/redactor.js';
import type { DebugSink } from '../../errorMessages.js';
import type { ToolDefinition } from '../toolDefinition.js';
import { READ_ONLY_ANNOTATIONS, runTool } from '../toolResult.js';

export function defineLanguagePairsListTool(
  queries: LearnerQueries,
  redactor: Redactor,
  debug?: DebugSink,
): ToolDefinition<Record<string, never>> {
  return {
    name: 'language_pairs_list',
    title: 'List language pairs',
    description:
      'List the Memrise courses (language pairs) of this account. The `id` of a pair is the value for MEMRISE_LANGUAGE_PAIR_ID when the account has more than one.',
    inputSchema: {},
    annotations: READ_ONLY_ANNOTATIONS,
    async handler() {
      return runTool(redactor, async () => ({
        language_pairs: (await queries.listPairs()).map((pair) => ({ id: pair.id, source: pair.sourceName, target: pair.targetName })),
      }), debug);
    },
  };
}
