import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../../src/errors.js';
import { createFixtureApp } from '../../helpers/fixtureApp.js';

const DETAILS_PREFIX = '/v1.25/me/scenarios/';
const FAILING_LESSON = 2003;
const COOLDOWN_FILE = 'rate-limit.json';

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-app-resume-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

async function cachedLessonIds(): Promise<number[]> {
  const files = await readdir(join(cacheDir, 'scenario-details')).catch(() => [] as string[]);
  return files.map((file) => Number.parseInt(file, 10)).sort((a, b) => a - b);
}

describe('a run that stops part-way', () => {
  it('keeps the lessons it already fetched, so asking again fetches only the rest', async () => {
    const first = createFixtureApp({ cacheDir, details: { [FAILING_LESSON]: { status: 429 } } });
    await expect(first.app.queries.listWords({ limit: 200, includeAudio: false })).rejects.toThrow(RateLimitedError);
    const fetchedBeforeStop = await cachedLessonIds();
    expect(fetchedBeforeStop.length).toBeGreaterThan(0);
    expect(fetchedBeforeStop).not.toContain(FAILING_LESSON);

    // The cooldown has run out by the time the user asks again.
    await rm(join(cacheDir, COOLDOWN_FILE));
    const second = createFixtureApp({ cacheDir, credentials: first.credentials });
    await second.app.queries.listWords({ limit: 200, includeAudio: false });

    for (const id of fetchedBeforeStop) {
      expect(second.transport.countFor(`${DETAILS_PREFIX}${id}/details/`), `lesson ${id}`).toBe(0);
    }
    expect(second.transport.countFor(`${DETAILS_PREFIX}${FAILING_LESSON}/details/`)).toBe(1);
  });
});
