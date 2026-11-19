/** `learnables_lookup`: whether the learner has met each given term, and how it matched. */
import { z } from 'zod';
import type { LearnerQueries } from '../../app/learnerQueries.js';
import type { Redactor } from '../../log/redactor.js';
import type { DebugSink } from '../../errorMessages.js';
import type { ToolDefinition } from '../toolDefinition.js';
import { stateSchema } from '../toolSchemas.js';
import { COLD_START_NOTE, HEARD_NOTE, ORIGIN_NOTE, PARTIAL_RESULTS_NOTE, READ_ONLY_ANNOTATIONS, runTool, STATE_NOTE, WORD_ROW_NOTE } from '../toolResult.js';

const inputSchema = {
  terms: z.array(z.string()).min(1).max(500),
  state: stateSchema.default('any'),
};

export function defineLearnablesLookupTool(
  queries: LearnerQueries,
  redactor: Redactor,
  debug?: DebugSink,
): ToolDefinition<typeof inputSchema> {
  return {
    name: 'learnables_lookup',
    title: 'Look up learner words',
    description: [
      'Check whether the learner has met each term (a word or phrase in the language being learned). Matching ignores case, accents, punctuation and one leading article from a built-in best-effort list of common articles of several Latin-script European languages (other languages get no article handling).',
      "Each result has met, match ('exact', 'in_sentence', 'translation' or 'none'), items (exact matches), in_sentences (longer phrases containing the term) and in_translations (words whose translation contains the term, for terms in the learner's own language); 'translation' means only translations matched. No stemming: if a conjugated or plural form is not found, also try its dictionary form (e.g. the infinitive). Terms shorter than 3 characters, or a lone article, match exactly only.",
      STATE_NOTE,
      PARTIAL_RESULTS_NOTE,
      WORD_ROW_NOTE,
      HEARD_NOTE,
      ORIGIN_NOTE,
      COLD_START_NOTE,
    ].join(' '),
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async handler(args) {
      return runTool(redactor, () => queries.lookupWords({ terms: args.terms, state: args.state }), debug);
    },
  };
}
