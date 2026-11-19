import { describe, expect, it } from 'vitest';
import { HttpStatusError, MalformedResponseError, NetworkError, RateLimitedError, RequestNotNeededError } from '../../../src/errors.js';
import { HttpClient, type ApiRequest } from '../../../src/http/httpClient.js';
import { RequestPacer } from '../../../src/http/requestPacer.js';
import { createFakeClock } from '../../helpers/fakeClock.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';
import type { Logger } from '../../../src/log/logger.js';
import type { HttpTransport } from '../../../src/http/transport.js';
import { InMemoryRateLimitStore } from '../../helpers/inMemoryRateLimitStore.js';
import { ScriptedTransport } from '../../helpers/scriptedTransport.js';

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function createClient(transport: HttpTransport, clock = createFakeClock(), rateLimit = new InMemoryRateLimitStore()) {
  let ids = 0;
  const client = new HttpClient({
    transport,
    pacer: new RequestPacer({ now: clock.now, sleep: clock.sleep }),
    sleep: clock.sleep,
    now: clock.now,
    newId: () => `corr-${++ids}`,
    logger: silentLogger,
    rateLimit,
  });
  return { client, clock, rateLimit };
}

const LANGUAGE_PAIRS: ApiRequest = { method: 'GET', path: '/v1.25/me/language_pairs/', label: 'language_pairs' };

