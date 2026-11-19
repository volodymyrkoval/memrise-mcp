import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLearnablesPage } from '../../../src/api/schemas.js';
import { DiskWordListCache } from '../../../src/cache/diskWordListCache.js';
import type { Learnable } from '../../../src/domain/types.js';
import type { Logger } from '../../../src/log/logger.js';
import { FIXTURE_PAIR_ID } from '../../helpers/fixtureApi.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { POSIX_MODES_UNSUPPORTED } from '../../helpers/platform.js';

const START_MS = Date.parse('2026-01-01T00:00:00.000Z');
const FETCHED_AT = new Date(START_MS).toISOString();
const TTL_SECONDS = 3600;
const ONE_HOUR_MS = TTL_SECONDS * 1000;

let cacheDir: string;
let nowMs: number;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-words-test-'));
  nowMs = START_MS;
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function learnables(): Learnable[] {
  return parseLearnablesPage(loadFixture('learnables-page-1.json')).items;
}

function legacyLearnables(): Omit<Learnable, 'heard'>[] {
  return learnables().map(({ heard: _heard, ...rest }) => rest);
}

function cacheWith({ ttlSeconds = TTL_SECONDS, logger = silentLogger() } = {}): DiskWordListCache {
  return new DiskWordListCache({ cacheDir, ttlSeconds, now: () => nowMs, logger });
}

function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

describe('DiskWordListCache', () => {
  it('serves the list an earlier instance wrote while the entry is within the TTL', async () => {
    await cacheWith().write(FIXTURE_PAIR_ID, 'any', learnables());
    nowMs += ONE_HOUR_MS - 1000;

    expect(await cacheWith().read(FIXTURE_PAIR_ID, 'any')).toEqual(learnables());
  });

  it('keeps the heard flag across a write and a read', async () => {
    const heardWord = { ...learnables()[0], heard: true };
    await cacheWith().write(FIXTURE_PAIR_ID, 'any', [heardWord]);

    expect(await cacheWith().read(FIXTURE_PAIR_ID, 'any')).toEqual([heardWord]);
  });

  it('returns null and logs a debug line once the entry is as old as the TTL', async () => {
    await cacheWith().write(FIXTURE_PAIR_ID, 'any', learnables());
    nowMs += ONE_HOUR_MS;
    const debugLines: string[] = [];
    const logger: Logger = { ...silentLogger(), debug: (msg) => debugLines.push(msg) };

    expect(await cacheWith({ logger }).read(FIXTURE_PAIR_ID, 'any')).toBeNull();
    expect(debugLines).toContain('words: disk cache expired');
  });

  it.each([
    ['a corrupt file', '{ "learnables": ['],
    ['an older format version, written before words carried heard', JSON.stringify({ version: 1, fetchedAt: FETCHED_AT, learnables: legacyLearnables() })],
    ['a newer format version', JSON.stringify({ version: 3, fetchedAt: FETCHED_AT, learnables: [] })],
    ['an entry whose words lack heard', JSON.stringify({ version: 2, fetchedAt: FETCHED_AT, learnables: legacyLearnables() })],
    ['learnables of the wrong shape', JSON.stringify({ version: 2, fetchedAt: FETCHED_AT, learnables: 'nope' })],
  ])('treats %s as a miss and logs one warning', async (_name, text) => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger(), warn: (msg) => warnings.push(msg) };
    await writeFile(join(cacheDir, `words-${FIXTURE_PAIR_ID}-any.json`), text, 'utf8');

    expect(await cacheWith({ logger }).read(FIXTURE_PAIR_ID, 'any')).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it('keeps one file per pair and state, so one state never reads another state list', async () => {
    await cacheWith().write(FIXTURE_PAIR_ID, 'any', learnables());

    expect(await cacheWith().read(FIXTURE_PAIR_ID, 'fully_learned_or_known')).toBeNull();
    await cacheWith().write(FIXTURE_PAIR_ID, 'fully_learned_or_known', []);
    expect(await readdir(cacheDir)).toEqual(['words-7-any.json', 'words-7-fully_learned_or_known.json']);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('writes the word list file with mode 0600', async () => {
    await cacheWith().write(FIXTURE_PAIR_ID, 'any', learnables());

    expect((await stat(join(cacheDir, `words-${FIXTURE_PAIR_ID}-any.json`))).mode & 0o777).toBe(0o600);
  });

  it('returns null and logs a debug line when nothing was cached for the pair and state', async () => {
    const debugLines: string[] = [];
    const logger: Logger = { ...silentLogger(), debug: (msg) => debugLines.push(msg) };

    expect(await cacheWith({ logger }).read(FIXTURE_PAIR_ID, 'any')).toBeNull();
    expect(debugLines).toContain('words: disk cache miss');
  });

  it('writes no file when the TTL is 0', async () => {
    await cacheWith({ ttlSeconds: 0 }).write(FIXTURE_PAIR_ID, 'any', learnables());

    expect(await readdir(cacheDir)).toEqual([]);
  });

  it('reads null without touching the disk when the TTL is 0', async () => {
    await writeFile(join(cacheDir, `words-${FIXTURE_PAIR_ID}-any.json`), '{ corrupt', 'utf8');

    expect(await cacheWith({ ttlSeconds: 0 }).read(FIXTURE_PAIR_ID, 'any')).toBeNull();
  });
});
