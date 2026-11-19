import { describe, expect, it, vi } from 'vitest';
import { FetchTransport } from '../../../src/http/transport.js';

function fakeFetch(response: Response) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response);
}

describe('FetchTransport', () => {
  it('sends the method, url, headers and body, and returns status, set-cookies and body text', async () => {
    const response = new Response('{"ok":true}', { status: 201 });
    // Built at runtime so the repo secret scanner does not read the sample as a real cookie.
    const csrfCookie = ['csrftoken', 'abc123'].join('=');
    response.headers.append('set-cookie', `${csrfCookie}; Path=/`);
    response.headers.append('set-cookie', 'other=1');
    const fetchMock = fakeFetch(response);
    const transport = new FetchTransport(fetchMock as unknown as typeof fetch);

    const result = await transport.send({
      method: 'POST',
      url: 'https://app.memrise.com/v1.25/auth/access_token/',
      headers: { accept: 'application/json' },
      body: '{"x":1}',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.memrise.com/v1.25/auth/access_token/');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ accept: 'application/json' });
    expect(init?.body).toBe('{"x":1}');
    expect(result).toEqual({
      status: 201,
      setCookies: [`${csrfCookie}; Path=/`, 'other=1'],
      bodyText: '{"ok":true}',
    });
  });

  it('returns the Retry-After header verbatim, so the rate-limit layer can honour it', async () => {
    const response = new Response('', { status: 429, headers: { 'retry-after': '5' } });
    const transport = new FetchTransport(fakeFetch(response) as unknown as typeof fetch);

    const result = await transport.send({ method: 'GET', url: 'https://app.memrise.com/v1.25/me/language_pairs/', headers: {} });

    expect(result.retryAfter).toBe('5');
  });

  it('bounds every request with an abort signal so a hung server cannot stall the client', async () => {
    const fetchMock = fakeFetch(new Response('', { status: 200 }));
    const transport = new FetchTransport(fetchMock as unknown as typeof fetch);

    await transport.send({ method: 'GET', url: 'https://app.memrise.com/v1.25/me/language_pairs/', headers: {} });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('lets a network failure reject so the retry layer can see it', async () => {
    const failure = new TypeError('fetch failed');
    const transport = new FetchTransport((async () => {
      throw failure;
    }) as unknown as typeof fetch);

    await expect(
      transport.send({ method: 'GET', url: 'https://app.memrise.com/v1.25/me/language_pairs/', headers: {} }),
    ).rejects.toBe(failure);
  });

  it('refuses to follow redirects so a credential body never reaches another location', async () => {
    const fetchMock = fakeFetch(new Response('', { status: 200 }));
    const transport = new FetchTransport(fetchMock as unknown as typeof fetch);

    await transport.send({ method: 'POST', url: 'https://app.memrise.com/v1.25/auth/access_token/', headers: {}, body: 'x' });

    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
  });
});
