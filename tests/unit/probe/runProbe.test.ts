import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProbeHttp } from '../../../scripts/probe/probeHttp.js';
import { main } from '../../../scripts/probe/runProbe.js';
import { scanForSecrets } from '../../../src/security/scanForSecrets.js';
import { cookiePair, createFakeFetch, type FakeReply, type FakeRoute } from './fakeTransport.js';

const USERNAME = ['learner', 'example.test'].join('@');
const PASSWORD = ['pw', 'Zk93', 'qLm2'].join('-');
const CSRF = ['csrf', 'Vx81', 'Tn04'].join('_');
const SESSION = ['sess', 'Qw72', 'Rb55'].join('_');
const TOKEN = ['tok', 'Hy60', 'Ls39'].join('_');
const USER_ID = 4815162342;
const FIXTURES = [
  'language-pairs.json',
  'learnables-page-1.json',
  'learnables-page-2.json',
  'learnables-page-last.json',
  'learnables-invalid-state.json',
  'scenarios-completed-page-1.json',
  'scenarios-completed-page-last.json',
  'scenarios-in-progress.json',
  'scenario-details-1001.json',
  'scenario-details-in-progress.json',
  'auth-access-token.json',
  'auth-web.json',
];

const learnables = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ learnable_id_key: from + i, target_value: `word ${from + i}` }));
const detailItems = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ learnable_id: i + 1, target_value: `item ${i + 1}` }));

const LEARNABLE_PAGES: Record<string, { items: unknown[]; next?: string }> = {
  first: { items: learnables(1, 12), next: 'page-two-token' },
  'page-two-token': { items: learnables(13, 12), next: 'page-three-token' },
  'page-three-token': { items: learnables(25, 12) },
};

function dataReply(request: Parameters<FakeRoute>[0], overrides: { learnableExtras?: object } = {}): FakeReply {
  const { url, headers } = request;
  if (headers.authorization && !headers.cookie) return { status: 401 };
  const path = url.pathname;
  if (path === '/v1.25/me/language_pairs/') return { body: { language_pairs: [{ id: 7, name: 'Alpha to Beta' }] } };
  if (path.endsWith('/learnables/')) {
    if (url.searchParams.get('learning_state') === 'INVALID_PROBE_VALUE') return { status: 400, body: { learning_state: ['allowed: A, B'] } };
    const page = LEARNABLE_PAGES[url.searchParams.get('next_page_token') ?? 'first'];
    return { body: { learnables: page.items, ...(page.next ? { next_page_token: page.next } : {}), ...overrides.learnableExtras } };
  }
  if (path.endsWith('/scenarios/')) {
    const type = url.searchParams.get('scenario_type');
    if (type === 'invalid_probe_value') return { status: 400, body: { detail: 'bad type' } };
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return {
      body: { scenarios: [{ scenario_id: 777 + offset, title: 'Lesson' }], has_more_pages: offset < 10, total_number: 11 },
    };
  }
  if (/\/me\/scenarios\/\d+\/details\/$/.test(path)) return { body: { learnables: detailItems(30), completed: true } };
  return { status: 404 };
}

function createRoute(overrides: { learnableExtras?: object; accessTokenStatus?: number } = {}): FakeRoute {
  return (request) => {
    const { url, method } = request;
    if (url.pathname === '/v1.25/web/ensure_csrf') return { setCookies: [cookiePair('csrftoken', CSRF)] };
    if (url.pathname === '/v1.25/auth/access_token/' && method === 'POST') {
      if (overrides.accessTokenStatus) return { status: overrides.accessTokenStatus, body: { error: 'denied' } };
      return {
        body: { access_token: { access_token: TOKEN, token_type: 'Bearer' }, user: { username: USERNAME, is_new: false, id: USER_ID } },
      };
    }
    if (url.pathname === '/v1.25/auth/web/') {
      return {
        body: { success: true },
        setCookies: [`${cookiePair('csrftoken', CSRF)}; Max-Age=31449600`, `${cookiePair('sessionid_2', SESSION)}; HttpOnly; Max-Age=31557600`],
      };
    }
    return dataReply(request, overrides);
  };
}

