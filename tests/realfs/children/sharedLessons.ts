/**
 * Child process for the shared-lessons test: loads lessons `1..count` in order through the production
 * repository, disk cache, HTTP client, pacer and cache-folder lock, over a fake transport that answers
 * every lesson as completed and counts what reaches the wire. Starts once `<go file>` exists, so both
 * children walk the lessons side by side. Args: <cache dir> <ready file> <go file> <count> <out file>.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { MemriseApi } from '../../../src/api/memriseApi.js';
import { DiskPacerLock } from '../../../src/cache/diskPacerLock.js';
import { DiskRateLimitStore } from '../../../src/cache/diskRateLimitStore.js';
import { DiskScenarioDetailsStore } from '../../../src/cache/diskScenarioDetailsStore.js';
import { ScenarioDetailsRepository } from '../../../src/cache/scenarioDetailsRepository.js';
import { HttpClient } from '../../../src/http/httpClient.js';
import { RequestPacer } from '../../../src/http/requestPacer.js';
import type { HttpTransport } from '../../../src/http/transport.js';
import { failOnWarnLogger, runChild, sleep } from './childSupport.js';

/** How long each fake request stays on the wire. */
const ON_WIRE_MS = 40;
const COMPLETED_LESSON = {
  learnables: [],
  completed: true,
  is_locked: false,
  number_of_learnables: 0,
  items_learned: 0,
  date_started: null,
  date_completed: null,
  content_media_id: null,
};

runChild(async () => {
  const [cacheDir, readyFile, goFile, count, outFile] = process.argv.slice(2);
  let sent = 0;
  const transport: HttpTransport = {
    send: async () => {
      sent += 1;
      await sleep(ON_WIRE_MS);
      return { status: 200, setCookies: [], bodyText: JSON.stringify(COMPLETED_LESSON) };
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
  const repository = new ScenarioDetailsRepository({
    store: new DiskScenarioDetailsStore({ cacheDir, now: Date.now, logger: failOnWarnLogger }),
    api: new MemriseApi({ requester: { send: (req) => client.request(req) }, logger: failOnWarnLogger }),
    logger: failOnWarnLogger,
  });

  await writeFile(readyFile, '');
  while (!existsSync(goFile)) await sleep(5);
  for (let id = 1; id <= Number(count); id += 1) await repository.get(id);
  await writeFile(outFile, JSON.stringify({ sent }));
  process.stdout.write('done\n');
});
