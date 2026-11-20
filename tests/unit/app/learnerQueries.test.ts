import { describe, expect, it, vi } from 'vitest';
import type { MemriseApi } from '../../../src/api/memriseApi.js';
import { LearnerDataLoader } from '../../../src/app/learnerDataLoader.js';
import { LearnerQueries } from '../../../src/app/learnerQueries.js';
import type { ScenarioDetailsRepository } from '../../../src/cache/scenarioDetailsRepository.js';
import type { LanguagePair, Learnable, Scenario, ScenarioDetails } from '../../../src/domain/types.js';
import { HttpStatusError } from '../../../src/errors.js';
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
const BOOK = makeLearnable(1, { target: 'the book', source: 'tr: the book', growthLevel: 2, learned: true });
const EAT = makeLearnable(2, { target: 'to eat', source: 'tr: to eat' });
const DRINK = makeLearnable(3, { target: 'to drink', source: 'tr: to drink', audios: ['https://audio.example/drink.mp3'] });
const LESSON_ALPHA = makeScenario(2005, { title: 'Lesson Alpha', topic: { id: 1, name: 'Topic One' } });
const LESSON_GAMMA = makeScenario(2003, { title: 'Lesson Gamma', topic: { id: 2, name: 'Topic Three' } });
const LESSON_DELTA = makeScenario(2002, { title: 'Lesson Delta', topic: { id: 3, name: 'Topic Four' } });
const ITEM_BY_ID = {
  1: makeDetailLearnable(1, { target: 'the book', source: 'tr: the book', growthLevel: 2 }),
  2: makeDetailLearnable(2, { target: 'to eat', source: 'tr: to eat' }),
  3: makeDetailLearnable(3, { target: 'to drink', source: 'tr: to drink' }),
};
const LESSON_ALPHA_STARTED = '2030-01-01T09:00:00.000Z';
const LESSON_ALPHA_COMPLETED = '2030-01-02T10:00:00.000Z';
const LESSON_GAMMA_COMPLETED = '2030-01-05T10:00:00.000Z';

/** A lesson whose details list the given learnable ids (from ITEM_BY_ID) and dates. */
function lesson(scenarioId: number, ids: Array<1 | 2 | 3>, dateCompleted: string | null): ScenarioDetails {
  return makeDetails(scenarioId, {
    learnables: ids.map((id) => ITEM_BY_ID[id]),
    dateStarted: dateCompleted === null ? null : LESSON_ALPHA_STARTED,
    dateCompleted,
  });
}

interface SetupOptions {
  learnables?: Learnable[];
  completed?: Scenario[];
  inProgress?: Scenario[];
  details?: Record<number, ScenarioDetails | Error>;
  timeZone?: string;
}

