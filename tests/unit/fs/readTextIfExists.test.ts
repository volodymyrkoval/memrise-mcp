import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTextIfExists } from '../../../src/fs/readTextIfExists.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memrise-read-text-'));
  file = join(dir, 'entry.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A read that fails with `codes`, one per call, then reads the real file. */
function readFailingWith(...codes: string[]) {
  let calls = 0;
  const fake = async (path: string) => {
    calls += 1;
    const code = codes.shift();
    if (code !== undefined) throw Object.assign(new Error(`${code}: simulated`), { code });
    return readFile(path, 'utf8');
  };
  return { readFile: fake, calls: () => calls };
}

const noWait = async () => undefined;

describe('readTextIfExists', () => {
  it('returns null when the file does not exist', async () => {
    expect(await readTextIfExists(file)).toBeNull();
  });

  it('retries a read refused while another process replaces the file (Windows), then returns the text', async () => {
    await writeFile(file, 'cached', 'utf8');
    const reader = readFailingWith('EPERM', 'EBUSY');

    expect(await readTextIfExists(file, { readFile: reader.readFile, sleep: noWait })).toBe('cached');
    expect(reader.calls()).toBe(3);
  });
});
