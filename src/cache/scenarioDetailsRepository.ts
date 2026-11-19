import type { MemriseApi } from '../api/memriseApi.js';
import type { ScenarioDetails } from '../domain/types.js';
import { RequestNotNeededError } from '../errors.js';
import type { Logger } from '../log/logger.js';
import type { ScenarioDetailsStore } from './diskScenarioDetailsStore.js';

export interface ScenarioDetailsRepositoryDeps {
  store: ScenarioDetailsStore;
  api: Pick<MemriseApi, 'fetchScenarioDetails'>;
  logger: Logger;
}

/**
 * Lesson details by id: disk first, then the API, with the disk read again once the request's turn
 * comes (another process may have stored the lesson meanwhile). Failed fetches propagate unchanged for the loader to decide;
 * a failed cache write is logged and the fetched details are still returned.
 */
export class ScenarioDetailsRepository {
  readonly #store: ScenarioDetailsStore;
  readonly #api: Pick<MemriseApi, 'fetchScenarioDetails'>;
  readonly #logger: Logger;

  constructor({ store, api, logger }: ScenarioDetailsRepositoryDeps) {
    this.#store = store;
    this.#api = api;
    this.#logger = logger;
  }

  async get(id: number): Promise<ScenarioDetails> {
    return (await this.#readReusable(id)) ?? this.#fetchUnlessStoredMeanwhile(id);
  }

  /**
   * Another process sharing the cache folder may store the lesson while this one waits for its pacer
   * turn, so the cache is read again once the turn comes; a hit then is served and nothing is sent.
   */
  async #fetchUnlessStoredMeanwhile(id: number): Promise<ScenarioDetails> {
    let storedMeanwhile: ScenarioDetails | null = null;
    const stillNeeded = async () => (storedMeanwhile = await this.#readReusable(id)) === null;
    try {
      return await this.#fetchAndKeep(id, stillNeeded);
    } catch (err) {
      if (err instanceof RequestNotNeededError && storedMeanwhile !== null) return storedMeanwhile;
      throw err;
    }
  }

  async #fetchAndKeep(id: number, stillNeeded: () => Promise<boolean>): Promise<ScenarioDetails> {
    const details = await this.#api.fetchScenarioDetails(id, { stillNeeded });
    await this.#store.write(id, details).catch(() => this.#logger.warn('details: could not write the disk cache', { scenario: id }));
    this.#logger.debug('details: fetched', { scenario: id });
    return details;
  }

  /** The cached lesson when it can be served as is; logs the hit. */
  async #readReusable(id: number): Promise<ScenarioDetails | null> {
    const cached = await this.#store.read(id);
    if (!this.#isReusable(cached)) return null;
    this.#logger.debug('details: cache hit (completed)', { scenario: id });
    return cached;
  }

  /** Only a completed lesson is final; an incomplete one can still gain words, so it is fetched again. */
  #isReusable(cached: ScenarioDetails | null): cached is ScenarioDetails {
    return cached?.completed === true;
  }
}
