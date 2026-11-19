import type { ProbeHttp } from './probeHttp.js';

const CANDIDATE_STATES: ReadonlyArray<string | null> = [
  'FULLY_LEARNED_OR_KNOWN',
  'LEARNING',
  'IN_PROGRESS',
  'SEEN',
  'NOT_LEARNED',
  'DIFFICULT',
  'NOT_SEEN',
  'UNSEEN',
  'SEEN_NOT_LEARNED',
  'LEARNED',
  'KNOWN',
  'FULLY_LEARNED',
  'ALL',
  'ANY',
  'LEARNING_OR_KNOWN',
  'TO_REVIEW',
  'DUE_FOR_REVIEW',
  'DIFFICULT_ITEMS',
  'IGNORED',
  'NOT_LEARNED_OR_UNKNOWN',
  'fully_learned_or_known',
  'Fully_Learned_Or_Known',
  null,
  'INVALID_PROBE_VALUE',
];
const KNOWN_GOOD_STATE = 'FULLY_LEARNED_OR_KNOWN';
const PAGE_SIZES = [10, 20, 25, 30, 40, 50, 51, 60, 75, 100];

export interface StateFinding {
  state: string | null;
  status: number;
  count?: number;
  hasNextPage?: boolean;
  errorBody?: unknown;
}

export interface PageSizeFinding {
  pageSize: number;
  status: number;
  count?: number;
  errorBody?: unknown;
}

export interface StatesFindings {
  states: StateFinding[];
  pageSizes: PageSizeFinding[];
}

/** Records how the learnables endpoint reacts to each candidate `learning_state` and page size. */
export async function probeStates(http: ProbeHttp, pairId: number): Promise<StatesFindings> {
  const path = `/v1.25/me/language_pairs/${pairId}/learnables/`;
  const states: StateFinding[] = [];
  for (const state of CANDIDATE_STATES) {
    states.push(await probeState(http, path, state));
  }
  return { states, pageSizes: await probePageSizes(http, path) };
}

async function probeState(http: ProbeHttp, path: string, state: string | null): Promise<StateFinding> {
  const query = listQuery(50, state);
  const response = await http.get(`state ${state ?? 'omitted'}`, path, query);
  if (response.status >= 400 || response.status === 0) {
    return { state, status: response.status, errorBody: response.body };
  }
  return {
    state,
    status: response.status,
    count: learnableCount(response.body),
    hasNextPage: hasNextPage(response.body),
  };
}

async function probePageSizes(http: ProbeHttp, path: string): Promise<PageSizeFinding[]> {
  const findings: PageSizeFinding[] = [];
  for (const pageSize of PAGE_SIZES) {
    const response = await http.get(`page_size ${pageSize}`, path, listQuery(pageSize, KNOWN_GOOD_STATE));
    findings.push(
      response.status === 200
        ? { pageSize, status: response.status, count: learnableCount(response.body) }
        : { pageSize, status: response.status, errorBody: response.body },
    );
  }
  return findings;
}

function listQuery(pageSize: number, state: string | null): Record<string, string> {
  return {
    ...(state === null ? {} : { learning_state: state }),
    ordering: 'LAST_TOUCHED',
    ordering_direction: 'DESCENDING',
    page_size: String(pageSize),
  };
}

function learnableCount(body: unknown): number | undefined {
  const learnables = (body as { learnables?: unknown } | null)?.learnables;
  return Array.isArray(learnables) ? learnables.length : undefined;
}

function hasNextPage(body: unknown): boolean {
  return typeof (body as { next_page_token?: unknown } | null)?.next_page_token === 'string';
}
