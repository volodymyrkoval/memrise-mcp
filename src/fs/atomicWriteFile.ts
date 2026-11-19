import { randomBytes } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { retryWhileBusy, type Sleep } from './retryWhileBusy.js';

export interface AtomicWriteDeps {
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: Sleep;
}

/**
 * Replaces `file` with `contents` via a temp file beside it, so a concurrent reader sees the old
 * contents or the new ones, never a partial write. A rename refused because the target is busy is
 * retried briefly (under a second in all); any other failure, or a target still busy after
 * that, rejects. A failed write removes its temp file. The caller creates the parent directory.
 */
export async function writeFileAtomic(
  file: string,
  contents: string,
  mode: number,
  deps: AtomicWriteDeps = {},
): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, contents, { mode, flag: 'wx' });
    const renameFile = deps.rename ?? rename;
    await retryWhileBusy(() => renameFile(tmp, file), deps.sleep);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}
