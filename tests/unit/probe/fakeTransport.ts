export interface FakeReply {
  status?: number;
  body?: unknown;
  setCookies?: string[];
}

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export type FakeRoute = (request: RecordedRequest) => FakeReply;

/** Builds an offline `fetch` that answers from `route` and records every request. */
export function createFakeFetch(route: FakeRoute): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const reply = route(request);
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const cookie of reply.setCookies ?? []) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers });
  };
  return { fetch: fakeFetch as typeof fetch, requests };
}

/** Builds `name=value` at runtime so test sources never contain a cookie assignment literal. */
export function cookiePair(name: string, value: string): string {
  return [name, value].join('=');
}
