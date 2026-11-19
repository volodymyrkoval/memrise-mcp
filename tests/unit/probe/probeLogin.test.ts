import { describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { probeLogin } from '../../../scripts/probe/probeLogin.js';
import { cookiePair, createFakeFetch, type FakeRoute } from './fakeTransport.js';

const CSRF = 'csrfValueAAAA1111';
const SESSION = 'sessionValueBBBB2222';
const ACCESS = 'accessValueCCCC3333';
const creds = { username: 'fake-user', password: 'fake-pass-word-42' };

const csrfCookie = `${cookiePair('csrftoken', CSRF)}; Max-Age=31449600`;
const sessionCookie = `${cookiePair('sessionid_2', SESSION)}; HttpOnly; Max-Age=31557600`;

interface Behaviour {
  ensureCsrf?: boolean;
  signin?: boolean;
  accessStatus?: number;
  bearerWorks?: boolean;
  cookiesWork?: boolean;
}

function happyRoute(behaviour: Behaviour = {}): FakeRoute {
  const { ensureCsrf = true, signin = true, accessStatus = 200, bearerWorks = false, cookiesWork = true } = behaviour;
  return ({ url, headers }) => {
    switch (url.pathname) {
      case '/v1.25/web/ensure_csrf':
        return ensureCsrf ? { setCookies: [csrfCookie] } : { status: 404 };
      case '/signin':
        return signin ? { setCookies: [csrfCookie] } : { status: 404 };
      case '/v1.25/auth/access_token/':
        return accessStatus === 200
          ? { body: { access_token: { access_token: ACCESS, token_type: 'Bearer' }, user: { id: 7 } } }
          : { status: accessStatus, body: { error: 'bad' } };
      case '/v1.25/auth/web/':
        return { body: { success: true }, setCookies: [csrfCookie, sessionCookie] };
      default:
        if (headers.authorization === `Bearer ${ACCESS}`) return bearerWorks ? { body: {} } : { status: 401 };
        return headers.cookie?.includes('sessionid_2') && cookiesWork ? { body: {} } : { status: 403 };
    }
  };
}

function run(route: FakeRoute, options?: Parameters<typeof probeLogin>[2]) {
  const fake = createFakeFetch(route);
  const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });
  return { http, requests: fake.requests, findings: probeLogin(http, creds, options) };
}

