import { describe, expect, it } from 'vitest';
import { collectOffsetPages, type OffsetPage } from '../../../src/api/pagination.js';
import { parseScenariosPage } from '../../../src/api/schemas.js';
import { loadFixture } from '../../helpers/fixtures.js';

/** Hard ceiling so a pagination bug fails the test instead of spinning forever. */
const MAX_TEST_REQUESTS = 50;

/** Serves scripted pages by offset and records each requested offset; an unscripted offset fails loudly. */
function scriptedOffsets<T>(script: Map<number, OffsetPage<T>>) {
  const requestedOffsets: number[] = [];
  const fetchPage = async (offset: number): Promise<OffsetPage<T>> => {
    requestedOffsets.push(offset);
    if (requestedOffsets.length > MAX_TEST_REQUESTS) throw new Error('runaway pagination');
    const page = script.get(offset);
    if (page === undefined) throw new Error(`unscripted offset: ${offset}`);
    return page;
  };
  return { fetchPage, requestedOffsets };
}

/** Which real scenarios fixture answers each offset; the completed list has two pages. */
const FIXTURE_BY_OFFSET = new Map<number, string>([
  [0, 'scenarios-completed-page-1.json'],
  [5, 'scenarios-completed-page-last.json'],
]);

async function fetchCompletedScenariosPage(offset: number) {
  const fixture = FIXTURE_BY_OFFSET.get(offset);
  if (fixture === undefined) throw new Error(`unexpected offset: ${offset}`);
  return parseScenariosPage(loadFixture(fixture));
}

describe('collectOffsetPages', () => {
  it('follows offsets across the completed scenario pages and returns every scenario once', async () => {
    const scenarios = await collectOffsetPages(fetchCompletedScenariosPage);

    expect(scenarios.map((scenario) => scenario.id)).toEqual([2005, 2004, 2003, 2002, 2001, 2000]);
  });

  it('stops after an empty page even when the server still says hasMore', async () => {
    const { fetchPage, requestedOffsets } = scriptedOffsets(new Map([[0, { items: [], hasMore: true }]]));

    const items = await collectOffsetPages(fetchPage);

    expect(items).toEqual([]);
    expect(requestedOffsets).toEqual([0]);
  });

  it('advances by the five items a short first page actually returned', async () => {
    const { fetchPage, requestedOffsets } = scriptedOffsets(
      new Map([
        [0, { items: ['a', 'b', 'c', 'd', 'e'], hasMore: true }],
        [5, { items: ['f'], hasMore: false }],
      ]),
    );

    const items = await collectOffsetPages(fetchPage);

    expect(requestedOffsets).toEqual([0, 5]);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('ignores total_number for control flow and keeps paging while hasMore is true', async () => {
    const firstPage = structuredClone(loadFixture<Record<string, unknown>>('scenarios-completed-page-1.json'));
    firstPage.total_number = 0;
    const { fetchPage, requestedOffsets } = scriptedOffsets(
      new Map([
        [0, parseScenariosPage(firstPage)],
        [5, parseScenariosPage(loadFixture('scenarios-completed-page-last.json'))],
      ]),
    );

    const scenarios = await collectOffsetPages(fetchPage);

    expect(requestedOffsets).toEqual([0, 5]);
    expect(scenarios).toHaveLength(6);
  });

  it('returns no scenarios after a single request when the first page is empty', async () => {
    const { fetchPage, requestedOffsets } = scriptedOffsets(
      new Map([[0, parseScenariosPage(loadFixture('scenarios-in-progress.json'))]]),
    );

    const scenarios = await collectOffsetPages(fetchPage);

    expect(scenarios).toEqual([]);
    expect(requestedOffsets).toEqual([0]);
  });
});
