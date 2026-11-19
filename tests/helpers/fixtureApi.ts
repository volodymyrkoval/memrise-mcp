/**
 * Routes `RoutedTransport` requests to the sanitized fixtures in `tests/fixtures/`, so API and app
 * tests run against real response shapes. Registration order matters: the language-pairs route is a
 * prefix match, so it is registered last and then checks the exact path.
 */
import type { HttpRequest, HttpResponse } from '../../src/http/transport.js';
import { loadFixture } from './fixtures.js';
import type { RoutedTransport } from './routedTransport.js';

/** The language pair in `language-pairs.json`. */
export const FIXTURE_PAIR_ID = 7;

/** A canned response for one scenario-details id: a status, and an optional JSON body. */
export interface DetailsOverride {
  status: number;
  body?: unknown;
}

export interface FixtureApiOptions {
  /** Learnable ids whose raw item answers `heard: true` (the fixtures hold none). */
  heardIds?: number[];
  details?: Record<number, DetailsOverride>;
}

const API = '/v1.25';
const PAIR_PATH = `${API}/me/language_pairs/${FIXTURE_PAIR_ID}`;
const DETAILS_PATH = /^\/v1\.25\/me\/scenarios\/(\d+)\/details\/$/;
/** The only scenario whose details come from a fixture; every other id gets a synthetic body. */
const FIXTURE_DETAILS_ID = 1001;
const LEARNING_STATES = ['ANY', 'FULLY_LEARNED_OR_KNOWN'];

/** Learnables pages keyed by the `next_page_token` on the request; the first request carries none. */
const LEARNABLES_BY_TOKEN = new Map<string, string>([
  ['', 'learnables-page-1.json'],
  ['<page-token-1>', 'learnables-page-2.json'],
  ['<page-token-2>', 'learnables-page-last.json'],
]);

/** Scenario pages keyed by `<scenario_type>:<offset>`. */
const SCENARIOS_BY_KEY = new Map<string, string>([
  ['completed:0', 'scenarios-completed-page-1.json'],
  ['completed:5', 'scenarios-completed-page-last.json'],
  ['in_progress:0', 'scenarios-in-progress.json'],
]);

const SYNTHETIC_DATE = '2030-01-01T10:12:00.000000Z';

interface FixtureLearnable {
  learnable_id_key: number;
  source_value: string;
  target_value: string;
  growth_level: number;
  known: boolean;
  difficult: boolean;
  due_for_review: boolean;
}

/** Routes every fixture-backed Memrise read on `transport`; unknown routes answer 404. */
export function routeFixtureApi(transport: RoutedTransport, options: FixtureApiOptions = {}): void {
  transport.route('GET', `${PAIR_PATH}/learnables/`, (req) => learnablesResponse(req, options.heardIds ?? []));
  transport.route('GET', `${PAIR_PATH}/scenarios/`, scenariosResponse);
  transport.route('GET', `${API}/me/scenarios/`, detailsResponder(options));
  transport.route('GET', `${API}/me/language_pairs/`, languagePairsResponse);
}

/**
 * A details body for a lesson with the given learnable ids, built from `learnables-page-1.json`
 * entries. Use it where a test needs a lesson but not its exact contents.
 */
export function syntheticDetails(learnableIds: number[], { completed = true } = {}): Record<string, unknown> {
  const items = learnableIds.map(detailItemFor);
  return {
    learnables: items,
    completed,
    is_locked: false,
    number_of_learnables: items.length,
    items_learned: items.length,
    date_started: completed ? SYNTHETIC_DATE : null,
    date_completed: completed ? SYNTHETIC_DATE : null,
    content_media_id: null,
  };
}

function learnablesResponse(req: HttpRequest, heardIds: readonly number[]): HttpResponse {
  const url = new URL(req.url);
  const state = url.searchParams.get('learning_state');
  if (state === null || !LEARNING_STATES.includes(state)) return fixtureResponse('learnables-invalid-state.json', 400);
  const fixture = LEARNABLES_BY_TOKEN.get(url.searchParams.get('next_page_token') ?? '');
  if (fixture === undefined) return jsonResponse(404);
  const page = loadFixture<{ learnables: { learnable_id_key: number; heard: boolean }[] }>(fixture);
  for (const item of page.learnables) if (heardIds.includes(item.learnable_id_key)) item.heard = true;
  return jsonResponse(200, page);
}

function scenariosResponse(req: HttpRequest): HttpResponse {
  const url = new URL(req.url);
  const key = `${url.searchParams.get('scenario_type')}:${url.searchParams.get('offset')}`;
  const fixture = SCENARIOS_BY_KEY.get(key);
  return fixture === undefined ? jsonResponse(404) : fixtureResponse(fixture);
}

function detailsResponder(options: FixtureApiOptions): (req: HttpRequest) => HttpResponse {
  return (req) => {
    const match = DETAILS_PATH.exec(new URL(req.url).pathname);
    if (match === null) return jsonResponse(404);
    const id = Number(match[1]);
    const override = options.details?.[id];
    if (override !== undefined) return jsonResponse(override.status, override.body);
    if (id === FIXTURE_DETAILS_ID) return fixtureResponse('scenario-details-1001.json');
    return jsonResponse(200, syntheticDetails([]));
  };
}

function languagePairsResponse(req: HttpRequest): HttpResponse {
  const isExactPath = new URL(req.url).pathname === `${API}/me/language_pairs/`;
  return isExactPath ? fixtureResponse('language-pairs.json') : jsonResponse(404);
}

function detailItemFor(learnableId: number) {
  const source = loadFixture<{ learnables: FixtureLearnable[] }>('learnables-page-1.json').learnables.find(
    (item) => item.learnable_id_key === learnableId,
  );
  if (source === undefined) throw new Error(`syntheticDetails: learnable ${learnableId} is not in learnables-page-1.json`);
  return {
    learnable_id: source.learnable_id_key,
    target_value: source.target_value,
    source_value: source.source_value,
    growth_level: source.growth_level,
    already_known: source.known,
    difficult: source.difficult,
    due_for_review: source.due_for_review,
  };
}

function fixtureResponse(name: string, status = 200): HttpResponse {
  return jsonResponse(status, loadFixture(name));
}

function jsonResponse(status: number, body?: unknown): HttpResponse {
  return { status, setCookies: [], bodyText: body === undefined ? '' : JSON.stringify(body) };
}
