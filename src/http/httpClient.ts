/**
 * Request pipeline for the Memrise web API: pacing, 429 back-off and retry around one HTTP attempt,
 * which checks the rate-limit cooldown, builds the URL and headers, then checks status and body.
 * Auth is layered on top by the caller.
 */
import { HttpStatusError, MalformedResponseError, NetworkError, RateLimitedError } from '../errors.js';
import type { Logger } from '../log/logger.js';
import { buildBrowserHeaders, MEMRISE_BASE_URL } from './browserHeaders.js';
import { MAX_RETRY_AFTER_WAIT_MS, withRateLimitBackoff } from './rateLimit.js';
import type { RateLimitStore } from './rateLimitStore.js';
import type { RequestPacer } from './requestPacer.js';
import { isTransientFailure, withRetry } from './retry.js';
import { REQUEST_TIMEOUT_MS, type HttpResponse, type HttpTransport, type NewId, type Now, type Sleep } from './transport.js';

export interface ApiRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  headers?: Record<string, string>;
  /** Step name used in errors and debug lines; never contains values. */
  label: string;
  /** `'none'` skips body parsing (e.g. the CSRF bootstrap, whose body is not JSON). */
  expect?: 'json' | 'none';
  /** Re-checked once the pacer turn is held; `false` drops the request unsent (see `PacedRunOptions`). */
  stillNeeded?: () => Promise<boolean>;
}

export interface ApiResponse {
  status: number;
  setCookies: string[];
  /** `null` when the request was sent with `expect: 'none'`. */
  body: unknown;
}

export interface HttpClientDeps {
  transport: HttpTransport;
  pacer: RequestPacer;
  sleep: Sleep;
  now: Now;
  newId: NewId;
  logger: Logger;
  /** Where a 429 cooldown is recorded, so other requests and processes stay away until it ends. */
  rateLimit: RateLimitStore;
}

/** Three tries in total, pausing 500 ms and then 1500 ms before the retries. */
const RETRY_DELAYS_MS = [500, 1500];
const ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const MAX_RETRY_ROUND_MS = ATTEMPTS * REQUEST_TIMEOUT_MS + RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);

/** The longest one request can hold its pacer turn: a round of timed-out retries, the longest 429 wait, another round. */
export const MAX_PACED_REQUEST_MS = 2 * MAX_RETRY_ROUND_MS + MAX_RETRY_AFTER_WAIT_MS;

export class HttpClient {
  readonly #transport: HttpTransport;
  readonly #pacer: RequestPacer;
  readonly #sleep: Sleep;
  readonly #now: Now;
  readonly #newId: NewId;
  readonly #logger: Logger;
  readonly #rateLimit: RateLimitStore;

  constructor(deps: HttpClientDeps) {
    this.#transport = deps.transport;
    this.#pacer = deps.pacer;
    this.#sleep = deps.sleep;
    this.#now = deps.now;
    this.#newId = deps.newId;
    this.#logger = deps.logger;
    this.#rateLimit = deps.rateLimit;
  }

  /** The 429 wait runs inside the pacer turn, so no other request of this process goes out meanwhile. */
  request(req: ApiRequest): Promise<ApiResponse> {
    return this.#pacer.run(
      () =>
        withRateLimitBackoff(() => this.#sendWithRetry(req), {
          now: this.#now,
          sleep: this.#sleep,
          store: this.#rateLimit,
        }),
      { stillNeeded: req.stillNeeded },
    );
  }

  #sendWithRetry(req: ApiRequest): Promise<ApiResponse> {
    return withRetry(() => this.#sendOnce(req), {
      attempts: ATTEMPTS,
      delaysMs: RETRY_DELAYS_MS,
      sleep: this.#sleep,
      isTransient: isTransientFailure,
    });
  }

  async #sendOnce(req: ApiRequest): Promise<ApiResponse> {
    await this.#assertNoCooldown(req);
    this.#logger.debug(`http: start ${req.label}`);
    const res = await this.#send(req);
    this.#logger.debug(`http: ${req.label} ${res.status}`);
    this.#assertOk(res, req);
    const body = req.expect === 'none' ? null : parseJson(res.bodyText, req);
    return { status: res.status, setCookies: res.setCookies, body };
  }

  /** Checked before every attempt, so a cooldown recorded by any process stops this one before the wire. */
  async #assertNoCooldown(req: ApiRequest): Promise<void> {
    const until = await this.#rateLimit.read();
    if (until === undefined || until <= this.#now()) return;
    this.#logger.debug(`http: ${req.label} skipped, rate-limit cooldown until ${new Date(until).toISOString()}`);
    throw new RateLimitedError(until);
  }

  /** The raw transport error is not attached: it can echo the URL, and the URL carries query values. */
  async #send(req: ApiRequest): Promise<HttpResponse> {
    const httpRequest = {
      method: req.method,
      url: this.#buildUrl(req),
      headers: this.#buildHeaders(req),
      body: req.json === undefined ? undefined : JSON.stringify(req.json),
    };
    try {
      return await this.#transport.send(httpRequest);
    } catch {
      throw new NetworkError(req.label, 1);
    }
  }

  #buildUrl(req: ApiRequest): string {
    const url = new URL(req.path, MEMRISE_BASE_URL);
    for (const [name, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url.toString();
  }

  #assertOk(res: HttpResponse, req: ApiRequest): void {
    if (res.status < 200 || res.status >= 300) throw new HttpStatusError(res.status, req.label, undefined, res.retryAfter);
  }

  #buildHeaders(req: ApiRequest): Record<string, string> {
    const jsonHeader: Record<string, string> = req.json === undefined ? {} : { 'content-type': 'application/json' };
    return { ...buildBrowserHeaders({ newId: this.#newId }), ...jsonHeader, ...req.headers };
  }
}

/** Parses a JSON body; the text itself is never put into the error. */
function parseJson(bodyText: string, req: ApiRequest): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new MalformedResponseError(req.label);
  }
}
