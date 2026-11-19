import { describe, expect, it } from 'vitest';
import { HttpStatusError, NotFoundError } from '../../../src/errors.js';
import { createTestApi } from '../../helpers/createTestApi.js';
import { FIXTURE_PAIR_ID, routeFixtureApi } from '../../helpers/fixtureApi.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';

const LEARNABLES_PATH = `/v1.25/me/language_pairs/${FIXTURE_PAIR_ID}/learnables/`;
const SCENARIOS_PATH = `/v1.25/me/language_pairs/${FIXTURE_PAIR_ID}/scenarios/`;
const FIRST_LEARNABLE_ID = 65500000065536;

function fixtureTransport(): RoutedTransport {
  const transport = new RoutedTransport();
  routeFixtureApi(transport);
  return transport;
}

describe('MemriseApi', () => {
  it('lists the language pairs from the fixture', async () => {
    const { api } = createTestApi(fixtureTransport());

    expect(await api.listLanguagePairs()).toEqual([
      { id: 7, sourceName: 'Alpha', targetName: 'Beta', sourceLocale: 'aa-aa', targetLocale: 'bb' },
    ]);
  });

  it('pages through all learnables with the ANY state and the web app ordering and page size', async () => {
    const transport = fixtureTransport();
    const { api } = createTestApi(transport);

    const items = await api.listLearnables(FIXTURE_PAIR_ID, 'any');

    expect(items).toHaveLength(30);
    const params = transport.requests.map((req) => new URL(req.url).searchParams);
    expect(params).toHaveLength(3);
    for (const p of params) {
      expect(p.get('learning_state')).toBe('ANY');
      expect(p.get('ordering')).toBe('LAST_TOUCHED');
      expect(p.get('ordering_direction')).toBe('DESCENDING');
      expect(p.get('page_size')).toBe('50');
    }
    expect(params[0].has('next_page_token')).toBe(false);
    expect(params[1].get('next_page_token')).toBe('<page-token-1>');
  });

  it('sends FULLY_LEARNED_OR_KNOWN for the fully_learned_or_known state', async () => {
    const transport = fixtureTransport();
    const { api } = createTestApi(transport);

    await api.listLearnables(FIXTURE_PAIR_ID, 'fully_learned_or_known');

    expect(new URL(transport.requests[0].url).searchParams.get('learning_state')).toBe('FULLY_LEARNED_OR_KNOWN');
  });

  it('keeps one learnable when the same id appears on two pages', async () => {
    const transport = new RoutedTransport();
    const page2 = loadFixture<{ learnables: Record<string, unknown>[] }>('learnables-page-2.json');
    page2.learnables[0].learnable_id_key = FIRST_LEARNABLE_ID;
    transport.route('GET', LEARNABLES_PATH, { next_page_token: '<page-token-1>' }, {
      status: 200,
      setCookies: [],
      bodyText: JSON.stringify(page2),
    });
    routeFixtureApi(transport);
    const { api } = createTestApi(transport);

    const ids = (await api.listLearnables(FIXTURE_PAIR_ID, 'any')).map((item) => item.id);

    expect(ids).toHaveLength(29);
    expect(ids.filter((id) => id === FIRST_LEARNABLE_ID)).toHaveLength(1);
  });

  it('warns and returns what it has when the server repeats a learnables token', async () => {
    const transport = new RoutedTransport();
    const repeatingPage2 = { ...loadFixture<Record<string, unknown>>('learnables-page-2.json'), next_page_token: '<page-token-1>' };
    transport.route('GET', LEARNABLES_PATH, { next_page_token: '<page-token-1>' }, {
      status: 200,
      setCookies: [],
      bodyText: JSON.stringify(repeatingPage2),
    });
    routeFixtureApi(transport);
    const { api, warnings } = createTestApi(transport);

    const items = await api.listLearnables(FIXTURE_PAIR_ID, 'any');

    expect(items).toHaveLength(20);
    expect(warnings).toEqual(['learnables: pagination stopped (repeated_token)']);
  });

  it('surfaces a 400 from the learnables endpoint as an HttpStatusError after a single request', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', LEARNABLES_PATH, { status: 400, setCookies: [], bodyText: '{}' });
    const { api } = createTestApi(transport);

    const error = await api.listLearnables(FIXTURE_PAIR_ID, 'any').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toMatchObject({ status: 400, label: 'learnables_page' });
    expect(transport.requests).toHaveLength(1);
  });

  it('lists completed scenarios across both offset pages with the web app query', async () => {
    const transport = fixtureTransport();
    const { api } = createTestApi(transport);

    const scenarios = await api.listScenarios(FIXTURE_PAIR_ID, 'completed');

    expect(scenarios.map((scenario) => scenario.id)).toEqual([2005, 2004, 2003, 2002, 2001, 2000]);
    const params = transport.requests.map((req) => new URL(req.url).searchParams);
    expect(params.map((p) => p.get('offset'))).toEqual(['0', '5']);
    for (const p of params) {
      expect(p.get('scenario_type')).toBe('completed');
      expect(p.get('free_only')).toBe('false');
      expect(p.get('has_immerse_content')).toBe('true');
      expect(p.get('limit')).toBe('20');
    }
    expect(transport.countFor(SCENARIOS_PATH)).toBe(2);
  });

  it('fetches one lesson details body by scenario id', async () => {
    const { api } = createTestApi(fixtureTransport());

    const details = await api.fetchScenarioDetails(1001);

    expect(details.scenarioId).toBe(1001);
    expect(details.completed).toBe(true);
    expect(details.learnables).toHaveLength(10);
  });

  it('maps a 404 for lesson details to NotFoundError', async () => {
    const transport = new RoutedTransport();
    routeFixtureApi(transport, { details: { 2005: { status: 404 } } });
    const { api } = createTestApi(transport);

    await expect(api.fetchScenarioDetails(2005)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('carries the lesson id on the NotFoundError', async () => {
    const transport = new RoutedTransport();
    routeFixtureApi(transport, { details: { 2005: { status: 404 } } });
    const { api } = createTestApi(transport);

    await expect(api.fetchScenarioDetails(2005)).rejects.toMatchObject({ label: 'scenario_details', id: 2005 });
  });
});
