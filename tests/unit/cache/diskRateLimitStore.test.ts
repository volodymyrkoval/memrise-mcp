import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskRateLimitStore } from '../../../src/cache/diskRateLimitStore.js';
import type { Logger } from '../../../src/log/logger.js';
import { POSIX_MODES_UNSUPPORTED } from '../../helpers/platform.js';

const UNTIL = Date.parse('2026-01-01T00:05:00.000Z');

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

let workDir: string;
let cacheDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memrise-rate-limit-test-'));
  cacheDir = join(workDir, 'cache');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function storeFor(dir = cacheDir, logger: Logger = silentLogger) {
  return new DiskRateLimitStore({ cacheDir: dir, logger });
}

describe('DiskRateLimitStore', () => {
  it('lets another store on the same cache folder (another process) read the recorded cooldown', async () => {
    await storeFor().record(UNTIL);

    expect(await storeFor().read()).toBe(UNTIL);
  });

  it('reads no cooldown when none was ever recorded, even before the cache folder exists', async () => {
    expect(await storeFor().read()).toBeUndefined();
  });

  it.each([
    ['not JSON', '{ not json'],
    ['an unknown format version', JSON.stringify({ version: 2, until: '2026-01-01T00:05:00.000Z' })],
    ['an until that is not a date', JSON.stringify({ version: 1, until: 'later' })],
  ])('ignores a cooldown file that is %s, never failing the request over it', async (_name, text) => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'rate-limit.json'), text, 'utf8');

    expect(await storeFor().read()).toBeUndefined();
  });

  it('writes only the rate-limit file, leaving no temp file behind', async () => {
    await storeFor().record(UNTIL);

    expect(await readdir(cacheDir)).toEqual(['rate-limit.json']);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('writes the file owner-only', async () => {
    await storeFor().record(UNTIL);

    expect((await stat(join(cacheDir, 'rate-limit.json'))).mode & 0o777).toBe(0o600);
  });

  it('keeps the cooldown in memory and warns, without rejecting, when the cache folder is unwritable', async () => {
    const blocker = join(workDir, 'not-a-dir');
    await writeFile(blocker, '', 'utf8');
    const warnings: string[] = [];
    const store = storeFor(join(blocker, 'cache'), { ...silentLogger, warn: (msg) => warnings.push(msg) });

    await expect(store.record(UNTIL)).resolves.toBeUndefined();

    expect(await store.read()).toBe(UNTIL);
    expect(warnings).toEqual(['rate-limit: could not save the cooldown; this process still honours it']);
  });
});
