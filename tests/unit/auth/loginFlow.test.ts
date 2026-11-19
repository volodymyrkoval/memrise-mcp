import { describe, expect, it } from 'vitest';
import { LoginFlow, WEB_CLIENT_ID } from '../../../src/auth/loginFlow.js';
import { AuthError, PacerLockTimeoutError, RateLimitedError } from '../../../src/errors.js';
import { HttpClient } from '../../../src/http/httpClient.js';
import { RequestPacer, type PacerLock } from '../../../src/http/requestPacer.js';
import { Redactor } from '../../../src/log/redactor.js';
import type { HttpTransport } from '../../../src/http/transport.js';
import type { Logger } from '../../../src/log/logger.js';
import { createFakeClock } from '../../helpers/fakeClock.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { InMemoryRateLimitStore } from '../../helpers/inMemoryRateLimitStore.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';
import { ScriptedTransport } from '../../helpers/scriptedTransport.js';
import { scanForSecrets } from '../../../src/security/scanForSecrets.js';

// Credentials and tokens are assembled at runtime so the repo secret scanner never reads them as real secrets.
const USERNAME = ['learner', 'user'].join('-');
const PASSWORD = ['pass', 'word', 'value', '99'].join('-');
const CSRF = ['csrf', 'alpha', '01'].join('-');
const CSRF_COOKIE = `csrftoken=${CSRF}; Max-Age=31449600; Path=/`;
const TOKEN = ['tok', 'alpha', 'beta', 'gamma', 'delta'].join('-');

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const CSRF_PATH = '/v1.25/web/ensure_csrf';
const TOKEN_PATH = '/v1.25/auth/access_token/';

function accessTokenBody(token: string): string {
  return JSON.stringify({ access_token: { access_token: token, token_type: 'Bearer', expires_in: 315359999 } });
}

function setup(transport: HttpTransport, lock?: PacerLock) {
  const clock = createFakeClock();
  let ids = 0;
  const http = new HttpClient({
    transport,
    pacer: new RequestPacer({ now: clock.now, sleep: clock.sleep, lock }),
    sleep: clock.sleep,
    now: clock.now,
    newId: () => `corr-${++ids}`,
    logger: silentLogger,
    rateLimit: new InMemoryRateLimitStore(),
  });
  const redactor = new Redactor();
  return { flow: new LoginFlow({ http, redactor }), redactor };
}

function loginTransport(): RoutedTransport {
  const transport = new RoutedTransport();
  transport.route('GET', CSRF_PATH, { status: 200, setCookies: [CSRF_COOKIE], bodyText: '' });
  transport.route('POST', TOKEN_PATH, { status: 200, setCookies: [], bodyText: accessTokenBody(TOKEN) });
  return transport;
}

