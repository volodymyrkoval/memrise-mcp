import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ScenarioDetails } from '../domain/types.js';
import { writeFileAtomic } from '../fs/atomicWriteFile.js';
import { parseJson } from '../fs/parseJson.js';
import { readTextIfExists } from '../fs/readTextIfExists.js';
import type { Logger } from '../log/logger.js';
import type { Now } from '../http/transport.js';

const DETAILS_DIR = 'scenario-details';
/** Cache entries are learner data: owner-only, like the session file. Windows ignores these modes without failing. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Port for persisted lesson details; the repository depends on this, not on the disk layout. */
export interface ScenarioDetailsStore {
  read(id: number): Promise<ScenarioDetails | null>;
  write(id: number, details: ScenarioDetails): Promise<void>;
}

export interface DiskScenarioDetailsStoreDeps {
  cacheDir: string;
  now: Now;
  logger: Logger;
}

const detailLearnableSchema = z.object({
  id: z.number(),
  target: z.string(),
  source: z.string(),
  growthLevel: z.number(),
  alreadyKnown: z.boolean(),
  difficult: z.boolean(),
});

const scenarioDetailsSchema: z.ZodType<ScenarioDetails> = z.object({
  scenarioId: z.number(),
  learnables: z.array(detailLearnableSchema),
  completed: z.boolean(),
  dateStarted: z.string().nullable(),
  dateCompleted: z.string().nullable(),
});

const storedEntrySchema = z.object({
  version: z.literal(1),
  fetchedAt: z.string(),
  details: scenarioDetailsSchema,
});

/**
 * One JSON file per lesson under `<cacheDir>/scenario-details/`. The store persists whatever it is
 * given; deciding which lessons are worth caching is the repository's job.
 */
export class DiskScenarioDetailsStore implements ScenarioDetailsStore {
  readonly #dir: string;
  readonly #now: Now;
  readonly #logger: Logger;

  constructor({ cacheDir, now, logger }: DiskScenarioDetailsStoreDeps) {
    this.#dir = join(cacheDir, DETAILS_DIR);
    this.#now = now;
    this.#logger = logger;
  }

  async read(id: number): Promise<ScenarioDetails | null> {
    const text = await readTextIfExists(this.#pathFor(id));
    return text === null ? null : this.#parseEntry(id, text);
  }

  async write(id: number, details: ScenarioDetails): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: DIR_MODE });
    const entry = { version: 1, fetchedAt: new Date(this.#now()).toISOString(), details };
    await writeFileAtomic(this.#pathFor(id), JSON.stringify(entry), FILE_MODE);
  }

  #pathFor(id: number): string {
    return join(this.#dir, `${id}.json`);
  }

  /** Unreadable, wrong-version or wrong-shape entries are misses. The warning carries the lesson id only, never the file's contents. */
  #parseEntry(id: number, text: string): ScenarioDetails | null {
    const parsed = storedEntrySchema.safeParse(parseJson(text));
    if (parsed.success) return parsed.data.details;
    this.#logger.warn('details: ignored unreadable cache entry', { scenario: id });
    return null;
  }
}