function setup({
  learnables = [BOOK, EAT, DRINK],
  completed = [LESSON_ALPHA, LESSON_GAMMA],
  inProgress = [],
  details = {},
  timeZone = 'UTC',
}: SetupOptions = {}) {
  const api = {
    listLanguagePairs: vi.fn<MemriseApi['listLanguagePairs']>(async () => [PAIR]),
    listLearnables: vi.fn<MemriseApi['listLearnables']>(async () => learnables),
    listScenarios: vi.fn<MemriseApi['listScenarios']>(async (_pair, type) =>
      type === 'completed' ? completed : inProgress,
    ),
  };
  const repository = {
    get: vi.fn<ScenarioDetailsRepository['get']>(async (id) => {
      const outcome = details[id] ?? makeDetails(id);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  };
  const warnings: string[] = [];
  const logger: Logger = { debug() {}, info() {}, error() {}, warn: (msg) => warnings.push(msg) };
  const loader = new LearnerDataLoader({
    api,
    repository,
    wordCache: { read: async () => null, write: async () => {} },
    wordCacheMode: 'read-write',
    languagePairId: PAIR_ID,
    logger,
  });
  return { queries: new LearnerQueries({ loader, api, timeZone }), api, repository, warnings };
}

const LIMIT = 200;
const LINKS_INCOMPLETE_WARNING =
  'Lesson links are incomplete in this result, so words with no lesson link have origin "unknown" instead of "other".';
const LESSON_GAMMA_WARNING =
  'Could not read lesson 2003 "Lesson Gamma" (Memrise error HTTP 503), so its words show no lesson or topic in this result.';

describe('LearnerQueries account data', () => {
  it('answers the pair id and the account pairs', async () => {
    const { queries } = setup();

    expect(await queries.pairId()).toBe(PAIR_ID);
    expect(await queries.listPairs()).toEqual([PAIR]);
  });
});

describe('LearnerQueries listWords', () => {
  it('returns each word with the lessons and topics that teach it', async () => {
    const { queries } = setup({
      details: { 2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED), 2003: lesson(2003, [1, 2], LESSON_GAMMA_COMPLETED) },
    });

    const result = await queries.listWords({ limit: LIMIT, includeAudio: false });

    expect(result).toMatchObject({ total: 3, returned: 3, truncated: false });
    expect(result.words[0]).toEqual({
      id: 1,
      word: 'the book',
      translation: 'tr: the book',
      growth_level: 2,
      learned: true,
      known: false,
      difficult: false,
      heard: false,
      next_review: null,
      origin: 'lesson',
      lessons: ['Lesson Alpha', 'Lesson Gamma'],
      topics: ['Topic One', 'Topic Three'],
    });
    expect(result.words[2]).toMatchObject({ lessons: [], origin: 'other' });
    expect(result).not.toHaveProperty('warnings');
  });

  it('slices to the limit and reports truncation with the full total', async () => {
    const { queries } = setup();

    const result = await queries.listWords({ limit: 2, includeAudio: false });

    expect(result).toMatchObject({ total: 3, returned: 2, truncated: true });
    expect(result.words).toHaveLength(2);
  });

  it('gives next_after_id on a truncated first page, and none when everything fits', async () => {
    const { queries } = setup();

    const first = await queries.listWords({ limit: 2, includeAudio: false });
    const all = await queries.listWords({ limit: LIMIT, includeAudio: false });

    expect(first.next_after_id).toBe('2');
    expect(all).not.toHaveProperty('next_after_id');
  });

  it('continues after after_id with no overlap or gap, and the last page is not truncated', async () => {
    const { queries } = setup();

    const first = await queries.listWords({ limit: 2, includeAudio: false });
    const second = await queries.listWords({ limit: 2, includeAudio: false, afterId: first.next_after_id });

    expect(first.words.map((w) => w.word)).toEqual(['the book', 'to eat']);
    expect(second.words.map((w) => w.word)).toEqual(['to drink']);
    expect(second).toMatchObject({ total: 3, returned: 1, truncated: false });
    expect(second).not.toHaveProperty('next_after_id');
  });

  it('rejects an after_id that is not in the list', async () => {
    const { queries } = setup();

    await expect(queries.listWords({ limit: 2, includeAudio: false, afterId: '999' })).rejects.toThrow(/after_id/);
  });

  it('includes audio URLs only when asked', async () => {
    const { queries } = setup();

    const without = await queries.listWords({ limit: LIMIT, includeAudio: false });
    const withAudio = await queries.listWords({ limit: LIMIT, includeAudio: true });

    expect(without.words[2]).not.toHaveProperty('audios');
    expect(withAudio.words[2].audios).toEqual(['https://audio.example/drink.mp3']);
  });

  it('asks the API for the requested learning state, defaulting to any', async () => {
    const { queries, api } = setup();

    await queries.listWords({ limit: LIMIT, includeAudio: false });
    await queries.listWords({ state: 'fully_learned_or_known', limit: LIMIT, includeAudio: false });

    expect(api.listLearnables).toHaveBeenNthCalledWith(1, PAIR_ID, 'any');
    expect(api.listLearnables).toHaveBeenNthCalledWith(2, PAIR_ID, 'fully_learned_or_known');
  });

  it('keeps the words and warns about a failed lesson, which gives no links', async () => {
    const { queries } = setup({
      details: {
        2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED),
        2003: new HttpStatusError(503, 'scenario_details', 3),
      },
    });

    const result = await queries.listWords({ limit: LIMIT, includeAudio: false });

    expect(result.words.map((w) => w.lessons)).toEqual([['Lesson Alpha'], [], []]);
    expect(result.warnings).toEqual([LESSON_GAMMA_WARNING, LINKS_INCOMPLETE_WARNING]);
  });

  it('marks unlinked words unknown, not other, while a lesson failed to load', async () => {
    const { queries } = setup({
      details: {
        2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED),
        2003: new HttpStatusError(503, 'scenario_details', 3),
      },
    });

    const result = await queries.listWords({ limit: LIMIT, includeAudio: false });

    expect(result.words.map((w) => w.origin)).toEqual(['lesson', 'unknown', 'unknown']);
  });

  it('marks unlinked words other once every lesson loaded', async () => {
    const { queries } = setup({ details: { 2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED) } });

    const result = await queries.listWords({ limit: LIMIT, includeAudio: false });

    expect(result.words.map((w) => w.origin)).toEqual(['lesson', 'other', 'other']);
  });
});