let outputRoot: string;
beforeEach(async () => {
  outputRoot = await mkdtemp(join(tmpdir(), 'probe-test-'));
});
afterEach(async () => {
  await rm(outputRoot, { recursive: true, force: true });
});

function setup(route: FakeRoute, env: Record<string, string | undefined>, argv: string[] = []) {
  const fake = createFakeFetch(route);
  const http = new ProbeHttp({ fetch: fake.fetch, pause: async () => {}, log: vi.fn() });
  const out: string[] = [];
  const err: string[] = [];
  const exit = main({ env, argv, http, outputRoot, log: (l) => out.push(l), error: (l) => err.push(l) });
  return { requests: fake.requests, exit, out, err };
}

const credsEnv = { MEMRISE_USERNAME: USERNAME, MEMRISE_PASSWORD: PASSWORD };
const readJson = async (name: string) => JSON.parse(await readFile(join(outputRoot, '.probe-out', name), 'utf8'));
const written = async () => (existsSync(join(outputRoot, '.probe-out')) ? readdir(join(outputRoot, '.probe-out')) : []);

describe('runProbe main', () => {
  it.each([{}, { MEMRISE_USERNAME: USERNAME }, { MEMRISE_PASSWORD: PASSWORD }, { MEMRISE_USERNAME: '', MEMRISE_PASSWORD: PASSWORD }])(
    'prints usage and exits 1 without any request when credentials are missing (%#)',
    async (env) => {
      const { exit, requests, err } = setup(createRoute(), env);

      expect(await exit).toBe(1);
      expect(requests).toHaveLength(0);
      expect(err.join('\n')).toContain('MEMRISE_USERNAME');
      expect(err.join('\n')).not.toContain(PASSWORD);
      expect(await written()).toEqual([]);
      expect(existsSync(join(outputRoot, '.probe-out/api.md'))).toBe(false);
    },
  );

  it('writes the report with every section and all twelve fixtures, then exits 0', async () => {
    const { exit } = setup(createRoute(), credsEnv);

    expect(await exit).toBe(0);
    const report = await readFile(join(outputRoot, '.probe-out/api.md'), 'utf8');
    for (const name of ['Headless login', 'Auth mode', 'Learning states', 'Language pairs', 'Scenario types', 'Id match', 'Pagination', 'Headers', 'Recommendations']) {
      expect(report).toContain(`## ${name}`);
    }
    expect((await written()).sort()).toEqual([...FIXTURES, 'api.md'].sort());
  });

  it('omits the pairs failure note when an endpoint listed pairs, and keeps it when none did', async () => {
    await setup(createRoute(), credsEnv).exit;
    expect(await readFile(join(outputRoot, '.probe-out/api.md'), 'utf8')).not.toContain('falling back');

    const route = createRoute();
    await setup((request) => (request.url.pathname.includes('language_pairs/') && !request.url.pathname.includes('/7/') ? { status: 404 } : route(request)), credsEnv).exit;
    expect(await readFile(join(outputRoot, '.probe-out/api.md'), 'utf8')).toContain('no endpoint listed language pairs; set MEMRISE_LANGUAGE_PAIR_ID');
  });

  it('writes no secret into any output file', async () => {
    await setup(createRoute(), credsEnv).exit;

    const secrets = [PASSWORD, USERNAME, CSRF, SESSION, TOKEN, String(USER_ID)];
    const files = [join(outputRoot, '.probe-out/api.md'), ...(await written()).map((n) => join(outputRoot, '.probe-out', n))];
    for (const file of files) {
      expect(scanForSecrets(await readFile(file, 'utf8'), secrets)).toEqual([]);
    }
  });

  it('keeps learner content out of the report but captures it untouched under .probe-out', async () => {
    await setup(createRoute(), credsEnv).exit;

    const report = await readFile(join(outputRoot, '.probe-out/api.md'), 'utf8');
    expect(report).not.toMatch(/Alpha to Beta|\b777\b|\b1001\b/);
    expect((await readJson('language-pairs.json')).language_pairs[0].name).toBe('Alpha to Beta');
    expect((await readJson('scenarios-completed-page-1.json')).scenarios[0].title).toBe('Lesson');
  });

  it('writes nothing under tests/fixtures', async () => {
    await setup(createRoute(), credsEnv).exit;

    expect(existsSync(join(outputRoot, 'tests'))).toBe(false);
  });

  it('picks learnables pages 1, 2 and last, with sanitized tokens', async () => {
    await setup(createRoute(), credsEnv).exit;

    expect((await readJson('learnables-page-1.json')).next_page_token).toBe('<page-token-1>');
    expect((await readJson('learnables-page-2.json')).learnables[0].learnable_id_key).toBe(13);
    expect((await readJson('learnables-page-last.json')).learnables[0].learnable_id_key).toBe(25);
    expect((await readJson('learnables-invalid-state.json')).learning_state).toEqual(['allowed: A, B']);
  });

  it('trims lists to 10 items but keeps a learnable shared by both scenario details', async () => {
    await setup(createRoute(), credsEnv).exit;

    expect((await readJson('learnables-page-1.json')).learnables).toHaveLength(10);
    for (const name of ['scenario-details-1001.json', 'scenario-details-in-progress.json']) {
      const ids = (await readJson(name)).learnables.map((l: { learnable_id: number }) => l.learnable_id);
      expect(ids).toHaveLength(10);
      expect(ids).toContain(1);
    }
  });

  it('fetches the last completed-scenarios page using total_number', async () => {
    const { exit, requests } = setup(createRoute(), credsEnv);
    await exit;

    const last = requests.filter((r) => r.url.pathname.endsWith('/scenarios/') && r.url.searchParams.get('offset') === '10');
    expect(last.length).toBeGreaterThan(0);
    expect((await readJson('scenarios-completed-page-last.json')).scenarios[0].scenario_id).toBe(787);
  });

  it('deletes everything it wrote and exits 1 when the self-check finds a secret that survived sanitizing', async () => {
    const { exit, err } = setup(createRoute({ learnableExtras: { owner_ref: USER_ID } }), credsEnv);

    expect(await exit).toBe(1);
    expect(await written()).toEqual([]);
    expect(existsSync(join(outputRoot, '.probe-out/api.md'))).toBe(false);
    expect(err.join('\n')).not.toContain(String(USER_ID));
  });

  it('still writes a sanitized partial report naming the failed step when login fails', async () => {
    const { exit, requests } = setup(createRoute({ accessTokenStatus: 401 }), credsEnv);

    expect(await exit).toBe(0);
    const report = await readFile(join(outputRoot, '.probe-out/api.md'), 'utf8');
    expect(report).toContain('login: failed at access_token');
    expect(report).toContain('## Recommendations');
    expect(requests.some((r) => r.url.pathname.endsWith('/learnables/'))).toBe(false);
  });

  it('keeps going with status-0 findings when requests blow up mid-probe', async () => {
    const route = createRoute();
    const { exit } = setup((request) => {
      if (request.url.pathname.endsWith('/scenarios/')) throw new Error('boom');
      return route(request);
    }, credsEnv);

    expect(await exit).toBe(0);
    const report = await readFile(join(outputRoot, '.probe-out/api.md'), 'utf8');
    expect(report).toContain('scenarios');
    expect(report).toContain('## Learning states');
  });

  it('runs the Bearer-only checks before the web session on the configured pair, and on the only listed pair when none is configured', async () => {
    const configured = setup(createRoute(), { ...credsEnv, MEMRISE_LANGUAGE_PAIR_ID: '9' });
    await configured.exit;
    const defaulted = setup(createRoute(), credsEnv);
    await defaulted.exit;

    const bearerPaths = (requests: typeof configured.requests) => {
      const web = requests.findIndex((r) => r.url.pathname === '/v1.25/auth/web/');
      return requests.slice(0, web).filter((r) => r.headers.authorization && r.headers.cookie === undefined).map((r) => r.url.pathname);
    };
    expect(bearerPaths(configured.requests)).toEqual([
      '/v1.25/me/language_pairs/9/learnables/',
      '/v1.25/me/language_pairs/9/scenarios/',
      '/v1.25/me/scenarios/1001/details/',
    ]);
    expect(bearerPaths(defaulted.requests)).toContain('/v1.25/me/language_pairs/7/learnables/');
    expect(await readFile(join(outputRoot, '.probe-out/api.md'), 'utf8')).toContain('| learnables list |');
  });
});

