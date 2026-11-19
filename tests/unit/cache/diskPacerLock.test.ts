import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskPacerLock, LOCK_WAIT_TIMEOUT_MS, NODE_LOCK_FILES, STALE_LOCK_AGE_MS, type LockFiles } from '../../../src/cache/diskPacerLock.js';
import { PacerLockTimeoutError } from '../../../src/errors.js';
import { MAX_RETRY_AFTER_WAIT_MS } from '../../../src/http/rateLimit.js';
import { RequestPacer } from '../../../src/http/requestPacer.js';
import type { Logger } from '../../../src/log/logger.js';
import { runActors, type ActorClock } from '../../helpers/actorClock.js';
import { createFakeClock, type FakeClock } from '../../helpers/fakeClock.js';
import { POSIX_MODES_UNSUPPORTED } from '../../helpers/platform.js';
import { longestRunWhileOthersWait } from '../../helpers/turnTaking.js';

const START = Date.parse('2026-01-01T00:00:00.000Z');

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

let workDir: string;
let cacheDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memrise-pacer-lock-test-'));
  cacheDir = join(workDir, 'cache');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** One pacer per simulated process; pacers built on the same folder share the disk lock and state. */
function pacerFor(clock: FakeClock, dir = cacheDir, logger: Logger = silentLogger): RequestPacer {
  const lock = new DiskPacerLock({ cacheDir: dir, now: clock.now, sleep: clock.sleep, logger });
  return new RequestPacer({ now: clock.now, sleep: clock.sleep, lock });
}

/** Leaves a lock in the cache folder as if another process held it. */
async function placeLock(holder: { pid: number; acquiredAt: number }): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const contents = { pid: holder.pid, token: 'placed-by-test', acquiredAt: new Date(holder.acquiredAt).toISOString() };
  await writeFile(join(cacheDir, 'pacer.lock'), JSON.stringify(contents), 'utf8');
}

/** The pid of a child that has already exited and been reaped: certainly not alive. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (child.pid === undefined) throw new Error('could not start a child process');
  return child.pid;
}

type LockFileOp = keyof LockFiles;

/**
 * The real lock files, except that each operation first fails with the queued error codes, the way
 * Windows refuses to touch a file another process has open or is deleting. `pending` counts the
 * queued failures not yet thrown.
 */
function lockFilesFailing(failures: Partial<Record<LockFileOp, string[]>>) {
  const queue = (op: LockFileOp) => failures[op] ?? [];
  const failNext = (op: LockFileOp) => {
    const code = queue(op).shift();
    if (code !== undefined) throw Object.assign(new Error(`${code}: simulated`), { code });
  };
  const files: LockFiles = {
    read: async (file) => (failNext('read'), NODE_LOCK_FILES.read(file)),
    createNew: async (file, contents) => (failNext('createNew'), NODE_LOCK_FILES.createNew(file, contents)),
    remove: async (file) => (failNext('remove'), NODE_LOCK_FILES.remove(file)),
  };
  const pending = () => Object.values(failures).reduce((sum, codes) => sum + (codes?.length ?? 0), 0);
  return { files, pending };
}

function pacerWithFiles(clock: FakeClock, files: LockFiles, logger: Logger = silentLogger): RequestPacer {
  const lock = new DiskPacerLock({ cacheDir, now: clock.now, sleep: clock.sleep, logger, files });
  return new RequestPacer({ now: clock.now, sleep: clock.sleep, lock });
}

async function placeState(text: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'pacer.json'), text, 'utf8');
}

