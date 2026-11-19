/**
 * Child process for the stale-lock test: takes the cache-folder pacer lock, prints `locked`, and
 * then hangs until it is killed, leaving the lock behind like a crashed process. Args: <cache dir>.
 */
import { DiskPacerLock } from '../../../src/cache/diskPacerLock.js';
import { failOnWarnLogger, runChild, sleep } from './childSupport.js';

runChild(async () => {
  const [cacheDir] = process.argv.slice(2);
  await new DiskPacerLock({ cacheDir, now: Date.now, sleep, logger: failOnWarnLogger }).acquire();
  process.stdout.write('locked\n');
  setInterval(() => undefined, 60_000);
});
