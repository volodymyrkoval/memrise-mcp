import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../src/app/buildApp.js';
import { ConfigError, NotFoundError } from '../../../src/errors.js';
import { createFixtureApp, type FixtureApp } from '../../helpers/fixtureApp.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';

const LEARNABLES_PATH = '/v1.25/me/language_pairs/7/learnables/';
const UNKNOWN_LESSON_ID = 999999;

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-app-edges-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe('app without credentials', () => {
  it('starts, and the first query fails with a ConfigError before any request is sent', async () => {
    const transport = new RoutedTransport();
    const app = buildApp({
      env: { MEMRISE_CACHE_DIR: cacheDir },
      transport,
      now: () => 0,
      sleep: async () => {},
    });

    await expect(app.queries.listWords({ limit: 10, includeAudio: false })).rejects.toThrow(ConfigError);
    await expect(app.queries.listWords({ limit: 10, includeAudio: false })).rejects.toThrow(
      'MEMRISE_USERNAME and MEMRISE_PASSWORD must be set',
    );
    expect(transport.requests).toHaveLength(0);
  });
});

describe('app over the fixture API: edge cases', () => {
  let harness: FixtureApp;

  beforeEach(() => {
    harness = createFixtureApp({ cacheDir });
  });

  it('rejects an unknown lesson with NotFoundError', async () => {
    harness.details[UNKNOWN_LESSON_ID] = { status: 404 };

    await expect(harness.app.queries.scenarioWords({ scenarioId: UNKNOWN_LESSON_ID, includeAudio: false })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('reports no truncation when the limit exceeds the total', async () => {
    const result = await harness.app.queries.listWords({ limit: 10000, includeAudio: false });

    expect(result).toMatchObject({ total: 30, returned: 30, truncated: false });
  });

  it('keeps the two learning states apart in memory and on disk', async () => {
    await harness.app.queries.listWords({ state: 'any', limit: 10, includeAudio: false });
    await harness.app.queries.listWords({ state: 'fully_learned_or_known', limit: 10, includeAudio: false });

    expect(harness.transport.countFor(LEARNABLES_PATH)).toBe(6);
    expect((await readdir(cacheDir)).filter((name) => name.startsWith('words-')).sort()).toEqual([
      'words-7-any.json',
      'words-7-fully_learned_or_known.json',
    ]);
  });

  it('serves a state from its own disk entry in a later process', async () => {
    await harness.app.queries.listWords({ state: 'fully_learned_or_known', limit: 10, includeAudio: false });
    const later = createFixtureApp({ cacheDir, credentials: harness.credentials });

    await later.app.queries.listWords({ state: 'fully_learned_or_known', limit: 10, includeAudio: false });

    expect(later.transport.countFor(LEARNABLES_PATH)).toBe(0);
  });
});
