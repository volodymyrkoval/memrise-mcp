import { describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { probeUnlinked } from '../../../scripts/probe/probeUnlinked.js';
import { renderUnlinkedReport } from '../../../scripts/probe/renderUnlinked.js';
import { SCENARIOS_PAGE_SIZE } from '../../../src/api/memriseApi.js';
import { createFakeFetch, type FakeReply, type RecordedRequest } from './fakeTransport.js';

const NOW = Date.parse('2030-06-01T00:00:00Z');
const BASE = 9000000;
const PAST = '2020-01-01T00:00:00Z';
const FUTURE = '2040-01-01T00:00:00Z';

interface Item {
  id: number;
  learned?: boolean;
  known?: boolean;
  heard?: boolean;
  used?: boolean;
  excluded?: boolean;
  due?: boolean;
  growth?: number;
  review?: string | null;
  difficult?: boolean;
  audios?: string[];
  romanization?: string;
  nativeScript?: string;
}

const toLearnable = (item: Item) => ({
  learnable_id_key: BASE + item.id,
  learned: item.learned ?? false,
  known: item.known ?? false,
  heard: item.heard ?? false,
  used: item.used ?? false,
  excluded: item.excluded ?? false,
  due_for_review: item.due ?? false,
  growth_level: item.growth ?? 0,
  next_review: item.review ?? null,
  difficult: item.difficult ?? false,
  audios: item.audios ?? [],
  romanization: item.romanization ?? null,
  native_script: item.nativeScript ?? null,
});

const ITEMS: Item[] = [
  { id: 1, learned: true, growth: 3, review: FUTURE },
  { id: 2, learned: true, growth: 5, review: PAST, due: true },
  { id: 3, heard: true, review: PAST, due: true },
  { id: 4, difficult: true, audios: ['a.mp3'], romanization: 'roman' },
  { id: 5, known: true, heard: true, used: true, audios: ['b.mp3'], nativeScript: 'script' },
  { id: 6, learned: true, growth: 1, review: FUTURE },
];
const PAGES: Record<string, { items: Item[]; next?: string }> = {
  first: { items: ITEMS.slice(0, 3), next: 'two' },
  two: { items: ITEMS.slice(3) },
};
const DETAILS: Record<number, number[]> = { 1001: [1, 2], 1002: [2, 6], 777: [] };

interface Setup {
  completed?: number[];
  inProgress?: number[];
  detailStatus?: Record<number, number>;
  listingStatus?: Partial<Record<'completed' | 'in_progress', number>>;
  extra?: (request: RecordedRequest) => FakeReply | undefined;
}

function run(setup: Setup = {}) {
  const completed = setup.completed ?? [1001, 1002];
  const inProgress = setup.inProgress ?? [777];
  const route = (request: RecordedRequest): FakeReply => {
    const custom = setup.extra?.(request);
    if (custom !== undefined) return custom;
    const { url } = request;
    if (url.pathname.endsWith('/learnables/') && url.pathname.includes('/language_pairs/')) {
      const page = PAGES[url.searchParams.get('next_page_token') ?? 'first'];
      return { body: { learnables: page.items.map(toLearnable), ...(page.next ? { next_page_token: page.next } : {}) } };
    }
    if (url.pathname.endsWith('/scenarios/')) {
      const type = url.searchParams.get('scenario_type');
      if (type === 'completed' || type === 'in_progress') {
        const failing = setup.listingStatus?.[type];
        if (failing !== undefined) return { status: failing, body: { scenario_type: ['rejected'], detail: 'rejected' } };
        const all = type === 'completed' ? completed : inProgress;
        const offset = Number(url.searchParams.get('offset'));
        const limit = Number(url.searchParams.get('limit'));
        if (limit > SCENARIOS_PAGE_SIZE) return { status: 400, body: { scenario_type: ['page too big'] } };
        return {
          body: {
            scenarios: all.slice(offset, offset + limit).map((scenario_id) => ({ scenario_id })),
            has_more_pages: offset + limit < all.length,
          },
        };
      }
      const flag = url.searchParams.get('has_immerse_content');
      return { body: { scenarios: [], total_number: flag === 'true' ? 4 : 9 } };
    }
    const detail = url.pathname.match(/scenarios\/(\d+)\/details/);
    if (detail !== null) {
      const id = Number(detail[1]);
      const status = setup.detailStatus?.[id];
      if (status !== undefined) return { status, body: {} };
      return { body: { learnables: (DETAILS[id] ?? [1]).map((n) => ({ learnable_id: BASE + n })) } };
    }
    if (url.pathname.startsWith('/v1.25/me/learnables/')) return { status: 404, body: { detail: 'not found' } };
    if (url.pathname.startsWith('/v1.25/learnables/')) {
      const id = url.pathname.split('/')[3];
      return { body: { learnables: { [id]: { learned: false, known: true, difficult: false, growth_level: 0, target_value: 'apple', extra_key: true } } } };
    }
    return { status: 404 };
  };
  const fake = createFakeFetch(route);
  const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });
  return { requests: fake.requests, http, findings: probeUnlinked(http, 7, { now: () => NOW }) };
}

