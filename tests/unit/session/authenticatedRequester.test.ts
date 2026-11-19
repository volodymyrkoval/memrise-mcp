import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accountKey } from '../../../src/auth/accountKey.js';
import { scanForSecrets } from '../../../src/security/scanForSecrets.js';
import { FileSessionStore } from '../../../src/session/fileSessionStore.js';
import type { SessionStore } from '../../../src/auth/session.js';
import { LoginFlow } from '../../../src/auth/loginFlow.js';
import type { Config } from '../../../src/config/config.js';
import { HttpClient } from '../../../src/http/httpClient.js';
import type { ApiRequest, ApiResponse } from '../../../src/http/httpClient.js';
import { RequestPacer } from '../../../src/http/requestPacer.js';
import type { Logger } from '../../../src/log/logger.js';
import { Redactor } from '../../../src/log/redactor.js';
import { AuthenticatedRequester } from '../../../src/session/authenticatedRequester.js';
import { createFakeClock } from '../../helpers/fakeClock.js';
import { InMemorySessionStore } from '../../helpers/inMemorySessionStore.js';
import { AuthError, ConfigError, HttpStatusError } from '../../../src/errors.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';
import { InMemoryRateLimitStore } from '../../helpers/inMemoryRateLimitStore.js';
import { POSIX_MODES_UNSUPPORTED } from '../../helpers/platform.js';

// Credentials and tokens are assembled at runtime so the repo secret scanner never reads them as real secrets.
const USERNAME = ['learner', 'user'].join('-');
const PASSWORD = ['pass', 'word', 'value', '99'].join('-');
const CSRF = ['csrf', 'alpha', '01'].join('-');
const TOKEN_A = ['tok', 'alpha', 'one', 'aaaa'].join('-');
const CACHED = ['tok', 'cached', 'zero', 'cccc'].join('-');

const CSRF_PATH = '/v1.25/web/ensure_csrf';
const TOKEN_PATH = '/v1.25/auth/access_token/';
const DATA_PATH = '/v1.25/me/language_pairs/';

const CONFIG: Config = {
  username: USERNAME,
  password: PASSWORD,
  languagePairId: null,
  cacheDir: '/unused',
  wordsTtlSeconds: 0,
  debug: false,
};

function capturingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (m) => lines.push(m),
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
  };
  return { logger, lines };
}

function okJson(body: unknown) {
  return { status: 200, setCookies: [], bodyText: JSON.stringify(body) };
}

function setup(opts: { config?: Config; store?: SessionStore; transport?: RoutedTransport } = {}) {
  const transport = opts.transport ?? new RoutedTransport();
  const store: SessionStore = opts.store ?? new InMemorySessionStore();
  const clock = createFakeClock();
  const { logger, lines } = capturingLogger();
  const http = new HttpClient({
    transport,
    pacer: new RequestPacer({ now: clock.now, sleep: clock.sleep }),
    sleep: clock.sleep,
    now: clock.now,
    newId: () => 'corr',
    logger,
    rateLimit: new InMemoryRateLimitStore(),
  });
  const loginFlow = new LoginFlow({ http, redactor: new Redactor() });
  const requester = new AuthenticatedRequester({
    config: opts.config ?? CONFIG,
    store,
    loginFlow,
    http,
    logger,
    now: clock.now,
  });
  return { requester, transport, store, lines, clock };
}

/** Routes a working login that hands out `tokens` in order, plus a data route that accepts only `valid` tokens. */
function routeApi(
  transport: RoutedTransport,
  tokens: string[],
  valid: () => Set<string>,
  rejectStatus = 401,
) {
  transport.route('GET', CSRF_PATH, { status: 200, setCookies: [`csrftoken=${CSRF}; Path=/`], bodyText: '' });
  transport.route('POST', TOKEN_PATH, () =>
    okJson({ access_token: { access_token: tokens.shift() ?? 'exhausted' } }),
  );
  transport.route('GET', DATA_PATH, (req) => {
    const token = req.headers.authorization?.replace('Bearer ', '') ?? '';
    return valid().has(token) ? okJson({ ok: true }) : { status: rejectStatus, setCookies: [], bodyText: '' };
  });
}

