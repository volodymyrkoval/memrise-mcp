import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountKey } from '../../../src/auth/accountKey.js';
import type { Session } from '../../../src/auth/session.js';
import type { Logger } from '../../../src/log/logger.js';
import { FileSessionStore } from '../../../src/session/fileSessionStore.js';
import { POSIX_MODES_UNSUPPORTED } from '../../helpers/platform.js';

// Credentials are assembled at runtime so the repo secret scanner never reads them as real secrets.
const USERNAME = ['learner', 'user'].join('-');
const TOKEN = ['tok', 'alpha', 'beta', 'gamma', 'delta'].join('-');
const SESSION: Session = { accessToken: TOKEN };
const NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-session-test-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function storeFor(username = USERNAME, logger: Logger = silentLogger) {
  return new FileSessionStore({ cacheDir, account: accountKey(username), now: () => NOW_MS, logger });
}

describe('FileSessionStore', () => {
  it('loads back the session it saved', async () => {
    const store = storeFor();

    await store.save(SESSION);

    expect(await store.load()).toEqual(SESSION);
  });

  it('loads nothing after the session is cleared', async () => {
    const store = storeFor();
    await store.save(SESSION);

    await store.clear();

    expect(await store.load()).toBeNull();
  });

  it('loads nothing when no session was ever saved', async () => {
    expect(await storeFor().load()).toBeNull();
  });

  it('treats a corrupt session file as no session and logs a warning', async () => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (msg) => warnings.push(msg) };
    await writeFile(join(cacheDir, 'session.json'), '{ not json', 'utf8');

    expect(await storeFor(USERNAME, logger).load()).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it.each([
    ['wrong format version', { version: 2, account: accountKey(USERNAME), accessToken: TOKEN, createdAt: 'x' }],
    ['missing access token', { version: 1, account: accountKey(USERNAME), createdAt: 'x' }],
    ['empty access token', { version: 1, account: accountKey(USERNAME), accessToken: '', createdAt: 'x' }],
    ['another account', { version: 1, account: accountKey('someone-else'), accessToken: TOKEN, createdAt: 'x' }],
  ])('treats a session file with a %s as no session', async (_name, stored) => {
    await writeFile(join(cacheDir, 'session.json'), JSON.stringify(stored), 'utf8');

    expect(await storeFor().load()).toBeNull();
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('creates a missing cache directory with mode 0700', async () => {
    const nested = join(cacheDir, 'nested');
    const store = new FileSessionStore({
      cacheDir: nested,
      account: accountKey(USERNAME),
      now: () => NOW_MS,
      logger: silentLogger,
    });

    await store.save(SESSION);

    expect((await stat(nested)).mode & 0o777).toBe(0o700);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('writes the session file with mode 0600', async () => {
    await storeFor().save(SESSION);

    expect((await stat(join(cacheDir, 'session.json'))).mode & 0o777).toBe(0o600);
  });

  it('never writes the username into the session file', async () => {
    await storeFor().save(SESSION);

    expect(await readFile(join(cacheDir, 'session.json'), 'utf8')).not.toContain(USERNAME);
  });

  it('leaves no temporary file behind after a save', async () => {
    await storeFor().save(SESSION);

    expect(await readdir(cacheDir)).toEqual(['session.json']);
  });

  it('removes its temporary file when the final rename fails', async () => {
    await mkdir(join(cacheDir, 'session.json'));

    await expect(storeFor().save(SESSION)).rejects.toBeDefined();

    expect(await readdir(cacheDir)).toEqual(['session.json']);
  });
});
