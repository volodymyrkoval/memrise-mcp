/**
 * Two real processes on one real cache folder. Unit tests simulate Windows file-sharing errors; these
 * prove, on each CI OS, that the atomic writes, the reads and the cross-process pacer lock really
 * hold up when another process is touching the same files. No network: the HTTP transport is fake.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskPacerLock } from '../../src/cache/diskPacerLock.js';
import { readTextIfExists } from '../../src/fs/readTextIfExists.js';
import { MIN_REQUEST_GAP_MS, RequestPacer } from '../../src/http/requestPacer.js';
import type { Logger } from '../../src/log/logger.js';
import { longestRunWhileOthersWait } from '../helpers/turnTaking.js';
import { sleep, startChild, type Finished } from './childProcess.js';

/**
 * The pacer promises `MIN_REQUEST_GAP_MS` between the starts it records, and the children log those
 * recorded starts, so the gap is asserted on them rather than on when a request reached the wire:
 * that moment trails the recorded start by however long the state-file write and the scheduler take,
 * which varies per request. The tolerance only covers a timer firing a millisecond early and the
 * millisecond rounding of `Date.now()`.
 */
const CLOCK_TOLERANCE_MS = 5;
/**
 * Breaking a dead holder's lock takes milliseconds; waiting out `STALE_LOCK_AGE_MS` takes over two
 * minutes. The bound sits far from both, so a slow CI machine cannot trip it and a regression cannot hide.
 */
const BREAKS_STALE_LOCK_WITHIN_MS = 30_000;
/**
 * The processes should alternate. A real scheduler can delay one process's poll past the moment
 * the other leaves the lock free (a loaded CI machine, a Windows timer firing late), so one process
 * may send twice in a row now and then; three in a row means it is not taking turns.
 */
const MAX_REQUESTS_IN_A_ROW = 2;

/**
 * A process stores a fetched lesson just after it gives the lock back, so a process whose poll lands
 * in those few milliseconds re-checks too early and fetches the lesson again. That is rare (about one
 * lesson in a hundred here); without the re-check every lesson is fetched twice.
 */
const MAX_DUPLICATE_FETCHES = 2;

let workDir: string;
let cacheDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memrise-realfs-'));
  cacheDir = join(workDir, 'cache');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true, maxRetries: 5 });
});

function expectCleanExit(result: Finished): void {
  expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: '' });
}

/** Parses every file at `paths` that exists, failing on any that is not complete JSON. Returns how many it read. */
async function checkParses(paths: readonly string[]): Promise<number> {
  let read = 0;
  for (const path of paths) {
    const text = await readTextIfExists(path);
    if (text === null) continue;
    expect(() => JSON.parse(text), `${path} held: ${text.slice(0, 80)}`).not.toThrow();
    read += 1;
  }
  return read;
}

