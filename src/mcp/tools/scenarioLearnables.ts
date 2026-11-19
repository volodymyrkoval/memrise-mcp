/** `scenario_learnables`: the words of one lesson, for the lesson's own details. */
import { z } from 'zod';
import type { LearnerQueries } from '../../app/learnerQueries.js';
import type { Redactor } from '../../log/redactor.js';
import type { DebugSink } from '../../errorMessages.js';
import type { ToolDefinition } from '../toolDefinition.js';
import { COLD_START_NOTE, PARTIAL_RESULTS_NOTE, READ_ONLY_ANNOTATIONS, runTool, WORD_ROW_NOTE } from '../toolResult.js';

const inputSchema = {
  scenario_id: z.number().int().positive().describe('A lesson id from scenarios_list.'),
  include_audio: z.boolean().default(false),
};

export function defineScenarioLearnablesTool(
  queries: LearnerQueries,
  redactor: Redactor,
  debug?: DebugSink,
): ToolDefinition<typeof inputSchema> {
  return {
    name: 'scenario_learnables',
    title: 'List the words of one lesson',
    description: [
      "List the words of one Memrise lesson (scenario) with the learner's state for each word.",
      "Fails if this lesson's details cannot be fetched.",
      PARTIAL_RESULTS_NOTE,
      WORD_ROW_NOTE,
      COLD_START_NOTE,
    ].join(' '),
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async handler(args) {
      return runTool(redactor, () => queries.scenarioWords({ scenarioId: args.scenario_id, includeAudio: args.include_audio }), debug);
    },
  };
}
