import { describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { probeStates } from '../../../scripts/probe/probeStates.js';
import { createFakeFetch, type FakeRoute } from './fakeTransport.js';

function run(route: FakeRoute) {
  const fake = createFakeFetch(route);
  const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });
  return { requests: fake.requests, findings: probeStates(http, 7) };
}

const items = (count: number) => Array.from({ length: count }, (_, i) => ({ learnable_id_key: i }));

const route: FakeRoute = ({ url }) => {
  const state = url.searchParams.get('learning_state');
  if (state === 'INVALID_PROBE_VALUE') return { status: 400, body: { learning_state: ['allowed: A, B'] } };
  if (state === 'SEEN') return { status: 200, body: { learnables: items(3), next_page_token: 'tok' } };
  return { status: 200, body: { learnables: items(Number(url.searchParams.get('page_size') ?? 0) > 50 ? 7 : 2) } };
};

describe('probeStates', () => {
  it('tries every candidate state, including omitted and an invalid value', async () => {
    const { findings, requests } = run(route);
    const result = await findings;

    expect(result.states.map((s) => s.state)).toEqual([
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
    ]);
    const omitted = requests.find((r) => r.url.pathname.endsWith('/learnables/') && !r.url.searchParams.has('learning_state'));
    expect(omitted).toBeDefined();
    expect(requests[0].url.pathname).toBe('/v1.25/me/language_pairs/7/learnables/');
  });

  it('records status and first-page count for accepted states', async () => {
    const result = await run(route).findings;

    expect(result.states.find((s) => s.state === 'SEEN')).toEqual({ state: 'SEEN', status: 200, count: 3, hasNextPage: true });
    expect(result.states.find((s) => s.state === 'LEARNING')).toMatchObject({ status: 200, count: 2, hasNextPage: false });
  });

  it('records the error body for rejected states', async () => {
    const result = await run(route).findings;

    expect(result.states.find((s) => s.state === 'INVALID_PROBE_VALUE')).toEqual({
      state: 'INVALID_PROBE_VALUE',
      status: 400,
      errorBody: { learning_state: ['allowed: A, B'] },
    });
  });

  it('probes the widened page sizes with the known-good state and keeps the error body of rejected ones', async () => {
    const { findings, requests } = run(({ url }) => {
      const size = Number(url.searchParams.get('page_size'));
      if (url.searchParams.get('learning_state') === 'FULLY_LEARNED_OR_KNOWN' && size > 50) {
        return { status: 400, body: { page_size: ['Ensure this value is less than or equal to 50.'] } };
      }
      return { body: { learnables: items(size > 50 ? 7 : 2) } };
    });
    const result = await findings;

    expect(result.pageSizes.map((p) => p.pageSize)).toEqual([10, 20, 25, 30, 40, 50, 51, 60, 75, 100]);
    expect(result.pageSizes.find((p) => p.pageSize === 50)).toEqual({ pageSize: 50, status: 200, count: 2 });
    expect(result.pageSizes.find((p) => p.pageSize === 51)).toEqual({
      pageSize: 51,
      status: 400,
      errorBody: { page_size: ['Ensure this value is less than or equal to 50.'] },
    });
    expect(requests.at(-1)?.url.searchParams.get('learning_state')).toBe('FULLY_LEARNED_OR_KNOWN');
  });

  it('keeps going when a request fails at the network level', async () => {
    const result = await run(() => ({ status: 0 })).findings;

    expect(result.states).toHaveLength(24);
    expect(result.states[0]).toMatchObject({ status: 0 });
  });
});
