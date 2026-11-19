/**
 * Use cases the MCP tools and the export share. Each one composes loader data with the pure domain
 * mappers and attaches warnings for lessons that could not be read.
 */
import type { MemriseApi } from '../api/memriseApi.js';
import { UsageError } from '../errors.js';
import { parseLearnerDate } from '../domain/learnerDate.js';
import { buildLookupIndex, lookupTerm, type LookupResult } from '../domain/lookup.js';
import { toScenarioRow, toScenarioWordRow, toWordRow, type ScenarioRow, type WordRow } from '../domain/rows.js';
import { filterCompletedSince, sortByRecency } from '../domain/scenarioOrdering.js';
import { buildWordFilter, type WordFilters, type WordPredicate } from '../domain/wordFilter.js';
import { unknownTitleHint } from '../domain/unknownTitleHint.js';
import { sortMostOverdueFirst } from '../domain/wordOrdering.js';
import { uniqueById } from '../domain/uniqueById.js';
import {
  DEFAULT_STATE,
  type LanguagePair,
  type LessonRef,
  type Scenario,
  type ScenarioDetails,
  type ScenarioTypeKey,
  type StateKey,
} from '../domain/types.js';
import type { LearnerDataLoader, LessonFailure } from './learnerDataLoader.js';
import { LINKS_INCOMPLETE_WARNING, withWarnings, type WithWarnings } from './lessonWarnings.js';

export interface LearnerQueriesDeps {
  loader: Pick<
    LearnerDataLoader,
    'pairId' | 'learnables' | 'lessonIndex' | 'lessonScenarios' | 'scenariosOfTypes' | 'detailsSettled' | 'detail'
  >;
  api: Pick<MemriseApi, 'listLanguagePairs'>;
  /** IANA zone that plain dates from the learner are read in (injected so tests never depend on the machine). */
  timeZone: string;
}

export interface ListWordsPage {
  total: number;
  returned: number;
  truncated: boolean;
  /** Present only when `truncated`: the id to pass as `afterId` for the next page. */
  next_after_id?: string;
  words: WordRow[];
}

/** Filters of `listWords`; `dueBefore` is the learner's text and is parsed in the use case. */
export interface ListWordsFilters extends Omit<WordFilters, 'dueBefore'> {
  dueBefore?: string;
}

/** Index of the first word after the one with `afterId`; an id not in this (filtered) list is a usage error. */
function startAfter(rows: readonly { id: number }[], afterId: string): number {
  const at = rows.findIndex((row) => String(row.id) === afterId);
  if (at === -1) {
    throw new UsageError(
      `after_id ${afterId} is not in this list. Call again without after_id, with the same filters, and pass next_after_id from that result.`,
    );
  }
  return at + 1;
}

export class LearnerQueries {
  readonly #loader: LearnerQueriesDeps['loader'];
  readonly #api: LearnerQueriesDeps['api'];
  readonly #timeZone: string;

  constructor({ loader, api, timeZone }: LearnerQueriesDeps) {
    this.#loader = loader;
    this.#api = api;
    this.#timeZone = timeZone;
  }

  pairId(): Promise<number> {
    return this.#loader.pairId();
  }

  listPairs(): Promise<LanguagePair[]> {
    return this.#api.listLanguagePairs();
  }

  /**
   * Words in most-recently-touched-first order, or most overdue first when `dueBefore` is set. `afterId` (a learnable id as a string) starts the page
   * after that word; a truncated page carries `next_after_id` to pass back for the next one.
   */
  async listWords(
    o: {
      state?: StateKey;
      limit: number;
      includeAudio: boolean;
      afterId?: string;
    } & ListWordsFilters,
  ): Promise<WithWarnings<ListWordsPage>> {
    const { matching, failures, lessons } = await this.#matchingWords(o);
    const start = o.afterId === undefined ? 0 : startAfter(matching, o.afterId);
    const page = matching.slice(start, start + o.limit);
    const words = page.map(({ row }) => row);
    const truncated = start + page.length < matching.length;
    const next = truncated ? { next_after_id: String(page[page.length - 1].id) } : {};
    return withWarnings(
      { total: matching.length, returned: words.length, truncated, ...next, words },
      failures,
      [LINKS_INCOMPLETE_WARNING],
      this.#unknownTitleHints(o, lessons, failures.length > 0),
    );
  }

