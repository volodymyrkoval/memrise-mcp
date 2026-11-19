import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExportDocument } from '../../../src/cli/exportDocument.js';
import { createFixtureApp, FIXTURE_START_MS, type FixtureApp } from '../../helpers/fixtureApp.js';

const LESSON_GAMMA = 2003;
const LESSON_GAMMA_WARNING =
  'Could not read lesson 2003 "Lesson Gamma" (Memrise error HTTP 503), so its words show no lesson or topic in this result.';

const FIXTURE_PAIR_ID = 7;
const COMPLETED_LESSONS = 6;

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-export-doc-'));
  harness = createFixtureApp({ cacheDir });
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe('buildExportDocument', () => {
  it('has no warnings key when every lesson could be read', async () => {
    const doc = await buildExportDocument(harness.app.queries, { state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    expect(doc).not.toHaveProperty('warnings');
  });

  it('names a failed lesson once in warnings, though both the words and the lessons read it', async () => {
    harness = createFixtureApp({ cacheDir, details: { [LESSON_GAMMA]: { status: 503 } } });

    const doc = await buildExportDocument(harness.app.queries, { state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    expect(doc.warnings).toEqual([LESSON_GAMMA_WARNING, expect.stringContaining('incomplete')]);
  });

  it('describes the pair, state and fetch time, with the words and the completed lessons', async () => {
    const doc = await buildExportDocument(harness.app.queries, { state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    expect(doc).toMatchObject({
      fetched_at: new Date(FIXTURE_START_MS).toISOString(),
      language_pair_id: FIXTURE_PAIR_ID,
      state: 'any',
    });
    expect(doc.lessons).toHaveLength(COMPLETED_LESSONS);
    expect(doc.words.length).toBeGreaterThan(0);
  });

  it('reads the learnables of the requested state from the API', async () => {
    await buildExportDocument(harness.app.queries, { state: 'fully_learned_or_known', includeAudio: false }, () => FIXTURE_START_MS);

    const learnableRequests = harness.transport.requests.filter((req) => req.url.includes('/learnables/'));
    expect(learnableRequests.length).toBeGreaterThan(0);
    for (const req of learnableRequests) {
      expect(new URL(req.url).searchParams.get('learning_state')).toBe('FULLY_LEARNED_OR_KNOWN');
    }
  });

  it('includes audio URLs in the word rows only when asked', async () => {
    const withAudio = await buildExportDocument(harness.app.queries, { state: 'any', includeAudio: true }, () => FIXTURE_START_MS);
    const withoutAudio = await buildExportDocument(harness.app.queries, { state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    expect(withAudio.words.some((word) => Array.isArray((word as { audios?: unknown }).audios))).toBe(true);
    expect(withoutAudio.words.some((word) => 'audios' in (word as object))).toBe(false);
  });
});
