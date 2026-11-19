import { describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { cookiePair, createFakeFetch } from './fakeTransport.js';

const SESSION_VALUE = 'zzTopSecretSession99';
const CSRF_VALUE = 'yyTopSecretCsrf88';

function setup(route: Parameters<typeof createFakeFetch>[0] = () => ({ body: { ok: true } })) {
  const fake = createFakeFetch(route);
  const pause = vi.fn(async () => {});
  const log = vi.fn();
  const http = new ProbeHttp({ fetch: fake.fetch, pause, log });
  return { http, pause, log, requests: fake.requests };
}

describe('ProbeHttp', () => {
  it('sends GET to the app host with query parameters and records the status and body', async () => {
    const { http, requests } = setup(() => ({ status: 200, body: { learnables: [] } }));

    const response = await http.get('states', '/v1.25/me/language_pairs/1/learnables/', { page_size: '50' });

    expect(requests[0].url.href).toBe('https://app.memrise.com/v1.25/me/language_pairs/1/learnables/?page_size=50');
    expect(response).toMatchObject({ status: 200, body: { learnables: [] } });
    expect(http.transcript).toEqual([
      {
        label: 'states',
        method: 'GET',
        path: '/v1.25/me/language_pairs/1/learnables/',
        query: { page_size: '50' },
        status: 200,
        setCookieNames: [],
        body: { learnables: [] },
      },
    ]);
  });

  it('posts JSON with extra headers', async () => {
    const { http, requests } = setup();

    await http.post('login', '/v1.25/auth/web/', { a: 1 }, { 'X-Extra': 'e' });

    expect(requests[0]).toMatchObject({ method: 'POST', body: { a: 1 } });
    expect(requests[0].headers['content-type']).toBe('application/json');
    expect(requests[0].headers['x-extra']).toBe('e');
  });

  it('mimics the browser headers with a fresh correlation id per request', async () => {
    const { http, requests } = setup();

    await http.get('a', '/x');
    await http.get('b', '/x');

    expect(requests[0].headers['x-client-type']).toBe('web');
    expect(requests[0].headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(requests[0].headers['x-correlation-id']).not.toBe(requests[1].headers['x-correlation-id']);
  });

  it('stores cookies, sends them back and mirrors csrftoken into X-CSRFToken', async () => {
    const { http, requests } = setup((request) =>
      request.url.pathname === '/first'
        ? {
            setCookies: [
              `${cookiePair('csrftoken', CSRF_VALUE)}; Max-Age=31449600`,
              `${cookiePair('sessionid_2', SESSION_VALUE)}; Domain=app.memrise.com; HttpOnly; Max-Age=31557600`,
            ],
          }
        : {},
    );

    const first = await http.get('first', '/first');
    await http.get('second', '/second');

    expect(first.setCookies).toEqual([
      { name: 'csrftoken', maxAge: 31449600 },
      { name: 'sessionid_2', maxAge: 31557600 },
    ]);
    expect(requests[1].headers.cookie).toBe(`${cookiePair('csrftoken', CSRF_VALUE)}; ${cookiePair('sessionid_2', SESSION_VALUE)}`);
    expect(requests[1].headers['x-csrftoken']).toBe(CSRF_VALUE);
    expect(http.cookieValues().sort()).toEqual([CSRF_VALUE, SESSION_VALUE].sort());
  });

  it('records cookie names only, never values, in the transcript', async () => {
    const { http } = setup(() => ({ setCookies: [`${cookiePair('sessionid_2', SESSION_VALUE)}; HttpOnly`] }));

    await http.get('login', '/x');

    expect(http.transcript[0].setCookieNames).toEqual(['sessionid_2']);
    expect(JSON.stringify(http.transcript)).not.toContain(SESSION_VALUE);
  });

  it('prints only label and status to the console, even with secrets in headers and cookies', async () => {
    const { http, log } = setup(() => ({ status: 201, setCookies: [cookiePair('csrftoken', CSRF_VALUE)] }));

    await http.post('login', '/x', { password: 'pw-value-123' }, { Authorization: 'Bearer abc' });

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('login 201');
  });

  it('pauses between requests but not before the first', async () => {
    const { http, pause } = setup();

    await http.get('a', '/x');
    expect(pause).not.toHaveBeenCalled();
    await http.get('b', '/x');
    await http.get('c', '/x');

    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('records a network failure as status 0 without leaking the error message', async () => {
    const pause = async () => {};
    const log = vi.fn();
    const failing = (async () => {
      throw new Error('connect failed for secret-ish-text');
    }) as unknown as typeof fetch;
    const http = new ProbeHttp({ fetch: failing, pause, log });

    const response = await http.get('down', '/x');

    expect(response.status).toBe(0);
    expect(log).toHaveBeenCalledWith('down 0');
    expect(JSON.stringify(http.transcript)).not.toContain('secret-ish-text');
  });

  it('keeps non-JSON bodies as text', async () => {
    const fetchText = (async () => new Response('<html>nope</html>', { status: 403 })) as unknown as typeof fetch;
    const http = new ProbeHttp({ fetch: fetchText, pause: async () => {}, log: () => {} });

    const response = await http.get('page', '/x');

    expect(response).toMatchObject({ status: 403, body: '<html>nope</html>' });
  });

  describe('cookie modes', () => {
    const withCookies = () =>
      setup(({ url }) => (url.pathname === '/seed' ? { setCookies: [cookiePair('csrftoken', CSRF_VALUE), cookiePair('sessionid_2', SESSION_VALUE)] } : {}));

    it('sends no cookie header and no x-csrftoken when asked for no cookies', async () => {
      const { http, requests } = withCookies();
      await http.get('seed', '/seed');

      await http.get('bare', '/data', undefined, { authorization: 'Bearer t' }, { cookies: 'none' });

      expect(requests[1].headers.cookie).toBeUndefined();
      expect(requests[1].headers['x-csrftoken']).toBeUndefined();
      expect(requests[1].headers.authorization).toBe('Bearer t');
    });

    it('sends only the csrftoken cookie plus the x-csrftoken header for csrf-only', async () => {
      const { http, requests } = withCookies();
      await http.get('seed', '/seed');

      await http.get('csrf', '/data', undefined, undefined, { cookies: 'csrf-only' });

      expect(requests[1].headers.cookie).toBe(cookiePair('csrftoken', CSRF_VALUE));
      expect(requests[1].headers['x-csrftoken']).toBe(CSRF_VALUE);
    });

    it('sends every jar cookie by default', async () => {
      const { http, requests } = withCookies();
      await http.get('seed', '/seed');

      await http.get('all', '/data');

      expect(requests[1].headers.cookie).toContain('sessionid_2');
    });
  });
});