describe('LearnerQueries listWords filters', () => {
  const APPLE = makeLearnable(11, { target: 'apple', source: 'tr: apple', learned: true, growthLevel: 5, difficult: true, nextReview: '2030-03-10T08:00:00.000Z' });
  const BREAD = makeLearnable(12, { target: 'bread', source: 'tr: bread', learned: true, growthLevel: 2, nextReview: '2030-03-10T20:00:00.000Z' });
  const CHEESE = makeLearnable(13, { target: 'cheese', source: 'tr: cheese', learned: true, growthLevel: 7, difficult: true, nextReview: '2030-03-12T08:00:00.000Z' });
  const TRAIN = makeLearnable(14, { target: 'train', source: 'tr: train', learned: false, growthLevel: 0, nextReview: '2020-01-01T00:00:00.000Z' });
  const ALL = [APPLE, BREAD, CHEESE, TRAIN];
  const FOOD_LESSON = makeScenario(3001, { title: 'Placeholder Lesson A', topic: { id: 1, name: 'Food & Drink' } });
  const details = {
    3001: makeDetails(3001, {
      learnables: [11, 12, 13].map((id) => makeDetailLearnable(id)),
      dateCompleted: LESSON_ALPHA_COMPLETED,
    }),
  };
  const filtered = (extra: Partial<Parameters<LearnerQueries['listWords']>[0]>) => ({ limit: LIMIT, includeAudio: false, ...extra });
  const wordsOf = (result: { words: { word: string }[] }) => result.words.map((w) => w.word);

  it('counts only the matching words in total, and returns them', async () => {
    const { queries } = setup({ learnables: ALL, completed: [FOOD_LESSON], details });

    const result = await queries.listWords(filtered({ difficult: true }));

    expect(wordsOf(result)).toEqual(['apple', 'cheese']);
    expect(result).toMatchObject({ total: 2, returned: 2, truncated: false });
  });

  it('keeps only the words the learner has heard, or only those not heard', async () => {
    const heardWord = makeLearnable(15, { target: 'river', source: 'tr: river', heard: true });
    const { queries } = setup({ learnables: [...ALL, heardWord] });

    expect(wordsOf(await queries.listWords(filtered({ heard: true })))).toEqual(['river']);
    expect(wordsOf(await queries.listWords(filtered({ heard: false })))).toEqual(['apple', 'bread', 'cheese', 'train']);
  });

  it('filters by lesson topic and by growth range together', async () => {
    const { queries } = setup({ learnables: ALL, completed: [FOOD_LESSON], details });

    const result = await queries.listWords(filtered({ topic: 'food', minGrowthLevel: 3 }));

    expect(wordsOf(result)).toEqual(['apple', 'cheese']);
  });

  it('answers an empty result as total 0 and not truncated', async () => {
    const { queries } = setup({ learnables: ALL });

    const result = await queries.listWords(filtered({ known: true }));

    expect(result).toEqual({ total: 0, returned: 0, truncated: false, words: [] });
  });

  it('pages through the filtered set only, with total and next_after_id inside it', async () => {
    const { queries } = setup({ learnables: ALL });

    const first = await queries.listWords(filtered({ learned: true, limit: 2 }));
    const second = await queries.listWords(filtered({ learned: true, limit: 2, afterId: first.next_after_id }));

    expect(wordsOf(first)).toEqual(['apple', 'bread']);
    expect(first).toMatchObject({ total: 3, truncated: true, next_after_id: '12' });
    expect(wordsOf(second)).toEqual(['cheese']);
    expect(second).toMatchObject({ total: 3, returned: 1, truncated: false });
    expect(second).not.toHaveProperty('next_after_id');
  });

  it('rejects an after_id that is outside the filtered set and says how to recover', async () => {
    const { queries } = setup({ learnables: ALL });

    await expect(queries.listWords(filtered({ learned: true, afterId: '14' }))).rejects.toThrow(
      'after_id 14 is not in this list. Call again without after_id, with the same filters, and pass next_after_id from that result.',
    );
  });

  it('keeps words due by the end of a plain date in the injected zone, and skips never-studied words', async () => {
    const auckland = setup({ learnables: ALL, timeZone: 'Pacific/Auckland' });
    const newYork = setup({ learnables: ALL, timeZone: 'America/New_York' });

    // Auckland 2030-03-10 ends 2030-03-10T10:59:59.999Z; New York 2030-03-10 (a DST switch day) ends 2030-03-11T03:59:59.999Z.
    expect(wordsOf(await auckland.queries.listWords(filtered({ dueBefore: '2030-03-10' })))).toEqual(['apple']);
    expect(wordsOf(await newYork.queries.listWords(filtered({ dueBefore: '2030-03-10' })))).toEqual(['apple', 'bread']);
  });

  it('takes a due_before date-time with an offset exactly', async () => {
    const { queries } = setup({ learnables: ALL });

    const result = await queries.listWords(filtered({ dueBefore: '2030-03-10T21:00:00+01:00' }));

    expect(wordsOf(result)).toEqual(['apple', 'bread']);
  });

  it('rejects due_before values that are not dates, naming the parameter', async () => {
    const { queries } = setup({ learnables: ALL });

    await expect(queries.listWords(filtered({ dueBefore: '2030-13-01' }))).rejects.toThrow(/^due_before "2030-13-01" is not a date/);
    await expect(queries.listWords(filtered({ dueBefore: '2030-03-10T08:00' }))).rejects.toThrow(/^due_before "2030-03-10T08:00" has no time zone/);
  });

  it('rejects a growth range whose minimum is above its maximum', async () => {
    const { queries } = setup({ learnables: ALL });

    await expect(queries.listWords(filtered({ minGrowthLevel: 5, maxGrowthLevel: 2 }))).rejects.toThrow(
      'min_growth_level (5) is greater than max_growth_level (2).',
    );
  });
});

