import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '../../../src/http/transport.js';
import { FIXTURE_PAIR_ID, routeFixtureApi, syntheticDetails } from '../../helpers/fixtureApi.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';

const BASE = 'https://app.memrise.com';
const PAIR_PATH = `/v1.25/me/language_pairs/${FIXTURE_PAIR_ID}`;

function createApi(options = {}) {
  const transport = new RoutedTransport();
  routeFixtureApi(transport, options);
  return transport;
}

async function get(transport: RoutedTransport, path: string, query: Record<string, string> = {}): Promise<HttpResponse> {
  const url = `${BASE}${path}?${new URLSearchParams(query).toString()}`;
  return transport.send({ method: 'GET', url, headers: {} });
}

function jsonOf(res: HttpResponse): unknown {
  return JSON.parse(res.bodyText);
}

describe('routeFixtureApi', () => {
  it('serves the language-pairs fixture', async () => {
    const res = await get(createApi(), '/v1.25/me/language_pairs/');

    expect(res.status).toBe(200);
    expect(jsonOf(res)).toEqual(loadFixture('language-pairs.json'));
  });

  it('serves the three learnables fixtures by next_page_token, starting with no token', async () => {
    const transport = createApi();
    const query = { learning_state: 'ANY' };

    expect(jsonOf(await get(transport, `${PAIR_PATH}/learnables/`, query))).toEqual(
      loadFixture('learnables-page-1.json'),
    );
    expect(jsonOf(await get(transport, `${PAIR_PATH}/learnables/`, { ...query, next_page_token: '<page-token-1>' }))).toEqual(
      loadFixture('learnables-page-2.json'),
    );
    expect(jsonOf(await get(transport, `${PAIR_PATH}/learnables/`, { ...query, next_page_token: '<page-token-2>' }))).toEqual(
      loadFixture('learnables-page-last.json'),
    );
  });

  it('answers a learnables request with an unknown learning_state as the real 400 body', async () => {
    const res = await get(createApi(), `${PAIR_PATH}/learnables/`, { learning_state: 'LEARNING' });

    expect(res.status).toBe(400);
    expect(jsonOf(res)).toEqual(loadFixture('learnables-invalid-state.json'));
  });

  it('serves the completed scenario pages by offset and the empty in-progress list', async () => {
    const transport = createApi();

    expect(jsonOf(await get(transport, `${PAIR_PATH}/scenarios/`, { scenario_type: 'completed', offset: '0' }))).toEqual(
      loadFixture('scenarios-completed-page-1.json'),
    );
    expect(jsonOf(await get(transport, `${PAIR_PATH}/scenarios/`, { scenario_type: 'completed', offset: '5' }))).toEqual(
      loadFixture('scenarios-completed-page-last.json'),
    );
    expect(jsonOf(await get(transport, `${PAIR_PATH}/scenarios/`, { scenario_type: 'in_progress', offset: '0' }))).toEqual(
      loadFixture('scenarios-in-progress.json'),
    );
  });

  it('serves the 1001 details fixture for that id', async () => {
    const res = await get(createApi(), '/v1.25/me/scenarios/1001/details/');

    expect(res.status).toBe(200);
    expect(jsonOf(res)).toEqual(loadFixture('scenario-details-1001.json'));
  });

  it('serves a synthetic completed details body for any other scenario id', async () => {
    const res = await get(createApi(), '/v1.25/me/scenarios/2005/details/');

    expect(jsonOf(res)).toEqual(syntheticDetails([]));
  });

  it('serves a details override status and body instead of the default', async () => {
    const transport = createApi({ details: { 2005: { status: 503 } } });

    expect((await get(transport, '/v1.25/me/scenarios/2005/details/')).status).toBe(503);
  });

  it('answers 404 for a route it does not know', async () => {
    const res = await get(createApi(), '/v1.25/me/unknown/');

    expect(res.status).toBe(404);
  });
});

describe('syntheticDetails', () => {
  it('builds details items from learnables-page-1 entries, one per requested id', () => {
    const body = syntheticDetails([65500000065536]) as {
      learnables: Array<{ learnable_id: number; target_value: string }>;
      completed: boolean;
    };

    expect(body.completed).toBe(true);
    expect(body.learnables).toHaveLength(1);
    expect(body.learnables[0]).toMatchObject({ learnable_id: 65500000065536, target_value: 'the book' });
  });

  it('refuses an id that is not in learnables-page-1', () => {
    expect(() => syntheticDetails([1])).toThrow('learnables-page-1');
  });
});
