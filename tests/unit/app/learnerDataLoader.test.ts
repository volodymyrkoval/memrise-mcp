import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemriseApi } from '../../../src/api/memriseApi.js';
import { LearnerDataLoader } from '../../../src/app/learnerDataLoader.js';
import { DiskWordListCache, type WordListCache } from '../../../src/cache/diskWordListCache.js';
import type { ScenarioDetailsRepository } from '../../../src/cache/scenarioDetailsRepository.js';
import type { LanguagePair } from '../../../src/domain/types.js';
import { AuthError, ConfigError, HttpStatusError } from '../../../src/errors.js';
import type { Logger } from '../../../src/log/logger.js';
import { makeDetailLearnable, makeDetails, makeLearnable, makeScenario } from '../../helpers/domainBuilders.js';

const PAIR_ID = 7;
const PAIR: LanguagePair = {
  id: PAIR_ID,
  sourceName: 'Alpha',
  targetName: 'Beta',
  sourceLocale: 'aa-aa',
  targetLocale: 'bb',
};

function silentLogger(warnings: string[] = []): Logger {
  return { debug() {}, info() {}, error() {}, warn: (msg) => warnings.push(msg) };
}

function fakeApi() {
  return {
    listLanguagePairs: vi.fn<MemriseApi['listLanguagePairs']>(async () => [PAIR]),
    listLearnables: vi.fn<MemriseApi['listLearnables']>(async () => [makeLearnable(1)]),
    listScenarios: vi.fn<MemriseApi['listScenarios']>(async () => [makeScenario(2003)]),
  };
}

function fakeRepository() {
  return { get: vi.fn<ScenarioDetailsRepository['get']>(async (id) => makeDetails(id)) };
}

/** A word-list cache that never hits and never stores: the loader behaves as if there were no disk cache. */
const noWordCache: WordListCache = { read: async () => null, write: async () => {} };

function loaderWith({
  languagePairId = PAIR_ID as number | null,
  api = fakeApi(),
  repository = fakeRepository(),
  warnings = [] as string[],
  wordCache = noWordCache,
  wordCacheMode = 'read-write' as 'read-write' | 'write-only',
} = {}) {
  const loader = new LearnerDataLoader({
    api,
    repository,
    languagePairId,
    wordCache,
    wordCacheMode,
    logger: silentLogger(warnings),
  });
  return { loader, api, repository, warnings };
}

describe('LearnerDataLoader pair resolution', () => {
  it('uses the configured pair id without listing the account pairs', async () => {
    const { loader, api } = loaderWith({ languagePairId: PAIR_ID });

    expect(await loader.pairId()).toBe(PAIR_ID);
    expect(api.listLanguagePairs).not.toHaveBeenCalled();
  });

  it('resolves the only pair of the account once and reuses it', async () => {
    const { loader, api } = loaderWith({ languagePairId: null });

    expect(await loader.pairId()).toBe(PAIR_ID);
    expect(await loader.pairId()).toBe(PAIR_ID);
    expect(api.listLanguagePairs).toHaveBeenCalledTimes(1);
  });

  it('rejects with a ConfigError naming the variable when the account has several pairs', async () => {
    const api = fakeApi();
    api.listLanguagePairs.mockResolvedValue([PAIR, { ...PAIR, id: 61 }]);
    const { loader } = loaderWith({ languagePairId: null, api });

    await expect(loader.pairId()).rejects.toThrow(ConfigError);
    await expect(loader.pairId()).rejects.toThrow('MEMRISE_LANGUAGE_PAIR_ID');
  });
});

describe('LearnerDataLoader memoized loading', () => {
  it('loads the learnables once per state for the pair', async () => {
    const { loader, api } = loaderWith();

    await loader.learnables('any');
    await loader.learnables('any');
    await loader.learnables('fully_learned_or_known');

    expect(api.listLearnables).toHaveBeenCalledTimes(2);
    expect(api.listLearnables).toHaveBeenNthCalledWith(1, PAIR_ID, 'any');
    expect(api.listLearnables).toHaveBeenNthCalledWith(2, PAIR_ID, 'fully_learned_or_known');
  });

  it('loads each scenario type once', async () => {
    const { loader, api } = loaderWith();

    await loader.scenarios('completed');
    await loader.scenarios('completed');

    expect(api.listScenarios).toHaveBeenCalledTimes(1);
    expect(api.listScenarios).toHaveBeenCalledWith(PAIR_ID, 'completed');
  });

  it('fetches a lesson’s details once and serves repeats from memory', async () => {
    const { loader, repository } = loaderWith();

    await loader.detail(2003);
    await loader.detail(2003);

    expect(repository.get).toHaveBeenCalledTimes(1);
    expect(repository.get).toHaveBeenCalledWith(2003);
  });
});

