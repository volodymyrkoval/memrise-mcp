import { scenarioDetailsPath, scenariosPageRequest, SCENARIOS_PAGE_SIZE } from '../../src/api/memriseApi.js';
import type { ScenarioTypeKey } from '../../src/domain/types.js';
import type { ProbeHttp, Query } from './probeHttp.js';
import { isIdKey, summarizeShape } from './shape.js';

const MAX_LESSON_DETAIL_FETCHES = 200;
const MAX_WALK_PAGES = 500;
const LEARNABLES_PAGE_SIZE = '50';
const SINGLE_LEARNABLE_TRIES = 3;
const CANDIDATE_SCENARIO_TYPES = ['immerse', 'video', 'media', 'all'] as const;
const LEARNABLE_ID_KEYS = new Set(['learnable_id', 'learnable_id_key']);

/** How many words of one group carry each raw flag. Counts only. */
export interface FlagTally {
  total: number;
  learned: number;
  known: number;
  heard: number;
  used: number;
  excluded: number;
  difficult: number;
  dueForReview: number;
  growthZero: number;
  reviewInPast: number;
  audiosNonEmpty: number;
  withRomanization: number;
  withNativeScript: number;
}

/** What a word-by-id answer holds, as field names only; `flagFields` says which review-state fields it carries. */
export interface LookupFacts {
  fields: string[];
  hasFlagFields: string[];
  lacksFlagFields: string[];
}

const LOOKUP_FLAG_FIELDS = ['learned', 'known', 'difficult', 'next_review', 'growth_level'] as const;

/** One guessed endpoint: its status, the key set of its answer and, for lists, how many unlinked ids it holds. */
export interface CandidateFinding {
  label: string;
  path: string;
  query?: Query;
  status: number;
  shape: string;
  /** `total_number` of a scenario list, when it reports one. */
  total?: number;
  unlinkedIdsContained?: { matched: number; of: number };
  /** Set when a 200 answer holds a `learnables` map keyed by id: the field names of its first entry. */
  lookup?: LookupFacts;
}

/** How listing one lesson type went; `errorShape` holds the key names and value types of a rejected answer, never values. */
export interface ListingOutcome {
  type: ScenarioTypeKey;
  pages: number;
  failedStatus?: number;
  errorShape?: string;
}

/** Why the linked-versus-unlinked comparison cannot be trusted, or `undefined` when it can. */
export function invalidRunReason(lessons: UnlinkedFindings['lessons']): string | undefined {
  const rejected = lessons.listing.filter((outcome) => outcome.failedStatus !== undefined);
  if (rejected.length > 0) {
    return `lesson listing failed (${rejected.map((outcome) => `HTTP ${outcome.failedStatus} on ${outcome.type}`).join(', ')})`;
  }
  if (lessons.listed === 0) return 'lesson listing returned 0 lessons';
  if (lessons.failed > 0) return `${lessons.failed} of ${lessons.fetched + lessons.failed} lesson detail fetches failed`;
  return undefined;
}

export interface UnlinkedFindings {
  walk: { pages: number; items: number; stoppedBy: 'end' | 'error' | 'cap' };
  lessons: { listed: number; fetched: number; failed: number; capped: boolean; listing: ListingOutcome[] };
  /** Words in the ANY walk that no fetched lesson lists. */
  unlinked: FlagTally;
  linked: FlagTally;
  /** Key names and value types of one unlinked item; never its values. */
  unlinkedShape?: string;
  candidates: CandidateFinding[];
}

export interface UnlinkedOptions {
  now?: () => number;
}

type RawItem = Record<string, unknown>;

/**
 * Finds out what the words that no lesson teaches have in common, and whether any endpoint knows
 * them. Read-only (GET) and counts-only: ids and values stay out of the findings.
 */
