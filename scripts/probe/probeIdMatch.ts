import type { ProbeHttp } from './probeHttp.js';

const ANY_STATE = 'ANY';
const KNOWN_SCENARIO_ID = 1001;
const MAX_PAGES = 500;
const PAGE_SIZE = '50';
const COMPLETED_SCENARIOS_TO_FETCH = 8;
const COMPLETED_PAGE_LIMIT = 5;
const STATE_FLAGS = ['learned', 'known', 'heard', 'used', 'difficult', 'excluded'] as const;

export type FlagCounts = Record<(typeof STATE_FLAGS)[number], number>;

export type WalkStop = 'end' | 'repeat' | 'error' | 'cap';

export interface WalkFinding {
  pages: number;
  total: number;
  repeatedToken: boolean;
  repeatedAtPage?: number;
  stoppedBy: WalkStop;
}

export interface DetailMatch {
  scenarioId: number;
  status: number;
  detailIds: number;
  matched: number;
  unmatched: number;
}

/** Full `learning_state=ANY` walk compared against the walk of the chosen state. */
export interface AnyWalkFinding {
  walk: WalkFinding;
  flagCounts: FlagCounts;
  /** The state the comparison baseline was walked with. */
  chosenState: string;
  /** Items returned by the chosen-state walk, for side-by-side totals. */
  chosenTotal: number;
  /** Learnable ids in the ANY walk that the chosen-state walk lacks. */
  onlyInAny: number;
  /** Learnable ids in the chosen-state walk that the ANY walk lacks. */
  onlyInChosen: number;
  /** True when ANY holds every chosen-state id and at least one more. */
  strictSuperset: boolean;
}

export interface IdMatchFindings {
  walk: WalkFinding;
  anyWalk?: AnyWalkFinding;
  inProgressScenarioId?: number;
  /** Learnables with each boolean state flag true, across the full walk. */
  flagCounts: FlagCounts;
  details: DetailMatch[];
  /** Learnable ids that appear in the details of at least two fetched scenarios. */
  sharedDetailIds: number[];
}

/** Walks the whole learnables list, then checks scenario-detail `learnable_id`s against list `learnable_id_key`s. */
export async function probeIdMatch(http: ProbeHttp, pairId: number, state: string): Promise<IdMatchFindings> {
  const { walk, listIds, flagCounts } = await walkAllLearnables(http, pairId, state, 'walk page');
  const anyWalk = state === ANY_STATE ? undefined : await walkAny(http, pairId, state, walk, listIds);
  const inProgressScenarioId = await findInProgressScenario(http, pairId);
  const completedIds = await findCompletedScenarios(http, pairId);
  const scenarioIds = [
    ...new Set([KNOWN_SCENARIO_ID, ...(inProgressScenarioId === undefined ? [] : [inProgressScenarioId]), ...completedIds]),
  ];
  const details: DetailMatch[] = [];
  const idSets: Set<number>[] = [];
  for (const scenarioId of scenarioIds) {
    const { match, ids } = await fetchDetails(http, scenarioId, listIds);
    details.push(match);
    idSets.push(ids);
  }
  const base = inProgressScenarioId === undefined ? {} : { inProgressScenarioId };
  return { walk, flagCounts, ...(anyWalk === undefined ? {} : { anyWalk }), ...base, details, sharedDetailIds: idsInAtLeastTwo(idSets) };
}

async function walkAny(http: ProbeHttp, pairId: number, chosenState: string, chosen: WalkFinding, chosenIds: Set<number>): Promise<AnyWalkFinding> {
  const { walk, listIds, flagCounts } = await walkAllLearnables(http, pairId, ANY_STATE, 'any walk page');
  const onlyInAny = [...listIds].filter((id) => !chosenIds.has(id)).length;
  const onlyInChosen = [...chosenIds].filter((id) => !listIds.has(id)).length;
  return { walk, flagCounts, chosenState, chosenTotal: chosen.total, onlyInAny, onlyInChosen, strictSuperset: onlyInChosen === 0 && onlyInAny > 0 };
}