describe('probeUnlinked', () => {
  it('counts the words no lesson teaches, and the ones that are linked', async () => {
    const { findings } = run();

    expect(await findings).toMatchObject({
      walk: { pages: 2, items: 6 },
      lessons: { listed: 3, fetched: 3, failed: 0, capped: false },
      unlinked: { total: 3 },
      linked: { total: 3 },
    });
  });

  it('cross-tabs the raw flags for unlinked against linked words', async () => {
    const { unlinked, linked } = await run().findings;

    expect(unlinked).toEqual({
      total: 3, learned: 0, known: 1, heard: 2, used: 1, excluded: 0, difficult: 1, dueForReview: 1, growthZero: 3, reviewInPast: 1,
      audiosNonEmpty: 2, withRomanization: 1, withNativeScript: 1,
    });
    expect(linked).toEqual({
      total: 3, learned: 3, known: 0, heard: 0, used: 0, excluded: 0, difficult: 0, dueForReview: 1, growthZero: 0, reviewInPast: 1,
      audiosNonEmpty: 0, withRomanization: 0, withNativeScript: 0,
    });
  });

  it('records the key set of an unlinked item and never its values', async () => {
    const { unlinkedShape } = await run().findings;

    expect(unlinkedShape).toContain('learnable_id_key: number');
    expect(unlinkedShape).toContain('heard: boolean');
    expect(unlinkedShape).not.toContain('900000');
  });

  it('sends only GET requests', async () => {
    const { requests, findings } = run();
    await findings;

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('fetches the details of completed and in-progress lessons only', async () => {
    const { requests, findings } = run();
    await findings;

    const detailPaths = requests.map((r) => r.url.pathname).filter((path) => path.includes('/details/'));
    expect(detailPaths.sort()).toEqual([
      '/v1.25/me/scenarios/1001/details/',
      '/v1.25/me/scenarios/1002/details/',
      '/v1.25/me/scenarios/777/details/',
    ]);
  });

  it('lists lessons with the same request the production client sends', async () => {
    const { requests, findings } = run();
    await findings;

    const listing = requests.filter((r) => ['completed', 'in_progress'].includes(r.url.searchParams.get('scenario_type') ?? ''));
    expect(listing.length).toBeGreaterThan(0);
    for (const request of listing) {
      expect(Object.fromEntries(request.url.searchParams)).toEqual({
        scenario_type: request.url.searchParams.get('scenario_type'),
        free_only: 'false',
        has_immerse_content: 'true',
        limit: String(SCENARIOS_PAGE_SIZE),
        offset: expect.stringMatching(/^\d+$/),
      });
    }
  });

  it('stops at 200 lesson-detail fetches and says the unlinked count is then an upper bound', async () => {
    const completed = Array.from({ length: 230 }, (_, i) => 5000 + i);
    const { requests, findings } = run({ completed });

    const result = await findings;

    expect(requests.filter((r) => r.url.pathname.includes('/details/'))).toHaveLength(200);
    expect(result.lessons).toMatchObject({ listed: 231, fetched: 200, capped: true });
    expect(renderUnlinkedReport(result)).toContain('upper bound');
  });

  it('counts a lesson whose details fail, without stopping', async () => {
    const result = await run({ detailStatus: { 1002: 500 } }).findings;

    expect(result.lessons).toMatchObject({ listed: 3, fetched: 2, failed: 1 });
    expect(result.unlinked.total).toBe(4);
  });

  it('asks the candidate scenario lists with and without immerse content and records the totals', async () => {
    const { requests, findings } = run();
    const result = await findings;

    const asked = requests
      .filter((r) => r.url.pathname.endsWith('/scenarios/') && !['completed', 'in_progress'].includes(r.url.searchParams.get('scenario_type') ?? ''))
      .map((r) => `${r.url.searchParams.get('scenario_type')}:${r.url.searchParams.get('has_immerse_content')}`);
    expect(asked.sort()).toEqual(
      ['all', 'immerse', 'media', 'video'].flatMap((type) => [`${type}:false`, `${type}:true`]).sort(),
    );
    const immerse = result.candidates.filter((c) => c.label.startsWith('scenarios immerse'));
    expect(immerse.map((c) => c.total)).toEqual([4, 9]);
  });

  it('tries the single-learnable endpoints for at most three unlinked words, recording status and shape', async () => {
    const { requests, findings } = run();
    const result = await findings;

    const single = requests.map((r) => r.url.pathname).filter((p) => /\/learnables\/\d+\/$/.test(p) && !p.includes('language_pairs'));
    expect(single).toHaveLength(6);
    const own = result.candidates.filter((c) => c.label.startsWith('me learnable'));
    expect(own).toHaveLength(3);
    expect(own[0]).toMatchObject({ status: 404 });
    const open = result.candidates.filter((c) => c.label.startsWith('learnable '));
    expect(open[0]).toMatchObject({ status: 200, shape: '{ learnables: object{<id-key> x 1} }' });
  });

  it('says how many unlinked ids a response contains, as counts', async () => {
    const extra = (request: RecordedRequest): FakeReply | undefined =>
      request.url.searchParams.get('scenario_type') === 'media' && request.url.searchParams.get('has_immerse_content') === 'true'
        ? { body: { learnables: [{ learnable_id: BASE + 3 }, { learnable_id: BASE + 4 }, { learnable_id: BASE + 1 }] } }
        : undefined;

    const result = await run({ extra }).findings;

    const media = result.candidates.find((c) => c.label === 'scenarios media immerse=true');
    expect(media?.unlinkedIdsContained).toEqual({ matched: 2, of: 3 });
  });
});

describe('renderUnlinkedReport', () => {
  it('shows counts and shapes but no learnable id, token or value', async () => {
    const report = renderUnlinkedReport(await run().findings);

    expect(report).toContain('# Unlinked words probe');
    expect(report).toContain('Unlinked words: 3');
    expect(report).toContain('contains 0 of 3 unlinked ids');
    expect(report).not.toMatch(/90000\d\d/);
    expect(report).not.toContain('apple');
  });
});

describe('renderUnlinkedReport validity', () => {
  const INVALID = 'INVALID RUN';

  it('prints the comparison and no warning when every listing page and detail fetch succeeded', async () => {
    const report = renderUnlinkedReport(await run().findings);

    expect(report).not.toContain(INVALID);
    expect(report).toContain('| Flag | Unlinked | Linked |');
  });

  it('fails loudly when a lesson listing is rejected, naming status, type and the key names of the answer, and drops the comparison', async () => {
    const result = await run({ listingStatus: { completed: 400 } }).findings;
    const report = renderUnlinkedReport(result);

    expect(result.lessons.listing).toContainEqual(expect.objectContaining({ type: 'completed', failedStatus: 400 }));
    expect(report).toContain('INVALID RUN: lesson listing failed (HTTP 400 on completed); the comparison below cannot be trusted');
    expect(report).toContain('scenario_type: array[1] of string');
    expect(report).not.toContain('| Flag | Unlinked | Linked |');
    expect(report).not.toMatch(/Unlinked words: \d/);
    expect(report).not.toMatch(/contains \d+ of \d+ unlinked ids/);
  });

  it('names every failing lesson type', async () => {
    const report = renderUnlinkedReport(await run({ listingStatus: { completed: 400, in_progress: 500 } }).findings);

    expect(report).toContain('HTTP 400 on completed, HTTP 500 on in_progress');
  });

  it('fails loudly when listing succeeds but finds no lessons', async () => {
    const report = renderUnlinkedReport(await run({ completed: [], inProgress: [] }).findings);

    expect(report).toContain('INVALID RUN: lesson listing returned 0 lessons; the comparison below cannot be trusted');
    expect(report).not.toContain('| Flag | Unlinked | Linked |');
  });

  it('fails loudly when some lesson details failed, saying how many', async () => {
    const report = renderUnlinkedReport(await run({ detailStatus: { 1002: 500 } }).findings);

    expect(report).toContain('INVALID RUN: 1 of 3 lesson detail fetches failed; the comparison below cannot be trusted');
    expect(report).not.toContain('| Flag | Unlinked | Linked |');
  });
});

describe('renderUnlinkedReport details', () => {
  it('tells which flag fields a single-learnable lookup carries, by key name only', async () => {
    const report = renderUnlinkedReport(await run().findings);

    expect(report).toContain('## Single-learnable lookup');
    expect(report).toContain('has learned, known, difficult, growth_level; lacks next_review');
    expect(report).toContain('fields: learned, known, difficult, growth_level, target_value, extra_key');
    expect(report).not.toMatch(/\d{8}/);
  });

  it('shows growth, flag and media facts of unlinked against linked words', async () => {
    const report = renderUnlinkedReport(await run().findings);

    expect(report).toContain('| difficult | 1 of 3 | 0 of 3 |');
    expect(report).toContain('| audios non-empty | 2 of 3 | 0 of 3 |');
    expect(report).toContain('| romanization present | 1 of 3 | 0 of 3 |');
    expect(report).toContain('| native_script present | 1 of 3 | 0 of 3 |');
  });
});
