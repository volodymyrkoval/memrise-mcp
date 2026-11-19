/** `learnables_list`: the learner's words, each with the lessons that teach it. */
import { z } from 'zod';
import type { LearnerQueries } from '../../app/learnerQueries.js';
import type { Redactor } from '../../log/redactor.js';
import type { DebugSink } from '../../errorMessages.js';
import type { ToolDefinition } from '../toolDefinition.js';
import { stateSchema } from '../toolSchemas.js';
import { COLD_START_NOTE, HEARD_NOTE, ORIGIN_NOTE, PARTIAL_RESULTS_NOTE, READ_ONLY_ANNOTATIONS, runTool, STATE_NOTE, WORD_ROW_NOTE } from '../toolResult.js';

const inputSchema = {
  state: stateSchema.default('any'),
  limit: z.number().int().min(1).max(10000).default(200),
  after_id: z.string().regex(/^\d+$/, 'after_id must be a numeric learnable id').optional(),
  include_audio: z.boolean().default(false),
  // Dates, titles and the growth range are checked in the use case, so mistakes get a readable message.
  difficult: z.boolean().optional(),
  learned: z.boolean().optional(),
  known: z.boolean().optional(),
  heard: z.boolean().optional(),
  due_before: z.string().optional(),
  topic: z.string().optional(),
  lesson: z.string().optional(),
  min_growth_level: z.number().int().min(0).optional(),
  max_growth_level: z.number().int().min(0).optional(),
};

export function defineLearnablesListTool(
  queries: LearnerQueries,
  redactor: Redactor,
  debug?: DebugSink,
): ToolDefinition<typeof inputSchema> {
  return {
    name: 'learnables_list',
    title: 'List learner words',
    description: [
      "List the learner's Memrise words for the configured language pair, with the lessons and topics that teach each.",
      "To answer questions, filter instead of paging through everything: difficult, learned, known, heard (true or false); due_before (learned words due for review by then, most overdue first when due_before is set; words already known or never studied have no review date and are never included; a plain date YYYY-MM-DD means the end of that day in the learner's time zone, so 'due today' = today's date); topic and lesson (words of a title, any case or accents, e.g. 'food' matches 'Food & Drink'; a topic or lesson that matches nothing adds a warning listing the valid names); min_growth_level, max_growth_level. Filters combine with AND and apply before paging; total counts the matching words.",
      STATE_NOTE,
      'Returns total, returned and truncated (default limit 200). When truncated is true the result also has next_after_id: call again with after_id set to next_after_id; repeat until truncated is false.',
      PARTIAL_RESULTS_NOTE,
      WORD_ROW_NOTE,
      HEARD_NOTE,
      ORIGIN_NOTE,
      COLD_START_NOTE,
    ].join(' '),
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async handler(args) {
      return runTool(redactor, () =>
        queries.listWords({
          state: args.state,
          limit: args.limit,
          includeAudio: args.include_audio,
          afterId: args.after_id,
          difficult: args.difficult,
          learned: args.learned,
          known: args.known,
          heard: args.heard,
          dueBefore: args.due_before,
          topic: args.topic,
          lesson: args.lesson,
          minGrowthLevel: args.min_growth_level,
          maxGrowthLevel: args.max_growth_level,
        }),
        debug,
      );
    },
  };
}