describe('HttpClient.request', () => {
  it('sends nothing when the request is no longer needed once its turn comes', async () => {
    const transport = new ScriptedTransport();
    const { client } = createClient(transport);

    await expect(client.request({ ...LANGUAGE_PAIRS, stillNeeded: async () => false })).rejects.toBeInstanceOf(RequestNotNeededError);

    expect(transport.requests).toEqual([]);
  });

  it('sends the request to the Memrise origin and returns the status and parsed JSON body', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/language_pairs/', { status: 200, setCookies: [], bodyText: '{"language_pairs":[]}' });
    const { client } = createClient(transport);

    const res = await client.request(LANGUAGE_PAIRS);

    expect(transport.requests[0].url).toBe('https://app.memrise.com/v1.25/me/language_pairs/');
    expect(res).toEqual({ status: 200, setCookies: [], body: { language_pairs: [] } });
  });

  it('sends the web-app browser headers with a fresh correlation id, and content-type only with a JSON body', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/language_pairs/', { status: 200, setCookies: [], bodyText: '{}' });
    transport.route('POST', '/v1.25/auth/access_token/', { status: 200, setCookies: [], bodyText: '{}' });
    const { client } = createClient(transport);

    await client.request(LANGUAGE_PAIRS);
    await client.request({
      method: 'POST',
      path: '/v1.25/auth/access_token/',
      json: { grant_type: 'password' },
      label: 'access_token',
    });

    const [get, post] = transport.requests;
    expect(get.headers).toMatchObject({
      origin: 'https://app.memrise.com',
      'x-browser': 'Firefox',
      'x-correlation-id': 'corr-1',
    });
    expect(get.headers).not.toHaveProperty('content-type');
    expect(post.headers).toMatchObject({ 'content-type': 'application/json', 'x-correlation-id': 'corr-2' });
    expect(post.body).toBe('{"grant_type":"password"}');
  });

  it('retries 503 responses after 500 ms and then 1500 ms, and returns the eventual success', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 503, setCookies: [], bodyText: '' });
    transport.enqueue({ status: 503, setCookies: [], bodyText: '' });
    transport.enqueue({ status: 200, setCookies: [], bodyText: '{"ok":true}' });
    const { client, clock } = createClient(transport);

    const res = await client.request(LANGUAGE_PAIRS);

    expect(res.body).toEqual({ ok: true });
    expect(transport.requests).toHaveLength(3);
    expect(clock.sleeps).toEqual([500, 1500]);
  });

  it('reports a transport failure as a network error for the step, after all attempts', async () => {
    const transport = new ScriptedTransport();
    for (let i = 0; i < 3; i += 1) transport.enqueue(new TypeError('fetch failed'));
    const { client, clock } = createClient(transport);

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(NetworkError);
    expect(failure).toHaveProperty('label', 'language_pairs');
    expect(failure).toHaveProperty('attempts', 3);
    expect(transport.requests).toHaveLength(3);
    expect(clock.sleeps).toEqual([500, 1500]);
  });

  it('never overlaps two concurrent requests and starts them at least 300 ms apart', async () => {
    const clock = createFakeClock();
    const starts: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const transport: HttpTransport = {
      async send() {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        starts.push(clock.now());
        await Promise.resolve();
        inFlight -= 1;
        return { status: 200, setCookies: [], bodyText: '{}' };
      },
    };
    const { client } = createClient(transport, clock);

    await Promise.all([client.request(LANGUAGE_PAIRS), client.request(LANGUAGE_PAIRS)]);

    expect(maxInFlight).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(300);
  });

  it('gives up on a persistent 503 after three attempts and names the step and count', async () => {
    const transport = new ScriptedTransport();
    for (let i = 0; i < 3; i += 1) transport.enqueue({ status: 503, setCookies: [], bodyText: '' });
    const { client } = createClient(transport);

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect(failure).toHaveProperty('status', 503);
    expect((failure as Error).message).toBe('language_pairs: HTTP 503 after 3 attempts');
    expect(transport.requests).toHaveLength(3);
  });

  it('does not retry a 404, because the resource will not appear on a second try', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 404, setCookies: [], bodyText: '' });
    const { client, clock } = createClient(transport);

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect(transport.requests).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('sends query parameters as the URL query string', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/learnables/', { status: 200, setCookies: [], bodyText: '{}' });
    const { client } = createClient(transport);

    await client.request({
      method: 'GET',
      path: '/v1.25/me/learnables/',
      query: { learning_state: 'any', page_size: 50, free_only: false },
      label: 'learnables',
    });

    expect(new URL(transport.requests[0].url).search).toBe('?learning_state=any&page_size=50&free_only=false');
  });

  it('logs the step label as each attempt starts and with its status as it ends, and never the query values', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/learnables/', { status: 200, setCookies: [], bodyText: '{}' });
    const debugLines: string[] = [];
    const logger: Logger = { ...silentLogger, debug: (msg) => void debugLines.push(msg) };
    const client = new HttpClient({
      transport,
      pacer: new RequestPacer({ now: createFakeClock().now, sleep: createFakeClock().sleep }),
      sleep: createFakeClock().sleep,
      now: createFakeClock().now,
      newId: () => 'corr-1',
      logger,
      rateLimit: new InMemoryRateLimitStore(),
    });

    await client.request({
      method: 'GET',
      path: '/v1.25/me/learnables/',
      query: { next_page_token: 'secret-page-token-value' },
      label: 'learnables',
    });

    expect(debugLines).toEqual(['http: start learnables', 'http: learnables 200']);
  });

  it('with expect "none", resolves an HTML body as null and keeps the set-cookie headers', async () => {
    const transport = new ScriptedTransport();
    const csrfCookie = ['csrftoken', 'ensure-value'].join('=');
    transport.enqueue({ status: 200, setCookies: [`${csrfCookie}; Path=/`], bodyText: '<!doctype html><html></html>' });
    const { client } = createClient(transport);

    const res = await client.request({
      method: 'GET',
      path: '/v1.25/web/ensure_csrf',
      label: 'csrf',
      expect: 'none',
    });

    expect(res).toEqual({ status: 200, setCookies: [`${csrfCookie}; Path=/`], body: null });
  });

  it.each([
    ['an empty body', ''],
    ['an HTML page', '<!doctype html><html><body>maintenance</body></html>'],
  ])('treats a 2xx response with %s as malformed, without retrying it', async (_name, bodyText) => {
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 200, setCookies: [], bodyText });
    const { client, clock } = createClient(transport);

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(MalformedResponseError);
    expect(failure).toHaveProperty('label', 'language_pairs');
    expect(transport.requests).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('leaves out query parameters whose value is undefined', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/learnables/', { status: 200, setCookies: [], bodyText: '{}' });
    const { client } = createClient(transport);

    await client.request({
      method: 'GET',
      path: '/v1.25/me/learnables/',
      query: { page_size: 50, next_page_token: undefined },
      label: 'learnables',
    });

    expect(new URL(transport.requests[0].url).searchParams.has('next_page_token')).toBe(false);
  });

  it('does not put a 400 error body into the error, only the step and status', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 400, setCookies: [], bodyText: JSON.stringify(loadFixture('learnables-invalid-state.json')) });
    const { client } = createClient(transport);

    const failure = await client.request({ method: 'GET', path: '/v1.25/me/learnables/', label: 'learnables' }).catch(
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect((failure as Error).message).toBe('learnables: HTTP 400');
  });

  it('keeps query values out of error messages', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue({ status: 404, setCookies: [], bodyText: '' });
    const { client } = createClient(transport);
    const pageToken = ['page', 'token', 'value', '77'].join('-');

    const failure = await client
      .request({ method: 'GET', path: '/v1.25/me/learnables/', query: { next_page_token: pageToken }, label: 'learnables' })
      .catch((err: unknown) => err);

    expect((failure as Error).message).not.toContain(pageToken);
  });
});

function rateLimited(retryAfter?: string) {
  return { status: 429, setCookies: [], bodyText: '', retryAfter };
}

