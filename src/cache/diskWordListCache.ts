import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Learnable, StateKey } from '../domain/types.js';
import { writeFileAtomic } from '../fs/atomicWriteFile.js';
import { parseJson } from '../fs/parseJson.js';
import { readTextIfExists } from '../fs/readTextIfExists.js';
import type { Logger } from '../log/logger.js';
import type { Now } from '../http/transport.js';

/** Port for the word list cache; `null` means "fetch from the API". */
export interface WordListCache {
  read(pairId: number, state: StateKey): Promise<Learnable[] | null>;
  write(pairId: number, state: StateKey, items: Learnable[]): Promise<void>;
}

export interface DiskWordListCacheDeps {
  cacheDir: string;
  /** `0` turns the cache off: nothing is read from or written to disk. */
  ttlSeconds: number;
  now: Now;
  logger: Logger;
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Bump when the stored word shape changes: entries of another version read as a miss and are refetched. */
const ENTRY_VERSION = 2;

const learnableSchema: z.ZodType<Learnable> = z.object({
  id: z.number(),
  target: z.string(),
  source: z.string(),
  audios: z.array(z.string()),
  growthLevel: z.number(),
  known: z.boolean(),
  difficult: z.boolean(),
  nextReview: z.string().nullable(),
  learned: z.boolean(),
  heard: z.boolean(),
});

const storedWordsSchema = z.object({
  version: z.literal(ENTRY_VERSION),
  fetchedAt: z.string(),
  learnables: z.array(learnableSchema),
});

/**
 * The learner's word list per pair and state, in `<cacheDir>/words-<pair>-<state>.json`, served
 * only while younger than the TTL. Every miss, expiry or unreadable entry reads as `null`.
 */
export class DiskWordListCache implements WordListCache {
  readonly #dir: string;
  readonly #ttlMs: number;
  readonly #now: Now;
  readonly #logger: Logger;

  constructor({ cacheDir, ttlSeconds, now, logger }: DiskWordListCacheDeps) {
    this.#dir = cacheDir;
    this.#ttlMs = ttlSeconds * 1000;
    this.#now = now;
    this.#logger = logger;
  }

  async read(pairId: number, state: StateKey): Promise<Learnable[] | null> {
    if (!this.#isEnabled()) return null;
    const text = await readTextIfExists(this.#pathFor(pairId, state));
    if (text === null) {
      this.#logger.debug('words: disk cache miss');
      return null;
    }
    const parsed = storedWordsSchema.safeParse(parseJson(text));
    if (!parsed.success) {
      this.#logger.warn('words: ignored unreadable cache entry');
      return null;
    }
    if (!this.#isFresh(parsed.data.fetchedAt)) {
      this.#logger.debug('words: disk cache expired');
      return null;
    }
    this.#logger.debug('words: disk cache hit');
    return parsed.data.learnables;
  }

  async write(pairId: number, state: StateKey, items: Learnable[]): Promise<void> {
    if (!this.#isEnabled()) return;
    await mkdir(this.#dir, { recursive: true, mode: DIR_MODE });
    const entry = { version: ENTRY_VERSION, fetchedAt: new Date(this.#now()).toISOString(), learnables: items };
    await writeFileAtomic(this.#pathFor(pairId, state), JSON.stringify(entry), FILE_MODE);
  }

  /** An entry exactly one TTL old is already stale. */
  #isFresh(fetchedAt: string): boolean {
    return this.#now() - Date.parse(fetchedAt) < this.#ttlMs;
  }

  #isEnabled(): boolean {
    return this.#ttlMs > 0;
  }

  #pathFor(pairId: number, state: StateKey): string {
    return join(this.#dir, `words-${pairId}-${state}.json`);
  }

}
