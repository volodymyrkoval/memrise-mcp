/** `scenarios_list`: the learner's lessons, with completion progress and the dates the lesson was started and finished. */
import { z } from 'zod';
import type { LearnerQueries } from '../../app/learnerQueries.js';
import type { Redactor } from '../../log/redactor.js';
import type { DebugSink } from '../../errorMessages.js';
import type { ToolDefinition } from '../toolDefinition.js';
import { COLD_START_NOTE, PARTIAL_RESULTS_NOTE, READ_ONLY_ANNOTATIONS, runTool } from '../toolResult.js';

const inputSchema = {
  type: z.enum(['completed', 'in_progress']).default('completed'),
  /** Checked in the use case, so a bad date gets a readable message instead of a schema error. */
  since: z.string().optional(),
};

export function defineScenariosListTool(
  queries: LearnerQueries,
  redactor: Redactor,
  debug?: DebugSink,
): ToolDefinition<typeof inputSchema> {
  return {
    name: 'scenarios_list',
    title: 'List lessons',
    description: [
      "List the learner's Memrise lessons (scenarios) of one type, newest completed first, with progress and the start and completion dates.",
      "type: 'completed' (default) or 'in_progress'.",
      "since: lessons completed on or after this date (YYYY-MM-DD = start of that day in the learner's time zone) or ISO datetime with offset.",
      PARTIAL_RESULTS_NOTE,
      COLD_START_NOTE,
    ].join(' '),
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async handler(args) {
      return runTool(redactor, () => queries.listScenarios({ types: [args.type], since: args.since }), debug);
    },
  };
}
