/**
 * Test double for `ScenarioDetailsStore`: keeps entries in a Map, so repository tests run without the
 * filesystem. Reads and writes copy, so a caller cannot mutate what the store holds.
 */
import type { ScenarioDetailsStore } from '../../src/cache/diskScenarioDetailsStore.js';
import type { ScenarioDetails } from '../../src/domain/types.js';

export class InMemoryDetailsStore implements ScenarioDetailsStore {
  readonly #entries = new Map<number, ScenarioDetails>();

  async read(id: number): Promise<ScenarioDetails | null> {
    const entry = this.#entries.get(id);
    return entry === undefined ? null : structuredClone(entry);
  }

  async write(id: number, details: ScenarioDetails): Promise<void> {
    this.#entries.set(id, structuredClone(details));
  }
}