describe('runProbe main with --unlinked', () => {
  it('runs login, pair discovery and the unlinked step only, and writes just its own files', async () => {
    const { exit, requests, out } = setup(createRoute(), credsEnv, ['--unlinked']);

    expect(await exit).toBe(0);
    expect((await written()).sort()).toEqual(['unlinked-candidates.json', 'unlinked.md']);
    expect(out.join('\n')).toContain('Wrote 2 files');
    const afterLogin = requests.slice(requests.findIndex((r) => r.url.pathname === '/v1.25/auth/web/') + 1);
    expect(afterLogin.length).toBeGreaterThan(0);
    expect(afterLogin.every((r) => r.method === 'GET')).toBe(true);
    expect(requests.some((r) => r.url.searchParams.get('learning_state') === 'FULLY_LEARNED_OR_KNOWN')).toBe(false);
  });

  it('reports counts of the words no lesson teaches', async () => {
    await setup(createRoute(), credsEnv, ['--unlinked']).exit;

    const report = await readFile(join(outputRoot, '.probe-out/unlinked.md'), 'utf8');
    expect(report).toContain('Words walked (learning_state ANY): 36');
    expect(report).toContain('Unlinked words: 6');
    expect(report).not.toMatch(/Alpha to Beta/);
  });

  it('writes no secret into its files, and deletes them when the self-check finds one', async () => {
    await setup(createRoute(), credsEnv, ['--unlinked']).exit;
    const secrets = [PASSWORD, USERNAME, CSRF, SESSION, TOKEN, String(USER_ID)];
    for (const name of await written()) {
      expect(scanForSecrets(await readFile(join(outputRoot, '.probe-out', name), 'utf8'), secrets)).toEqual([]);
    }

    await rm(join(outputRoot, '.probe-out'), { recursive: true, force: true });
    const route = createRoute();
    const leaking = setup(
      (request) => (request.url.pathname.startsWith('/v1.25/learnables/') ? { body: { owner_ref: USER_ID } } : route(request)),
      credsEnv,
      ['--unlinked'],
    );
    expect(await leaking.exit).toBe(1);
    expect(await written()).toEqual([]);
  });

  it('refuses to write an unlinked report that holds a run of 8 or more digits, saying why', async () => {
    const route = createRoute();
    const leaking = setup(
      (request) =>
        request.url.pathname.startsWith('/v1.25/learnables/') ? { body: { learnables: { field_12345678: { field_12345678: 1 } } } } : route(request),
      credsEnv,
      ['--unlinked'],
    );

    expect(await leaking.exit).toBe(1);
    expect(await written()).toEqual([]);
    expect(leaking.err.join('\n')).toContain('digit run of 8+ characters');
  });

  it('stops after a failed login and still writes a note about it', async () => {
    const { exit, requests } = setup(createRoute({ accessTokenStatus: 401 }), credsEnv, ['--unlinked']);

    expect(await exit).toBe(0);
    expect(requests.some((r) => r.url.pathname.endsWith('/learnables/'))).toBe(false);
    expect(await readFile(join(outputRoot, '.probe-out/unlinked.md'), 'utf8')).toContain('login: failed at access_token');
  });
});
