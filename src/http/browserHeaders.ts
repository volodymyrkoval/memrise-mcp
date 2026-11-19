/**
 * Headers the Memrise web app sends with every API call, copied from the discovery probe (G-10).
 * No user-agent override, cookie or CSRF header here: those belong to the auth layer.
 */

/** Origin of the web app; also the base for every request URL. */
export const MEMRISE_BASE_URL = 'https://app.memrise.com';

export interface BrowserHeaderOptions {
  newId: () => string;
}

/** Fresh headers for one request: the constant web-app set plus a new correlation id. */
export function buildBrowserHeaders({ newId }: BrowserHeaderOptions): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    origin: MEMRISE_BASE_URL,
    referer: `${MEMRISE_BASE_URL}/signin`,
    'x-client-type': 'web',
    'x-timezone': 'UTC',
    'x-device-type': 'desktop',
    'x-os': 'macOS',
    'x-os-version': '10.15',
    'x-browser': 'Firefox',
    'x-browser-version': '130.0',
    'x-correlation-id': newId(),
  };
}