describe('LearnerQueries lookupWords', () => {
  it('matches a term against the learnables and reports a miss', async () => {
    const { queries } = setup();

    const result = await queries.lookupWords({ terms: ['book', 'xyzzy'] });

    expect(result.results[0]).toMatchObject({ query: 'book', met: true, match: 'exact' });
    expect(result.results[0].items[0].word).toBe('the book');
    expect(result.results[1]).toMatchObject({ query: 'xyzzy', met: false, match: 'none' });
    expect(result).not.toHaveProperty('warnings');
  });

  it('still answers the terms when a lesson fails, and warns about it', async () => {
    const { queries } = setup({ details: { 2003: new HttpStatusError(503, 'scenario_details', 3) } });

    const result = await queries.lookupWords({ terms: ['to drink'] });

    expect(result.results[0].met).toBe(true);
    expect(result.warnings).toEqual([LESSON_GAMMA_WARNING, LINKS_INCOMPLETE_WARNING]);
  });
});

describe('LearnerQueries listScenarios', () => {
  it('merges the requested types, most recently completed first, with dates from the details', async () => {
    const { queries } = setup({
      completed: [LESSON_ALPHA, LESSON_GAMMA],
      inProgress: [LESSON_DELTA],
      details: {
        2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED),
        2003: lesson(2003, [2], LESSON_GAMMA_COMPLETED),
        2002: makeDetails(2002, { dateStarted: '2030-01-06T08:00:00.000Z', dateCompleted: null }),
      },
    });

    const result = await queries.listScenarios({ types: ['completed', 'in_progress'] });

    expect(result.scenarios.map((s) => s.scenario_id)).toEqual([2003, 2005, 2002]);
    expect(result.scenarios[0]).toMatchObject({
      scenario_id: 2003,
      title: 'Lesson Gamma',
      topic: 'Topic Three',
      date_completed: LESSON_GAMMA_COMPLETED,
    });
  });

  it('keeps only lessons completed at or after since', async () => {
    const { queries } = setup({
      details: {
        2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED),
        2003: lesson(2003, [2], LESSON_GAMMA_COMPLETED),
      },
    });

    const result = await queries.listScenarios({
      types: ['completed'],
      since: '2030-01-03',
    });

    expect(result.scenarios.map((s) => s.scenario_id)).toEqual([2003]);
  });

  it.each([
    ['Pacific/Auckland', [2003, 2005]],
    ['Pacific/Pago_Pago', [2003]],
  ])('reads a plain since date as the start of that day in the injected zone %s', async (timeZone, expected) => {
    const { queries } = setup({
      timeZone,
      details: {
        2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED),
        2003: lesson(2003, [2], LESSON_GAMMA_COMPLETED),
      },
    });

    const result = await queries.listScenarios({ types: ['completed'], since: '2030-01-02' });

    expect(result.scenarios.map((s) => s.scenario_id)).toEqual(expected);
  });

  it('rejects a since date-time without a time zone in plain words', async () => {
    const { queries } = setup();

    await expect(queries.listScenarios({ types: ['completed'], since: '2030-01-02T10:00' })).rejects.toThrow(
      'since "2030-01-02T10:00" has no time zone; add Z or an offset like +01:00, or pass just the date.',
    );
  });

  it('keeps a failed lesson with null dates and names it in warnings', async () => {
    const { queries } = setup({ details: { 2003: new HttpStatusError(503, 'scenario_details', 3) } });

    const result = await queries.listScenarios({ types: ['completed'] });

    expect(result.scenarios.find((s) => s.scenario_id === 2003)).toMatchObject({
      date_started: null,
      date_completed: null,
    });
    expect(result.warnings).toEqual([LESSON_GAMMA_WARNING]);
  });
});

