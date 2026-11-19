import type { MemriseApi } from '../api/memriseApi.js';
import { resolvePairId } from '../api/resolvePairId.js';
import { AsyncMemo } from '../cache/asyncMemo.js';
import type { WordListCache } from '../cache/diskWordListCache.js';
import type { ScenarioDetailsRepository } from '../cache/scenarioDetailsRepository.js';
import { buildLessonIndex } from '../domain/lessonIndex.js';
import { uniqueById } from '../domain/uniqueById.js';
import type { Learnable, LessonRef, Scenario, ScenarioDetails, ScenarioTypeKey, StateKey } from '../domain/types.js';
import { LESSON_INDEX_TYPES } from '../domain/types.js';
import { describeFailure, isLessonFetchFailure } from '../errors.js';
import type { Logger } from '../log/logger.js';

/** A lesson whose details could not be fetched; `reason` comes from `describeFailure` and never holds a secret. */
export interface LessonFailure {
  scenarioId: number;
  title: string;
  reason: string;
}

export interface LessonIndexResult {
  index: Map<number, LessonRef[]>;
  failures: LessonFailure[];
}

export interface SettledDetails {
  details: Map<number, ScenarioDetails>;
  failures: LessonFailure[];
}

/** `write-only` skips reading the disk cache but still refreshes it; `export` uses it so its numbers come from the API. */
export type WordCacheMode = 'read-write' | 'write-only';

export interface LearnerDataLoaderDeps {
  api: Pick<MemriseApi, 'listLanguagePairs' | 'listLearnables' | 'listScenarios'>;
  repository: Pick<ScenarioDetailsRepository, 'get'>;
  wordCache: WordListCache;
  wordCacheMode: WordCacheMode;
  languagePairId: number | null;
  logger: Logger;
}

/**
 * Loads the learner's data once per process and decides what a partial failure means. Every
 * accessor is memoized (single-flight); a rejected load is evicted so the next call retries it.
 */
export class LearnerDataLoader {
  readonly #api: LearnerDataLoaderDeps['api'];
  readonly #repository: LearnerDataLoaderDeps['repository'];
  readonly #wordCache: WordListCache;
  readonly #readWordCache: boolean;
  readonly #configuredPairId: number | null;
  readonly #logger: Logger;
  readonly #pairMemo = new AsyncMemo<'pair', number>();
  readonly #learnablesMemo = new AsyncMemo<string, Learnable[]>();
  readonly #scenariosMemo = new AsyncMemo<string, Scenario[]>();
  readonly #detailsMemo = new AsyncMemo<number, ScenarioDetails>();

  constructor({ api, repository, wordCache, wordCacheMode, languagePairId, logger }: LearnerDataLoaderDeps) {
    this.#api = api;
    this.#repository = repository;
    this.#wordCache = wordCache;
    this.#readWordCache = wordCacheMode === 'read-write';
    this.#configuredPairId = languagePairId;
    this.#logger = logger;
  }

  pairId(): Promise<number> {
    return this.#pairMemo.get('pair', () =>
      resolvePairId(this.#configuredPairId ?? undefined, () => this.#api.listLanguagePairs()),
    );
  }

  async learnables(state: StateKey): Promise<Learnable[]> {
    const pairId = await this.pairId();
    return this.#learnablesMemo.get(`${pairId}:${state}`, () => this.#loadLearnables(pairId, state));
  }

  /** A fresh disk entry is served; otherwise the API is walked and the result written back. A failed write only costs the next process a walk. */
  async #loadLearnables(pairId: number, state: StateKey): Promise<Learnable[]> {
    const cached = this.#readWordCache ? await this.#wordCache.read(pairId, state) : null;
    if (cached !== null) return cached;
    const items = await this.#api.listLearnables(pairId, state);
    await this.#wordCache.write(pairId, state, items).catch(() => this.#logger.warn('words: could not write the disk cache'));
    return items;
  }

  async scenarios(type: ScenarioTypeKey): Promise<Scenario[]> {
    const pairId = await this.pairId();
    return this.#scenariosMemo.get(`${pairId}:${type}`, () => this.#api.listScenarios(pairId, type));
  }

  detail(id: number): Promise<ScenarioDetails> {
    return this.#detailsMemo.get(id, () => this.#repository.get(id));
  }

  /** Lessons of the given types, one row per id. */
  async scenariosOfTypes(types: readonly ScenarioTypeKey[]): Promise<Scenario[]> {
    const lists: Scenario[][] = [];
    for (const type of types) lists.push(await this.scenarios(type));
    return uniqueById(lists.flat());
  }

  /** Every lesson the word ↔ lesson join reads. */
  lessonScenarios(): Promise<Scenario[]> {
    return this.scenariosOfTypes(LESSON_INDEX_TYPES);
  }

  /** Loads each lesson in turn; a lesson-fetch failure becomes a `LessonFailure`, anything else (auth, config) propagates. */
  async detailsSettled(scenarios: readonly Scenario[]): Promise<SettledDetails> {
    const details = new Map<number, ScenarioDetails>();
    const failures: LessonFailure[] = [];
    for (const scenario of scenarios) {
      try {
        details.set(scenario.id, await this.detail(scenario.id));
      } catch (err) {
        failures.push(this.#toFailure(scenario, err));
      }
    }
    return { details, failures };
  }

  /** Not memoized: it is cheap, and rebuilding it lets a lesson that failed earlier join in once it loads. */
  async lessonIndex(): Promise<LessonIndexResult> {
    const scenarios = await this.lessonScenarios();
    const { details, failures } = await this.detailsSettled(scenarios);
    return { index: buildLessonIndex(scenarios, details), failures };
  }

  #toFailure(scenario: Scenario, err: unknown): LessonFailure {
    if (!isLessonFetchFailure(err)) throw err;
    const reason = describeFailure(err);
    this.#logger.warn(`details: failed scenario=${scenario.id} (${reason})`);
    return { scenarioId: scenario.id, title: scenario.title, reason };
  }
}
