import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseScenarioDetails } from '../../../src/api/schemas.js';
import { DiskScenarioDetailsStore } from '../../../src/cache/diskScenarioDetailsStore.js';
import type { Logger } from '../../../src/log/logger.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { POSIX_MODES_UNSUPPORTED } from '../../helpers/platform.js';

const NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');
const FETCHED_AT = new Date(NOW_MS).toISOString();
const DETAILS_ID = 1001;

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-details-test-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function storeIn(dir = cacheDir, logger: Logger = silentLogger()) {
  return new DiskScenarioDetailsStore({ cacheDir: dir, now: () => NOW_MS, logger });
}

function fixtureDetails() {
  return parseScenarioDetails(DETAILS_ID, loadFixture('scenario-details-1001.json'));
}

function detailsDir(): string {
  return join(cacheDir, 'scenario-details');
}

function entryPath(id: number): string {
  return join(detailsDir(), `${id}.json`);
}

/** Puts `text` into the entry file for `DETAILS_ID`, as if an earlier run or another tool had written it. */
async function writeRawEntry(text: string): Promise<void> {
  await mkdir(detailsDir(), { recursive: true });
  await writeFile(entryPath(DETAILS_ID), text, 'utf8');
}

function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

/** A logger whose warnings are collected, so tests can assert on what was logged. */
function recordingLogger(warnings: string[]): Logger {
  return { ...silentLogger(), warn: (msg) => warnings.push(msg) };
}

describe('DiskScenarioDetailsStore', () => {
  it('reads back the details it wrote for the same id', async () => {
    const details = fixtureDetails();
    await storeIn().write(DETAILS_ID, details);

    expect(await storeIn().read(DETAILS_ID)).toEqual(details);
  });

  it('reads null for an id that was never written', async () => {
    expect(await storeIn().read(DETAILS_ID)).toBeNull();
  });

  it('treats a corrupt entry as a miss and logs one warning without its contents', async () => {
    const warnings: string[] = [];
    await writeRawEntry('{ "secretish": "do-not-log-this');

    expect(await storeIn(cacheDir, recordingLogger(warnings)).read(DETAILS_ID)).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('do-not-log-this');
  });

  it.each([
    ['another format version', { version: 2, fetchedAt: FETCHED_AT, details: fixtureDetails() }],
    ['details of the wrong shape', { version: 1, fetchedAt: FETCHED_AT, details: { scenarioId: 'not-a-number' } }],
  ])('treats an entry with %s as a miss and logs a warning', async (_name, entry) => {
    const warnings: string[] = [];
    await writeRawEntry(JSON.stringify(entry));

    expect(await storeIn(cacheDir, recordingLogger(warnings)).read(DETAILS_ID)).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('creates a missing cache directory with mode 0700 on first write', async () => {
    const nested = join(cacheDir, 'not-yet-created');

    await storeIn(nested).write(DETAILS_ID, fixtureDetails());

    expect((await stat(join(nested, 'scenario-details'))).mode & 0o777).toBe(0o700);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('writes the entry file with mode 0600', async () => {
    await storeIn().write(DETAILS_ID, fixtureDetails());

    expect((await stat(entryPath(DETAILS_ID))).mode & 0o777).toBe(0o600);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED || process.getuid?.() === 0)('keeps the previous entry when a rewrite cannot complete', async () => {
    const store = storeIn();
    const previous = fixtureDetails();
    await store.write(DETAILS_ID, previous);

    await chmod(detailsDir(), 0o500);
    try {
      await expect(store.write(DETAILS_ID, { ...previous, completed: false })).rejects.toBeDefined();
    } finally {
      await chmod(detailsDir(), 0o700);
    }

    expect(await store.read(DETAILS_ID)).toEqual(previous);
  });

  it('leaves one valid entry and no temp files after concurrent writes to the same id', async () => {
    const store = storeIn();
    const variants = Array.from({ length: 20 }, (_, i) => ({
      ...fixtureDetails(),
      dateStarted: new Date(NOW_MS + i * 1000).toISOString(),
    }));

    await Promise.all(variants.map((details) => store.write(DETAILS_ID, details)));

    expect(variants).toContainEqual(await store.read(DETAILS_ID));
    expect(await readdir(detailsDir())).toEqual([`${DETAILS_ID}.json`]);
  });
});
