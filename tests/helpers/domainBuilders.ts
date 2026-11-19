/**
 * Test builders for synthetic domain objects. Used where the sanitized fixtures lack the case
 * under test (shared learnables across lessons, near-miss words, and similar).
 */
import type { DetailLearnable, Learnable, Scenario, ScenarioDetails } from '../../src/domain/types.js';

export function makeLearnable(id: number, overrides: Partial<Learnable> = {}): Learnable {
  return {
    id,
    target: 'word',
    source: 'translation',
    audios: [],
    growthLevel: 0,
    known: false,
    difficult: false,
    nextReview: null,
    learned: false,
    heard: false,
    ...overrides,
  };
}

export function makeScenario(id: number, overrides: Partial<Scenario> = {}): Scenario {
  return {
    id,
    title: `Lesson ${id}`,
    topic: null,
    numberOfLearnables: 0,
    itemsLearned: 0,
    progressPercent: 0,
    ...overrides,
  };
}

export function makeDetailLearnable(id: number, overrides: Partial<DetailLearnable> = {}): DetailLearnable {
  return {
    id,
    target: 'word',
    source: 'translation',
    growthLevel: 0,
    alreadyKnown: false,
    difficult: false,
    ...overrides,
  };
}

export function makeDetails(scenarioId: number, overrides: Partial<ScenarioDetails> = {}): ScenarioDetails {
  return {
    scenarioId,
    learnables: [],
    completed: true,
    dateStarted: null,
    dateCompleted: null,
    ...overrides,
  };
}
