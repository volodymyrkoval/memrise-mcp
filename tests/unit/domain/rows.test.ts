import { describe, expect, it } from 'vitest';
import { toScenarioRow, toScenarioWordRow, toWordRow } from '../../../src/domain/rows.js';
import { makeDetailLearnable, makeDetails, makeLearnable, makeScenario } from '../../helpers/domainBuilders.js';

describe('toWordRow', () => {
  it('maps a learnable to the compact word row with audios when requested', () => {
    const learnable = makeLearnable(7, {
      target: 'the book',
      source: 'tr: the book',
      audios: ['https://example.test/book.mp3'],
      growthLevel: 13,
      known: false,
      difficult: true,
      nextReview: '2030-01-01T00:00:00Z',
      learned: true,
    });
    const lessons = [{ scenarioId: 1, title: 'Lesson Epsilon', topic: 'Trips' }];

    expect(toWordRow(learnable, lessons, { includeAudio: true })).toEqual({
      word: 'the book',
      translation: 'tr: the book',
      growth_level: 13,
      learned: true,
      known: false,
      difficult: true,
      heard: false,
      next_review: '2030-01-01T00:00:00Z',
      origin: 'lesson',
      lessons: ['Lesson Epsilon'],
      topics: ['Trips'],
      audios: ['https://example.test/book.mp3'],
    });
  });

  it('marks a word the learner only heard, outside any lesson', () => {
    const learnable = makeLearnable(7, { heard: true, nextReview: '2020-01-01T00:00:00Z' });

    const row = toWordRow(learnable, [], { includeAudio: false });

    expect(row).toMatchObject({ heard: true, learned: false, known: false, origin: 'other', next_review: null });
  });

  it('lists lesson titles and topic names, skipping lessons without a topic', () => {
    const lessons = [
      { scenarioId: 1, title: 'Lesson Epsilon', topic: 'Trips' },
      { scenarioId: 2, title: 'Loose lesson', topic: null },
    ];

    const row = toWordRow(makeLearnable(7), lessons, { includeAudio: false });

    expect(row.lessons).toEqual(['Lesson Epsilon', 'Loose lesson']);
    expect(row.topics).toEqual(['Trips']);
  });

  it('lists each topic once, in the order the lessons first show it', () => {
    const lessons = [
      { scenarioId: 1, title: 'Lesson Epsilon', topic: 'Trips' },
      { scenarioId: 2, title: 'Topic Three', topic: 'Eating out' },
      { scenarioId: 3, title: 'Tickets', topic: 'Trips' },
    ];

    const row = toWordRow(makeLearnable(7), lessons, { includeAudio: false });

    expect(row.topics).toEqual(['Trips', 'Eating out']);
  });

  it.each([
    ['never studied', { learned: false, known: false }, null],
    ['learned', { learned: true, known: false }, '2030-01-01T00:00:00Z'],
    ['known without being learned', { learned: false, known: true }, null],
  ])('keeps next_review only when the word is learned (%s)', (_label, flags, expected) => {
    const learnable = makeLearnable(7, { ...flags, nextReview: '2030-01-01T00:00:00Z' });

    expect(toWordRow(learnable, [], { includeAudio: false }).next_review).toBe(expected);
  });

  it.each([
    ['a lesson teaches the word', [{ scenarioId: 1, title: 'Lesson Epsilon', topic: null }], false, 'lesson'],
    ['no lesson teaches it and every lesson loaded', [], false, 'other'],
    ['no lesson links it but some lesson failed to load', [], true, 'unknown'],
    ['a lesson teaches it even though another failed', [{ scenarioId: 1, title: 'Lesson Epsilon', topic: null }], true, 'lesson'],
  ] as const)('marks the origin when %s', (_label, lessons, linksIncomplete, expected) => {
    const row = toWordRow(makeLearnable(7), lessons, { includeAudio: false, linksIncomplete });

    expect(row.origin).toBe(expected);
  });

  it('treats lesson links as complete unless told otherwise', () => {
    expect(toWordRow(makeLearnable(7), [], { includeAudio: false }).origin).toBe('other');
  });

  it('omits the audios key when audio was not requested', () => {
    const learnable = makeLearnable(7, { audios: ['https://example.test/a.mp3'] });

    const row = toWordRow(learnable, [], { includeAudio: false });

    expect(row).not.toHaveProperty('audios');
  });
});

