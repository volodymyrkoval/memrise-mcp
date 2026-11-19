import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../../../scripts/checkSecrets.js';

const execFileAsync = promisify(execFile);

// Fake values only. The cookie sample is joined at runtime so this file never
// contains the contiguous string the repo scanner flags.
const COOKIE_SAMPLE = ['sessionid_2', 'abc123'].join('=');
const AUTHOR_EMAIL = ['someone', 'mail.test'].join('@');
const OTHER_EMAIL = ['other', 'mail.test'].join('@');

describe('check-secrets', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'check-secrets-'));
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  async function track(name: string, content: string): Promise<void> {
    await writeFile(join(repo, name), content);
    await execFileAsync('git', ['add', name], { cwd: repo });
  }

  async function runCheck(env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main({ cwd: repo, env, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out, err };
  }

  it('exits 0 when every tracked file is clean', async () => {
    await track('notes.txt', 'nothing sensitive here\n');

    const { code } = await runCheck();

    expect(code).toBe(0);
  });

  it('exits 1 and names file, line and kind for a tracked session cookie', async () => {
    await track('notes.txt', `ok\n${COOKIE_SAMPLE}\n`);

    const { code, err } = await runCheck();

    expect(code).toBe(1);
    expect(err).toEqual(['notes.txt:2:session-cookie']);
  });

  it('allows the e-mail on the author line of package.json', async () => {
    await track('package.json', `{\n  "author": "someone <${AUTHOR_EMAIL}>"\n}\n`);

    const { code } = await runCheck();

    expect(code).toBe(0);
  });

  it('still flags other e-mails in package.json and the author e-mail elsewhere', async () => {
    await track('package.json', `{\n  "author": "someone <${AUTHOR_EMAIL}>",\n  "contact": "${OTHER_EMAIL}"\n}\n`);
    await track('notes.txt', `${AUTHOR_EMAIL}\n`);

    const { code, err } = await runCheck();

    expect(code).toBe(1);
    expect(err).toEqual(['notes.txt:1:email', 'package.json:3:email']);
  });

  it('allows placeholder e-mails on reserved example domains', async () => {
    const placeholder = ['your-email', 'example.com'].join('@');
    await track('guide.md', `Use ${placeholder} here\n`);

    const { code } = await runCheck();

    expect(code).toBe(0);
  });

  it('still flags an e-mail on a lookalike of a reserved domain', async () => {
    const lookalike = ['me', 'example.com.evil.io'].join('@');
    await track('guide.md', `${lookalike}\n`);

    const { code, err } = await runCheck();

    expect(code).toBe(1);
    expect(err).toEqual(['guide.md:1:email']);
  });

  it('ignores untracked files', async () => {
    await writeFile(join(repo, 'untracked.txt'), `${COOKIE_SAMPLE}\n`);
    await track('notes.txt', 'clean\n');

    const { code } = await runCheck();

    expect(code).toBe(0);
  });

  it('flags a tracked file containing MEMRISE_PASSWORD from the environment', async () => {
    const password = 'fake-pass-word-42';
    await track('notes.txt', `login with ${password}\n`);

    const { code, err } = await runCheck({ MEMRISE_PASSWORD: password });

    expect(code).toBe(1);
    expect(err).toEqual(['notes.txt:1:known-secret']);
  });

  it('skips a tracked file that was deleted from the working tree', async () => {
    await track('gone.txt', 'clean\n');
    await track('notes.txt', 'clean\n');
    await rm(join(repo, 'gone.txt'));

    const { code } = await runCheck();

    expect(code).toBe(0);
  });
});
