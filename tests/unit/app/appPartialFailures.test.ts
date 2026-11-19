import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthError, RateLimitedError } from '../../../src/errors.js';
import { syntheticDetails } from '../../helpers/fixtureApi.js';
import { createFixtureApp, FIXTURE_START_MS, type FixtureApp } from '../../helpers/fixtureApp.js';

const DETAILS_PREFIX = '/v1.25/me/scenarios/';
const LESSON_GAMMA = 2003;
const LESSON_GAMMA_TITLE = 'Lesson Gamma';
const LESSON_ALPHA = 2005;
const LESSON_1001 = 1001;
const O_LIVRO_ID = 65500000065536;
const LESSON_GAMMA_WARNING =
  'Could not read lesson 2003 "Lesson Gamma" (Memrise error HTTP 503), so its words show no lesson or topic in this result.';

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-app-partial-'));
  harness = createFixtureApp({ cacheDir, details: { [LESSON_GAMMA]: { status: 503 } } });
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function gammaDetailsRequests(): number {
  return harness.transport.countFor(`${DETAILS_PREFIX}${LESSON_GAMMA}/details/`);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe('app partial failures', () => {
  it('lists words and looks terms up without links to the failed lesson, and names it in one warning', async () => {
    harness.details[LESSON_ALPHA] = { status: 200, body: syntheticDetails([O_LIVRO_ID]) };

    const words = await harness.app.queries.listWords({ limit: 200, includeAudio: false });
    const lookup = await harness.app.queries.lookupWords({ terms: ['book'] });

    expect(words.words.flatMap((w) => w.lessons)).not.toContain(LESSON_GAMMA_TITLE);
    expect(words.words.find((w) => w.word === 'the book')?.lessons).toEqual(['Lesson Alpha']);
    expect(words.warnings).toEqual([LESSON_GAMMA_WARNING, expect.stringContaining('incomplete')]);
    expect(lookup.results[0].met).toBe(true);
    expect(lookup.warnings).toEqual([LESSON_GAMMA_WARNING, expect.stringContaining('incomplete')]);
  });

  it('keeps the failed lesson in the scenario list with null dates, and since drops it', async () => {
    const all = await harness.app.queries.listScenarios({ types: ['completed'] });
    const recent = await harness.app.queries.listScenarios({
      types: ['completed'],
      since: '2026-01-01T00:00:00Z',
    });

    expect(all.scenarios.find((s) => s.scenario_id === LESSON_GAMMA)).toMatchObject({
      date_started: null,
      date_completed: null,
    });
    expect(all.warnings).toEqual([LESSON_GAMMA_WARNING]);
    expect(recent.scenarios.map((s) => s.scenario_id)).not.toContain(LESSON_GAMMA);
  });

  it('rejects the failed lesson itself but still answers another lesson, with the warning', async () => {
    await expect(harness.app.queries.scenarioWords({ scenarioId: LESSON_GAMMA, includeAudio: false })).rejects.toThrow(
      'scenario_details: HTTP 503',
    );

    const other = await harness.app.queries.scenarioWords({ scenarioId: LESSON_1001, includeAudio: false });

    expect(other.words.length).toBeGreaterThan(0);
    expect(other.warnings).toEqual([LESSON_GAMMA_WARNING]);
  });

  it('rejects word queries on an auth failure during a lesson fetch, since it would fail every lesson', async () => {
    harness.details[LESSON_GAMMA] = { status: 401 };

    await expect(harness.app.queries.listWords({ limit: 200, includeAudio: false })).rejects.toThrow(AuthError);
  });

  it('rejects word queries when a lesson fetch stays rate-limited, instead of turning the 429 into a warning', async () => {
    harness.details[LESSON_GAMMA] = { status: 429 };

    await expect(harness.app.queries.listWords({ limit: 200, includeAudio: false })).rejects.toThrow(RateLimitedError);
  });

  it('sends no request at all, login included, while another process has recorded a cooldown', async () => {
    const until = new Date(FIXTURE_START_MS + 60_000).toISOString();
    await writeFile(join(cacheDir, 'rate-limit.json'), JSON.stringify({ version: 1, until }), 'utf8');

    await expect(harness.app.queries.listWords({ limit: 200, includeAudio: false })).rejects.toThrow(RateLimitedError);
    expect(harness.transport.requests).toHaveLength(0);
  });

  it('retries only the failed lesson on the next call, and the warning goes away once it loads', async () => {
    await harness.app.queries.listWords({ limit: 200, includeAudio: false });
    const requestsAfterFirstCall = gammaDetailsRequests();
    const learnablesAfterFirstCall = harness.transport.countFor('/v1.25/me/language_pairs/7/learnables/');
    delete harness.details[LESSON_GAMMA];

    const second = await harness.app.queries.listWords({ limit: 200, includeAudio: false });

    expect(gammaDetailsRequests()).toBe(requestsAfterFirstCall + 1);
    expect(harness.transport.countFor(`${DETAILS_PREFIX}${LESSON_ALPHA}/details/`)).toBe(1);
    expect(harness.transport.countFor('/v1.25/me/language_pairs/7/learnables/')).toBe(learnablesAfterFirstCall);
    expect(second).not.toHaveProperty('warnings');
  });

  it('writes nothing to the details cache for the failed lesson', async () => {
    await harness.app.queries.listWords({ limit: 200, includeAudio: false });

    expect(await exists(join(cacheDir, 'scenario-details', `${LESSON_GAMMA}.json`))).toBe(false);
  });
});