describe('probeLogin', () => {
  it('logs in headlessly and reports statuses, cookie names and max-age', async () => {
    const { findings, requests } = run(happyRoute());

    expect(await findings).toEqual({
      csrfSource: 'ensure_csrf',
      csrfStatuses: { ensure_csrf: 200 },
      accessTokenStatus: 200,
      bearerOnDataStatus: 401,
      webSessionStatus: 200,
      cookieNames: ['csrftoken', 'sessionid_2'],
      cookieMaxAge: { csrftoken: 31449600, sessionid_2: 31557600 },
      cookiesOnDataStatus: 200,
    });
    const accessRequest = requests.find((r) => r.url.pathname === '/v1.25/auth/access_token/');
    expect(accessRequest?.body).toMatchObject({ grant_type: 'password', client_id: '1e739f5e77704b57a703' });
    expect(accessRequest?.headers['x-csrftoken']).toBe(CSRF);
    const webRequest = requests.find((r) => r.url.pathname === '/v1.25/auth/web/');
    expect(webRequest?.body).toEqual({ token: ACCESS, invalidate_token_after: true });
  });

  it('falls back to /signin when ensure_csrf yields no csrftoken', async () => {
    const { findings } = run(happyRoute({ ensureCsrf: false }));

    expect(await findings).toMatchObject({ csrfSource: 'signin', csrfStatuses: { ensure_csrf: 404, signin: 200 } });
  });

  it('stops with a failed-step note when no csrf cookie can be obtained', async () => {
    const { findings, requests } = run(happyRoute({ ensureCsrf: false, signin: false }));

    expect(await findings).toMatchObject({ csrfSource: 'none', failedStep: 'csrf' });
    expect(requests.some((r) => r.url.pathname.includes('access_token'))).toBe(false);
  });

  it('stops when the access token request is rejected', async () => {
    const { findings, requests } = run(happyRoute({ accessStatus: 401 }));

    expect(await findings).toMatchObject({ accessTokenStatus: 401, failedStep: 'access_token' });
    expect(requests.some((r) => r.url.pathname === '/v1.25/auth/web/')).toBe(false);
  });

  it('reports when the bearer token alone is accepted on data endpoints', async () => {
    const { findings } = run(happyRoute({ bearerWorks: true }));

    expect(await findings).toMatchObject({ bearerOnDataStatus: 200 });
  });

  it('sends the bearer probe without the session cookie, and never records the password or token', async () => {
    const { http, requests, findings } = run(happyRoute());
    const result = await findings;

    const bearerRequest = requests.find((r) => r.headers.authorization !== undefined);
    expect(bearerRequest?.headers.cookie ?? '').not.toContain('sessionid_2');
    const recorded = JSON.stringify([result, http.transcript]);
    expect(recorded).not.toContain(creds.password);
    expect(recorded).not.toContain(SESSION);
  });

  it('notes a failed cookie check on data endpoints', async () => {
    const { findings } = run(happyRoute({ cookiesWork: false }));

    expect(await findings).toMatchObject({ cookiesOnDataStatus: 403 });
  });

  describe('bearer coverage before the web session', () => {
    const route = (extra: FakeRoute = () => ({ status: 404 })): FakeRoute => {
      const base = happyRoute({ bearerWorks: true });
      return (request) => {
        if (request.url.pathname === '/v1.25/me/language_pairs/9/scenarios/') {
          return request.headers.authorization === `Bearer ${ACCESS}`
            ? { body: { scenarios: [{ scenario_id: 321 }, { scenario_id: 322 }] } }
            : { status: 401 };
        }
        const handled = extra(request);
        return handled.status === 404 ? base(request) : handled;
      };
    };

    it('checks learnables, scenarios list and scenario details with no cookies, then with csrf only', async () => {
      const { findings } = run(route(), { pairId: 9 });

      expect((await findings).bearerChecks).toEqual([
        { endpoint: 'learnables list', variant: 'no cookies', status: 200 },
        { endpoint: 'scenarios list', variant: 'no cookies', status: 200 },
        { endpoint: 'scenario details', variant: 'no cookies', status: 200 },
        { endpoint: 'learnables list', variant: 'csrf only', status: 200 },
        { endpoint: 'scenarios list', variant: 'csrf only', status: 200 },
        { endpoint: 'scenario details', variant: 'csrf only', status: 200 },
      ]);
    });

    it('sends no Cookie or x-csrftoken header on the no-cookies variant, and only csrftoken on the csrf-only variant', async () => {
      const { findings, requests } = run(route(), { pairId: 9 });
      await findings;

      const webIndex = requests.findIndex((r) => r.url.pathname === '/v1.25/auth/web/');
      const bearer = requests.slice(0, webIndex).filter((r) => r.headers.authorization !== undefined && r.url.pathname !== '/v1.25/me/language_pairs/');
      expect(bearer).toHaveLength(6);
      for (const request of bearer.slice(0, 3)) {
        expect(request.headers.cookie).toBeUndefined();
        expect(request.headers['x-csrftoken']).toBeUndefined();
      }
      for (const request of bearer.slice(3)) {
        expect(request.headers.cookie).toBe(cookiePair('csrftoken', CSRF));
        expect(request.headers['x-csrftoken']).toBe(CSRF);
      }
      expect(requests.slice(0, webIndex).every((r) => !(r.headers.cookie ?? '').includes('sessionid_2'))).toBe(true);
    });

    it('fetches details of the first completed scenario from the bearer-only list, falling back to 1001', async () => {
      const found = run(route(), { pairId: 9 });
      await found.findings;
      const fallback = run(happyRoute({ bearerWorks: true }), { pairId: 9 });
      await fallback.findings;

      const detailPaths = (requests: typeof found.requests) =>
        requests.filter((r) => r.url.pathname.endsWith('/details/')).map((r) => r.url.pathname);
      expect(detailPaths(found.requests)).toEqual(['/v1.25/me/scenarios/321/details/', '/v1.25/me/scenarios/321/details/']);
      expect(detailPaths(fallback.requests)).toEqual(['/v1.25/me/scenarios/1001/details/', '/v1.25/me/scenarios/1001/details/']);
    });

    it('uses the only pair the account lists when no pair id is given', async () => {
      const base = route();
      const { findings, requests } = run((request) =>
        request.url.pathname === '/v1.25/me/language_pairs/' && request.headers.authorization
          ? { body: { language_pairs: [{ language_pair_id: 9 }] } }
          : base(request),
      );

      expect((await findings).bearerChecks).toHaveLength(6);
      expect(requests.some((r) => r.url.pathname === '/v1.25/me/language_pairs/9/learnables/')).toBe(true);
    });

    it('skips the bearer checks when no pair id is given and the account lists none or several', async () => {
      const several = run((request) =>
        request.url.pathname === '/v1.25/me/language_pairs/' && request.headers.authorization
          ? { body: { language_pairs: [{ id: 1 }, { id: 2 }] } }
          : happyRoute({ bearerWorks: true })(request),
      );
      const none = run(happyRoute({ bearerWorks: true }));

      expect((await several.findings).bearerChecks).toBeUndefined();
      expect((await none.findings).bearerChecks).toBeUndefined();
    });

    it('records the rejected statuses', async () => {
      const { findings } = run(happyRoute(), { pairId: 9 });

      expect((await findings).bearerChecks?.map((c) => c.status)).toEqual([401, 401, 401, 401, 401, 401]);
    });
  });

  it('records the access token expires_in as a number only', async () => {
    const base = happyRoute();
    const { findings, http } = run((request) =>
      request.url.pathname === '/v1.25/auth/access_token/'
        ? { body: { access_token: { access_token: ACCESS, token_type: 'Bearer', expires_in: 3600 }, user: { id: 7 } } }
        : base(request),
    );

    expect((await findings).expiresIn).toBe(3600);
    expect(JSON.stringify(await findings)).not.toContain(ACCESS);
    expect(http.transcript.length).toBeGreaterThan(0);
  });

  it('leaves expires_in unset when the response has none or a non-number', async () => {
    const { findings } = run(happyRoute());

    expect((await findings).expiresIn).toBeUndefined();
  });
});
