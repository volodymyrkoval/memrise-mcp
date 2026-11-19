/**
 * Keeps the rate-limit cooldown in `<cache dir>/rate-limit.json` (`{"version":1,"until":"<ISO time>"}`,
 * mode 0600 on POSIX), so every process on the folder honours it. A past `until` is simply an expired cooldown.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomicWriteFile.js';
import { parseJson } from '../fs/parseJson.js';
import type { RateLimitStore } from '../http/rateLimitStore.js';
import type { Logger } from '../log/logger.js';

const RATE_LIMIT_FILE = 'rate-limit.json';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const storedCooldownSchema = z.object({
  version: z.literal(1),
  until: z.string(),
});

export interface DiskRateLimitStoreDeps {
  cacheDir: string;
  logger: Logger;
}

/** The last recorded cooldown is also kept in memory, so this process honours it even when the disk write fails. */
export class DiskRateLimitStore implements RateLimitStore {
  readonly #dir: string;
  readonly #file: string;
  readonly #logger: Logger;
  #recorded: number | undefined;

  constructor({ cacheDir, logger }: DiskRateLimitStoreDeps) {
    this.#dir = cacheDir;
    this.#file = join(cacheDir, RATE_LIMIT_FILE);
    this.#logger = logger;
  }

  /** A missing, unreadable or malformed file is no cooldown: it may only ever delay requests, never break them. */
  async read(): Promise<number | undefined> {
    return latest(this.#recorded, await this.#readFile());
  }

  async record(until: number): Promise<void> {
    this.#recorded = until;
    await this.#writeFile(until).catch(() =>
      this.#logger.warn('rate-limit: could not save the cooldown; this process still honours it'),
    );
  }

  async #readFile(): Promise<number | undefined> {
    const text = await readFile(this.#file, 'utf8').catch(() => null);
    if (text === null) return undefined;
    const parsed = storedCooldownSchema.safeParse(parseJson(text));
    const until = parsed.success ? Date.parse(parsed.data.until) : Number.NaN;
    return Number.isNaN(until) ? undefined : until;
  }

  async #writeFile(until: number): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: DIR_MODE });
    const stored = { version: 1, until: new Date(until).toISOString() };
    await writeFileAtomic(this.#file, JSON.stringify(stored), FILE_MODE);
  }
}

function latest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  return b === undefined ? a : Math.max(a, b);
}
