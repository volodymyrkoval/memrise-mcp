import { mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../../../src/fs/atomicWriteFile.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memrise-atomic-write-'));
  file = join(dir, 'entry.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

/** A rename that fails with `codes`, one per call, then behaves like the real one. */
function renameFailingWith(...codes: string[]) {
  let calls = 0;
  const fake = async (from: string, to: string) => {
    calls += 1;
    const code = codes.shift();
    if (code !== undefined) throw fsError(code);
    await rename(from, to);
  };
  return { rename: fake, calls: () => calls };
}

function recordingSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => void waits.push(ms), waits };
}

describe('writeFileAtomic', () => {
  it('retries a rename refused because another process has the file open (Windows), then writes', async () => {
    const renamer = renameFailingWith('EBUSY', 'EPERM');
    const { sleep, waits } = recordingSleep();

    await writeFileAtomic(file, 'new', 0o600, { rename: renamer.rename, sleep });

    expect(await readFile(file, 'utf8')).toBe('new');
    expect(renamer.calls()).toBe(3);
    expect(waits).toHaveLength(2);
    expect(await readdir(dir)).toEqual(['entry.json']);
  });

  it('gives up after a bounded number of short waits, leaving the old file and no temp file', async () => {
    await writeFileAtomic(file, 'old', 0o600);
    const renamer = renameFailingWith(...Array<string>(20).fill('EBUSY'));
    const { sleep, waits } = recordingSleep();

    await expect(writeFileAtomic(file, 'new', 0o600, { rename: renamer.rename, sleep })).rejects.toMatchObject({ code: 'EBUSY' });

    expect(renamer.calls()).toBe(12);
    expect(waits.every((ms) => ms > 0 && ms <= 100)).toBe(true);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(1_000);
    expect(await readFile(file, 'utf8')).toBe('old');
    expect(await readdir(dir)).toEqual(['entry.json']);
  });

  it('does not retry a failure that waiting cannot fix', async () => {
    const renamer = renameFailingWith('ENOSPC');
    const { sleep, waits } = recordingSleep();

    await expect(writeFileAtomic(file, 'new', 0o600, { rename: renamer.rename, sleep })).rejects.toMatchObject({ code: 'ENOSPC' });

    expect(renamer.calls()).toBe(1);
    expect(waits).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });
});