export async function probeUnlinked(http: ProbeHttp, pairId: number, options: UnlinkedOptions = {}): Promise<UnlinkedFindings> {
  const now = (options.now ?? Date.now)();
  const { items, walk } = await walkAny(http, pairId);
  const { lessonIds, listing } = await listLessonIds(http, pairId);
  const { linkedIds, fetched, failed } = await fetchLessonLinks(http, lessonIds);
  const unlinkedItems = items.filter((item) => !linkedIds.has(idOf(item)));
  const linkedItems = items.filter((item) => linkedIds.has(idOf(item)));
  const unlinkedIds = new Set(unlinkedItems.map(idOf));
  return {
    walk,
    lessons: { listed: lessonIds.length, fetched, failed, capped: lessonIds.length > MAX_LESSON_DETAIL_FETCHES, listing },
    unlinked: tally(unlinkedItems, now),
    linked: tally(linkedItems, now),
    ...(unlinkedItems.length > 0 ? { unlinkedShape: summarizeShape(unlinkedItems[0]) } : {}),
    candidates: await tryCandidates(http, pairId, unlinkedIds),
  };
}

function stringQuery(query: Record<string, string | number>): Query {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)]));
}

function idOf(item: RawItem): number {
  return item.learnable_id_key as number;
}

async function walkAny(http: ProbeHttp, pairId: number): Promise<{ items: RawItem[]; walk: UnlinkedFindings['walk'] }> {
  const items: RawItem[] = [];
  let token: string | undefined;
  let pages = 0;
  while (pages < MAX_WALK_PAGES) {
    const response = await http.get(`unlinked any walk page ${pages + 1}`, `/v1.25/me/language_pairs/${pairId}/learnables/`, {
      learning_state: 'ANY',
      ordering: 'LAST_TOUCHED',
      ordering_direction: 'DESCENDING',
      page_size: LEARNABLES_PAGE_SIZE,
      ...(token === undefined ? {} : { next_page_token: token }),
    });
    if (response.status !== 200) return { items, walk: { pages, items: items.length, stoppedBy: 'error' } };
    pages++;
    const body = response.body as { learnables?: unknown; next_page_token?: unknown } | null;
    for (const item of Array.isArray(body?.learnables) ? body.learnables : []) {
      if (typeof (item as RawItem)?.learnable_id_key === 'number') items.push(item as RawItem);
    }
    if (typeof body?.next_page_token !== 'string' || body.next_page_token === token) {
      return { items, walk: { pages, items: items.length, stoppedBy: 'end' } };
    }
    token = body.next_page_token;
  }
  return { items, walk: { pages, items: items.length, stoppedBy: 'cap' } };
}

/** Ids of the completed and in-progress lessons, the two lists the server's word-to-lesson join reads. */
async function listLessonIds(http: ProbeHttp, pairId: number): Promise<{ lessonIds: number[]; listing: ListingOutcome[] }> {
  const ids: number[] = [];
  const listing: ListingOutcome[] = [];
  for (const type of ['completed', 'in_progress'] as const satisfies readonly ScenarioTypeKey[]) {
    const outcome: ListingOutcome = { type, pages: 0 };
    listing.push(outcome);
    for (let offset = 0; ; offset += SCENARIOS_PAGE_SIZE) {
      const { path, query } = scenariosPageRequest(pairId, type, offset);
      const response = await http.get(`unlinked ${type} lessons offset ${offset}`, path, stringQuery(query));
      if (response.status !== 200) {
        outcome.failedStatus = response.status;
        outcome.errorShape = summarizeShape(response.body);
        break;
      }
      outcome.pages++;
      const body = response.body as { scenarios?: unknown; has_more_pages?: unknown } | null;
      for (const scenario of Array.isArray(body?.scenarios) ? body.scenarios : []) {
        const id = (scenario as { scenario_id?: unknown }).scenario_id;
        if (typeof id === 'number' && !ids.includes(id)) ids.push(id);
      }
      if (body?.has_more_pages !== true) break;
    }
  }
  return { lessonIds: ids, listing };
}

