/**
 * Endpoint client for the Memrise learner API: paths, query contract, paging and the one error
 * mapping callers need. Responses are parsed by `schemas.ts`; this file only decides what to ask for.
 */
import { HttpStatusError, NotFoundError } from '../errors.js';
import type { ApiRequest } from '../http/httpClient.js';
import type { Logger } from '../log/logger.js';
import type { Requester } from '../session/authenticatedRequester.js';
import { uniqueById } from '../domain/uniqueById.js';
import type { LanguagePair, Learnable, Scenario, ScenarioDetails, ScenarioTypeKey, StateKey } from '../domain/types.js';
import { collectOffsetPages, collectTokenPages, type OffsetPage, type TokenPage } from './pagination.js';
import { parseLanguagePairs, parseLearnablesPage, parseScenarioDetails, parseScenariosPage } from './schemas.js';

/** Web-app API version; the one place to change when Memrise bumps it. */
export const API_PREFIX = '/v1.25';
/** Largest page the learnables endpoint accepts (51 is a 400). */
export const LEARNABLES_PAGE_SIZE = 50;
/** Largest page the scenarios endpoint accepts (25 is a 400). */
export const SCENARIOS_PAGE_SIZE = 20;
/** The `learning_state` values the API accepts for a learnables list. */
export const STATE_TO_API: Record<StateKey, string> = {
  any: 'ANY',
  fully_learned_or_known: 'FULLY_LEARNED_OR_KNOWN',
};

/** Path and query of one page of a pair's lessons; the single definition production and the discovery probe both send. */
export function scenariosPageRequest(
  pairId: number,
  type: ScenarioTypeKey,
  offset: number,
): { path: string; query: Record<string, string | number> } {
  return {
    path: `${API_PREFIX}/me/language_pairs/${pairId}/scenarios/`,
    query: {
      scenario_type: type,
      free_only: 'false',
      has_immerse_content: 'true',
      limit: SCENARIOS_PAGE_SIZE,
      offset,
    },
  };
}

/** Path of one lesson's details. */
export function scenarioDetailsPath(id: number): string {
  return `${API_PREFIX}/me/scenarios/${id}/details/`;
}

export interface MemriseApiDeps {
  requester: Requester;
  logger: Logger;
}

export class MemriseApi {
  readonly #requester: Requester;
  readonly #logger: Logger;

  constructor({ requester, logger }: MemriseApiDeps) {
    this.#requester = requester;
    this.#logger = logger;
  }

  async listLanguagePairs(): Promise<LanguagePair[]> {
    const res = await this.#requester.send({
      method: 'GET',
      path: `${API_PREFIX}/me/language_pairs/`,
      label: 'language_pairs',
    });
    return parseLanguagePairs(res.body);
  }

  /** Every learnable in the given state, one row per id. With `maxItems` the walk stops early, so the result is a prefix of the full list. */
  async listLearnables(pairId: number, state: StateKey, options: { maxItems?: number } = {}): Promise<Learnable[]> {
    const items = await collectTokenPages((token) => this.#fetchLearnablesPage(pairId, state, token), {
      maxItems: options.maxItems,
      onStop: (reason) => this.#logger.warn(`learnables: pagination stopped (${reason})`),
    });
    return uniqueById(items);
  }

  async listScenarios(pairId: number, type: ScenarioTypeKey): Promise<Scenario[]> {
    const items = await collectOffsetPages((offset) => this.#fetchScenariosPage(pairId, type, offset));
    return uniqueById(items);
  }

  /**
   * A lesson the API no longer has rejects with `NotFoundError`; other failures keep their own error types.
   * `stillNeeded` is re-checked once the request's pacer turn comes (see `ApiRequest`).
   */
  async fetchScenarioDetails(id: number, options: Pick<ApiRequest, 'stillNeeded'> = {}): Promise<ScenarioDetails> {
    const res = await this.#requester
      .send({ method: 'GET', path: scenarioDetailsPath(id), label: 'scenario_details', ...options })
      .catch((err: unknown) => {
        if (err instanceof HttpStatusError && err.status === 404) throw new NotFoundError('scenario_details', id);
        throw err;
      });
    return parseScenarioDetails(id, res.body);
  }

  async #fetchLearnablesPage(pairId: number, state: StateKey, token: string | null): Promise<TokenPage<Learnable>> {
    const res = await this.#requester.send({
      method: 'GET',
      path: `${API_PREFIX}/me/language_pairs/${pairId}/learnables/`,
      query: {
        learning_state: STATE_TO_API[state],
        ordering: 'LAST_TOUCHED',
        ordering_direction: 'DESCENDING',
        page_size: LEARNABLES_PAGE_SIZE,
        next_page_token: token ?? undefined,
      },
      label: 'learnables_page',
    });
    return parseLearnablesPage(res.body);
  }

  async #fetchScenariosPage(pairId: number, type: ScenarioTypeKey, offset: number): Promise<OffsetPage<Scenario>> {
    const res = await this.#requester.send({
      method: 'GET',
      ...scenariosPageRequest(pairId, type, offset),
      label: 'scenarios_page',
    });
    return parseScenariosPage(res.body);
  }
}
