/** Session lifecycle around the HTTP client: lazy login, Bearer auth, one re-login per request, capped per process. */
import { applySession } from '../auth/session.js';
import type { Session, SessionStore } from '../auth/session.js';
import type { LoginFlow } from '../auth/loginFlow.js';
import { requireCredentials } from '../config/config.js';
import type { Config } from '../config/config.js';
import { AuthError, HttpStatusError, RequestNotNeededError } from '../errors.js';
import type { ApiRequest, ApiResponse, HttpClient } from '../http/httpClient.js';
import type { Logger } from '../log/logger.js';
import type { Now } from '../http/transport.js';

/** Re-logins one requester may perform; a forbidden resource must not trigger dozens of password submissions. */
export const MAX_RELOGINS = 3;
/** After a failed login, sends fail fast for this long instead of submitting the password again. */
export const LOGIN_COOLDOWN_MS = 30_000;

/** Port the API layer depends on; implemented by `AuthenticatedRequester`. */
export interface Requester {
  send(req: ApiRequest): Promise<ApiResponse>;
}

export interface AuthenticatedRequesterDeps {
  config: Config;
  store: SessionStore;
  loginFlow: Pick<LoginFlow, 'login'>;
  http: Pick<HttpClient, 'request'>;
  logger: Logger;
  now?: Now;
}

export class AuthenticatedRequester implements Requester {
  readonly #config: Config;
  readonly #store: SessionStore;
  readonly #loginFlow: Pick<LoginFlow, 'login'>;
  readonly #http: Pick<HttpClient, 'request'>;
  readonly #logger: Logger;
  #current: Session | null = null;
  #inflight: Promise<Session> | null = null;
  readonly #now: Now;
  #loggedCacheReuse = false;
  #relogins = 0;
  #lastLoginFailure: { error: AuthError; at: number } | null = null;

  constructor({ config, store, loginFlow, http, logger, now = Date.now }: AuthenticatedRequesterDeps) {
    this.#now = now;
    this.#config = config;
    this.#store = store;
    this.#loginFlow = loginFlow;
    this.#http = http;
    this.#logger = logger;
  }

  async send(req: ApiRequest): Promise<ApiResponse> {
    const session = await this.#currentSession();
    try {
      return await this.#sendWith(session, req);
    } catch (err) {
      if (!isAuthRejection(err)) throw err;
      return this.#sendAfterRelogin(await this.#reloginOnce(session), req);
    }
  }

  /** The one retry a request gets; a rejection here means a fresh login did not help. */
  async #sendAfterRelogin(session: Session, req: ApiRequest): Promise<ApiResponse> {
    try {
      return await this.#sendWith(session, req);
    } catch (err) {
      if (!isAuthRejection(err)) throw err;
      throw new AuthError('data_request_after_relogin', `HTTP ${err.status}`, { cause: err });
    }
  }

  /**
   * Replaces the rejected session with a fresh login, unless another caller already did: then that
   * newer session is reused, so a burst of 401s from one stale token costs a single login.
   */
  async #reloginOnce(stale: Session): Promise<Session> {
    if (this.#inflight !== null) return this.#inflight;
    if (this.#current !== null && this.#current.accessToken !== stale.accessToken) return this.#current;
    if (this.#relogins >= MAX_RELOGINS) throw new AuthError('relogin_cap', `re-login limit of ${MAX_RELOGINS} reached`);
    this.#relogins += 1;
    this.#current = null;
    this.#inflight = this.#establish(async () => {
      await this.#store.clear().catch(() => this.#logger.warn('session: could not clear the rejected session file'));
      return this.#loginAndSave();
    });
    return this.#inflight;
  }

  /** Memory first; otherwise one shared load-or-login, however many callers ask at once. */
  async #currentSession(): Promise<Session> {
    if (this.#current !== null) return this.#current;
    this.#inflight ??= this.#establish(() => this.#loadOrLogin());
    return this.#inflight;
  }

  /** Runs `acquire` as the single in-flight acquisition; a failure leaves no state behind, so the next send retries. */
  async #establish(acquire: () => Promise<Session>): Promise<Session> {
    try {
      this.#current = await acquire();
      return this.#current;
    } finally {
      this.#inflight = null;
    }
  }

  async #loadOrLogin(): Promise<Session> {
    return (await this.#loadSaved()) ?? this.#loginUnlessSavedMeanwhile();
  }

  /**
   * Another process sharing the cache folder may log in while this one waits for its pacer turn, so
   * the session file is read again once the turn comes; a session found then is used and no login is sent.
   */
  async #loginUnlessSavedMeanwhile(): Promise<Session> {
    let savedMeanwhile: Session | null = null;
    const stillNeeded = async () => (savedMeanwhile = await this.#loadSaved()) === null;
    try {
      return await this.#loginAndSave(stillNeeded);
    } catch (err) {
      if (err instanceof RequestNotNeededError && savedMeanwhile !== null) return savedMeanwhile;
      throw err;
    }
  }

  async #loadSaved(): Promise<Session | null> {
    const saved = await this.#store.load();
    if (saved !== null) this.#logCacheReuseOnce();
    return saved;
  }

  #logCacheReuseOnce(): void {
    if (this.#loggedCacheReuse) return;
    this.#loggedCacheReuse = true;
    this.#logger.debug('session: reused cached session');
  }

  #sendWith(session: Session, req: ApiRequest): Promise<ApiResponse> {
    return this.#http.request(applySession(req, session));
  }

  /** Submits the credentials unless a login failed within the cool-down; then that failure is rethrown unchanged. */
  async #login(stillNeeded?: () => Promise<boolean>): Promise<Session> {
    const failure = this.#lastLoginFailure;
    if (failure !== null && this.#now() - failure.at < LOGIN_COOLDOWN_MS) throw failure.error;
    try {
      const session = await this.#loginFlow.login(requireCredentials(this.#config), { stillNeeded });
      this.#lastLoginFailure = null;
      return session;
    } catch (err) {
      if (err instanceof AuthError) this.#lastLoginFailure = { error: err, at: this.#now() };
      throw err;
    }
  }

  async #loginAndSave(stillNeeded?: () => Promise<boolean>): Promise<Session> {
    const session = await this.#login(stillNeeded);
    await this.#store
      .save(session)
      .catch(() => this.#logger.warn('session: could not save the session; keeping it in memory only'));
    this.#logger.debug('session: logged in');
    return session;
  }
}

function isAuthRejection(err: unknown): err is HttpStatusError {
  return err instanceof HttpStatusError && (err.status === 401 || err.status === 403);
}
