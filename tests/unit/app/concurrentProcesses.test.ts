/**
 * Two apps on one cache folder, each on its own actor clock, as two processes started side by side
 * on a cold cache. They share the pacer lock, so they take turns; what one stores while the other
 * waits for its turn must not be fetched a second time.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runActors, type ActorClock } from '../../helpers/actorClock.js';
import { createFixtureApp, FIXTURE_START_MS, type FixtureApp } from '../../helpers/fixtureApp.js';
import { runtimeSecret } from '../../helpers/runtimeSecret.js';

const DETAILS_PREFIX = '/v1.25/me/scenarios/';
const CSRF_PATH = '/v1.25/web/ensure_csrf';
const ACCESS_TOKEN_PATH = '/v1.25/auth/access_token/';
/** The completed lessons across the two fixture pages. */
const COMPLETED_LESSONS = 6;

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-concurrent-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

/** Two apps on the same account and cache folder, each running `work` on its own actor clock. */
async function runSideBySide(work: (harness: FixtureApp) => Promise<unknown>): Promise<FixtureApp[]> {
  const credentials = { username: runtimeSecret('user'), password: runtimeSecret('pw') };
  const harnesses: FixtureApp[] = [];
  const actor = (clock: ActorClock) => {
    const harness = createFixtureApp({ cacheDir, credentials, clock, env: { MEMRISE_DEBUG: '1' } });
    harnesses.push(harness);
    return work(harness).then(() => undefined);
  };
  await runActors(FIXTURE_START_MS, [actor, actor]);
  return harnesses;
}

function requestsTo(harnesses: readonly FixtureApp[], prefixes: readonly string[]): number {
  return harnesses.reduce((sum, h) => sum + prefixes.reduce((n, prefix) => n + h.transport.countFor(prefix), 0), 0);
}

describe('two processes on one cold cache folder', () => {
  it('fetch each completed lesson once between them, the waiting one reusing what the other stored', async () => {
    const harnesses = await runSideBySide((h) => h.app.queries.listScenarios({ types: ['completed'] }));

    expect(requestsTo(harnesses, [DETAILS_PREFIX])).toBe(COMPLETED_LESSONS);
    const cacheHits = harnesses.flatMap((h) => h.stderr).filter((line) => line.includes('details: cache hit (completed)'));
    expect(cacheHits.length).toBeGreaterThan(0);
  });

  /**
   * Login is two paced requests, and the lock is free between them, so the waiting process sends its
   * own CSRF request in that gap. When its password turn comes, the other has saved the session.
   */
  it('submit the password once between them, the waiting one reusing the session the other saved', async () => {
    const harnesses = await runSideBySide((h) => h.app.queries.listPairs());

    expect(requestsTo(harnesses, [ACCESS_TOKEN_PATH])).toBe(1);
    expect(requestsTo(harnesses, [CSRF_PATH])).toBe(2);
  });
});
