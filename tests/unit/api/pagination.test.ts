import { describe, expect, it } from 'vitest';
import { collectTokenPages } from '../../../src/api/pagination.js';
import { parseLearnablesPage } from '../../../src/api/schemas.js';
import { loadFixture } from '../../helpers/fixtures.js';

/** Which real learnables fixture answers each request token; `null` is the first request. */
const FIXTURE_BY_TOKEN = new Map<string | null, string>([
  [null, 'learnables-page-1.json'],
  ['<page-token-1>', 'learnables-page-2.json'],
  ['<page-token-2>', 'learnables-page-last.json'],
]);

async function fetchLearnablesFixturePage(token: string | null) {
  const fixture = FIXTURE_BY_TOKEN.get(token);
  if (fixture === undefined) throw new Error(`unexpected page token: ${String(token)}`);
  return parseLearnablesPage(loadFixture(fixture));
}

describe('collectTokenPages', () => {
  it('follows next-page tokens from the first page to the last and returns every item in order', async () => {
    const items = await collectTokenPages(fetchLearnablesFixturePage);

    expect(items).toHaveLength(30);
    expect(items[0].id).toBe(65500000065536);
    expect(items[10].id).toBe(65510000065536);
    expect(items[20].id).toBe(65520000065536);
    expect(items[29].id).toBe(65520000655360);
  });
});

/** Hard ceiling so a pagination bug fails the test instead of spinning forever. */
const MAX_TEST_REQUESTS = 50;

interface ScriptedPage {
  items: string[];
  nextPageToken: string | null;
}

/** Serves scripted pages by request token and records each request; an unscripted token fails loudly. */
function scriptedPages(script: Map<string | null, ScriptedPage>) {
  const requestedTokens: Array<string | null> = [];
  const fetchPage = async (token: string | null): Promise<ScriptedPage> => {
    requestedTokens.push(token);
    if (requestedTokens.length > MAX_TEST_REQUESTS) throw new Error('runaway pagination');
    const page = script.get(token);
    if (page === undefined) throw new Error(`unscripted token: ${String(token)}`);
    return page;
  };
  return { fetchPage, requestedTokens };
}

describe('collectTokenPages stop conditions', () => {
  it('stops when a page hands back the token it was just requested with, and reports repeated_token', async () => {
    const { fetchPage } = scriptedPages(
      new Map([
        [null, { items: ['a1'], nextPageToken: 'A' }],
        ['A', { items: ['a2'], nextPageToken: 'A' }],
      ]),
    );
    const stops: string[] = [];

    const items = await collectTokenPages(fetchPage, { onStop: (reason) => stops.push(reason) });

    expect(items).toEqual(['a1', 'a2']);
    expect(stops).toEqual(['repeated_token']);
  });

  it('stops when a longer cycle returns to an earlier token (A to B to A)', async () => {
    const { fetchPage, requestedTokens } = scriptedPages(
      new Map([
        [null, { items: ['a1'], nextPageToken: 'A' }],
        ['A', { items: ['a2'], nextPageToken: 'B' }],
        ['B', { items: ['a3'], nextPageToken: 'A' }],
      ]),
    );
    const stops: string[] = [];

    const items = await collectTokenPages(fetchPage, { onStop: (reason) => stops.push(reason) });

    expect(items).toEqual(['a1', 'a2', 'a3']);
    expect(requestedTokens).toEqual([null, 'A', 'B']);
    expect(stops).toEqual(['repeated_token']);
  });

  it('stops at the page cap, reports page_cap, and keeps the pages already fetched', async () => {
    const { fetchPage, requestedTokens } = scriptedPages(
      new Map([
        [null, { items: ['a1'], nextPageToken: 'A' }],
        ['A', { items: ['a2'], nextPageToken: 'B' }],
        ['B', { items: ['a3'], nextPageToken: null }],
      ]),
    );
    const stops: string[] = [];

    const items = await collectTokenPages(fetchPage, { maxPages: 2, onStop: (reason) => stops.push(reason) });

    expect(items).toEqual(['a1', 'a2']);
    expect(requestedTokens).toEqual([null, 'A']);
    expect(stops).toEqual(['page_cap']);
  });

  it('keeps following tokens past an empty page that still carries a next token', async () => {
    const { fetchPage, requestedTokens } = scriptedPages(
      new Map([
        [null, { items: [], nextPageToken: 'A' }],
        ['A', { items: ['a1'], nextPageToken: null }],
      ]),
    );

    const items = await collectTokenPages(fetchPage);

    expect(items).toEqual(['a1']);
    expect(requestedTokens).toEqual([null, 'A']);
  });

  it('truncates the page that crosses maxItems and requests no further page', async () => {
    const { fetchPage, requestedTokens } = scriptedPages(
      new Map([
        [null, { items: ['a1', 'a2', 'a3'], nextPageToken: 'A' }],
        ['A', { items: ['b1'], nextPageToken: null }],
      ]),
    );

    const items = await collectTokenPages(fetchPage, { maxItems: 2 });

    expect(items).toEqual(['a1', 'a2']);
    expect(requestedTokens).toEqual([null]);
  });

  it('stops at an empty-string token without requesting it, as it does for null', async () => {
    const { fetchPage, requestedTokens } = scriptedPages(new Map([[null, { items: ['a1'], nextPageToken: '' }]]));
    const stops: string[] = [];

    const items = await collectTokenPages(fetchPage, { onStop: (reason) => stops.push(reason) });

    expect(items).toEqual(['a1']);
    expect(requestedTokens).toEqual([null]);
    expect(stops).toEqual([]);
  });
});
