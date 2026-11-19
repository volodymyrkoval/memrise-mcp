import { describe, expect, it } from 'vitest';

describe('unit-test network guard', () => {
  it('refuses fetch calls so unit tests cannot reach the network', async () => {
    // Port 9 on loopback is closed; the red run must not touch a real host.
    await expect(fetch('http://127.0.0.1:9/')).rejects.toThrow('network disabled in unit tests');
  });
});
