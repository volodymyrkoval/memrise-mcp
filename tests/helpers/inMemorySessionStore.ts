/**
 * Test double for `SessionStore`: keeps the session in memory, so auth tests never touch the
 * filesystem. Loads return copies, so a caller cannot mutate what the store holds.
 */
import type { Session, SessionStore } from '../../src/auth/session.js';

export class InMemorySessionStore implements SessionStore {
  #session: Session | null = null;

  async load(): Promise<Session | null> {
    return this.#session === null ? null : { ...this.#session };
  }

  async save(session: Session): Promise<void> {
    this.#session = { ...session };
  }

  async clear(): Promise<void> {
    this.#session = null;
  }
}
