/** Shared by the child scripts: a logger that turns any warning into a failure, and the exit path. */
import type { Logger } from '../../../src/log/logger.js';

/** Every warning the stores or the lock would log means the shared folder misbehaved. */
export const failOnWarnLogger: Logger = {
  debug() {},
  info() {},
  warn: (msg) => fail(new Error(`unexpected warning: ${msg}`)),
  error: (msg) => fail(new Error(`unexpected error log: ${msg}`)),
};

export function fail(err: unknown): never {
  const code = (err as NodeJS.ErrnoException).code;
  process.stderr.write(`${code === undefined ? '' : `${code} `}${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `main`, exiting 1 with the error code and message on any failure. */
export function runChild(main: () => Promise<void>): void {
  main().catch(fail);
}
