import { readFile } from 'node:fs/promises';
import { retryWhileBusy, type Sleep } from './retryWhileBusy.js';

export interface ReadTextDeps {
  readFile?: (file: string) => Promise<string>;
  sleep?: Sleep;
}

/**
 * Reads a UTF-8 file, or `null` when it does not exist. A read refused for a moment while another
 * process replaces the file (Windows) is retried briefly; any other I/O error propagates.
 */
export async function readTextIfExists(file: string, deps: ReadTextDeps = {}): Promise<string | null> {
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  try {
    return await retryWhileBusy(() => read(file), deps.sleep);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
