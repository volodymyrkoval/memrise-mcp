/**
 * Persists the access token in `<cache dir>/session.json`. The file is a credential: never logged.
 * Created with mode 0600 in a 0700 folder; Windows ignores modes, so there the user profile's
 * default permissions protect it.
 */
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Session, SessionStore, StoredSession } from '../auth/session.js';
import { writeFileAtomic } from '../fs/atomicWriteFile.js';
import { parseJson } from '../fs/parseJson.js';
import type { Now } from '../http/transport.js';
import type { Logger } from '../log/logger.js';

const SESSION_FILE = 'session.json';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const storedSessionSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  accessToken: z.string().min(1),
  createdAt: z.string(),
});

export interface FileSessionStoreDeps {
  cacheDir: string;
  /** Output of `accountKey(username)`; a file stored for another account is ignored. */
  account: string;
  now: Now;
  logger: Logger;
}

export class FileSessionStore implements SessionStore {
  readonly #dir: string;
  readonly #file: string;
  readonly #account: string;
  readonly #now: Now;
  readonly #logger: Logger;

  constructor({ cacheDir, account, now, logger }: FileSessionStoreDeps) {
    this.#dir = cacheDir;
    this.#file = join(cacheDir, SESSION_FILE);
    this.#account = account;
    this.#now = now;
    this.#logger = logger;
  }

  async load(): Promise<Session | null> {
    const text = await this.#readFile();
    return text === null ? null : this.#parseStored(text);
  }

  async save(session: Session): Promise<void> {
    const stored: StoredSession = {
      version: 1,
      account: this.#account,
      accessToken: session.accessToken,
      createdAt: new Date(this.#now()).toISOString(),
    };
    await this.#writeAtomic(JSON.stringify(stored));
  }

  async clear(): Promise<void> {
    await unlink(this.#file).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async #readFile(): Promise<string | null> {
    try {
      return await readFile(this.#file, 'utf8');
    } catch {
      return null;
    }
  }

  /** Any file that is not a valid session for this account is ignored; the warning never includes its contents. */
  #parseStored(text: string): Session | null {
    const parsed = storedSessionSchema.safeParse(parseJson(text));
    if (!parsed.success || parsed.data.account !== this.#account) {
      this.#logger.warn('session: ignored invalid session file');
      return null;
    }
    return { accessToken: parsed.data.accessToken };
  }

  async #writeAtomic(json: string): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: DIR_MODE });
    await writeFileAtomic(this.#file, json, FILE_MODE);
  }
}
