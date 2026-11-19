/**
 * Codes Windows returns while another process has a file open or is deleting it (a reader, an
 * antivirus scan). They usually clear within milliseconds; the budget of about one second follows
 * graceful-fs, which npm relies on for the same Windows rename problem. On POSIX these codes are
 * permanent, and the retries only delay the same error.
 */
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const MAX_ATTEMPTS = 12;
const BACKOFF_STEP_MS = 20;
const MAX_BACKOFF_MS = 100;

export type Sleep = (ms: number) => Promise<void>;

/** True for a file-system error that waiting a moment may clear. */
export function isBusyError(err: unknown): boolean {
  return BUSY_CODES.has((err as NodeJS.ErrnoException | undefined)?.code ?? '');
}

/**
 * Runs `operation`, up to 12 attempts in all with 20-100 ms waits (0.9 s at most), while it fails
 * with a busy code. Any other failure, or the last busy one, rejects.
 */
export async function retryWhileBusy<T>(operation: () => Promise<T>, sleep: Sleep = realSleep): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isBusyError(err)) throw err;
      await sleep(Math.min(BACKOFF_STEP_MS * attempt, MAX_BACKOFF_MS));
    }
  }
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
