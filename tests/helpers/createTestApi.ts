/**
 * Builds a real `MemriseApi` over `transport`: the real `HttpClient` runs (headers, pacing, error
 * mapping) and only the wire is replaced. `warnings` collects the API's warn lines.
 */
import { MemriseApi } from '../../src/api/memriseApi.js';
import { HttpClient } from '../../src/http/httpClient.js';
import { RequestPacer } from '../../src/http/requestPacer.js';
import type { HttpTransport } from '../../src/http/transport.js';
import type { Logger } from '../../src/log/logger.js';
import type { Requester } from '../../src/session/authenticatedRequester.js';
import { createFakeClock } from './fakeClock.js';
import { InMemoryRateLimitStore } from './inMemoryRateLimitStore.js';

export function createTestApi(transport: HttpTransport) {
  const clock = createFakeClock();
  const client = new HttpClient({
    transport,
    pacer: new RequestPacer({ now: clock.now, sleep: clock.sleep }),
    sleep: clock.sleep,
    now: clock.now,
    newId: () => 'corr-1',
    logger: { debug() {}, info() {}, error() {}, warn() {} },
    rateLimit: new InMemoryRateLimitStore(),
  });
  const warnings: string[] = [];
  const logger: Logger = { debug() {}, info() {}, error() {}, warn: (msg) => warnings.push(msg) };
  const requester: Requester = { send: (req) => client.request(req) };
  return { api: new MemriseApi({ requester, logger }), warnings };
}
