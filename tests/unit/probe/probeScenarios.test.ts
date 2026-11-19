import { describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { probeScenarios } from '../../../scripts/probe/probeScenarios.js';
import { createFakeFetch, type FakeRoute } from './fakeTransport.js';

function run(route: FakeRoute) {
  const fake = createFakeFetch(route);
  const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });
  return { requests: fake.requests, findings: probeScenarios(http, 7) };
}

const scenarios = (count: number) => Array.from({ length: count }, (_, i) => ({ scenario_id: i }));

const route: FakeRoute = ({ url }) => {
  const type = url.searchParams.get('scenario_type');
  if (type === 'invalid_probe_value') return { status: 400, body: { scenario_type: ['allowed: a, b'] } };
  const immerse = url.searchParams.get('has_immerse_content');
  const total = immerse === 'false' ? 80 : immerse === 'true' ? 40 : 90;
  const limit = Number(url.searchParams.get('limit') ?? 0);
  return { body: { scenarios: scenarios(Math.min(limit, 50)), has_more_pages: true, total_number: total } };
};

describe('probeScenarios', () => {
  it('tries every scenario_type candidate, including omitted and invalid', async () => {
    const { findings, requests } = run(route);
    const result = await findings;

    expect(result.types.map((t) => t.type)).toEqual([
      'completed',
      'in_progress',
      'all',
      'learning',
      null,
      'invalid_probe_value',
    ]);
    expect(requests[0].url.pathname).toBe('/v1.25/me/language_pairs/7/scenarios/');
    expect(requests.some((r) => r.url.searchParams.get('free_only') === 'false')).toBe(true);
  });

  it('records status, count, total_number and paging flag; error body when rejected', async () => {
    const result = await run(route).findings;

    expect(result.types[0]).toEqual({ type: 'completed', status: 200, count: 5, total: 40, hasMore: true });
    expect(result.types.at(-1)).toEqual({
      type: 'invalid_probe_value',
      status: 400,
      errorBody: { scenario_type: ['allowed: a, b'] },
    });
  });

  it('compares total_number for has_immerse_content true, false and omitted on completed', async () => {
    const { findings, requests } = run(route);
    const result = await findings;

    expect(result.immerse).toEqual([
      { value: 'true', status: 200, total: 40 },
      { value: 'false', status: 200, total: 80 },
      { value: null, status: 200, total: 90 },
    ]);
    expect(requests.some((r) => r.url.searchParams.get('scenario_type') === 'completed' && !r.url.searchParams.has('has_immerse_content'))).toBe(true);
  });

  it('probes the widened limits and keeps the error body of rejected ones', async () => {
    const result = await run(({ url }) =>
      Number(url.searchParams.get('limit')) > 20
        ? { status: 400, body: { limit: ['Ensure this value is less than or equal to 20.'] } }
        : { body: { scenarios: scenarios(Number(url.searchParams.get('limit'))) } },
    ).findings;

    expect(result.limits.map((l) => l.limit)).toEqual([5, 6, 10, 20, 25, 30, 50]);
    expect(result.limits[3]).toEqual({ limit: 20, status: 200, count: 20 });
    expect(result.limits[4]).toEqual({ limit: 25, status: 400, errorBody: { limit: ['Ensure this value is less than or equal to 20.'] } });
  });

  it('keeps going when requests fail at the network level', async () => {
    const result = await run(() => ({ status: 0 })).findings;

    expect(result.types).toHaveLength(6);
    expect(result.types[0]).toMatchObject({ status: 0 });
    expect(result.immerse).toHaveLength(3);
    expect(result.limits).toHaveLength(7);
  });
});