describe('two processes on one cache folder', () => {
  it('both rewrite the same cache entries without a sharing error, and every file is always valid JSON', async () => {
    const rounds = '150';
    const writers = [startChild('cacheWriter.ts', [cacheDir, 'first', rounds]), startChild('cacheWriter.ts', [cacheDir, 'second', rounds])];
    const files = [join(cacheDir, 'scenario-details', '1001.json'), join(cacheDir, 'session.json')];
    let running = true;
    const results = Promise.all(writers.map((w) => w.finished)).finally(() => {
      running = false;
    });

    let reads = 0;
    while (running) {
      reads += await checkParses(files);
      await sleep(2);
    }

    for (const result of await results) expectCleanExit(result);
    expect(reads).toBeGreaterThan(0);
    expect(await checkParses(files)).toBe(2);
  });

  it('send through the shared pacer lock one at a time, at least the pacing gap apart, taking turns', async () => {
    const perProcess = 5;
    const ready = [join(workDir, 'ready-1'), join(workDir, 'ready-2')];
    const out = [join(workDir, 'intervals-1.json'), join(workDir, 'intervals-2.json')];
    const go = join(workDir, 'go');
    const senders = [0, 1].map((i) => startChild('pacedRequests.ts', [cacheDir, ready[i], go, String(perProcess), out[i]]));

    while (!ready.every((file) => existsSync(file))) await sleep(10);
    await writeFile(go, '');
    for (const result of await Promise.all(senders.map((s) => s.finished))) expectCleanExit(result);

    const logs = await Promise.all(out.map(async (file) => JSON.parse(await readFile(file, 'utf8')) as IntervalLog));
    const requests = logs
      .flatMap((log) => log.intervals.map((interval) => ({ ...interval, pid: log.pid })))
      .sort((a, b) => a.recordedAt - b.recordedAt);
    expect(requests).toHaveLength(2 * perProcess);
    for (const [i, request] of requests.entries()) {
      expect(request.start, `request ${i} reached the wire before its start was recorded`).toBeGreaterThanOrEqual(request.recordedAt);
    }
    for (let i = 1; i < requests.length; i += 1) {
      const [previous, current] = [requests[i - 1], requests[i]];
      expect(current.start, `request ${i} overlaps request ${i - 1}`).toBeGreaterThanOrEqual(previous.end);
      expect(current.recordedAt - previous.recordedAt, `gap before request ${i}`).toBeGreaterThanOrEqual(MIN_REQUEST_GAP_MS - CLOCK_TOLERANCE_MS);
    }
    const order = requests.map((request) => request.pid);
    expect(longestRunWhileOthersWait(order), `senders in start order: ${order.join(' ')}`).toBeLessThanOrEqual(MAX_REQUESTS_IN_A_ROW);
  });

  it('fetch each lesson once between them when both walk the same lessons side by side', async () => {
    const lessons = 8;
    const ready = [join(workDir, 'ready-1'), join(workDir, 'ready-2')];
    const out = [join(workDir, 'sent-1.json'), join(workDir, 'sent-2.json')];
    const go = join(workDir, 'go');
    const walkers = [0, 1].map((i) => startChild('sharedLessons.ts', [cacheDir, ready[i], go, String(lessons), out[i]]));

    while (!ready.every((file) => existsSync(file))) await sleep(10);
    await writeFile(go, '');
    for (const result of await Promise.all(walkers.map((w) => w.finished))) expectCleanExit(result);

    const sent = await Promise.all(out.map(async (file) => (JSON.parse(await readFile(file, 'utf8')) as { sent: number }).sent));
    expect(sent[0] + sent[1], `sent per process: ${sent.join(', ')}`).toBeLessThanOrEqual(lessons + MAX_DUPLICATE_FETCHES);
  });

  it('breaks the lock a crashed process left behind', async () => {
    const holder = startChild('holdLock.ts', [cacheDir]);
    await holder.waitForLine('locked');
    holder.process.kill('SIGKILL');
    await holder.finished;
    expect(existsSync(join(cacheDir, 'pacer.lock'))).toBe(true);

    const warnings: string[] = [];
    const logger: Logger = { debug() {}, info() {}, warn: (msg) => warnings.push(msg), error() {} };
    const pacer = new RequestPacer({ now: Date.now, sleep, lock: new DiskPacerLock({ cacheDir, now: Date.now, sleep, logger }) });
    const startedAt = Date.now();

    await expect(pacer.run(async () => 'sent')).resolves.toBe('sent');

    expect(Date.now() - startedAt).toBeLessThan(BREAKS_STALE_LOCK_WITHIN_MS);
    expect(warnings).toEqual([]);
    expect(existsSync(join(cacheDir, 'pacer.lock'))).toBe(false);
  });
});

interface IntervalLog {
  pid: number;
  /** `recordedAt` is the start the pacer stored for the request; `start`/`end` bracket its time on the wire. */
  intervals: Array<{ recordedAt: number; start: number; end: number }>;
}
