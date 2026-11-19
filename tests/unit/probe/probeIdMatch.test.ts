import { describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { probeIdMatch } from '../../../scripts/probe/probeIdMatch.js';
import { createFakeFetch, type FakeRoute } from './fakeTransport.js';

function run(route: FakeRoute) {
  const fake = createFakeFetch(route);
  const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });
  return { requests: fake.requests, findings: probeIdMatch(http, 7, 'FULLY_LEARNED_OR_KNOWN') };
}

const learnables = (ids: number[]) =>
  ids.map((learnable_id_key) => ({ learnable_id_key, learned: learnable_id_key <= 4, known: learnable_id_key === 6, heard: false, used: false, difficult: learnable_id_key === 1 }));
const detail = (ids: number[]) => ({ learnables: ids.map((learnable_id) => ({ learnable_id })) });

const PAGES: Record<string, { ids: number[]; next?: string }> = {
  first: { ids: [1, 2, 3], next: 'a' },
  a: { ids: [4, 5], next: 'b' },
  b: { ids: [6] },
};

function routeWith(
  overrides: Partial<{ inProgress: unknown; completed: unknown; d1001: unknown; dIp: unknown; pages: typeof PAGES; detailsById: Record<number, unknown> }> = {},
): FakeRoute {
  const pages = overrides.pages ?? PAGES;
  return ({ url }) => {
    if (url.pathname.endsWith('/learnables/')) {
      const page = pages[url.searchParams.get('next_page_token') ?? 'first'];
      return { body: { learnables: learnables(page.ids), ...(page.next ? { next_page_token: page.next } : {}) } };
    }
    if (url.pathname.endsWith('/scenarios/')) {
      if (url.searchParams.get('scenario_type') === 'completed') {
        const offset = Number(url.searchParams.get('offset'));
        return { body: overrides.completed ?? { scenarios: offset === 0 ? [{ scenario_id: 1001 }] : [], has_more_pages: false } };
      }
      return { body: overrides.inProgress ?? { scenarios: [{ scenario_id: 777 }, { scenario_id: 778 }] } };
    }
    const byId = overrides.detailsById?.[Number(url.pathname.match(/scenarios\/(\d+)\/details/)?.[1])];
    if (byId !== undefined) return { body: byId };
    if (url.pathname === '/v1.25/me/scenarios/1001/details/') return { body: overrides.d1001 ?? detail([1, 2, 99]) };
    if (url.pathname === '/v1.25/me/scenarios/777/details/') return { body: overrides.dIp ?? detail([2, 5]) };
    return { status: 404 };
  };
}

