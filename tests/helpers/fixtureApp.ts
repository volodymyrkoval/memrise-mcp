/**
 * A composition-root app wired to the fixture API: the real `buildApp` runs, and only the wire is
 * replaced. Login answers from runtime-built credentials, so no literal secret is needed.
 */
import { buildApp, type App } from '../../src/app/buildApp.js';
import type { Now, Sleep } from '../../src/http/transport.js';
import { routeFixtureApi, type DetailsOverride } from './fixtureApi.js';
import { createFakeClock } from './fakeClock.js';
import { RoutedTransport } from './routedTransport.js';
import { runtimeSecret } from './runtimeSecret.js';

export const FIXTURE_START_MS = Date.parse('2026-01-01T00:00:00.000Z');

export interface FixtureAppOptions {
  cacheDir: string;
  /** Shared and mutable: editing an entry changes the next details response for that lesson. */
  details?: Record<number, DetailsOverride>;
  /** Learnable ids whose raw item answers `heard: true`. */
  heardIds?: number[];
  wordCache?: 'read-write' | 'write-only';
  /** Extra env (e.g. `MEMRISE_WORDS_TTL_SECONDS`); credentials and cache dir are always set. */
  env?: Record<string, string | undefined>;
  /** Defaults to fresh runtime credentials; pass the first app's to model a second process on the same account. */
  credentials?: { username: string; password: string };
  /** Defaults to a fake clock of its own; pass an actor clock to run apps side by side as separate processes. */
  clock?: { now: Now; sleep: Sleep };
}

export interface FixtureApp {
  app: App;
  transport: RoutedTransport;
  details: Record<number, DetailsOverride>;
  stderr: string[];
  credentials: { username: string; password: string };
}

export function createFixtureApp(options: FixtureAppOptions): FixtureApp {
  const transport = new RoutedTransport();
  const details = options.details ?? {};
  const credentials = options.credentials ?? { username: runtimeSecret('user'), password: runtimeSecret('pw') };
  routeFixtureApi(transport, { details, heardIds: options.heardIds });
  routeLogin(transport, credentials);

  const clock = options.clock ?? createFakeClock(FIXTURE_START_MS);
  const stderr: string[] = [];
  const app = buildApp({
    env: {
      MEMRISE_USERNAME: credentials.username,
      MEMRISE_PASSWORD: credentials.password,
      MEMRISE_CACHE_DIR: options.cacheDir,
      ...options.env,
    },
    transport,
    now: clock.now,
    sleep: clock.sleep,
    newId: () => 'corr-1',
    stderrWrite: (line) => stderr.push(line),
    wordCache: options.wordCache,
    timeZone: 'UTC',
  });
  return { app, transport, details, stderr, credentials };
}

/** The two login steps: the CSRF cookie, then the token exchange, which accepts only the runtime credentials. */
function routeLogin(transport: RoutedTransport, credentials: { username: string; password: string }): void {
  const csrf = runtimeSecret('csrf');
  const token = runtimeSecret('token');
  transport.route('GET', '/v1.25/web/ensure_csrf', () => ({
    status: 200,
    setCookies: [`csrftoken=${csrf}; Path=/; Max-Age=31449600`],
    bodyText: '',
  }));
  transport.route('POST', '/v1.25/auth/access_token/', (req) => {
    const body = JSON.parse(req.body ?? '{}') as { username?: string; password?: string };
    if (body.username !== credentials.username || body.password !== credentials.password) {
      return { status: 400, setCookies: [], bodyText: '{"error":"invalid credentials"}' };
    }
    const accessToken = { access_token: token, token_type: 'Bearer', expires_in: 315359999, scope: 'read' };
    return { status: 200, setCookies: [], bodyText: JSON.stringify({ access_token: accessToken, user: {} }) };
  });
}