const OK = { status: 200, setCookies: [], bodyText: '{"ok":true}' };

describe('HttpClient.request on HTTP 429', () => {
  it('waits exactly the Retry-After seconds once, then returns the retried success', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(rateLimited('5'));
    transport.enqueue(OK);
    const { client, clock } = createClient(transport);

    const res = await client.request(LANGUAGE_PAIRS);

    expect(res.body).toEqual({ ok: true });
    expect(transport.requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([5_000]);
  });

  it('waits until the Retry-After HTTP-date once, then retries', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(rateLimited('Thu, 01 Jan 2026 00:00:30 GMT'));
    transport.enqueue(OK);
    const { client, clock } = createClient(transport, createFakeClock(Date.parse('2026-01-01T00:00:00.000Z')));

    await client.request(LANGUAGE_PAIRS);

    expect(transport.requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([30_000]);
  });

  it('waits 60 s when the 429 carries no Retry-After', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(rateLimited());
    transport.enqueue(OK);
    const { client, clock } = createClient(transport);

    await client.request(LANGUAGE_PAIRS);

    expect(transport.requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([60_000]);
  });

  it('fails at once with RateLimitedError, without waiting, when Retry-After is above the 120 s cap', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(rateLimited('600'));
    const { client, clock, rateLimit } = createClient(transport, createFakeClock(1_000));

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(RateLimitedError);
    expect(failure).toHaveProperty('until', 601_000);
    expect(transport.requests).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
    expect(rateLimit.recorded).toEqual([601_000]);
  });

  it('gives up with RateLimitedError on a second 429, after the one wait', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(rateLimited('5'));
    transport.enqueue(rateLimited('10'));
    const { client, clock, rateLimit } = createClient(transport, createFakeClock(1_000));

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(RateLimitedError);
    expect(failure).toHaveProperty('until', 16_000);
    expect(transport.requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([5_000]);
    expect(rateLimit.recorded).toEqual([16_000]);
  });
});

describe('HttpClient.request on an absurd Retry-After', () => {
  it('caps the cooldown at one day, so a bogus header cannot lock requests out for years', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(rateLimited('99999999999999'));
    const { client, rateLimit } = createClient(transport, createFakeClock(1_000));

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(RateLimitedError);
    expect(failure).toHaveProperty('until', 1_000 + 24 * 60 * 60 * 1000);
    expect(rateLimit.recorded).toEqual([1_000 + 24 * 60 * 60 * 1000]);
  });
});

describe('HttpClient.request during a rate-limit cooldown', () => {
  it('fails fast with RateLimitedError and never touches the network while the cooldown is active', async () => {
    const transport = new ScriptedTransport();
    const { client, clock } = createClient(transport, createFakeClock(1_000), new InMemoryRateLimitStore(61_000));

    const failure = await client.request(LANGUAGE_PAIRS).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(RateLimitedError);
    expect(failure).toHaveProperty('until', 61_000);
    expect(transport.requests).toHaveLength(0);
    expect(clock.sleeps).toEqual([]);
  });

  it('stops a request queued behind the one that gave up, before it reaches the network', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(rateLimited('600'));
    const { client } = createClient(transport);

    const results = await Promise.allSettled([client.request(LANGUAGE_PAIRS), client.request(LANGUAGE_PAIRS)]);

    expect(results.map((r) => r.status === 'rejected' && r.reason instanceof RateLimitedError)).toEqual([true, true]);
    expect(transport.requests).toHaveLength(1);
  });

  it('sends normally once the cooldown has ended, the end itself included', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(OK);
    const { client } = createClient(transport, createFakeClock(61_000), new InMemoryRateLimitStore(61_000));

    const res = await client.request(LANGUAGE_PAIRS);

    expect(res.body).toEqual({ ok: true });
    expect(transport.requests).toHaveLength(1);
  });

  it('logs one debug line naming the step and the cooldown end, and nothing else', async () => {
    const debugLines: string[] = [];
    const clock = createFakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
    const client = new HttpClient({
      transport: new ScriptedTransport(),
      pacer: new RequestPacer({ now: clock.now, sleep: clock.sleep }),
      sleep: clock.sleep,
      now: clock.now,
      newId: () => 'corr-1',
      logger: { ...silentLogger, debug: (msg) => void debugLines.push(msg) },
      rateLimit: new InMemoryRateLimitStore(Date.parse('2026-01-01T00:01:00.000Z')),
    });

    await client.request(LANGUAGE_PAIRS).catch(() => undefined);

    expect(debugLines).toEqual(['http: language_pairs skipped, rate-limit cooldown until 2026-01-01T00:01:00.000Z']);
  });
});