async function fetchLessonLinks(
  http: ProbeHttp,
  lessonIds: readonly number[],
): Promise<{ linkedIds: Set<number>; fetched: number; failed: number }> {
  const linkedIds = new Set<number>();
  let fetched = 0;
  let failed = 0;
  for (const scenarioId of lessonIds.slice(0, MAX_LESSON_DETAIL_FETCHES)) {
    const response = await http.get(`unlinked lesson details ${fetched + failed + 1}`, scenarioDetailsPath(scenarioId));
    if (response.status !== 200) {
      failed++;
      continue;
    }
    fetched++;
    const items = (response.body as { learnables?: unknown } | null)?.learnables;
    for (const item of Array.isArray(items) ? items : []) {
      const id = (item as { learnable_id?: unknown }).learnable_id;
      if (typeof id === 'number') linkedIds.add(id);
    }
  }
  return { linkedIds, fetched, failed };
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function tally(items: readonly RawItem[], now: number): FlagTally {
  const count = (matches: (item: RawItem) => boolean) => items.filter(matches).length;
  const flag = (name: string) => count((item) => item[name] === true);
  return {
    total: items.length,
    learned: flag('learned'),
    known: flag('known'),
    heard: flag('heard'),
    used: flag('used'),
    excluded: flag('excluded'),
    difficult: flag('difficult'),
    dueForReview: flag('due_for_review'),
    growthZero: count((item) => item.growth_level === 0),
    reviewInPast: count((item) => typeof item.next_review === 'string' && Date.parse(item.next_review) < now),
    audiosNonEmpty: count((item) => Array.isArray(item.audios) && item.audios.length > 0),
    withRomanization: count((item) => isNonEmptyString(item.romanization)),
    withNativeScript: count((item) => isNonEmptyString(item.native_script)),
  };
}

async function tryCandidates(http: ProbeHttp, pairId: number, unlinkedIds: ReadonlySet<number>): Promise<CandidateFinding[]> {
  const candidates: CandidateFinding[] = [];
  const scenariosPath = `/v1.25/me/language_pairs/${pairId}/scenarios/`;
  for (const type of CANDIDATE_SCENARIO_TYPES) {
    for (const immerse of ['true', 'false']) {
      const label = `scenarios ${type} immerse=${immerse}`;
      const query = { scenario_type: type, free_only: 'false', has_immerse_content: immerse, limit: '1', offset: '0' };
      candidates.push(await record(http, pairId, label, scenariosPath, unlinkedIds, query));
    }
  }
  const tries = [...unlinkedIds].slice(0, SINGLE_LEARNABLE_TRIES);
  for (const [index, id] of tries.entries()) {
    candidates.push(await record(http, pairId, `me learnable #${index + 1}`, `/v1.25/me/learnables/${id}/`, unlinkedIds));
  }
  for (const [index, id] of tries.entries()) {
    candidates.push(await record(http, pairId, `learnable #${index + 1}`, `/v1.25/learnables/${id}/`, unlinkedIds));
  }
  return candidates;
}

async function record(
  http: ProbeHttp,
  pairId: number,
  label: string,
  path: string,
  unlinkedIds: ReadonlySet<number>,
  query?: Query,
): Promise<CandidateFinding> {
  const response = await http.get(`unlinked candidate ${label}`, path, query);
  const total = (response.body as { total_number?: unknown } | null)?.total_number;
  const found = response.status === 200 ? learnableIdsIn(response.body) : [];
  return {
    label,
    path: path.replace(`/language_pairs/${pairId}/`, '/language_pairs/<pair>/').replace(/\/\d+\/$/, '/<id>/'),
    ...(query === undefined ? {} : { query }),
    status: response.status,
    shape: summarizeShape(response.body),
    ...(typeof total === 'number' ? { total } : {}),
    ...(response.status === 200 ? lookupFactsOf(response.body) : {}),
    unlinkedIdsContained: { matched: found.filter((id) => unlinkedIds.has(id)).length, of: unlinkedIds.size },
  };
}

/** Every learnable id found under a `learnable_id` or `learnable_id_key` key, at any depth. */
function learnableIdsIn(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(learnableIdsIn);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    LEARNABLE_ID_KEYS.has(key) && typeof child === 'number' ? [child] : learnableIdsIn(child),
  );
}

function lookupFactsOf(body: unknown): { lookup: LookupFacts } | Record<string, never> {
  const map = (body as { learnables?: unknown } | null)?.learnables;
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return {};
  const entry = Object.values(map)[0];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return {};
  const fields = Object.keys(entry).filter((key) => !isIdKey(key));
  return {
    lookup: {
      fields,
      hasFlagFields: LOOKUP_FLAG_FIELDS.filter((name) => fields.includes(name)),
      lacksFlagFields: LOOKUP_FLAG_FIELDS.filter((name) => !fields.includes(name)),
    },
  };
}