describe('probeIdMatch', () => {
  it('walks every learnables page until no next_page_token is left', async () => {
    const { findings, requests } = run(routeWith());
    const result = await findings;

    expect(result.walk).toEqual({ pages: 3, total: 6, repeatedToken: false, stoppedBy: 'end' });
    const walked = requests.filter(
      (r) => r.url.pathname.endsWith('/learnables/') && r.url.searchParams.get('learning_state') === 'FULLY_LEARNED_OR_KNOWN',
    );
    expect(walked.map((r) => r.url.searchParams.get('next_page_token'))).toEqual([null, 'a', 'b']);
    expect(walked[0].url.searchParams.get('learning_state')).toBe('FULLY_LEARNED_OR_KNOWN');
  });

  it('counts items with each state flag true across the whole walk', async () => {
    const result = await run(routeWith()).findings;

    expect(result.flagCounts).toEqual({ learned: 4, known: 1, heard: 0, used: 0, difficult: 1, excluded: 0 });
  });

  it('stops and records when a returned token was already seen, including the requesting one', async () => {
    const pages = { first: { ids: [1], next: 'a' }, a: { ids: [2], next: 'a' } };
    const result = await run(routeWith({ pages })).findings;

    expect(result.walk).toEqual({ pages: 2, total: 2, repeatedToken: true, repeatedAtPage: 2, stoppedBy: 'repeat' });
  });

  it('stops when a page request fails', async () => {
    const result = await run(({ url }) => (url.pathname.endsWith('/learnables/') ? { status: 500 } : { status: 404 })).findings;

    expect(result.walk).toMatchObject({ pages: 0, total: 0, stoppedBy: 'error' });
  });

  it('fetches details for 1001 and the first in-progress scenario and intersects ids with the list', async () => {
    const result = await run(routeWith()).findings;

    expect(result.inProgressScenarioId).toBe(777);
    expect(result.details).toEqual([
      { scenarioId: 1001, status: 200, detailIds: 3, matched: 2, unmatched: 1 },
      { scenarioId: 777, status: 200, detailIds: 2, matched: 2, unmatched: 0 },
    ]);
    expect(result.sharedDetailIds).toEqual([2]);
  });

  it('also fetches details for up to 8 completed scenarios over two pages and reports ids shared by at least two', async () => {
    const pageOf = (ids: number[], hasMore: boolean) => ({ scenarios: ids.map((scenario_id) => ({ scenario_id })), has_more_pages: hasMore });
    const completed = (offset: number) =>
      offset === 0 ? pageOf([201, 202, 203, 204, 205], true) : pageOf([206, 207, 208, 209, 210], false);
    const detailsById: Record<number, unknown> = { 201: detail([6, 10]), 202: detail([6, 11]) };
    const base = routeWith({ inProgress: { scenarios: [] }, detailsById });
    const { findings, requests } = run((request) =>
      request.url.searchParams.get('scenario_type') === 'completed'
        ? { body: completed(Number(request.url.searchParams.get('offset'))) }
        : /\/scenarios\/20\d\/details\/$/.test(request.url.pathname) && !(Number(request.url.pathname.match(/(\d+)\/details/)?.[1]) in detailsById)
          ? { body: detail([Number(request.url.pathname.match(/(\d+)\/details/)?.[1])]) }
          : base(request),
    );
    const result = await findings;

    expect(result.details.map((d) => d.scenarioId)).toEqual([1001, 201, 202, 203, 204, 205, 206, 207, 208]);
    expect(result.sharedDetailIds).toEqual([6]);
    expect(result.details[1]).toEqual({ scenarioId: 201, status: 200, detailIds: 2, matched: 1, unmatched: 1 });
    const lists = requests.filter((r) => r.url.pathname.endsWith('/scenarios/') && r.url.searchParams.get('scenario_type') === 'completed');
    expect(lists.map((r) => r.url.searchParams.get('offset'))).toEqual(['0', '5']);
  });

  it('skips the in-progress details when no in-progress scenario exists', async () => {
    const result = await run(routeWith({ inProgress: { scenarios: [] } })).findings;

    expect(result.inProgressScenarioId).toBeUndefined();
    expect(result.details.map((d) => d.scenarioId)).toEqual([1001]);
  });

  it('records a failed details request without intersecting', async () => {
    const route = routeWith();
    const result = await run((req) => (req.url.pathname.includes('/1001/') ? { status: 404 } : route(req))).findings;

    expect(result.details[0]).toEqual({ scenarioId: 1001, status: 404, detailIds: 0, matched: 0, unmatched: 0 });
  });

  describe('ANY walk', () => {
    const anyPages: typeof PAGES = {
      first: { ids: [1, 2, 3, 7], next: 'a' },
      a: { ids: [4, 5, 8], next: 'b' },
      b: { ids: [6] },
    };
    const routeWithAny = (anyOverride: typeof PAGES = anyPages): FakeRoute => {
      const base = routeWith();
      const anyRoute = routeWith({ pages: anyOverride });
      return (request) =>
        request.url.searchParams.get('learning_state') === 'ANY' ? anyRoute(request) : base(request);
    };

    it('walks learning_state=ANY with page_size 50 and compares its ids with the chosen state', async () => {
      const { findings, requests } = run(routeWithAny());
      const result = await findings;

      expect(result.anyWalk).toMatchObject({
        walk: { pages: 3, total: 8, repeatedToken: false, stoppedBy: 'end' },
        chosenTotal: 6,
        onlyInAny: 2,
        onlyInChosen: 0,
        strictSuperset: true,
      });
      const anyRequests = requests.filter((r) => r.url.searchParams.get('learning_state') === 'ANY');
      expect(anyRequests.map((r) => r.url.searchParams.get('page_size'))).toEqual(['50', '50', '50']);
    });

    it('counts flags across the ANY walk', async () => {
      const result = await run(routeWithAny()).findings;

      expect(result.anyWalk?.flagCounts).toEqual({ learned: 4, known: 1, heard: 0, used: 0, difficult: 1, excluded: 0 });
    });

    it('is not a strict superset when the chosen state has ids ANY lacks, or the sets are equal', async () => {
      const missing = await run(routeWithAny({ first: { ids: [1, 2, 3, 7] } })).findings;
      const equal = await run(routeWithAny(PAGES)).findings;

      expect(missing.anyWalk).toMatchObject({ onlyInAny: 1, onlyInChosen: 3, strictSuperset: false });
      expect(equal.anyWalk).toMatchObject({ onlyInAny: 0, onlyInChosen: 0, strictSuperset: false });
    });

    it('is skipped when the chosen state is already ANY', async () => {
      const fake = createFakeFetch(routeWith());
      const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });

      expect((await probeIdMatch(http, 7, 'ANY')).anyWalk).toBeUndefined();
    });
  });
});
