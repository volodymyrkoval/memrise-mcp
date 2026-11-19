import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fileURLToPath } from 'node:url';
import { symlink } from 'node:fs/promises';
import { isEntryPoint, main } from '../../src/index.js';

const INDEX_FILE = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
import { createFixtureApp, FIXTURE_START_MS, type FixtureApp } from '../helpers/fixtureApp.js';

const LEARNABLES_PATH = '/v1.25/me/language_pairs/7/learnables/';

let workDir: string;
let cacheDir: string;
let harness: FixtureApp;
let stderr: string[];

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memrise-main-'));
  cacheDir = join(workDir, 'cache');
  harness = createFixtureApp({ cacheDir });
  stderr = [];
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** The environment a logged-in user would have, pointed at the fixture wire. */
function envFor(credentials: FixtureApp['credentials']): Record<string, string> {
  return {
    MEMRISE_USERNAME: credentials.username,
    MEMRISE_PASSWORD: credentials.password,
    MEMRISE_CACHE_DIR: cacheDir,
  };
}

function fixtureDeps() {
  return {
    transport: harness.transport,
    now: () => FIXTURE_START_MS,
    sleep: async () => undefined,
    newId: () => 'corr-1',
    stderrWrite: (line: string) => stderr.push(line),
  };
}

describe('bin entry point', () => {
  it('prints the usage on stdout for --help, without credentials, and exits 0', async () => {
    const stdout: string[] = [];
    const code = await main(['--help'], {}, { stdoutWrite: (text) => stdout.push(text), stderrWrite: (line) => stderr.push(line) });
    expect(code).toBe(0);
    expect(stdout.join('')).toMatch(/usage: memrise-mcp/);
    expect(stdout.join('')).toContain('export --out');
    expect(stderr).toEqual([]);
  });

  it('prints the package version on stdout for --version and exits 0', async () => {
    const stdout: string[] = [];
    const code = await main(['--version'], {}, { stdoutWrite: (text) => stdout.push(text) });
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(code).toBe(0);
    expect(stdout.join('')).toBe(`${pkg.version}\n`);
  });

  it('exits 2 with the usage text when export is missing --out', async () => {
    const code = await main(['export'], {}, { stderrWrite: (line) => stderr.push(line) });

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('memrise-mcp export --out <file.json>');
  });

  it('exports to the file and exits 0', async () => {
    const out = join(workDir, 'memrise.json');

    const code = await main(['export', '--out', out], envFor(harness.credentials), fixtureDeps());

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject({ language_pair_id: 7, state: 'any' });
  });

  it('exits 1 with one redacted line when the export fails at runtime', async () => {
    const out = join(workDir, 'memrise.json');

    const code = await main(['export', '--out', out], { MEMRISE_CACHE_DIR: cacheDir }, fixtureDeps());

    expect(code).toBe(1);
    expect(stderr.join('')).toBe(
      'memrise-mcp: Not set up yet: MEMRISE_USERNAME and MEMRISE_PASSWORD must be set in your client settings.\n',
    );
  });

  it('exits 1 with a clear message, before any fetch, when the out directory is missing', async () => {
    const missingDir = join(workDir, 'no-such-dir');

    const code = await main(['export', '--out', join(missingDir, 'memrise.json')], envFor(harness.credentials), fixtureDeps());

    expect(code).toBe(1);
    expect(stderr.join('')).toContain(`${missingDir} is missing or not a directory`);
    expect(harness.transport.requests).toHaveLength(0);
  });

  it('exits 1 with a clear message and leaves no temp file when the write itself fails', async () => {
    const taken = join(workDir, 'taken');
    await mkdir(taken);

    const code = await main(['export', '--out', taken], envFor(harness.credentials), fixtureDeps());

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('cannot write the export file');
    expect((await readdir(workDir)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it.each([
    ['an unknown subcommand', ['sync', '--out', 'x.json']],
    ['an unknown flag', ['export', '--out', 'x.json', '--verbose']],
    ['an unknown --state value', ['export', '--out', 'x.json', '--state', 'all']],
  ])('exits 2 with usage for %s', async (_label, argv) => {
    const code = await main(argv, envFor(harness.credentials), fixtureDeps());

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('usage: memrise-mcp');
  });

  it('exits 0 and writes warnings into the file when one lesson failed', async () => {
    harness = createFixtureApp({ cacheDir, details: { 2003: { status: 503 } } });
    const out = join(workDir, 'memrise.json');

    const code = await main(['export', '--out', out], envFor(harness.credentials), fixtureDeps());

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf8')).warnings).toEqual([expect.stringContaining('lesson 2003'), expect.stringContaining('incomplete')]);
  });

  it('exits 1 with the rate-limit message, and writes no file, when Memrise keeps answering 429', async () => {
    harness = createFixtureApp({ cacheDir, details: { 2003: { status: 429 } } });
    const out = join(workDir, 'memrise.json');

    const code = await main(['export', '--out', out], envFor(harness.credentials), fixtureDeps());

    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(
      /^memrise-mcp: Memrise asked us to slow down\. Try again after \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\.\n$/,
    );
    expect(await readdir(workDir)).not.toContain('memrise.json');
  });

  it('writes nothing to stdout while serving', async () => {
    const writes = vi.spyOn(process.stdout, 'write');
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'entry-test', version: '0.0.0' });

    const served = main([], envFor(harness.credentials), { ...fixtureDeps(), serverTransport: () => serverSide });
    await client.connect(clientSide);
    await client.listTools();
    await client.close();
    await served;

    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });

  it('serves the five tools until the client disconnects, then exits 0', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'entry-test', version: '0.0.0' });

    const served = main([], envFor(harness.credentials), { ...fixtureDeps(), serverTransport: () => serverSide });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools).toHaveLength(5);
    expect(await served).toBe(0);
  });

  it('exports refetch the words even when the word cache is fresh', async () => {
    const out = join(workDir, 'memrise.json');
    const env = envFor(harness.credentials);
    await main(['export', '--out', out], env, fixtureDeps());
    const learnableRequestsBefore = harness.transport.countFor(LEARNABLES_PATH);

    await main(['export', '--out', out], env, fixtureDeps());

    expect(harness.transport.countFor(LEARNABLES_PATH) - learnableRequestsBefore).toBeGreaterThan(0);
  });
});

describe('isEntryPoint', () => {
  it('is false when the process was started with no script path', () => {
    expect(isEntryPoint(undefined, new URL('../../src/index.ts', import.meta.url).href)).toBe(false);
  });

  it('is false for a different script, so importing this module runs nothing', () => {
    expect(isEntryPoint(fileURLToPath(import.meta.url), new URL('../../src/index.ts', import.meta.url).href)).toBe(false);
  });

  // Creating a symlink on Windows needs a privilege, and npm installs a .cmd shim there instead; the
  // startup smoke test (npm run smoke:startup) covers that shim.
  it.skipIf(process.platform === 'win32')('is true when the bin is a symlink to this module (the installed bin)', async () => {
    const link = join(workDir, 'memrise-mcp');
    await symlink(INDEX_FILE, link);

    expect(isEntryPoint(link, new URL('../../src/index.ts', import.meta.url).href)).toBe(true);
  });
});