describe('LearnerDataLoader partial failures', () => {
  const LESSON_GAMMA = makeScenario(2003, { title: 'Lesson Gamma' });
  const LESSON_DELTA = makeScenario(2002, { title: 'Lesson Delta', topic: { id: 7, name: 'Topic Four' } });

  it('keeps the lessons that load and reports a lesson-fetch failure with its reason', async () => {
    const warnings: string[] = [];
    const repository = fakeRepository();
    repository.get.mockImplementation(async (id) => {
      if (id === 2003) throw new HttpStatusError(503, 'scenario_details', 3);
      return makeDetails(id);
    });
    const { loader } = loaderWith({ repository, warnings });

    const settled = await loader.detailsSettled([LESSON_DELTA, LESSON_GAMMA]);

    expect([...settled.details.keys()]).toEqual([2002]);
    expect(settled.failures).toEqual([{ scenarioId: 2003, title: 'Lesson Gamma', reason: 'HTTP 503' }]);
    expect(warnings).toEqual(['details: failed scenario=2003 (HTTP 503)']);
  });

  it('rethrows an auth error instead of tolerating it', async () => {
    const repository = fakeRepository();
    repository.get.mockRejectedValue(new AuthError('access_token', 'HTTP 401'));
    const { loader } = loaderWith({ repository });

    await expect(loader.detailsSettled([LESSON_GAMMA])).rejects.toThrow(AuthError);
  });

  it('retries a failed lesson on the next call instead of remembering the failure', async () => {
    const repository = fakeRepository();
    repository.get.mockRejectedValueOnce(new HttpStatusError(503, 'scenario_details', 3));
    const { loader } = loaderWith({ repository });

    expect((await loader.detailsSettled([LESSON_GAMMA])).failures).toHaveLength(1);
    const retried = await loader.detailsSettled([LESSON_GAMMA]);

    expect(retried.failures).toEqual([]);
    expect(retried.details.has(2003)).toBe(true);
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it('collects completed and in-progress lessons once each, without repeats', async () => {
    const api = fakeApi();
    api.listScenarios.mockImplementation(async (_pair, type) =>
      type === 'completed' ? [LESSON_DELTA, LESSON_GAMMA] : [LESSON_GAMMA, makeScenario(50001)],
    );
    const { loader } = loaderWith({ api });

    expect((await loader.lessonScenarios()).map((s) => s.id)).toEqual([2002, 2003, 50001]);
    expect(api.listScenarios).toHaveBeenCalledWith(PAIR_ID, 'completed');
    expect(api.listScenarios).toHaveBeenCalledWith(PAIR_ID, 'in_progress');
  });

  it('builds the word-to-lesson index per call, so a recovered lesson shows up on the next call', async () => {
    const repository = fakeRepository();
    let gammaAttempts = 0;
    repository.get.mockImplementation(async (id) => {
      if (id === 2002) return makeDetails(2002, { learnables: [makeDetailLearnable(1)] });
      gammaAttempts += 1;
      if (gammaAttempts === 1) throw new HttpStatusError(503, 'scenario_details', 3);
      return makeDetails(2003, { learnables: [makeDetailLearnable(2)] });
    });
    const api = fakeApi();
    api.listScenarios.mockImplementation(async (_pair, type) => (type === 'completed' ? [LESSON_DELTA, LESSON_GAMMA] : []));
    const { loader } = loaderWith({ api, repository });

    const first = await loader.lessonIndex();
    expect(first.index.has(2)).toBe(false);
    expect(first.failures.map((f) => f.scenarioId)).toEqual([2003]);

    const second = await loader.lessonIndex();
    expect(second.failures).toEqual([]);
    expect(second.index.get(2)).toEqual([{ scenarioId: 2003, title: 'Lesson Gamma', topic: null }]);
    expect(second.index.get(1)).toEqual([{ scenarioId: 2002, title: 'Lesson Delta', topic: 'Topic Four' }]);
  });
});

describe('LearnerDataLoader word-list disk cache', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'memrise-loader-words-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  function diskCache(): DiskWordListCache {
    return new DiskWordListCache({ cacheDir, ttlSeconds: 3600, now: () => Date.now(), logger: silentLogger() });
  }

  it('serves the word list from disk within the TTL, so a later process makes no learnables request', async () => {
    await loaderWith({ wordCache: diskCache() }).loader.learnables('any');
    const later = fakeApi();
    const { loader } = loaderWith({ api: later, wordCache: diskCache() });

    expect(await loader.learnables('any')).toEqual([makeLearnable(1)]);
    expect(later.listLearnables).not.toHaveBeenCalled();
  });

  it('in write-only mode skips a fresh cached list, walks the API and rewrites the file', async () => {
    await diskCache().write(PAIR_ID, 'any', [makeLearnable(99)]);
    const api = fakeApi();
    const { loader } = loaderWith({ api, wordCache: diskCache(), wordCacheMode: 'write-only' });

    expect(await loader.learnables('any')).toEqual([makeLearnable(1)]);
    expect(api.listLearnables).toHaveBeenCalledTimes(1);
    expect(await diskCache().read(PAIR_ID, 'any')).toEqual([makeLearnable(1)]);
  });

  it('a failed cache write does not fail the call; it is logged as a warning', async () => {
    const brokenCache: WordListCache = {
      read: async () => null,
      write: async () => {
        throw new Error('disk full');
      },
    };
    const warnings: string[] = [];
    const { loader } = loaderWith({ wordCache: brokenCache, warnings });

    expect(await loader.learnables('any')).toEqual([makeLearnable(1)]);
    expect(warnings).toEqual(['words: could not write the disk cache']);
  });
});