const LOGIN_COOLDOWN_MS = 30_000;
const REQ = { method: 'GET', path: DATA_PATH, label: 'pairs' } as const;

describe('AuthenticatedRequester', () => {
  it('does nothing until the first send, then logs in and sends the data request with the Bearer token', async () => {
    const { requester, transport } = setup();
    routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]));
    expect(transport.requests).toHaveLength(0);

    const res = await requester.send(REQ);

    expect(res.body).toEqual({ ok: true });
    expect(transport.requests.map((r) => new URL(r.url).pathname)).toEqual([CSRF_PATH, TOKEN_PATH, DATA_PATH]);
    const data = transport.requests[2];
    expect(data.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(data.headers.cookie).toBeUndefined();
    expect(data.headers['x-csrftoken']).toBeUndefined();
  });

  it('reuses a cached session without logging in, and says so only once', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport, lines } = setup({ store });
    routeApi(transport, [], () => new Set([CACHED]));

    await requester.send(REQ);
    await requester.send(REQ);

    expect(transport.countFor(CSRF_PATH) + transport.countFor(TOKEN_PATH)).toBe(0);
    expect(transport.requests.every((r) => r.headers.authorization === `Bearer ${CACHED}`)).toBe(true);
    expect(lines.filter((l) => l === 'session: reused cached session')).toHaveLength(1);
  });

  it('re-logs in once when the cached session is rejected, then retries the request with the new token', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport } = setup({ store });
    routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]));

    const res = await requester.send(REQ);

    expect(res.body).toEqual({ ok: true });
    expect(transport.countFor(CSRF_PATH)).toBe(1);
    expect(transport.countFor(TOKEN_PATH)).toBe(1);
    expect(transport.countFor(DATA_PATH)).toBe(2);
    expect(await store.load()).toEqual({ accessToken: TOKEN_A });
  });

  it('shares one login between concurrent sends when there is no session', async () => {
    const { requester, transport } = setup();
    routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]));

    await Promise.all([requester.send(REQ), requester.send(REQ), requester.send(REQ)]);

    expect(transport.countFor(TOKEN_PATH)).toBe(1);
    expect(transport.countFor(DATA_PATH)).toBe(3);
  });

  it('logs in only once when several concurrent sends are rejected with the same stale session', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport } = setup({ store });
    routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]));

    const results = await Promise.all([requester.send(REQ), requester.send(REQ), requester.send(REQ)]);

    expect(results.map((r) => r.body)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(transport.countFor(TOKEN_PATH)).toBe(1);
  });

  it('reuses a session another caller already renewed when a late rejection of the stale one arrives', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    let logins = 0;
    const loginFlow = {
      login: async () => {
        logins += 1;
        return { accessToken: TOKEN_A };
      },
    };
    // Test-only fake client: the real pacer would serialize requests and hide this interleaving.
    const lateStale: Array<() => void> = [];
    const http = {
      async request(req: ApiRequest): Promise<ApiResponse> {
        const token = req.headers?.authorization?.replace('Bearer ', '');
        if (token === TOKEN_A) return { status: 200, setCookies: [], body: { ok: true } };
        if (lateStale.length === 0 && !http.firstSeen) {
          http.firstSeen = true;
          return Promise.reject(new HttpStatusError(401, req.label));
        }
        return new Promise((_, reject) => lateStale.push(() => reject(new HttpStatusError(401, req.label))));
      },
      firstSeen: false,
    };
    const { logger } = capturingLogger();
    const requester = new AuthenticatedRequester({ config: CONFIG, store, loginFlow, http, logger });

    const first = requester.send(REQ);
    const second = requester.send(REQ);
    await first;
    lateStale.forEach((reject) => reject());

    expect((await second).body).toEqual({ ok: true });
    expect(logins).toBe(1);
  });

  it('fails with a login-failed AuthError naming the step when the data request is rejected again after re-login', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport } = setup({ store });
    routeApi(transport, [TOKEN_A], () => new Set());

    const failure = await requester.send(REQ).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(AuthError);
    expect((failure as AuthError).step).toBe('data_request_after_relogin');
    expect((failure as AuthError).message).toContain('login failed');
    expect((failure as AuthError).message).toContain('data_request_after_relogin');
    expect(transport.countFor(TOKEN_PATH)).toBe(1);
    expect(transport.countFor(DATA_PATH)).toBe(2);
  });

  it('treats 403 like 401: re-logs in once and retries', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport } = setup({ store });
    routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]), 403);

    const res = await requester.send(REQ);

    expect(res.body).toEqual({ ok: true });
    expect(transport.countFor(TOKEN_PATH)).toBe(1);
  });

  it('does not re-login for other failures and lets them through unchanged', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport } = setup({ store });
    transport.route('GET', DATA_PATH, { status: 404, setCookies: [], bodyText: '' });

    await expect(requester.send(REQ)).rejects.toMatchObject({ name: 'HttpStatusError', status: 404 });
    expect(transport.countFor(TOKEN_PATH)).toBe(0);
  });

  it('does not poison state when login fails: once the cool-down has passed the next send logs in again', async () => {
    const { requester, transport, clock } = setup();
    let tokenAttempts = 0;
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [`csrftoken=${CSRF}; Path=/`], bodyText: '' });
    transport.route('POST', TOKEN_PATH, () => {
      tokenAttempts += 1;
      return tokenAttempts === 1
        ? { status: 400, setCookies: [], bodyText: '' }
        : okJson({ access_token: { access_token: TOKEN_A } });
    });
    transport.route('GET', DATA_PATH, okJson({ ok: true }));
    const failure = await requester.send(REQ).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AuthError);
    expect((failure as AuthError).step).toBe('access_token');

    await clock.sleep(LOGIN_COOLDOWN_MS);
    const res = await requester.send(REQ);

    expect(res.body).toEqual({ ok: true });
    expect(tokenAttempts).toBe(2);
  });

  it('fails a re-login that errors, then recovers on the next send after the cool-down', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport, clock } = setup({ store });
    let tokenAttempts = 0;
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [`csrftoken=${CSRF}; Path=/`], bodyText: '' });
    transport.route('POST', TOKEN_PATH, () => {
      tokenAttempts += 1;
      return tokenAttempts === 1
        ? { status: 400, setCookies: [], bodyText: '' }
        : okJson({ access_token: { access_token: TOKEN_A } });
    });
    transport.route('GET', DATA_PATH, (req) =>
      req.headers.authorization === `Bearer ${TOKEN_A}` ? okJson({ ok: true }) : { status: 401, setCookies: [], bodyText: '' },
    );

    await expect(requester.send(REQ)).rejects.toBeInstanceOf(AuthError);
    await clock.sleep(LOGIN_COOLDOWN_MS);
    const res = await requester.send(REQ);

    expect(res.body).toEqual({ ok: true });
  });

  it('stops re-logging in after three re-logins: further rejections fail without another login', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport } = setup({ store });
    routeApi(transport, ['t1', 't2', 't3', 't4'], () => new Set());

    for (let i = 0; i < 3; i += 1) await requester.send(REQ).catch(() => undefined);
    const failure = await requester.send(REQ).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(AuthError);
    expect(transport.countFor(TOKEN_PATH)).toBe(3);
  });

  it('fails fast with the previous AuthError during the cool-down after a failed login, without re-sending the password', async () => {
    const { requester, transport, clock } = setup();
    transport.route('GET', CSRF_PATH, { status: 200, setCookies: [`csrftoken=${CSRF}; Path=/`], bodyText: '' });
    transport.route('POST', TOKEN_PATH, { status: 400, setCookies: [], bodyText: '' });

    const first = await requester.send(REQ).catch((err: unknown) => err);
    await clock.sleep(LOGIN_COOLDOWN_MS - 1);
    const second = await requester.send(REQ).catch((err: unknown) => err);

    expect(first).toBeInstanceOf(AuthError);
    expect(second).toBe(first);
    expect(transport.countFor(TOKEN_PATH)).toBe(1);
  });

  it('keeps the session in memory and warns when saving it fails, instead of failing the request', async () => {
    const store = new InMemorySessionStore();
    store.save = async () => {
      throw new Error(`EACCES: cannot write /secret/path/${TOKEN_A}`);
    };
    const { requester, transport, lines } = setup({ store });
    routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]));

    await requester.send(REQ);
    const second = await requester.send(REQ);

    expect(second.body).toEqual({ ok: true });
    expect(transport.countFor(TOKEN_PATH)).toBe(1);
    expect(lines).toContain('session: could not save the session; keeping it in memory only');
    expect(lines.join('\n')).not.toContain('/secret/path');
  });

  it('warns and carries on when clearing the rejected session fails during a re-login', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    store.clear = async () => {
      throw new Error('EPERM: /secret/path');
    };
    const { requester, transport, lines } = setup({ store });
    routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]));

    const res = await requester.send(REQ);

    expect(res.body).toEqual({ ok: true });
    expect(lines).toContain('session: could not clear the rejected session file');
    expect(lines.join('\n')).not.toContain('/secret/path');
  });

  it('throws ConfigError when there are no credentials and no cached session', async () => {
    const { requester, transport } = setup({ config: { ...CONFIG, username: undefined, password: undefined } });

    await expect(requester.send(REQ)).rejects.toBeInstanceOf(ConfigError);
    expect(transport.requests).toHaveLength(0);
  });

  it('works without credentials when a cached session exists', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport } = setup({ store, config: { ...CONFIG, username: undefined, password: undefined } });
    routeApi(transport, [], () => new Set([CACHED]));

    const res = await requester.send(REQ);

    expect(res.body).toEqual({ ok: true });
  });

  it('leaks no credential, csrf or token into error messages or log lines', async () => {
    const store = new InMemorySessionStore();
    await store.save({ accessToken: CACHED });
    const { requester, transport, lines } = setup({ store });
    routeApi(transport, [TOKEN_A], () => new Set());
    const secrets = [USERNAME, PASSWORD, CSRF, TOKEN_A, CACHED];

    const doubleRejection = await requester.send(REQ).catch((err: Error) => err.message);
    await store.clear();
    const noCredentials = setup({ config: { ...CONFIG, username: undefined, password: undefined } });
    const missing = await noCredentials.requester.send(REQ).catch((err: Error) => err.message);

    const text = [doubleRejection, missing, ...lines, ...noCredentials.lines].join('\n');
    expect(scanForSecrets(text, secrets)).toEqual([]);
  });

  it.skipIf(POSIX_MODES_UNSUPPORTED || process.getuid?.() === 0)('treats an unreadable session file like the store does: as no cached session, then logs in and replaces it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memrise-requester-test-'));
    try {
      const { logger } = capturingLogger();
      const fileStore = new FileSessionStore({ cacheDir: dir, account: accountKey(USERNAME), now: () => 0, logger });
      await fileStore.save({ accessToken: CACHED });
      await chmod(join(dir, 'session.json'), 0o000);
      const { requester, transport } = setup({ store: fileStore });
      routeApi(transport, [TOKEN_A], () => new Set([TOKEN_A]));

      const res = await requester.send(REQ);

      expect(res.body).toEqual({ ok: true });
      expect(transport.countFor(TOKEN_PATH)).toBe(1);
      expect(await fileStore.load()).toEqual({ accessToken: TOKEN_A });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