describe('LearnerQueries scenarioWords', () => {
  it('returns the lesson row and its words, linked to lessons and enriched from the learnables', async () => {
    const { queries } = setup({
      details: {
        2005: lesson(2005, [1], LESSON_ALPHA_COMPLETED),
        2003: lesson(2003, [1, 2], LESSON_GAMMA_COMPLETED),
      },
    });

    const result = await queries.scenarioWords({ scenarioId: 2003, includeAudio: false });

    expect(result.scenario).toMatchObject({ scenario_id: 2003, title: 'Lesson Gamma', date_completed: LESSON_GAMMA_COMPLETED });
    expect(result.words).toHaveLength(2);
    expect(result.words[0]).toMatchObject({
      word: 'the book',
      learned: true,
      lessons: ['Lesson Alpha', 'Lesson Gamma'],
    });
    expect(result).not.toHaveProperty('warnings');
  });

  it('returns a null scenario when the lesson is not in the lesson lists', async () => {
    const { queries } = setup({ details: { 1001: lesson(1001, [2], LESSON_ALPHA_COMPLETED) } });

    const result = await queries.scenarioWords({ scenarioId: 1001, includeAudio: false });

    expect(result.scenario).toBeNull();
    expect(result.words.map((w) => w.word)).toEqual(['to eat']);
  });

  it('rejects when this lesson’s details cannot be fetched', async () => {
    const { queries } = setup({ details: { 2003: new HttpStatusError(503, 'scenario_details', 3) } });

    await expect(queries.scenarioWords({ scenarioId: 2003, includeAudio: false })).rejects.toThrow(HttpStatusError);
  });

  it('resolves and warns about other lessons that fail', async () => {
    const { queries } = setup({
      details: {
        2005: new HttpStatusError(503, 'scenario_details', 3),
        2003: lesson(2003, [2], LESSON_GAMMA_COMPLETED),
      },
    });

    const result = await queries.scenarioWords({ scenarioId: 2003, includeAudio: false });

    expect(result.words).toHaveLength(1);
    expect(result.warnings).toEqual([
      'Could not read lesson 2005 "Lesson Alpha" (Memrise error HTTP 503), so its words show no lesson or topic in this result.',
    ]);
  });
});

