import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../src/app/buildApp.js';
import { runExport } from '../../../src/cli/runExport.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';
import { runtimeSecret } from '../../helpers/runtimeSecret.js';
import { createFixtureApp, FIXTURE_START_MS, type FixtureApp } from '../../helpers/fixtureApp.js';
import { POSIX_MODES_UNSUPPORTED } from '../../helpers/platform.js';

const FIXTURE_PAIR_ID = 7;
const LESSON_GAMMA = 2003;
const LESSON_GAMMA_WARNING =
  'Could not read lesson 2003 "Lesson Gamma" (Memrise error HTTP 503), so its words show no lesson or topic in this result.';

let workDir: string;
let cacheDir: string;
let harness: FixtureApp;
let out: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memrise-export-'));
  cacheDir = join(workDir, 'cache');
  out = join(workDir, 'memrise.json');
  harness = createFixtureApp({ cacheDir });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('runExport', () => {
  it('writes the export document to the out file', async () => {
    await runExport(harness.app, { out, state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    const doc = JSON.parse(await readFile(out, 'utf8'));
    expect(doc).toMatchObject({ language_pair_id: FIXTURE_PAIR_ID, state: 'any' });
    expect(doc.lessons).toHaveLength(6);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('writes the file readable by its owner only', async () => {
    await runExport(harness.app, { out, state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    expect((await stat(out)).mode & 0o777).toBe(0o600);
  });

  it('still writes the file when a lesson failed, names it in warnings, and logs it as a warn line', async () => {
    harness = createFixtureApp({ cacheDir, details: { [LESSON_GAMMA]: { status: 503 } } });

    await runExport(harness.app, { out, state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    const doc = JSON.parse(await readFile(out, 'utf8'));
    expect(doc.warnings).toEqual([LESSON_GAMMA_WARNING, expect.stringContaining('incomplete')]);
    expect(harness.stderr.filter((line) => line.endsWith(` [warn] ${LESSON_GAMMA_WARNING}\n`))).toHaveLength(1);
  });

  it('leaves no file at out when the export cannot log in', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/web/ensure_csrf', { status: 503, setCookies: [], bodyText: '' });
    const app = buildApp({
      env: { MEMRISE_USERNAME: runtimeSecret('user'), MEMRISE_PASSWORD: runtimeSecret('pw'), MEMRISE_CACHE_DIR: cacheDir },
      transport,
      now: () => FIXTURE_START_MS,
      sleep: async () => undefined,
      newId: () => 'corr-1',
      stderrWrite: () => undefined,
    });

    await expect(runExport(app, { out, state: 'any', includeAudio: false }, () => FIXTURE_START_MS)).rejects.toThrow(/login failed/);
    await expect(access(out)).rejects.toThrow();
  });
});
