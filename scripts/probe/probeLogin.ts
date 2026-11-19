import type { ProbeHttp } from './probeHttp.js';

const CLIENT_ID = '1e739f5e77704b57a703';
const DATA_PATH = '/v1.25/me/language_pairs/';
const FALLBACK_SCENARIO_ID = 1001;

export interface Credentials {
  username: string;
  password: string;
}

export type CsrfSource = 'ensure_csrf' | 'signin' | 'none';
export type BearerEndpoint = 'learnables list' | 'scenarios list' | 'scenario details';
export type BearerVariant = 'no cookies' | 'csrf only';

/** Status of one Bearer-only request; `no cookies` sends neither Cookie nor x-csrftoken, `csrf only` sends the csrftoken cookie and header. */
export interface BearerCheck {
  endpoint: BearerEndpoint;
  variant: BearerVariant;
  status: number;
}

export interface LoginOptions {
  /** Language pair used for the Bearer endpoint checks; when omitted, the only pair the account lists, else the checks are skipped. */
  pairId?: number;
}

export type LoginStep = 'csrf' | 'access_token' | 'web_session';

/** Non-secret outcome of the headless login probe: statuses, cookie names and lifetimes only. */
export interface LoginFindings {
  csrfSource: CsrfSource;
  csrfStatuses: Partial<Record<'ensure_csrf' | 'signin', number>>;
  accessTokenStatus?: number;
  bearerOnDataStatus?: number;
  /** Bearer-only results, all taken before the web session exists. */
  bearerChecks?: BearerCheck[];
  /** Lifetime in seconds the access-token response reports; never the token. */
  expiresIn?: number;
  webSessionStatus?: number;
  cookieNames: string[];
  cookieMaxAge: Record<string, number>;
  cookiesOnDataStatus?: number;
  failedStep?: LoginStep;
}

/** Runs the headless login sequence and records what each step returned. */
export async function probeLogin(http: ProbeHttp, creds: Credentials, options: LoginOptions = {}): Promise<LoginFindings> {
  const findings: LoginFindings = { csrfSource: 'none', csrfStatuses: {}, cookieNames: [], cookieMaxAge: {} };

  await bootstrapCsrf(http, findings);
  if (findings.csrfSource === 'none') return { ...findings, failedStep: 'csrf' };

  const token = await requestAccessToken(http, creds, findings);
  if (token === undefined) return { ...findings, failedStep: 'access_token' };

  const bearerOnData = await tryBearerOnData(http, token);
  findings.bearerOnDataStatus = bearerOnData.status;
  const pairId = options.pairId ?? soleListedPairId(bearerOnData.body);
  if (pairId !== undefined) findings.bearerChecks = await checkBearerEndpoints(http, token, pairId);

  await createWebSession(http, token, findings);
  if (findings.webSessionStatus !== 200) return { ...findings, failedStep: 'web_session' };

  findings.cookiesOnDataStatus = (await http.get('data with cookies', DATA_PATH)).status;
  return findings;
}

async function bootstrapCsrf(http: ProbeHttp, findings: LoginFindings): Promise<void> {
  const attempts = [
    { source: 'ensure_csrf', path: '/v1.25/web/ensure_csrf' },
    { source: 'signin', path: '/signin' },
  ] as const;
  for (const { source, path } of attempts) {
    findings.csrfStatuses[source] = (await http.get(`csrf via ${source}`, path)).status;
    if (http.hasCookie('csrftoken')) {
      findings.csrfSource = source;
      return;
    }
  }
}

async function requestAccessToken(
  http: ProbeHttp,
  creds: Credentials,
  findings: LoginFindings,
): Promise<string | undefined> {
  const response = await http.post('access token', '/v1.25/auth/access_token/', {
    username: creds.username,
    password: creds.password,
    grant_type: 'password',
    client_id: CLIENT_ID,
  });
  findings.accessTokenStatus = response.status;
  const expiresIn = extractExpiresIn(response.body);
  if (expiresIn !== undefined) findings.expiresIn = expiresIn;
  return response.status === 200 ? extractAccessToken(response.body) : undefined;
}

