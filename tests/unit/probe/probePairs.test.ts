import { describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { probePairs } from '../../../scripts/probe/probePairs.js';
import { createFakeFetch, type FakeRoute } from './fakeTransport.js';

function run(route: FakeRoute) {
  const fake = createFakeFetch(route);
  const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });
  return { requests: fake.requests, findings: probePairs(http) };
}

describe('probePairs', () => {
  it('tries the six candidate paths in order, records which list pairs, and summarizes every response shape', async () => {
    const { findings, requests } = run(({ url }) =>
      url.pathname === '/v1.25/me/language_pairs/'
        ? { body: { language_pairs: [{ id: 7, name: 'Alpha to Beta' }] } }
        : { status: 404 },
    );

    const result = await findings;
    expect(result.map(({ path, status, listsPairs }) => ({ path, status, listsPairs }))).toEqual([
      { path: '/v1.25/me/language_pairs/', status: 200, listsPairs: true },
      { path: '/v1.25/me/language_pairs', status: 404, listsPairs: false },
      { path: '/v1.25/me/', status: 404, listsPairs: false },
      { path: '/v1.25/language_pairs/', status: 404, listsPairs: false },
      { path: '/v1.25/me/courses/', status: 404, listsPairs: false },
      { path: '/v1.25/me/languages/', status: 404, listsPairs: false },
    ]);
    expect(result[0]).toMatchObject({ pairs: [{ id: 7, name: 'Alpha to Beta' }], shape: '{ language_pairs: array[1] of {id, name} }' });
    expect(result[1].shape).toBe('{}');
    expect(requests.map((r) => r.url.pathname)).toEqual(result.map((r) => r.path));
  });

  it('accepts alternative id keys with a title or label', async () => {
    const result = await run(({ url }) =>
      url.pathname === '/v1.25/me/language_pairs/'
        ? { body: { items: [{ language_pair_id: 4, title: 'PT course' }] } }
        : url.pathname === '/v1.25/me/language_pairs'
          ? { body: [{ pair_id: 5, label: 'ES course' }] }
          : { status: 404 },
    ).findings;

    expect(result[0].pairs).toEqual([{ id: 4, name: 'PT course' }]);
    expect(result[1].pairs).toEqual([{ id: 5, name: 'ES course' }]);
  });

  it('builds the name from source and target language names when there is no name key', async () => {
    const result = await run(({ url }) =>
      url.pathname === '/v1.25/me/language_pairs/'
        ? { body: { pairs: [{ id: 7, source_language: { name: 'Alpha' }, target_language: { name: 'Beta' } }] } }
        : url.pathname === '/v1.25/me/language_pairs'
          ? { body: { pairs: [{ id: 53, source_language_name: 'Alpha', target_language_name: 'Gamma' }] } }
          : { status: 404 },
    ).findings;

    expect(result[0].pairs).toEqual([{ id: 7, name: 'Alpha to Beta' }]);
    expect(result[1].pairs).toEqual([{ id: 53, name: 'Alpha to Gamma' }]);
  });

  it('finds pairs nested in a profile object or returned as a bare array', async () => {
    const result = await run(({ url }) =>
      url.pathname === '/v1.25/me/'
        ? { body: { user: { language_pairs: [{ id: 3, name: 'A' }] } } }
        : { body: [{ id: 9, name: 'B' }] },
    ).findings;

    expect(result[0].pairs).toEqual([{ id: 9, name: 'B' }]);
    expect(result[2].pairs).toEqual([{ id: 3, name: 'A' }]);
  });

  it('does not count a 200 without id+name entries as listing pairs', async () => {
    const result = await run(() => ({ body: { learnables: [{ foo: 1 }] } })).findings;

    expect(result.every((r) => !r.listsPairs && r.status === 200)).toBe(true);
  });
});