describe('DiskPacerLock', () => {
  it('keeps the gap between request starts of two processes on the same cache folder', async () => {
    const clock = createFakeClock(START);
    const starts: number[] = [];
    const task = async () => {
      starts.push(clock.now());
    };

    await pacerFor(clock).run(task);
    await pacerFor(clock).run(task);

    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(300);
  });

  it('never lets two processes on the same cache folder send at the same time', async () => {
    const starts: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const sendTwice = async (clock: ActorClock) => {
      const lock = new DiskPacerLock({ cacheDir, now: clock.now, sleep: clock.sleep, logger: silentLogger });
      const pacer = new RequestPacer({ now: clock.now, sleep: clock.sleep, lock });
      for (let i = 0; i < 2; i += 1) {
        await pacer.run(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          starts.push(clock.now());
          await clock.sleep(5);
          inFlight -= 1;
        });
      }
    };

    await runActors(START, [sendTwice, sendTwice]);

    expect(maxInFlight).toBe(1);
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(300);
  });

  it.each([
    ['shorter', 40],
    ['longer', 500],
  ])('lets two processes on the same cache folder take turns, when requests are %s than the gap', async (_name, onWireMs) => {
    const perProcess = 6;
    const starts: Array<{ owner: number; at: number }> = [];
    const sendAll = (owner: number) => async (clock: ActorClock) => {
      const lock = new DiskPacerLock({ cacheDir, now: clock.now, sleep: clock.sleep, logger: silentLogger });
      const pacer = new RequestPacer({ now: clock.now, sleep: clock.sleep, lock });
      for (let i = 0; i < perProcess; i += 1) {
        await pacer.run(async () => {
          starts.push({ owner, at: clock.now() });
          await clock.sleep(onWireMs);
        });
      }
    };

    await runActors(START, [sendAll(1), sendAll(2)]);

    expect(starts).toHaveLength(2 * perProcess);
    expect(longestRunWhileOthersWait(starts.map((s) => s.owner))).toBeLessThanOrEqual(2);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i].at - starts[i - 1].at).toBeGreaterThanOrEqual(300);
  });

  it('releases the lock when the request fails', async () => {
    const clock = createFakeClock(START);

    await expect(
      pacerFor(clock).run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await readdir(cacheDir)).not.toContain('pacer.lock');
  });

  it('leaves alone a lock that another process took after this one lost it', async () => {
    const clock = createFakeClock(START);
    const othersLock = JSON.stringify({ pid: process.pid, token: 'other-holder', acquiredAt: new Date(START).toISOString() });

    await pacerFor(clock).run(async () => {
      await writeFile(join(cacheDir, 'pacer.lock'), othersLock, 'utf8');
    });

    expect(await readFile(join(cacheDir, 'pacer.lock'), 'utf8')).toBe(othersLock);
  });

  it('gives up with a clear error, naming no path, when another live process keeps the lock too long', async () => {
    const clock = createFakeClock(START);
    await placeLock({ pid: process.pid, acquiredAt: START });
    let sent = false;

    const err = await pacerFor(clock)
      .run(async () => {
        sent = true;
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PacerLockTimeoutError);
    expect((err as Error).message).toBe(
      'timed out waiting for another memrise-mcp process to finish its request (lock file pacer.lock in the cache folder)',
    );
    expect((err as Error).message).not.toContain(workDir);
    expect(sent).toBe(false);
    expect(clock.now() - START).toBeGreaterThanOrEqual(LOCK_WAIT_TIMEOUT_MS);
    expect(new Set(clock.sleeps)).toEqual(new Set([50]));
  });

  it('breaks a lock left behind by a process that is no longer running', async () => {
    const clock = createFakeClock(START);
    await placeLock({ pid: deadPid(), acquiredAt: START });

    await expect(pacerFor(clock).run(async () => 'sent')).resolves.toBe('sent');

    expect(clock.sleeps).toEqual([]);
  });

  it('keeps a live process its lock through a long 429 back-off, never breaking it on age alone', async () => {
    const backOffStart = START - MAX_RETRY_AFTER_WAIT_MS;
    const clock = createFakeClock(START);
    await placeLock({ pid: process.pid, acquiredAt: backOffStart });

    await expect(pacerFor(clock).run(async () => 'sent')).rejects.toBeInstanceOf(PacerLockTimeoutError);

    expect(clock.now() - backOffStart).toBeLessThan(STALE_LOCK_AGE_MS);
  });

  it('breaks a lock held longer than any request can take, even if its pid is alive (reused by another program)', async () => {
    const clock = createFakeClock(START);
    await placeLock({ pid: process.pid, acquiredAt: START - STALE_LOCK_AGE_MS - 1 });

    await expect(pacerFor(clock).run(async () => 'sent')).resolves.toBe('sent');

    expect(clock.sleeps).toEqual([]);
  });

  it('stamps its lock with the time it got it, not the time it started waiting', async () => {
    const clock = createFakeClock(START);
    await placeLock({ pid: process.pid, acquiredAt: START });
    const otherHolderDone = START + 100_000;
    const sleep = async (ms: number) => {
      await clock.sleep(ms);
      if (clock.now() === otherHolderDone) await unlink(join(cacheDir, 'pacer.lock'));
    };
    const lock = new DiskPacerLock({ cacheDir, now: clock.now, sleep, logger: silentLogger });
    let stamped = '';

    await new RequestPacer({ now: clock.now, sleep, lock }).run(async () => {
      stamped = JSON.parse(await readFile(join(cacheDir, 'pacer.lock'), 'utf8')).acquiredAt;
    });

    expect(Date.parse(stamped)).toBe(otherHolderDone);
  });

  it('waits no longer than one gap when the recorded start lies in the future (clock skew, corrupt file)', async () => {
    const clock = createFakeClock(START);
    await placeState(JSON.stringify({ version: 1, lastStart: new Date(START + 86_400_000).toISOString() }));

    await pacerFor(clock).run(async () => 'sent');

    expect(clock.sleeps).toEqual([300]);
  });

  it.each([
    ['not JSON', '{ not json'],
    ['an unknown format version', JSON.stringify({ version: 2, lastStart: '2026-01-01T00:00:00.000Z' })],
    ['a start that is not a date', JSON.stringify({ version: 1, lastStart: 'earlier' })],
  ])('treats a state file that is %s as no previous start', async (_name, text) => {
    const clock = createFakeClock(START);
    await placeState(text);

    await expect(pacerFor(clock).run(async () => 'sent')).resolves.toBe('sent');

    expect(clock.sleeps).toEqual([]);
  });

  it('falls back to pacing within this process, warning once, when the cache folder cannot be written', async () => {
    const blocker = join(workDir, 'not-a-dir');
    await writeFile(blocker, '', 'utf8');
    const clock = createFakeClock(START);
    const warnings: string[] = [];
    const pacer = pacerFor(clock, join(blocker, 'cache'), { ...silentLogger, warn: (msg) => warnings.push(msg) });
    const starts: number[] = [];
    const task = async () => {
      starts.push(clock.now());
    };

    await Promise.all([pacer.run(task), pacer.run(task), pacer.run(task)]);

    expect(starts).toEqual([START, START + 300, START + 600]);
    expect(warnings).toEqual([
      'pacer: cannot keep the request lock in the cache folder; pacing requests within this process only',
    ]);
  });

  it('still sends, then paces within this process, when the start time cannot be saved', async () => {
    await mkdir(join(cacheDir, 'pacer.json'), { recursive: true });
    const clock = createFakeClock(START);
    const warnings: string[] = [];
    const pacer = pacerFor(clock, cacheDir, { ...silentLogger, warn: (msg) => warnings.push(msg) });
    const starts: number[] = [];
    const task = async () => {
      starts.push(clock.now());
    };

    await Promise.all([pacer.run(task), pacer.run(task)]);

    expect(starts).toEqual([START, START + 300]);
    expect(warnings).toHaveLength(1);
    expect(await readdir(cacheDir)).not.toContain('pacer.lock');
  });

  it.each([
    ['keeps', 'just written', START, PacerLockTimeoutError],
    ['breaks', 'abandoned long ago', START - STALE_LOCK_AGE_MS - 1_000, undefined],
  ])('%s a lock whose holder cannot be read (%s), judging it by the file time', async (_verb, _age, mtime, error) => {
    const clock = createFakeClock(START);
    const lockFile = join(cacheDir, 'pacer.lock');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(lockFile, '', 'utf8');
    await utimes(lockFile, new Date(mtime), new Date(mtime));

    const outcome = await pacerFor(clock)
      .run(async () => 'sent')
      .catch((e: unknown) => e);

    if (error === undefined) expect(outcome).toBe('sent');
    else expect(outcome).toBeInstanceOf(error);
  });

  it('leaves only the start time behind once the request is done', async () => {
    await pacerFor(createFakeClock(START)).run(async () => undefined);

    expect(await readdir(cacheDir)).toEqual(['pacer.json']);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED)('keeps its files owner-only', async () => {
    const clock = createFakeClock(START);
    let lockMode = 0;

    await pacerFor(clock).run(async () => {
      lockMode = (await stat(join(cacheDir, 'pacer.lock'))).mode & 0o777;
    });

    expect(lockMode).toBe(0o600);
    expect((await stat(join(cacheDir, 'pacer.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(cacheDir)).mode & 0o777).toBe(0o700);
  });
});

describe('DiskPacerLock on Windows file-sharing errors', () => {
  it('still removes its lock when the delete is briefly refused (another process has it open)', async () => {
    const clock = createFakeClock(START);
    const fs = lockFilesFailing({ remove: ['EBUSY', 'EPERM'] });

    await pacerWithFiles(clock, fs.files).run(async () => 'sent');

    expect(fs.pending()).toBe(0);
    expect(await readdir(cacheDir)).toEqual(['pacer.json']);
  });

  it('still removes its lock when reading it back is briefly refused', async () => {
    const clock = createFakeClock(START);
    const fs = lockFilesFailing({ read: ['EBUSY'] });

    await pacerWithFiles(clock, fs.files).run(async () => 'sent');

    expect(fs.pending()).toBe(0);
    expect(await readdir(cacheDir)).toEqual(['pacer.json']);
  });

  it('keeps using the shared lock when creating it is briefly refused (the previous lock is still being deleted)', async () => {
    const clock = createFakeClock(START);
    const warnings: string[] = [];
    const fs = lockFilesFailing({ createNew: ['EPERM', 'EBUSY'] });

    await pacerWithFiles(clock, fs.files, { ...silentLogger, warn: (msg) => warnings.push(msg) }).run(async () => 'sent');

    expect(fs.pending()).toBe(0);
    expect(warnings).toEqual([]);
    expect(await readdir(cacheDir)).toEqual(['pacer.json']);
  });

  it('falls back to pacing within this process after a short while when creating the lock stays refused', async () => {
    const clock = createFakeClock(START);
    const warnings: string[] = [];
    const fs = lockFilesFailing({ createNew: Array<string>(50).fill('EACCES') });

    await expect(
      pacerWithFiles(clock, fs.files, { ...silentLogger, warn: (msg) => warnings.push(msg) }).run(async () => 'sent'),
    ).resolves.toBe('sent');

    expect(warnings).toHaveLength(1);
    expect(clock.now() - START).toBeLessThan(2_000);
  });

  it('waits, without failing, while the lock of another live process cannot be read (it is being deleted)', async () => {
    const clock = createFakeClock(START);
    await placeLock({ pid: process.pid, acquiredAt: START });
    const fs = lockFilesFailing({ read: ['EPERM', 'ENOENT', 'EBUSY'] });
    const otherHolderDone = START + 1_000;
    const sleep = async (ms: number) => {
      await clock.sleep(ms);
      if (clock.now() === otherHolderDone) await unlink(join(cacheDir, 'pacer.lock'));
    };
    const lock = new DiskPacerLock({ cacheDir, now: clock.now, sleep, logger: silentLogger, files: fs.files });

    await expect(new RequestPacer({ now: clock.now, sleep, lock }).run(async () => 'sent')).resolves.toBe('sent');

    expect(fs.pending()).toBe(0);
    expect(clock.now()).toBeGreaterThanOrEqual(otherHolderDone);
  });
});