describe('toScenarioRow', () => {
  it('maps a lesson to the scenario row, taking dates from its details', () => {
    const scenario = makeScenario(1001, {
      title: 'Pedir a table',
      topic: { id: 3, name: 'Topic Five' },
      numberOfLearnables: 15,
      itemsLearned: 12,
      progressPercent: 80,
    });
    const details = makeDetails(1001, {
      dateStarted: '2030-01-01T10:00:00Z',
      dateCompleted: '2030-01-02T11:30:00Z',
    });

    expect(toScenarioRow(scenario, details)).toEqual({
      scenario_id: 1001,
      title: 'Pedir a table',
      topic: 'Topic Five',
      number_of_learnables: 15,
      items_learned: 12,
      progress_percent: 80,
      date_started: '2030-01-01T10:00:00Z',
      date_completed: '2030-01-02T11:30:00Z',
    });
  });

  it('leaves both dates null when the lesson has no details yet', () => {
    const row = toScenarioRow(makeScenario(1001), undefined);

    expect(row.date_started).toBeNull();
    expect(row.date_completed).toBeNull();
  });
});

describe('toScenarioWordRow', () => {
  it('takes state from the learnables enrichment when the word was found there', () => {
    const detail = makeDetailLearnable(7, {
      target: 'the book',
      source: 'tr: the book',
      growthLevel: 10,
      alreadyKnown: false,
      difficult: true,
    });
    const enrichment = makeLearnable(7, {
      learned: true,
      known: true,
      nextReview: '2030-01-01T00:00:00Z',
      audios: ['https://example.test/book.mp3'],
    });
    const lessons = [{ scenarioId: 1, title: 'Lesson Epsilon', topic: 'Trips' }];

    expect(toScenarioWordRow(detail, enrichment, lessons, { includeAudio: true })).toEqual({
      word: 'the book',
      translation: 'tr: the book',
      growth_level: 10,
      learned: true,
      known: true,
      difficult: true,
      heard: false,
      next_review: '2030-01-01T00:00:00Z',
      origin: 'lesson',
      lessons: ['Lesson Epsilon'],
      topics: ['Trips'],
      audios: ['https://example.test/book.mp3'],
    });
  });

  it('takes heard from the enrichment, and reads false without one', () => {
    const detail = makeDetailLearnable(7);

    expect(toScenarioWordRow(detail, makeLearnable(7, { heard: true }), [], { includeAudio: false }).heard).toBe(true);
    expect(toScenarioWordRow(detail, undefined, [], { includeAudio: false }).heard).toBe(false);
  });

  it('always marks a word inside a lesson as coming from a lesson', () => {
    const row = toScenarioWordRow(makeDetailLearnable(7), undefined, [], { includeAudio: false, linksIncomplete: true });

    expect(row.origin).toBe('lesson');
  });

  it('gives a scenario word that was never studied no next_review', () => {
    const detail = makeDetailLearnable(7);
    const enrichment = makeLearnable(7, { learned: false, known: false, nextReview: '2020-01-01T00:00:00Z' });

    expect(toScenarioWordRow(detail, enrichment, [], { includeAudio: false }).next_review).toBeNull();
  });

  it('falls back to already_known and null state when the word is not in the learnables list', () => {
    const detail = makeDetailLearnable(7, { alreadyKnown: true });

    const row = toScenarioWordRow(detail, undefined, [], { includeAudio: true });

    expect(row.learned).toBeNull();
    expect(row.next_review).toBeNull();
    expect(row.known).toBe(true);
    expect(row.audios).toEqual([]);
  });

  it('omits the audios key when audio was not requested', () => {
    const detail = makeDetailLearnable(7);
    const enrichment = makeLearnable(7, { audios: ['a.mp3'] });

    const row = toScenarioWordRow(detail, enrichment, [], { includeAudio: false });

    expect(row).not.toHaveProperty('audios');
  });
});
