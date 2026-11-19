/**
 * Request pacing shared by every process on one cache folder. A request takes `<cache dir>/pacer.lock`
 * (created with O_EXCL; `{"pid","token","acquiredAt"}`) for its whole pacer turn, reads the previous
 * start from `<cache dir>/pacer.json` (`{"version":1,"lastStart":"<ISO time>"}`), records its own
 * start there, sends, and removes the lock, then leaves it free for a moment so processes take
 * turns. Both files are mode 0600 in a 0700 folder (POSIX only; Windows ignores modes). When the
 * folder cannot be used, the process falls back to pacing on its own and warns once.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PacerLockTimeoutError } from '../errors.js';
import { writeFileAtomic } from '../fs/atomicWriteFile.js';
import { parseJson } from '../fs/parseJson.js';
import { retryWhileBusy } from '../fs/retryWhileBusy.js';
import { MAX_PACED_REQUEST_MS } from '../http/httpClient.js';
import { InProcessPacerLock, type PacerLock, type PacerSlot } from '../http/requestPacer.js';
import type { Now, Sleep } from '../http/transport.js';
import type { Logger } from '../log/logger.js';

const LOCK_FILE = 'pacer.lock';
const STATE_FILE = 'pacer.json';
const POLL_MS = 50;
/**
 * After releasing, this process leaves the lock free this long before trying for it again, so a
 * process polling every `POLL_MS` gets its turn instead of seeing the lock re-taken at once. Two
 * polls wide, so one late timer (Windows rounds to about 16 ms) still lands inside the window. When
 * requests are shorter than the gap it costs nothing (the gap wait is longer); alone with longer
 * requests it adds up to this much per request.
 */
const YIELD_AFTER_RELEASE_MS = 2 * POLL_MS;
/** Long enough to wait out a holder in the longest 429 back-off (120 s) plus a normal request, short enough for a tool call. */
export const LOCK_WAIT_TIMEOUT_MS = 150_000;
/**
 * A live holder keeps its lock for its whole turn, which includes retries and a 429 wait of up to
 * 120 s, so age alone breaks a lock only past the longest possible turn plus a margin. Before that,
 * only a dead holder pid makes a lock stale. Past it, the pid is not trusted: it may have been reused.
 */
export const STALE_LOCK_AGE_MS = MAX_PACED_REQUEST_MS + 5_000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const lockHolderSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string(),
  acquiredAt: z.string(),
});

interface LockHolder {
  /** `undefined` when the lock could not be read. */
  pid: number | undefined;
  acquiredAt: number;
}

const storedStateSchema = z.object({
  version: z.literal(1),
  lastStart: z.string(),
});

/** The lock-file operations; tests replace them to simulate Windows file-sharing errors. */
export interface LockFiles {
  read(file: string): Promise<string>;
  /** Creates `file` only when it does not exist (O_EXCL); rejects with EEXIST otherwise. */
  createNew(file: string, contents: string): Promise<void>;
  remove(file: string): Promise<void>;
}

export const NODE_LOCK_FILES: LockFiles = {
  read: (file) => readFile(file, 'utf8'),
  createNew: (file, contents) => writeFile(file, contents, { mode: FILE_MODE, flag: 'wx' }),
  remove: (file) => unlink(file),
};

export interface DiskPacerLockDeps {
  cacheDir: string;
  now: Now;
  sleep: Sleep;
  logger: Logger;
  files?: LockFiles;
}

/** The `PacerLock` behind `RequestPacer` in production: the in-process queue runs first, then this file lock. */
export class DiskPacerLock implements PacerLock {
  readonly #dir: string;
  readonly #lockFile: string;
  readonly #stateFile: string;
  readonly #now: Now;
  readonly #sleep: Sleep;
  readonly #logger: Logger;
  readonly #files: LockFiles;
  /** Set once the cache folder proved unusable; from then on this process paces on its own. */
  #fallback: PacerLock | undefined;
  /** When this process last gave the lock back; `undefined` before its first turn. */
  #releasedAt: number | undefined;

  constructor({ cacheDir, now, sleep, logger, files = NODE_LOCK_FILES }: DiskPacerLockDeps) {
    this.#dir = cacheDir;
    this.#lockFile = join(cacheDir, LOCK_FILE);
    this.#stateFile = join(cacheDir, STATE_FILE);
    this.#now = now;
    this.#sleep = sleep;
    this.#logger = logger;
    this.#files = files;
  }

