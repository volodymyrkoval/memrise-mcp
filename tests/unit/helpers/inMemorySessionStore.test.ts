import { describe, expect, it } from 'vitest';
import { InMemorySessionStore } from '../../helpers/inMemorySessionStore.js';

const SESSION = { accessToken: ['tok', 'alpha', 'beta', 'gamma'].join('-') };

describe('InMemorySessionStore', () => {
  it('loads back the session it saved, and nothing after it is cleared', async () => {
    const store = new InMemorySessionStore();

    expect(await store.load()).toBeNull();
    await store.save(SESSION);
    expect(await store.load()).toEqual(SESSION);
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
