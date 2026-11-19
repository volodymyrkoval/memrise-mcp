import { randomUUID } from 'node:crypto';

const BASE_URL = 'https://app.memrise.com';
const PAUSE_MS = 1000;

export type Query = Record<string, string>;

export interface SetCookieInfo {
  name: string;
  maxAge?: number;
}

export interface ProbeResponse {
  status: number;
  body: unknown;
  setCookies: SetCookieInfo[];
}

/** One recorded request. Holds cookie names and the response body only; never header or cookie values. */
export interface TranscriptEntry {
  label: string;
  method: 'GET' | 'POST';
  path: string;
  query: Query | undefined;
  status: number;
  setCookieNames: string[];
  body: unknown;
}

/** Which jar cookies a request carries: all (default), only `csrftoken`, or none (also drops `x-csrftoken`). */
export type CookieMode = 'all' | 'csrf-only' | 'none';

export interface RequestOptions {
  cookies?: CookieMode;
}

export interface ProbeHttpOptions {
  fetch?: typeof fetch;
  pause?: () => Promise<void>;
  log?: (line: string) => void;
}

const BROWSER_HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  origin: BASE_URL,
  referer: `${BASE_URL}/signin`,
  'x-client-type': 'web',
  'x-timezone': 'UTC',
  'x-device-type': 'desktop',
  'x-os': 'macOS',
  'x-os-version': '10.15',
  'x-browser': 'Firefox',
  'x-browser-version': '130.0',
};

/** Names of every request header the probe sends besides cookies, for the report. */
export const MIMICKED_HEADER_NAMES: readonly string[] = [
  ...Object.keys(BROWSER_HEADERS),
  'x-correlation-id',
  'content-type',
  'x-csrftoken',
];

/** Sequential, throttled HTTP client for the discovery probe; console output is label + status only. */
export class ProbeHttp {
  readonly transcript: TranscriptEntry[] = [];
  readonly #fetch: typeof fetch;
  readonly #pause: () => Promise<void>;
  readonly #log: (line: string) => void;
  readonly #cookies = new Map<string, string>();
  #requestCount = 0;

  constructor(options: ProbeHttpOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#pause = options.pause ?? (() => new Promise((resolve) => setTimeout(resolve, PAUSE_MS)));
    this.#log = options.log ?? ((line) => console.log(line));
  }

  get(
    label: string,
    path: string,
    query?: Query,
    extraHeaders?: Record<string, string>,
    options?: RequestOptions,
  ): Promise<ProbeResponse> {
    return this.#request(label, 'GET', path, query, undefined, extraHeaders, options?.cookies);
  }

  post(label: string, path: string, json: unknown, extraHeaders?: Record<string, string>): Promise<ProbeResponse> {
    return this.#request(label, 'POST', path, undefined, json, extraHeaders, undefined);
  }

  hasCookie(name: string): boolean {
    return this.#cookies.has(name);
  }

  /** Cookie values, for the caller's post-write secret self-check only. */
  cookieValues(): string[] {
    return [...this.#cookies.values()];
  }

  async #request(
    label: string,
    method: 'GET' | 'POST',
    path: string,
    query: Query | undefined,
    json: unknown,
    extraHeaders: Record<string, string> | undefined,
    cookies: CookieMode | undefined,
  ): Promise<ProbeResponse> {
    await this.#awaitPause();
    const response = await this.#send(method, path, query, json, extraHeaders, cookies);
    this.#record({
      label,
      method,
      path,
      query,
      status: response.status,
      setCookieNames: response.setCookies.map((cookie) => cookie.name),
      body: response.body,
    });
    return response;
  }

  async #awaitPause(): Promise<void> {
    if (this.#requestCount++ > 0) await this.#pause();
  }

  #buildHeaders(
    hasBody: boolean,
    extraHeaders: Record<string, string> | undefined,
    mode: CookieMode = 'all',
  ): Record<string, string> {
    const headers: Record<string, string> = { ...BROWSER_HEADERS, 'x-correlation-id': randomUUID() };
    if (hasBody) headers['content-type'] = 'application/json';
    const csrf = this.#cookies.get('csrftoken');
    if (csrf !== undefined && mode !== 'none') headers['x-csrftoken'] = csrf;
    const sent = [...this.#cookies].filter(([name]) => mode === 'all' || (mode === 'csrf-only' && name === 'csrftoken'));
    if (sent.length > 0) headers.cookie = sent.map(([name, value]) => `${name}=${value}`).join('; ');
    return { ...headers, ...extraHeaders };
  }

  async #send(
    method: 'GET' | 'POST',
    path: string,
    query: Query | undefined,
    json: unknown,
    extraHeaders: Record<string, string> | undefined,
    cookies: CookieMode | undefined,
  ): Promise<ProbeResponse> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    try {
      const response = await this.#fetch(url, {
        method,
        headers: this.#buildHeaders(json !== undefined, extraHeaders, cookies),
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      const received = response.headers.getSetCookie().map(parseSetCookie);
      this.#storeCookies(received);
      return {
        status: response.status,
        body: parseBody(await response.text()),
        setCookies: received.map(({ name, maxAge }) => (maxAge === undefined ? { name } : { name, maxAge })),
      };
    } catch {
      return { status: 0, body: { error: 'network error' }, setCookies: [] };
    }
  }

  #storeCookies(received: ReceivedCookie[]): void {
    for (const { name, value } of received) this.#cookies.set(name, value);
  }

  #record(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    this.#log(`${entry.label} ${entry.status}`);
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface ReceivedCookie extends SetCookieInfo {
  value: string;
}

function parseSetCookie(raw: string): ReceivedCookie {
  const [pair, ...attributes] = raw.split(';').map((part) => part.trim());
  const separator = pair.indexOf('=');
  const maxAge = attributes.find((attribute) => attribute.toLowerCase().startsWith('max-age='));
  const cookie = { name: pair.slice(0, separator), value: pair.slice(separator + 1) };
  return maxAge === undefined ? cookie : { ...cookie, maxAge: Number(maxAge.slice('max-age='.length)) };
}
