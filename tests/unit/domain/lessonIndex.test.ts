import { describe, expect, it } from 'vitest';
import { buildLessonIndex } from '../../../src/domain/lessonIndex.js';
import { makeDetailLearnable, makeDetails, makeScenario } from '../../helpers/domainBuilders.js';

describe('buildLessonIndex', () => {
  it('lists every lesson that teaches a learnable, in scenario order', () => {
    const scenarios = [makeScenario(1, { title: 'Lesson Epsilon' }), makeScenario(2, { title: 'Topic Three' })];
    const detailsById = new Map([
      [1, makeDetails(1, { learnables: [makeDetailLearnable(7)] })],
      [2, makeDetails(2, { learnables: [makeDetailLearnable(7)] })],
    ]);

    const index = buildLessonIndex(scenarios, detailsById);

    expect(index.get(7)).toEqual([
      { scenarioId: 1, title: 'Lesson Epsilon', topic: null },
      { scenarioId: 2, title: 'Topic Three', topic: null },
    ]);
  });

  it('lists a lesson once when the same scenario appears twice in the input', () => {
    const scenario = makeScenario(1, { title: 'Lesson Epsilon' });
    const detailsById = new Map([[1, makeDetails(1, { learnables: [makeDetailLearnable(7)] })]]);

    const index = buildLessonIndex([scenario, scenario], detailsById);

    expect(index.get(7)).toEqual([{ scenarioId: 1, title: 'Lesson Epsilon', topic: null }]);
  });

  it('lists a lesson once when the same learnable appears twice in its details', () => {
    const scenarios = [makeScenario(1, { title: 'Lesson Epsilon' })];
    const detailsById = new Map([
      [1, makeDetails(1, { learnables: [makeDetailLearnable(7), makeDetailLearnable(7)] })],
    ]);

    const index = buildLessonIndex(scenarios, detailsById);

    expect(index.get(7)).toEqual([{ scenarioId: 1, title: 'Lesson Epsilon', topic: null }]);
  });

  it('carries the topic name of each lesson', () => {
    const scenarios = [makeScenario(1, { title: 'Lesson Epsilon', topic: { id: 10, name: 'Trips' } })];
    const detailsById = new Map([[1, makeDetails(1, { learnables: [makeDetailLearnable(7)] })]]);

    const index = buildLessonIndex(scenarios, detailsById);

    expect(index.get(7)).toEqual([{ scenarioId: 1, title: 'Lesson Epsilon', topic: 'Trips' }]);
  });

  it('leaves out learnables that no lesson teaches', () => {
    const scenarios = [makeScenario(1)];
    const detailsById = new Map([[1, makeDetails(1, { learnables: [makeDetailLearnable(7)] })]]);

    const index = buildLessonIndex(scenarios, detailsById);

    expect(index.has(8)).toBe(false);
  });

  it('skips a scenario that has no details entry without failing', () => {
    const scenarios = [makeScenario(1, { title: 'Lesson Epsilon' }), makeScenario(2, { title: 'Failed lesson' })];
    const detailsById = new Map([[1, makeDetails(1, { learnables: [makeDetailLearnable(7)] })]]);

    const index = buildLessonIndex(scenarios, detailsById);

    expect(index.get(7)).toEqual([{ scenarioId: 1, title: 'Lesson Epsilon', topic: null }]);
    expect([...index.keys()]).toEqual([7]);
  });
});
