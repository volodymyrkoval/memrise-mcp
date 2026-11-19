/**
 * Child process for the shared-pacer test: sends `count` requests through the production HTTP
 * client, pacer and cache-folder lock, over a fake transport that only records when each request
 * was on the wire. Starts once `<go file>` exists, so both children contend for the lock.
 * Args: <cache dir> <ready file> <go file> <count> <intervals out file>.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { DiskPacerLock } from '../../../src/cache/diskPacerLock.js';
import { DiskRateLimitStore } from '../../../src/cache/diskRateLimitStore.js';
import { HttpClient } from '../../../src/http/httpClient.js';
import { RequestPacer } from '../../../src/http/requestPacer.js';
import type { HttpTransport } from '../../../src/http/transport.js';
import { failOnWarnLogger, runChild, sleep } from './childSupport.js';

/** How long each fake request stays on the wire. */
const ON_WIRE_MS = 40;

runChild(async () => {
  const [cacheDir, readyFile, goFile, count, outFile] = process.argv.slice(2);
  const intervals: Array<{ start: number; end: number }> = [];
  const transport: HttpTransport = {
    send: async () => {
      const start = Date.now();
      await sleep(ON_WIRE_MS);
      intervals.push({ start, end: Date.now() });
      return { status: 200, setCookies: [], bodyText: '{}' };
    },
  };
  const lock = new DiskPacerLock({ cacheDir, now: Date.now, sleep, logger: failOnWarnLogger });
  const client = new HttpClient({
    transport,
    pacer: new RequestPacer({ now: Date.now, sleep, lock }),
    sleep,
    now: Date.now,
    newId: randomUUID,
    logger: failOnWarnLogger,
    rateLimit: new DiskRateLimitStore({ cacheDir, logger: failOnWarnLogger }),
  });

  await writeFile(readyFile, '');
  while (!existsSync(goFile)) await sleep(5);
  for (let i = 0; i < Number(count); i += 1) {
    await client.request({ method: 'GET', path: '/v1.25/me/', label: 'realfs' });
  }
  await writeFile(outFile, JSON.stringify({ pid: process.pid, intervals }));
  process.stdout.write('done\n');
});