describe('LoginFlow.login', () => {
  it('fetches the csrf cookie, then exchanges the credentials for an access token', async () => {
    const transport = loginTransport();
    const { flow } = setup(transport);

    const session = await flow.login({ username: USERNAME, password: PASSWORD });

    expect(session).toEqual({ accessToken: TOKEN });
    expect(transport.requests.map((req) => new URL(req.url).pathname)).toEqual([CSRF_PATH, TOKEN_PATH]);
    expect(JSON.parse(transport.requests[1].body ?? '{}')).toEqual({
      username: USERNAME,
      password: PASSWORD,
      grant_type: 'password',
      client_id: WEB_CLIENT_ID,
    });
  });

  it('sends the csrf token as header and cookie on the access-token request only', async () => {
    const transport = loginTransport();
    const { flow } = setup(transport);

    await flow.login({ username: USERNAME, password: PASSWORD });

    const [bootstrap, tokenRequest] = transport.requests;
    expect(tokenRequest.headers).toMatchObject({ 'x-csrftoken': CSRF, cookie: `csrftoken=${CSRF}` });
    expect(bootstrap.headers).not.toHaveProperty('x-csrftoken');
    expect(bootstrap.headers).not.toHaveProperty('cookie');
  });

  it('registers the csrf token and access token with the redactor so they never reach output', async () => {
    const transport = loginTransport();
    const { flow, redactor } = setup(transport);

    await flow.login({ username: USERNAME, password: PASSWORD });

    const masked = redactor.redact(`${CSRF} and ${TOKEN}`);
    expect(masked).not.toContain(CSRF);
    expect(masked).not.toContain(TOKEN);
  });

  it('reports a csrf bootstrap without a csrftoken cookie as a login failure at the csrf step', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [], bodyText: '' });
    const { flow } = setup(transport);

    await expect(flow.login({ username: USERNAME, password: PASSWORD })).rejects.toMatchObject({
      step: 'csrf',
      message: 'Memrise login failed at step csrf: csrftoken cookie missing',
    });
  });

  it('reports a csrf bootstrap that keeps failing as a login failure at the csrf step', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', CSRF_PATH, { status: 503, setCookies: [], bodyText: '' });
    const { flow } = setup(transport);

    await expect(flow.login({ username: USERNAME, password: PASSWORD })).rejects.toMatchObject({
      step: 'csrf',
      message: 'Memrise login failed at step csrf: HTTP 503',
    });
  });

  it('retries a network failure three times, then reports it as a login failure at the csrf step', async () => {
    const transport = new ScriptedTransport();
    for (let attempt = 0; attempt < 3; attempt += 1) transport.enqueue(new Error('socket hang up'));
    const { flow } = setup(transport);

    await expect(flow.login({ username: USERNAME, password: PASSWORD })).rejects.toMatchObject({
      step: 'csrf',
      message: 'Memrise login failed at step csrf: network error',
    });
    expect(transport.requests).toHaveLength(3);
  });

  it('never echoes the password when the server echoes it back in a rejected response', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [CSRF_COOKIE], bodyText: '' });
    transport.route('POST', TOKEN_PATH, { status: 400, setCookies: [], bodyText: JSON.stringify({ echo: PASSWORD }) });
    const { flow } = setup(transport);

    const failure = await flow.login({ username: USERNAME, password: PASSWORD }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(AuthError);
    expect(scanForSecrets(String((failure as Error).message), [PASSWORD, CSRF, TOKEN])).toEqual([]);
  });

  it('never calls the web-session endpoint', async () => {
    const transport = loginTransport();
    const { flow } = setup(transport);

    await flow.login({ username: USERNAME, password: PASSWORD });

    expect(transport.countFor('/v1.25/auth/web/')).toBe(0);
  });

  it('reports a token response in an unexpected shape as a malformed access_token step', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [CSRF_COOKIE], bodyText: '' });
    transport.route('POST', TOKEN_PATH, {
      status: 200,
      setCookies: [],
      bodyText: JSON.stringify(loadFixture('auth-access-token.json')),
    });
    const { flow } = setup(transport);

    await expect(flow.login({ username: USERNAME, password: PASSWORD })).rejects.toMatchObject({
      step: 'access_token',
      message: 'Memrise login failed at step access_token: malformed response',
    });
  });

  it('reports a rejected access-token request as a login failure naming the step and status', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [CSRF_COOKIE], bodyText: '' });
    transport.route('POST', TOKEN_PATH, { status: 400, setCookies: [], bodyText: '{}' });
    const { flow } = setup(transport);

    const attempt = flow.login({ username: USERNAME, password: PASSWORD });

    await expect(attempt).rejects.toBeInstanceOf(AuthError);
    await expect(attempt).rejects.toMatchObject({
      step: 'access_token',
      message: 'Memrise login failed at step access_token: HTTP 400',
    });
  });

  it('lets a rate-limited login step fail as RateLimitedError, not as a login failure', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [CSRF_COOKIE], bodyText: '' });
    transport.route('POST', TOKEN_PATH, { status: 429, setCookies: [], bodyText: '', retryAfter: '1' });
    const { flow } = setup(transport);

    await expect(flow.login({ username: USERNAME, password: PASSWORD })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('lets a login step that never got its turn from another process fail as that, not as a login failure', async () => {
    const busy: PacerLock = {
      acquire: async () => {
        throw new PacerLockTimeoutError();
      },
    };
    const { flow } = setup(loginTransport(), busy);

    await expect(flow.login({ username: USERNAME, password: PASSWORD })).rejects.toBeInstanceOf(PacerLockTimeoutError);
  });
});
