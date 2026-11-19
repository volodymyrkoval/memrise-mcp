import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseScenarioDetails } from '../../../src/api/schemas.js';
import type { ScenarioDetailsStore } from '../../../src/cache/diskScenarioDetailsStore.js';
import { DiskScenarioDetailsStore } from '../../../src/cache/diskScenarioDetailsStore.js';
import { ScenarioDetailsRepository } from '../../../src/cache/scenarioDetailsRepository.js';
import { HttpStatusError, NotFoundError } from '../../../src/errors.js';
import type { Logger } from '../../../src/log/logger.js';
import { createTestApi } from '../../helpers/createTestApi.js';
import { type FixtureApiOptions, routeFixtureApi } from '../../helpers/fixtureApi.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { InMemoryDetailsStore } from '../../helpers/inMemoryDetailsStore.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';

const NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');
/** The completed lesson in `scenario-details-1001.json`; the routed API serves it for this id. */
const DETAILS_ID = 1001;
const SCENARIO_DETAILS_PATH = '/v1.25/me/scenarios/';
const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-repo-test-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function fixtureTransport(options: FixtureApiOptions = {}): RoutedTransport {
  const transport = new RoutedTransport();
  routeFixtureApi(transport, options);
  return transport;
}

function diskStore(): DiskScenarioDetailsStore {
  return new DiskScenarioDetailsStore({ cacheDir, now: () => NOW_MS, logger: silentLogger });
}

/** A repository whose network is `transport` and whose cache is `store` (the cache dir by default). */
function repositoryOver(transport: RoutedTransport, store: ScenarioDetailsStore = diskStore()) {
  const { api } = createTestApi(transport);
  return new ScenarioDetailsRepository({ store, api, logger: silentLogger });
}

function fixtureDetails() {
  return parseScenarioDetails(DETAILS_ID, loadFixture('scenario-details-1001.json'));
}

describe('ScenarioDetailsRepository', () => {
  it('fetches a lesson it has not cached and keeps a copy on disk', async () => {
    const details = await repositoryOver(fixtureTransport()).get(DETAILS_ID);

    expect(details).toEqual(fixtureDetails());
    expect(await diskStore().read(DETAILS_ID)).toEqual(fixtureDetails());
  });

  it('serves a completed lesson cached by an earlier repository with zero transport requests', async () => {
    await repositoryOver(fixtureTransport()).get(DETAILS_ID);
    const transport = fixtureTransport();

    const details = await repositoryOver(transport).get(DETAILS_ID);

    expect(details).toEqual(fixtureDetails());
    expect(transport.countFor(SCENARIO_DETAILS_PATH)).toBe(0);
  });

  it('fetches an incomplete cached lesson again and overwrites the cached copy', async () => {
    const store = new InMemoryDetailsStore();
    await store.write(DETAILS_ID, { ...fixtureDetails(), completed: false, learnables: [] });
    const transport = fixtureTransport();

    const details = await repositoryOver(transport, store).get(DETAILS_ID);

    expect(details).toEqual(fixtureDetails());
    expect(transport.countFor(SCENARIO_DETAILS_PATH)).toBe(1);
    expect(await store.read(DETAILS_ID)).toEqual(fixtureDetails());
  });

  it('serves a completed lesson another process stored while this one waited for its turn, sending nothing', async () => {
    const store = new InMemoryDetailsStore();
    const storedMeanwhile: ScenarioDetailsStore = {
      read: async (id) => {
        const current = await store.read(id);
        await store.write(DETAILS_ID, fixtureDetails());
        return current;
      },
      write: (id, details) => store.write(id, details),
    };
    const debugLines: string[] = [];
    const logger: Logger = { ...silentLogger, debug: (msg) => void debugLines.push(msg) };
    const transport = fixtureTransport();
    const repository = new ScenarioDetailsRepository({ store: storedMeanwhile, api: createTestApi(transport).api, logger });

    const details = await repository.get(DETAILS_ID);

    expect(details).toEqual(fixtureDetails());
    expect(transport.countFor(SCENARIO_DETAILS_PATH)).toBe(0);
    expect(debugLines).toEqual(['details: cache hit (completed)']);
  });

  it('still fetches a lesson when what was stored meanwhile is incomplete', async () => {
    const store = new InMemoryDetailsStore();
    const storedMeanwhile: ScenarioDetailsStore = {
      read: async (id) => {
        const current = await store.read(id);
        await store.write(DETAILS_ID, { ...fixtureDetails(), completed: false, learnables: [] });
        return current;
      },
      write: (id, details) => store.write(id, details),
    };
    const transport = fixtureTransport();

    const details = await repositoryOver(transport, storedMeanwhile).get(DETAILS_ID);

    expect(details).toEqual(fixtureDetails());
    expect(transport.countFor(SCENARIO_DETAILS_PATH)).toBe(1);
  });

  it('returns the freshly fetched details and logs a warning when the cache write fails', async () => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (msg) => void warnings.push(msg) };
    const failingStore: ScenarioDetailsStore = {
      read: async () => null,
      write: async () => {
        throw new Error('EACCES: permission denied, open "/private/cache/scenario-details/1001.json"');
      },
    };
    const { api } = createTestApi(fixtureTransport());
    const repository = new ScenarioDetailsRepository({ store: failingStore, api, logger });

    const details = await repository.get(DETAILS_ID);

    expect(details).toEqual(fixtureDetails());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('/private/cache');
    expect(warnings[0]).not.toContain('EACCES');
  });

  it.each([
    ['a 503 after retries', { status: 503 }, HttpStatusError],
    ['a 404', { status: 404 }, NotFoundError],
  ])('propagates %s unchanged and caches nothing', async (_name, override, errorClass) => {
    const store = new InMemoryDetailsStore();
    const transport = fixtureTransport({ details: { [DETAILS_ID]: override } });

    await expect(repositoryOver(transport, store).get(DETAILS_ID)).rejects.toBeInstanceOf(errorClass);
    expect(await store.read(DETAILS_ID)).toBeNull();
  });
});
