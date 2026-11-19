import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../../src/app/buildApp.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../../../src/http/transport.js';
import { UserMessageError } from '../../../src/errors.js';
import { main } from '../../../scripts/smoke.js';
import { syntheticDetails, type DetailsOverride } from '../../helpers/fixtureApi.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { createFixtureApp, type FixtureApp } from '../../helpers/fixtureApp.js';

const SKIP_LINE = 'smoke skipped: MEMRISE_USERNAME/MEMRISE_PASSWORD not set';

/** The first completed lesson in the fixture scenario list; its details are overridden per test. */
const FIRST_LESSON_ID = loadFixture<{ scenarios: { scenario_id: number }[] }>('scenarios-completed-page-1.json').scenarios[0]
  .scenario_id;
/** Learnable ids from the first learnables page, used as the lesson's items. */
const LESSON_IDS = loadFixture<{ learnables: { learnable_id_key: number }[] }>('learnables-page-1.json')
  .learnables.slice(0, 2)
  .map((item) => item.learnable_id_key);
/** Three fixture pages of 10 learnables each: the walk stops at the last page, short of the 50-item sample. */
const FIXTURE_WORDS = 30;

interface Output {
  out: string[];
  err: string[];
  sink: { out: (line: string) => void; err: (line: string) => void };
}

let workDir: string;
const cacheDir = () => join(workDir, 'cache');

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memrise-smoke-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function captureOutput(): Output {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, sink: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

function fixtureHarness(details: Record<number, DetailsOverride> = {}): FixtureApp {
  return createFixtureApp({ cacheDir: cacheDir(), details });
}

function envFor(harness: FixtureApp): Record<string, string> {
  return { MEMRISE_USERNAME: harness.credentials.username, MEMRISE_PASSWORD: harness.credentials.password };
}

/** Answers the completed-lessons list with an empty page and delegates every other request to the fixture wire. */
function withoutCompletedLessons(harness: FixtureApp): HttpTransport {
  return {
    send: (req: HttpRequest): Promise<HttpResponse> => {
      const url = new URL(req.url);
      const isCompletedList = url.pathname.endsWith('/scenarios/') && url.searchParams.get('scenario_type') === 'completed';
      if (!isCompletedList) return harness.transport.send(req);
      return Promise.resolve({
        status: 200,
        setCookies: [],
        bodyText: JSON.stringify({ scenarios: [], has_more_pages: false, total_number: 0 }),
      });
    },
  };
}

describe('smoke', () => {
  it('skips with exit 0, the skip line and no app or request when credentials are unset', async () => {
    const { out, err, sink } = captureOutput();
    const createApp = vi.fn((): App => {
      throw new Error('the app must not be built without credentials');
    });

    const code = await main({ env: {}, createApp, ...sink });

    expect(code).toBe(0);
    expect(out).toEqual([SKIP_LINE]);
    expect(err).toEqual([]);
    expect(createApp).not.toHaveBeenCalled();
  });

  it('prints counts only: the words sample and the first completed lesson', async () => {
    const harness = fixtureHarness({ [FIRST_LESSON_ID]: { status: 200, body: syntheticDetails(LESSON_IDS) } });
    const { out, err, sink } = captureOutput();

    const code = await main({ env: envFor(harness), createApp: () => harness.app, ...sink });

    expect(code).toBe(0);
    expect(out).toEqual([`words page: ${FIXTURE_WORDS}, lesson items: ${LESSON_IDS.length}`]);
    expect(err).toEqual([]);
  });

  it('exits 1 with one redacted line when the lesson details fail', async () => {
    const harness = fixtureHarness({ [FIRST_LESSON_ID]: { status: 503 } });
    const { out, err, sink } = captureOutput();

    const code = await main({ env: envFor(harness), createApp: () => harness.app, ...sink });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(['smoke failed: Memrise had a problem while reading a lesson (HTTP 503, tried 3 times). Try again in a few minutes.']);
  });

  it('exits 1 without a lesson line when the account has no completed lesson', async () => {
    const harness = fixtureHarness();
    const { out, err, sink } = captureOutput();
    const createApp = (appEnv: Readonly<Record<string, string | undefined>>) =>
      buildApp({ env: { ...appEnv, MEMRISE_CACHE_DIR: cacheDir() }, transport: withoutCompletedLessons(harness) });

    const code = await main({ env: envFor(harness), createApp, ...sink });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(['smoke failed: no completed lesson to sample']);
  });

  it('does not skip when only one credential is set, and fails before any request', async () => {
    const harness = fixtureHarness();
    const { out, err, sink } = captureOutput();
    const env = { MEMRISE_USERNAME: harness.credentials.username };
    const createApp = (appEnv: Readonly<Record<string, string | undefined>>) =>
      buildApp({ env: { ...appEnv, MEMRISE_CACHE_DIR: cacheDir() }, transport: harness.transport });

    const code = await main({ env, createApp, ...sink });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(['smoke failed: Not set up yet: MEMRISE_USERNAME and MEMRISE_PASSWORD must be set in your client settings.']);
    expect(harness.transport.requests).toHaveLength(0);
  });

  it('never echoes the username in the failure line', async () => {
    const harness = fixtureHarness();
    const { err, sink } = captureOutput();
    const leaking = () => {
      throw new UserMessageError(`cannot start for ${harness.credentials.username}`);
    };

    const code = await main({ env: envFor(harness), createApp: leaking, ...sink });

    expect(code).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).not.toContain(harness.credentials.username);
    expect(err[0]).toContain('<redacted>');
  });
});