describe('LearnerQueries listWords order when due_before is set', () => {
  const due = (id: number, target: string, nextReview: string) =>
    makeLearnable(id, { target, source: `tr: ${target}`, learned: true, nextReview });
  // Most recently touched first, i.e. not in review order.
  const LATE = due(21, 'late', '2030-03-09T12:00:00.000Z');
  const TIE_HIGH_ID = due(25, 'tie-high', '2030-03-05T08:00:00.000Z');
  const EARLY = due(23, 'early', '2030-03-01T08:00:00.000Z');
  const TIE_LOW_ID = due(22, 'tie-low', '2030-03-05T08:00:00.000Z');
  const NEVER_STUDIED = makeLearnable(24, { target: 'never', nextReview: '2020-01-01T00:00:00.000Z' });
  const ALL = [LATE, TIE_HIGH_ID, EARLY, NEVER_STUDIED, TIE_LOW_ID];
  const wordsOf = (result: { words: { word: string }[] }) => result.words.map((w) => w.word);

  it('lists the most overdue first, ties by id', async () => {
    const { queries } = setup({ learnables: ALL });

    const result = await queries.listWords({ limit: LIMIT, includeAudio: false, dueBefore: '2030-03-31' });

    expect(wordsOf(result)).toEqual(['early', 'tie-low', 'tie-high', 'late']);
  });

  it('keeps the list order when due_before is not set', async () => {
    const { queries } = setup({ learnables: ALL });

    const result = await queries.listWords({ limit: LIMIT, includeAudio: false });

    expect(wordsOf(result)).toEqual(['late', 'tie-high', 'early', 'never', 'tie-low']);
  });

  it('pages across the sorted order, including the tied words, without a skip or a repeat', async () => {
    const { queries } = setup({ learnables: ALL });
    const seen: string[] = [];
    let afterId: string | undefined;

    for (let guard = 0; guard < 10; guard += 1) {
      const page = await queries.listWords({ limit: 1, includeAudio: false, dueBefore: '2030-03-31', afterId });
      seen.push(...wordsOf(page));
      if (!page.truncated) break;
      afterId = page.next_after_id;
    }

    expect(seen).toEqual(['early', 'tie-low', 'tie-high', 'late']);
  });
});

