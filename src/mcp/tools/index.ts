/** The five tools the server offers, built over one set of queries. */
import type { DebugSink } from '../../errorMessages.js';
import type { LearnerQueries } from '../../app/learnerQueries.js';
import type { Redactor } from '../../log/redactor.js';
import type { ToolDefinition } from '../toolDefinition.js';
import { defineLanguagePairsListTool } from './languagePairsList.js';
import { defineLearnablesListTool } from './learnablesList.js';
import { defineLearnablesLookupTool } from './learnablesLookup.js';
import { defineScenarioLearnablesTool } from './scenarioLearnables.js';
import { defineScenariosListTool } from './scenariosList.js';

export function defineMemriseTools(queries: LearnerQueries, redactor: Redactor, debug?: DebugSink): ToolDefinition[] {
  return [
    defineLanguagePairsListTool(queries, redactor, debug),
    defineLearnablesListTool(queries, redactor, debug),
    defineLearnablesLookupTool(queries, redactor, debug),
    defineScenariosListTool(queries, redactor, debug),
    defineScenarioLearnablesTool(queries, redactor, debug),
  ];
}
