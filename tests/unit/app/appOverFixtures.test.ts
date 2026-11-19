import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syntheticDetails } from '../../helpers/fixtureApi.js';
import { createFixtureApp, type FixtureApp } from '../../helpers/fixtureApp.js';

const LEARNABLES_PATH = '/v1.25/me/language_pairs/7/learnables/';
const SCENARIOS_PATH = '/v1.25/me/language_pairs/7/scenarios/';
const DETAILS_PREFIX = '/v1.25/me/scenarios/';
const O_LIVRO_ID = 65500000065536;
const SECOND_LEARNABLE_ID = 65500000196608;
const SCENARIO_B_ID = 2005;
const SCENARIO_A_ID = 2003;
const LESSON_1001_ID = 1001;
/** The fixture lesson 1001 is trimmed to 10 items in the fixture. */
const LESSON_1001_ITEMS = 10;

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-app-fixtures-'));
  harness = createFixtureApp({ cacheDir });
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe('app over the fixture API', () => {
  it('walks each upstream route once across a sequence of queries', async () => {
    const { app, transport } = harness;

    await app.queries.listWords({ limit: 200, includeAudio: false });
    await app.queries.lookupWords({ terms: ['book'] });
    await app.queries.listScenarios({ types: ['completed'] });
    await app.queries.listScenarios({ types: ['completed', 'in_progress'] });
    await app.queries.scenarioWords({ scenarioId: LESSON_1001_ID, includeAudio: false });
    await app.queries.scenarioWords({ scenarioId: SCENARIO_B_ID, includeAudio: false });

    expect(transport.countFor(LEARNABLES_PATH)).toBe(3);
    expect(transport.countFor(SCENARIOS_PATH)).toBe(3);
    expect(transport.countFor('/v1.25/auth/access_token/')).toBe(1);
    expect(transport.countFor(`${DETAILS_PREFIX}${SCENARIO_B_ID}/details/`)).toBe(1);
    expect(transport.countFor(`${DETAILS_PREFIX}${LESSON_1001_ID}/details/`)).toBe(1);
  });

  it('returns the fixture lesson 1001 with its words and no lesson row', async () => {
    const result = await harness.app.queries.scenarioWords({ scenarioId: LESSON_1001_ID, includeAudio: false });

    expect(result.words).toHaveLength(LESSON_1001_ITEMS);
    expect(result.words.map((word) => word.word)).toContain('the plate is on the table');
    expect(result.scenario).toBeNull();
    expect(result).not.toHaveProperty('warnings');
  });

  it('links a word to the lesson that teaches it', async () => {
    harness.details[SCENARIO_B_ID] = { status: 200, body: syntheticDetails([O_LIVRO_ID]) };

    const result = await harness.app.queries.listWords({ limit: 200, includeAudio: false });

    expect(result.total).toBe(30);
    expect(result.words.find((word) => word.word === 'the book')?.lessons).toEqual(['Lesson Alpha']);
    expect(result).not.toHaveProperty('warnings');
  });

  it('answers lookups: exact for a word, inside a sentence for a phrase part, and unknown', async () => {
    const result = await harness.app.queries.lookupWords({ terms: ['book', 'key', 'xyzzy'] });

    expect(result.results.map((r) => [r.query, r.match])).toEqual([
      ['book', 'exact'],
      ['key', 'in_sentence'],
      ['xyzzy', 'none'],
    ]);
    expect(result.results[1].in_sentences.map((row) => row.word)).toContain(
      'the key is on the table',
    );
  });

  it('lists no lessons for in-progress scenarios and makes no details request', async () => {
    const result = await harness.app.queries.listScenarios({ types: ['in_progress'] });

    expect(result.scenarios).toEqual([]);
    expect(harness.transport.countFor(DETAILS_PREFIX)).toBe(0);
  });

  it('a second app over the same cache dir reuses the session, the words and completed lessons', async () => {
    await harness.app.queries.listWords({ limit: 200, includeAudio: false });
    await harness.app.queries.listScenarios({ types: ['completed'] });
    const second = createFixtureApp({ cacheDir, credentials: harness.credentials });

    await second.app.queries.listWords({ limit: 200, includeAudio: false });
    await second.app.queries.listScenarios({ types: ['completed'] });

    expect(second.transport.countFor('/v1.25/auth/')).toBe(0);
    expect(second.transport.countFor(LEARNABLES_PATH)).toBe(0);
    expect(second.transport.countFor(DETAILS_PREFIX)).toBe(0);
    // listWords reads both lesson lists (completed: 2 pages, in progress: 1); listScenarios reuses them from memory.
    expect(second.transport.countFor(SCENARIOS_PATH)).toBe(3);
  });
});