  async acquire(): Promise<PacerSlot> {
    if (this.#fallback !== undefined) return this.#fallback.acquire();
    await this.#yieldAfterRelease();
    let ownLock: string;
    try {
      ownLock = await this.#takeLock();
    } catch (err) {
      if (err instanceof PacerLockTimeoutError) throw err;
      return this.#fallBack().acquire();
    }
    return {
      lastStart: await this.#readLastStart(),
      recordStart: (at) => this.#recordStart(at),
      release: async () => {
        await this.#removeLockIfUnchanged(ownLock);
        this.#releasedAt = this.#now();
      },
    };
  }

  /** Takes turns with other processes: see `YIELD_AFTER_RELEASE_MS`. */
  async #yieldAfterRelease(): Promise<void> {
    if (this.#releasedAt === undefined) return;
    const wait = this.#releasedAt + YIELD_AFTER_RELEASE_MS - this.#now();
    if (wait > 0) await this.#sleep(wait);
  }

  /** A start that cannot be saved must not cost the request: this process keeps it and paces on its own. */
  async #recordStart(at: number): Promise<void> {
    try {
      await this.#writeLastStart(at);
    } catch {
      const slot = await this.#fallBack().acquire();
      await slot.recordStart(at);
    }
  }

  /** Switches this process to pacing on its own; the warning is written once, on the switch. */
  #fallBack(): PacerLock {
    if (this.#fallback !== undefined) return this.#fallback;
    this.#logger.warn('pacer: cannot keep the request lock in the cache folder; pacing requests within this process only');
    this.#fallback = new InProcessPacerLock();
    return this.#fallback;
  }

  /**
   * Removes the lock only while it still holds `contents`, so a lock someone else took since is never
   * deleted. The read and the unlink are two steps; losing that race costs at most one overlapping
   * request, never a stuck lock. A read or delete Windows refuses while another process has the lock
   * open is retried briefly. Never rejects.
   */
  async #removeLockIfUnchanged(contents: string): Promise<void> {
    const current = await retryWhileBusy(() => this.#files.read(this.#lockFile), this.#sleep).catch(() => null);
    if (current === contents) await retryWhileBusy(() => this.#files.remove(this.#lockFile), this.#sleep).catch(() => undefined);
  }

  /** Returns the contents written, which identify this holder. */
  async #takeLock(): Promise<string> {
    await mkdir(this.#dir, { recursive: true, mode: DIR_MODE });
    const token = randomBytes(8).toString('hex');
    const deadline = this.#now() + LOCK_WAIT_TIMEOUT_MS;
    for (;;) {
      try {
        const contents = JSON.stringify({ pid: process.pid, token, acquiredAt: new Date(this.#now()).toISOString() });
        await retryWhileBusy(() => this.#files.createNew(this.#lockFile, contents), this.#sleep);
        return contents;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        if (await this.#breakIfStale()) continue;
        if (this.#now() >= deadline) throw new PacerLockTimeoutError();
        await this.#sleep(POLL_MS);
      }
    }
  }

  /** True when the lock was found stale and removed, so taking it can be tried again at once. */
  async #breakIfStale(): Promise<boolean> {
    const contents = await this.#files.read(this.#lockFile).catch(() => null);
    if (contents === null) return false;
    const holder = await this.#describeHolder(contents);
    if (holder === null || !this.#isStale(holder)) return false;
    await this.#removeLockIfUnchanged(contents);
    return true;
  }

  /**
   * A lock that cannot be parsed (its holder is between creating and writing it, or the write was
   * cut short) has no pid to check, so only its age counts, taken from the file time. `null` when
   * the lock is already gone.
   */
  async #describeHolder(contents: string): Promise<LockHolder | null> {
    const parsed = lockHolderSchema.safeParse(parseJson(contents));
    const acquiredAt = parsed.success ? Date.parse(parsed.data.acquiredAt) : Number.NaN;
    if (parsed.success && !Number.isNaN(acquiredAt)) return { pid: parsed.data.pid, acquiredAt };
    const file = await stat(this.#lockFile).catch(() => null);
    return file === null ? null : { pid: parsed.success ? parsed.data.pid : undefined, acquiredAt: file.mtimeMs };
  }

  #isStale({ pid, acquiredAt }: LockHolder): boolean {
    const holderGone = pid !== undefined && !isProcessAlive(pid);
    return holderGone || this.#now() - acquiredAt > STALE_LOCK_AGE_MS;
  }

  async #readLastStart(): Promise<number | undefined> {
    const text = await readFile(this.#stateFile, 'utf8').catch(() => null);
    if (text === null) return undefined;
    const parsed = storedStateSchema.safeParse(parseJson(text));
    const lastStart = parsed.success ? Date.parse(parsed.data.lastStart) : Number.NaN;
    return Number.isNaN(lastStart) ? undefined : lastStart;
  }

  /** Runs while the lock is held, so the folder exists. */
  async #writeLastStart(at: number): Promise<void> {
    const stored = { version: 1, lastStart: new Date(at).toISOString() };
    await writeFileAtomic(this.#stateFile, JSON.stringify(stored), FILE_MODE);
  }
}

/** `kill(pid, 0)` sends nothing; only ESRCH means no such process. EPERM is a live process of another user. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
