/** HTTP port and its fetch adapter. Everything above this file talks to `HttpTransport`, never to `fetch`. */

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  setCookies: string[];
  bodyText: string;
  /** Raw `Retry-After` header, when the server sent one (seconds or an HTTP-date). */
  retryAfter?: string;
}

/** Throws (rejects) on network failure or timeout; HTTP error statuses are returned, not thrown. */
export interface HttpTransport {
  send(req: HttpRequest): Promise<HttpResponse>;
}

export type Sleep = (ms: number) => Promise<void>;
export type Now = () => number;
export type NewId = () => string;

export const REQUEST_TIMEOUT_MS = 30_000;

/** Production transport: one `fetch` call per request, bounded by `REQUEST_TIMEOUT_MS`. */
export class FetchTransport implements HttpTransport {
  readonly #fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    const res = await this.#fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return {
      status: res.status,
      setCookies: res.headers.getSetCookie(),
      bodyText: await res.text(),
      retryAfter: res.headers.get('retry-after') ?? undefined,
    };
  }
}
