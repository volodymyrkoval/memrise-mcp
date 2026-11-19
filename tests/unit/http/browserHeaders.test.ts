import { describe, expect, it } from 'vitest';
import { buildBrowserHeaders } from '../../../src/http/browserHeaders.js';

describe('buildBrowserHeaders', () => {
  it('returns the desktop-Firefox header set the web app sends, with a fresh correlation id and no user-agent', () => {
    const headers = buildBrowserHeaders({ newId: () => 'corr-1' });

    expect(headers).toEqual({
      accept: 'application/json, text/plain, */*',
      origin: 'https://app.memrise.com',
      referer: 'https://app.memrise.com/signin',
      'x-client-type': 'web',
      'x-timezone': 'UTC',
      'x-device-type': 'desktop',
      'x-os': 'macOS',
      'x-os-version': '10.15',
      'x-browser': 'Firefox',
      'x-browser-version': '130.0',
      'x-correlation-id': 'corr-1',
    });
  });

  it('gives every request its own correlation id', () => {
    let next = 0;
    const newId = () => `corr-${++next}`;

    const first = buildBrowserHeaders({ newId });
    const second = buildBrowserHeaders({ newId });

    expect(first['x-correlation-id']).toBe('corr-1');
    expect(second['x-correlation-id']).toBe('corr-2');
  });
});
