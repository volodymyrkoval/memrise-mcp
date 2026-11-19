/**
 * Parsers for Memrise response bodies. Each one validates the wire shape with zod (unknown extra
 * fields are ignored), maps snake_case to the domain's camelCase, and throws `MalformedResponseError`
 * naming only its step. A body that fails validation is never echoed into the error.
 */
import { z } from 'zod';
import { MalformedResponseError } from '../errors.js';
import type { LanguagePair, Learnable, Scenario, ScenarioDetails } from '../domain/types.js';

const languagePairSchema = z.object({
  language_pair_id: z.number().int(),
  source_language_name: z.string(),
  target_language_name: z.string(),
  source_language_locale: z.string(),
  target_language_locale: z.string(),
});

const learnableSchema = z.object({
  learnable_id_key: z.number().int(),
  source_value: z.string(),
  target_value: z.string(),
  audios: z.array(z.string()),
  growth_level: z.number().int(),
  known: z.boolean(),
  difficult: z.boolean(),
  next_review: z.string().nullable(),
  learned: z.boolean(),
  heard: z.boolean().default(false),
});

const scenarioSchema = z.object({
  scenario_id: z.number().int(),
  title: z.string(),
  topic: z.object({ topic_id: z.number().int(), name: z.string() }).nullable(),
  number_of_learnables: z.number().int(),
  progress: z.object({ items_learned: z.number().int(), progress_percent: z.number() }),
});

const detailLearnableSchema = z.object({
  learnable_id: z.number().int(),
  source_value: z.string(),
  target_value: z.string(),
  growth_level: z.number().int(),
  already_known: z.boolean(),
  difficult: z.boolean(),
});

const languagePairsBodySchema = z.object({ language_pairs: z.array(languagePairSchema) });

const learnablesBodySchema = z.object({
  learnables: z.array(learnableSchema),
  next_page_token: z.string().nullable(),
});

const scenariosBodySchema = z.object({
  scenarios: z.array(scenarioSchema),
  has_more_pages: z.boolean(),
  total_number: z.number().int(),
});

const scenarioDetailsBodySchema = z.object({
  learnables: z.array(detailLearnableSchema),
  completed: z.boolean(),
  date_started: z.string().nullable(),
  date_completed: z.string().nullable(),
});

/** Validates a body against its schema; the label is the only detail that leaves the function. */
function parseBody<T>(schema: z.ZodType<T>, body: unknown, label: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new MalformedResponseError(label);
  return parsed.data;
}

export function parseLanguagePairs(body: unknown): LanguagePair[] {
  return parseBody(languagePairsBodySchema, body, 'language_pairs').language_pairs.map((raw) => ({
    id: raw.language_pair_id,
    sourceName: raw.source_language_name,
    targetName: raw.target_language_name,
    sourceLocale: raw.source_language_locale,
    targetLocale: raw.target_language_locale,
  }));
}

export function parseLearnablesPage(body: unknown): { items: Learnable[]; nextPageToken: string | null } {
  const data = parseBody(learnablesBodySchema, body, 'learnables_page');
  return {
    items: data.learnables.map((raw) => ({
      id: raw.learnable_id_key,
      source: raw.source_value,
      target: raw.target_value,
      audios: raw.audios,
      growthLevel: raw.growth_level,
      known: raw.known,
      difficult: raw.difficult,
      nextReview: raw.next_review,
      learned: raw.learned,
      heard: raw.heard,
    })),
    nextPageToken: data.next_page_token,
  };
}

export function parseScenariosPage(body: unknown): { items: Scenario[]; hasMore: boolean; total: number } {
  const data = parseBody(scenariosBodySchema, body, 'scenarios_page');
  return {
    items: data.scenarios.map((raw) => ({
      id: raw.scenario_id,
      title: raw.title,
      topic: raw.topic === null ? null : { id: raw.topic.topic_id, name: raw.topic.name },
      numberOfLearnables: raw.number_of_learnables,
      itemsLearned: raw.progress.items_learned,
      progressPercent: raw.progress.progress_percent,
    })),
    hasMore: data.has_more_pages,
    total: data.total_number,
  };
}

/** The id comes from the request path: the details body does not repeat it. */
export function parseScenarioDetails(id: number, body: unknown): ScenarioDetails {
  const data = parseBody(scenarioDetailsBodySchema, body, 'scenario_details');
  return {
    scenarioId: id,
    learnables: data.learnables.map((raw) => ({
      id: raw.learnable_id,
      source: raw.source_value,
      target: raw.target_value,
      growthLevel: raw.growth_level,
      alreadyKnown: raw.already_known,
      difficult: raw.difficult,
    })),
    completed: data.completed,
    dateStarted: data.date_started,
    dateCompleted: data.date_completed,
  };
}
