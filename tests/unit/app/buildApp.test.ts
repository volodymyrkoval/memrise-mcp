import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../src/app/buildApp.js';
import { formatUserMessage } from '../../../src/errorMessages.js';
import { AuthError, UsageError } from '../../../src/errors.js';
import { createFixtureApp } from '../../helpers/fixtureApp.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';
import { runtimeSecret } from '../../helpers/runtimeSecret.js';

let cacheDir: string;
let lines: string[];

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-build-app-'));
  lines = [];
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function appWith(env: Record<string, string | undefined>, transport = new RoutedTransport()) {
  return buildApp({
    env: { MEMRISE_CACHE_DIR: cacheDir, ...env },
    transport,
    now: () => 0,
    sleep: async () => {},
    newId: () => 'corr-1',
    stderrWrite: (line) => lines.push(line),
  });
}

describe('buildApp', () => {
  it('makes no request and checks no credential at construction', () => {
    const transport = new RoutedTransport();
    const username = runtimeSecret('user');
    const password = runtimeSecret('pw');

    appWith({ MEMRISE_USERNAME: username, MEMRISE_PASSWORD: password }, transport);
    appWith({}, transport);

    expect(transport.requests).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('masks the password wherever it is echoed: in a log line and in a user-facing message', () => {
    const username = runtimeSecret('user');
    const password = runtimeSecret('pw');
    const app = appWith({ MEMRISE_USERNAME: username, MEMRISE_PASSWORD: password });

    app.logger.warn('login echoed the password', { cause: `echo ${password}` });
    const message = formatUserMessage(new UsageError(`rejected ${password}`), app.redactor);

    expect(lines.join('')).toContain('<redacted>');
    expect(lines.join('')).not.toContain(password);
    expect(message).toContain('<redacted>');
    expect(message).not.toContain(password);
  });

  it('stamps log lines with the time from the clock it is given', () => {
    const app = appWith({});

    app.logger.warn('a warning');

    expect(lines).toEqual(['memrise-mcp 1970-01-01T00:00:00.000Z [warn] a warning\n']);
  });

  it('masks the username and password in an error cause chain', () => {
    const username = runtimeSecret('user');
    const password = runtimeSecret('pw');
    const app = appWith({ MEMRISE_USERNAME: username, MEMRISE_PASSWORD: password });
    const err = new AuthError('access_token', 'malformed response', { cause: new Error(`${username} ${password}`) });

    const redacted = app.redactor.redactError(err);

    expect(redacted).not.toContain(username);
    expect(redacted).not.toContain(password);
  });

  it('paces requests through the cache folder, so other processes on it keep their distance', async () => {
    const { app } = createFixtureApp({ cacheDir });

    await app.queries.listWords({ limit: 1, includeAudio: false });

    const files = await readdir(cacheDir);
    expect(files).toContain('pacer.json');
    expect(files).not.toContain('pacer.lock');
  });
});