async function tryBearerOnData(http: ProbeHttp, token: string): Promise<{ status: number; body: unknown }> {
  return http.get('data with bearer only', DATA_PATH, undefined, {
    authorization: `Bearer ${token}`,
  }, { cookies: 'csrf-only' });
}

function soleListedPairId(body: unknown): number | undefined {
  const pairs = (body as { language_pairs?: unknown } | null)?.language_pairs;
  if (!Array.isArray(pairs) || pairs.length !== 1) return undefined;
  const record = pairs[0] as { id?: unknown; language_pair_id?: unknown } | null;
  const id = record?.id ?? record?.language_pair_id;
  return typeof id === 'number' ? id : undefined;
}

const VARIANT_COOKIES = { 'no cookies': 'none', 'csrf only': 'csrf-only' } as const;

async function checkBearerEndpoints(http: ProbeHttp, token: string, pairId: number): Promise<BearerCheck[]> {
  const headers = { authorization: `Bearer ${token}` };
  const checks: BearerCheck[] = [];
  let scenarioId = FALLBACK_SCENARIO_ID;
  for (const variant of ['no cookies', 'csrf only'] as const) {
    const cookies = { cookies: VARIANT_COOKIES[variant] };
    const base = `/v1.25/me/language_pairs/${pairId}`;
    const learnables = await http.get(`bearer ${variant} learnables list`, `${base}/learnables/`, {
      learning_state: 'ANY',
      ordering: 'LAST_TOUCHED',
      ordering_direction: 'DESCENDING',
      page_size: '5',
    }, headers, cookies);
    const scenarios = await http.get(`bearer ${variant} scenarios list`, `${base}/scenarios/`, {
      scenario_type: 'completed',
      free_only: 'false',
      has_immerse_content: 'true',
      limit: '5',
      offset: '0',
    }, headers, cookies);
    if (variant === 'no cookies') scenarioId = firstScenarioId(scenarios.body) ?? FALLBACK_SCENARIO_ID;
    const details = await http.get(`bearer ${variant} scenario details`, `/v1.25/me/scenarios/${scenarioId}/details/`, undefined, headers, cookies);
    checks.push(
      { endpoint: 'learnables list', variant, status: learnables.status },
      { endpoint: 'scenarios list', variant, status: scenarios.status },
      { endpoint: 'scenario details', variant, status: details.status },
    );
  }
  return checks;
}

function firstScenarioId(body: unknown): number | undefined {
  const scenarios = (body as { scenarios?: unknown } | null)?.scenarios;
  const id = Array.isArray(scenarios) ? (scenarios[0] as { scenario_id?: unknown } | undefined)?.scenario_id : undefined;
  return typeof id === 'number' ? id : undefined;
}

async function createWebSession(http: ProbeHttp, token: string, findings: LoginFindings): Promise<void> {
  const response = await http.post('web session', '/v1.25/auth/web/', {
    token,
    invalidate_token_after: true,
  });
  findings.webSessionStatus = response.status;
  for (const { name, maxAge } of response.setCookies) {
    if (!findings.cookieNames.includes(name)) findings.cookieNames.push(name);
    if (maxAge !== undefined) findings.cookieMaxAge[name] = maxAge;
  }
}

function extractAccessToken(body: unknown): string | undefined {
  const outer = (body as { access_token?: unknown } | null)?.access_token;
  const inner = (outer as { access_token?: unknown } | null)?.access_token;
  return typeof inner === 'string' ? inner : undefined;
}

function extractExpiresIn(body: unknown): number | undefined {
  const outer = (body as { access_token?: unknown } | null)?.access_token;
  const expiresIn = (outer as { expires_in?: unknown } | null)?.expires_in;
  return typeof expiresIn === 'number' ? expiresIn : undefined;
}
