/** Memrise login protocol: csrf bootstrap, then the access-token exchange. */
import { z } from 'zod';
import type { Credentials } from '../config/config.js';
import { AuthError, describeFailure, PacerLockTimeoutError, RateLimitedError, RequestNotNeededError } from '../errors.js';
import { readCookie } from '../http/cookies.js';
import type { ApiRequest, ApiResponse, HttpClient } from '../http/httpClient.js';
import type { Session } from './session.js';

export const WEB_CLIENT_ID = '1e739f5e77704b57a703';

const CSRF_PATH = '/v1.25/web/ensure_csrf';
const ACCESS_TOKEN_PATH = '/v1.25/auth/access_token/';
const CSRF_COOKIE = 'csrftoken';

const accessTokenBodySchema = z.object({
  access_token: z.object({ access_token: z.string().min(1) }),
});

export interface LoginFlowDeps {
  http: Pick<HttpClient, 'request'>;
  redactor: { addSecret(value: string): void };
}

export class LoginFlow {
  readonly #http: Pick<HttpClient, 'request'>;
  readonly #redactor: { addSecret(value: string): void };

  constructor({ http, redactor }: LoginFlowDeps) {
    this.#http = http;
    this.#redactor = redactor;
  }

  /**
   * `stillNeeded` is re-checked when each step's pacer turn comes; `false` rejects with
   * `RequestNotNeededError` and sends nothing more, so a session saved meanwhile stops the password submission.
   */
  async login(creds: Credentials, options: Pick<ApiRequest, 'stillNeeded'> = {}): Promise<Session> {
    const csrf = await this.#obtainCsrfToken(options);
    const body = await this.#requestStep('access_token', { ...this.#accessTokenRequest(creds, csrf), ...options });
    return this.#extractAccessToken(body);
  }

  async #obtainCsrfToken(options: Pick<ApiRequest, 'stillNeeded'>): Promise<string> {
    const res = await this.#requestStep('csrf', { method: 'GET', path: CSRF_PATH, label: 'csrf', expect: 'none', ...options });
    const csrf = readCookie(res.setCookies, CSRF_COOKIE);
    if (csrf === undefined) throw new AuthError('csrf', 'csrftoken cookie missing');
    this.#redactor.addSecret(csrf);
    return csrf;
  }

  /**
   * Any failure of one login step is reported as an `AuthError` naming that step, except rate
   * limiting, a lock-wait timeout and a dropped request: they say nothing about the credentials, so
   * they pass through unchanged.
   */
  async #requestStep(step: string, req: ApiRequest): Promise<ApiResponse> {
    try {
      return await this.#http.request(req);
    } catch (err) {
      if (err instanceof RateLimitedError || err instanceof PacerLockTimeoutError || err instanceof RequestNotNeededError) throw err;
      throw new AuthError(step, describeFailure(err), { cause: err });
    }
  }

  #accessTokenRequest(creds: Credentials, csrf: string): ApiRequest {
    return {
      method: 'POST',
      path: ACCESS_TOKEN_PATH,
      json: { username: creds.username, password: creds.password, grant_type: 'password', client_id: WEB_CLIENT_ID },
      headers: { 'x-csrftoken': csrf, cookie: `${CSRF_COOKIE}=${csrf}` },
      label: 'access_token',
    };
  }

  #extractAccessToken(res: ApiResponse): Session {
    const parsed = accessTokenBodySchema.safeParse(res.body);
    if (!parsed.success) throw new AuthError('access_token', 'malformed response');
    const accessToken = parsed.data.access_token.access_token;
    this.#redactor.addSecret(accessToken);
    return { accessToken };
  }
}