async function walkAllLearnables(
  http: ProbeHttp,
  pairId: number,
  state: string,
  labelPrefix: string,
): Promise<{ walk: WalkFinding; listIds: Set<number>; flagCounts: FlagCounts }> {
  const path = `/v1.25/me/language_pairs/${pairId}/learnables/`;
  const seenTokens = new Set<string>();
  const listIds = new Set<number>();
  const flagCounts = Object.fromEntries(STATE_FLAGS.map((flag) => [flag, 0])) as FlagCounts;
  let pages = 0;
  let total = 0;
  let token: string | undefined;
  const finish = (stoppedBy: WalkStop, extra: Partial<WalkFinding> = {}) => ({
    walk: { pages, total, repeatedToken: stoppedBy === 'repeat', ...extra, stoppedBy },
    listIds,
    flagCounts,
  });

  while (pages < MAX_PAGES) {
    const query: Record<string, string> = {
      learning_state: state,
      ordering: 'LAST_TOUCHED',
      ordering_direction: 'DESCENDING',
      page_size: PAGE_SIZE,
      ...(token === undefined ? {} : { next_page_token: token }),
    };
    const response = await http.get(`${labelPrefix} ${pages + 1}`, path, query);
    if (response.status !== 200) return finish('error');
    pages++;
    const items = (response.body as { learnables?: unknown } | null)?.learnables;
    for (const item of Array.isArray(items) ? items : []) {
      total++;
      const id = (item as { learnable_id_key?: unknown }).learnable_id_key;
      if (typeof id === 'number') listIds.add(id);
      for (const flag of STATE_FLAGS) {
        if ((item as Record<string, unknown>)[flag] === true) flagCounts[flag]++;
      }
    }
    const next = (response.body as { next_page_token?: unknown } | null)?.next_page_token;
    if (typeof next !== 'string') return finish('end');
    if (token !== undefined) seenTokens.add(token);
    if (next === token || seenTokens.has(next)) return finish('repeat', { repeatedAtPage: pages });
    token = next;
  }
  return finish('cap');
}

async function findInProgressScenario(http: ProbeHttp, pairId: number): Promise<number | undefined> {
  const response = await http.get('in-progress scenario lookup', `/v1.25/me/language_pairs/${pairId}/scenarios/`, {
    scenario_type: 'in_progress',
    free_only: 'false',
    limit: '5',
    offset: '0',
  });
  const scenarios = (response.body as { scenarios?: unknown } | null)?.scenarios;
  const id = Array.isArray(scenarios) ? (scenarios[0] as { scenario_id?: unknown } | undefined)?.scenario_id : undefined;
  return typeof id === 'number' ? id : undefined;
}

async function findCompletedScenarios(http: ProbeHttp, pairId: number): Promise<number[]> {
  const ids: number[] = [];
  for (let offset = 0; ids.length < COMPLETED_SCENARIOS_TO_FETCH; offset += COMPLETED_PAGE_LIMIT) {
    const response = await http.get(`completed scenario lookup offset ${offset}`, `/v1.25/me/language_pairs/${pairId}/scenarios/`, {
      scenario_type: 'completed',
      free_only: 'false',
      has_immerse_content: 'true',
      limit: String(COMPLETED_PAGE_LIMIT),
      offset: String(offset),
    });
    const body = response.body as { scenarios?: unknown; has_more_pages?: unknown } | null;
    const page = Array.isArray(body?.scenarios) ? body.scenarios : [];
    for (const scenario of page) {
      const id = (scenario as { scenario_id?: unknown }).scenario_id;
      if (typeof id === 'number') ids.push(id);
    }
    if (response.status !== 200 || body?.has_more_pages !== true) break;
  }
  return ids.slice(0, COMPLETED_SCENARIOS_TO_FETCH);
}

async function fetchDetails(
  http: ProbeHttp,
  scenarioId: number,
  listIds: Set<number>,
): Promise<{ match: DetailMatch; ids: Set<number> }> {
  const response = await http.get(`scenario details ${scenarioId}`, `/v1.25/me/scenarios/${scenarioId}/details/`);
  const items = (response.body as { learnables?: unknown } | null)?.learnables;
  const ids = new Set<number>();
  for (const item of response.status === 200 && Array.isArray(items) ? items : []) {
    const id = (item as { learnable_id?: unknown }).learnable_id;
    if (typeof id === 'number') ids.add(id);
  }
  const matched = [...ids].filter((id) => listIds.has(id)).length;
  return {
    match: { scenarioId, status: response.status, detailIds: ids.size, matched, unmatched: ids.size - matched },
    ids,
  };
}

function idsInAtLeastTwo(sets: Set<number>[]): number[] {
  const occurrences = new Map<number, number>();
  for (const set of sets) {
    for (const id of set) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }
  return [...occurrences].filter(([, count]) => count >= 2).map(([id]) => id);
}