describe('LearnerQueries listWords hint for a topic or lesson that matches nothing', () => {
  const WORD_A = makeLearnable(31, { target: 'apple', learned: true });
  const WORD_B = makeLearnable(32, { target: 'bread' });
  const TRAVEL = makeScenario(4001, { title: 'Trains', topic: { id: 1, name: 'Travel' } });
  const FOOD = makeScenario(4002, { title: 'Fruit', topic: { id: 2, name: 'Food' } });
  const FOOD_AGAIN = makeScenario(4003, { title: 'Bakery', topic: { id: 2, name: 'Food' } });
  const BASICS = makeScenario(4004, { title: 'Greetings', topic: { id: 3, name: 'Basics' } });
  const teach = (scenarioId: number, ...ids: number[]) =>
    makeDetails(scenarioId, { learnables: ids.map((id) => makeDetailLearnable(id)) });
  const lessons = {
    completed: [TRAVEL, FOOD, FOOD_AGAIN, BASICS],
    details: { 4001: teach(4001, 31), 4002: teach(4002, 31), 4003: teach(4003, 32), 4004: teach(4004, 32) },
  };
  const ask = (extra: Partial<Parameters<LearnerQueries['listWords']>[0]>) => ({ limit: LIMIT, includeAudio: false, ...extra });

  it('lists the topics, sorted and without repeats, when no topic matches', async () => {
    const { queries } = setup({ learnables: [WORD_A, WORD_B], ...lessons });

    const result = await queries.listWords(ask({ topic: 'quantum physics' }));

    expect(result).toMatchObject({ total: 0, words: [] });
    expect(result.warnings).toEqual(['No topic matches "quantum physics". Topics: Basics, Food, Travel.']);
  });

  it('lists the lesson titles, sorted, when no lesson matches', async () => {
    const { queries } = setup({ learnables: [WORD_A, WORD_B], ...lessons });

    const result = await queries.listWords(ask({ lesson: 'Nope' }));

    expect(result.warnings).toEqual(['No lesson matches "Nope". Lessons: Bakery, Fruit, Greetings, Trains.']);
  });

  it('adds no hint when the topic matches but another filter leaves no word', async () => {
    const { queries } = setup({ learnables: [WORD_A, WORD_B], ...lessons });

    const result = await queries.listWords(ask({ topic: 'food', minGrowthLevel: 9 }));

    expect(result).toMatchObject({ total: 0, words: [] });
    expect(result).not.toHaveProperty('warnings');
  });

  it('adds no hint when the lesson matches', async () => {
    const { queries } = setup({ learnables: [WORD_A, WORD_B], ...lessons });

    expect(await queries.listWords(ask({ lesson: 'fruit' }))).not.toHaveProperty('warnings');
  });

  it('names 30 topics at most and counts the rest', async () => {
    const many = Array.from({ length: 35 }, (_, i) =>
      makeScenario(5000 + i, { title: `Lesson ${i}`, topic: { id: i, name: `Topic ${String(i).padStart(2, '0')}` } }),
    );
    const details = Object.fromEntries(many.map((s) => [s.id, teach(s.id, 31)]));
    const { queries } = setup({ learnables: [WORD_A], completed: many, details });

    const [warning] = (await queries.listWords(ask({ topic: 'zzz' }))).warnings ?? [];

    expect(warning).toBe(
      `No topic matches "zzz". Topics: ${Array.from({ length: 30 }, (_, i) => `Topic ${String(i).padStart(2, '0')}`).join(', ')} (+5 more).`,
    );
  });

  it('says there are none when the learner has no topics or lessons', async () => {
    const { queries } = setup({ learnables: [WORD_A], completed: [] });

    expect((await queries.listWords(ask({ topic: 'food' }))).warnings).toEqual(['No topic matches "food". There are no topics.']);
    expect((await queries.listWords(ask({ lesson: 'food' }))).warnings).toEqual(['No lesson matches "food". There are no lessons.']);
  });

  it('says the list may be partial when a lesson could not be read, next to the failure warnings', async () => {
    const { queries } = setup({
      learnables: [WORD_A, WORD_B],
      ...lessons,
      details: { ...lessons.details, 4001: new HttpStatusError(503, 'scenario_details', 3) },
    });

    const result = await queries.listWords(ask({ topic: 'quantum' }));

    expect(result.warnings).toContain(
      'No topic matches "quantum". Topics: Basics, Food. Some lessons could not be read, so this list may be incomplete.',
    );
    expect(result.warnings).toContain(LINKS_INCOMPLETE_WARNING);
  });

  it('hints for the topic and for the lesson independently when both match nothing', async () => {
    const { queries } = setup({ learnables: [WORD_A, WORD_B], ...lessons });

    const result = await queries.listWords(ask({ topic: 'x1', lesson: 'x2' }));

    expect(result.warnings).toHaveLength(2);
  });
});