  /** One hint per topic or lesson filter that matches no lesson the learner has. */
  #unknownTitleHints(o: ListWordsFilters, lessons: readonly LessonRef[], partial: boolean): string[] {
    const hints = [
      o.topic === undefined ? null : unknownTitleHint('topic', o.topic, lessons.flatMap(({ topic }) => (topic === null ? [] : [topic])), partial),
      o.lesson === undefined ? null : unknownTitleHint('lesson', o.lesson, lessons.map(({ title }) => title), partial),
    ];
    return hints.filter((hint): hint is string => hint !== null);
  }

  /** Every word that passes the filters, in list order, as a row with its id (needed for paging). */
  async #matchingWords(
    o: { state?: StateKey; includeAudio: boolean } & ListWordsFilters,
  ): Promise<{ matching: { id: number; row: WordRow }[]; failures: LessonFailure[]; lessons: LessonRef[] }> {
    const accepts = this.#wordFilter(o);
    const learnables = await this.#loader.learnables(o.state ?? DEFAULT_STATE);
    const { index, failures } = await this.#loader.lessonIndex();
    const linksIncomplete = failures.length > 0;
    const matching = learnables
      .map((learnable) => ({
        id: learnable.id,
        row: toWordRow(learnable, index.get(learnable.id) ?? [], { includeAudio: o.includeAudio, linksIncomplete }),
      }))
      .filter(({ row }) => accepts(row));
    return {
      matching: o.dueBefore === undefined ? matching : sortMostOverdueFirst(matching),
      failures,
      lessons: [...index.values()].flat(),
    };
  }

  #wordFilter(o: ListWordsFilters): WordPredicate {
    const { minGrowthLevel, maxGrowthLevel } = o;
    if (minGrowthLevel !== undefined && maxGrowthLevel !== undefined && minGrowthLevel > maxGrowthLevel) {
      throw new UsageError(`min_growth_level (${minGrowthLevel}) is greater than max_growth_level (${maxGrowthLevel}).`);
    }
    const dueBefore =
      o.dueBefore === undefined ? undefined : parseLearnerDate(o.dueBefore, 'end', this.#timeZone, 'due_before');
    return buildWordFilter({ ...o, dueBefore });
  }

  async lookupWords(o: { terms: string[]; state?: StateKey }): Promise<WithWarnings<{ results: LookupResult[] }>> {
    const learnables = await this.#loader.learnables(o.state ?? DEFAULT_STATE);
    const { index, failures } = await this.#loader.lessonIndex();
    const lookup = buildLookupIndex(
      learnables.map((learnable) => ({
        learnable,
        row: toWordRow(learnable, index.get(learnable.id) ?? [], { includeAudio: false, linksIncomplete: failures.length > 0 }),
      })),
    );
    return withWarnings({ results: o.terms.map((term) => lookupTerm(lookup, term)) }, failures, [LINKS_INCOMPLETE_WARNING]);
  }

  async listScenarios(o: {
    types: readonly ScenarioTypeKey[];
    /** `YYYY-MM-DD` (start of that day in the learner's zone) or a date-time with `Z` / offset. */
    since?: string;
  }): Promise<WithWarnings<{ scenarios: ScenarioRow[] }>> {
    const since = o.since === undefined ? undefined : parseLearnerDate(o.since, 'start', this.#timeZone, 'since');
    const scenarios = await this.#loader.scenariosOfTypes(o.types);
    const { details, failures } = await this.#loader.detailsSettled(scenarios);
    const rows = scenarios.map((scenario) => toScenarioRow(scenario, details.get(scenario.id)));
    return withWarnings({ scenarios: sortByRecency(filterCompletedSince(rows, since)) }, failures);
  }

  /** Rejects when this lesson's own details cannot be fetched; other lessons that fail only add warnings. */
  async scenarioWords(o: {
    scenarioId: number;
    includeAudio: boolean;
  }): Promise<WithWarnings<{ scenario: ScenarioRow | null; words: WordRow[] }>> {
    const detail = await this.#loader.detail(o.scenarioId);
    const learnables = await this.#loader.learnables(DEFAULT_STATE);
    const { index, failures } = await this.#loader.lessonIndex();
    const enrichment = new Map(learnables.map((learnable) => [learnable.id, learnable]));
    const words = uniqueById(detail.learnables).map((item) =>
      toScenarioWordRow(item, enrichment.get(item.id), index.get(item.id) ?? [], { includeAudio: o.includeAudio }),
    );
    const scenario = this.#scenarioRowFor(o.scenarioId, await this.#loader.lessonScenarios(), detail);
    return withWarnings({ scenario, words }, failures);
  }

  /** The lesson's row, or null when it is not one of the lessons the lesson lists read. */
  #scenarioRowFor(scenarioId: number, lessons: readonly Scenario[], detail: ScenarioDetails): ScenarioRow | null {
    const listed = lessons.find((scenario) => scenario.id === scenarioId);
    return listed === undefined ? null : toScenarioRow(listed, detail);
  }
}
