/**
 * Domain vocabulary shared by the API, application and tool layers. Fields are camelCase; the
 * snake_case wire names are mapped away in `api/schemas.ts` and never leak past it.
 */

export interface LanguagePair {
  id: number;
  sourceName: string;
  targetName: string;
  sourceLocale: string;
  targetLocale: string;
}

/** One word or phrase the learner is studying. `nextReview` is an ISO-8601 timestamp or null. */
export interface Learnable {
  id: number;
  target: string;
  source: string;
  audios: string[];
  growthLevel: number;
  known: boolean;
  difficult: boolean;
  nextReview: string | null;
  learned: boolean;
  /** Memrise's own flag that the word has been heard; its exact trigger is undocumented. */
  heard: boolean;
}

/** A lesson in the learner's scenario list. `progressPercent` is 0–100. */
export interface Scenario {
  id: number;
  title: string;
  topic: { id: number; name: string } | null;
  numberOfLearnables: number;
  itemsLearned: number;
  progressPercent: number;
}

/** A word as it appears inside one lesson's details. */
export interface DetailLearnable {
  id: number;
  target: string;
  source: string;
  growthLevel: number;
  alreadyKnown: boolean;
  difficult: boolean;
}

export interface ScenarioDetails {
  scenarioId: number;
  learnables: DetailLearnable[];
  completed: boolean;
  dateStarted: string | null;
  dateCompleted: string | null;
}

/** Which learnables the learner sees: "everything I've met" is `any`, the API's `ANY`. */
export type StateKey = 'any' | 'fully_learned_or_known';

/** Scenario lists the app reads; the API values are identical to these keys. */
export type ScenarioTypeKey = 'completed' | 'in_progress';

/** A lesson that teaches a learnable. `topic` is the lesson's topic name, or null when it has none. */
export interface LessonRef {
  scenarioId: number;
  title: string;
  topic: string | null;
}

/** The state a learnables read uses unless the caller asks for another. */
export const DEFAULT_STATE: StateKey = 'any';

/** Scenario lists that feed the word ↔ lesson join. */
export const LESSON_INDEX_TYPES: readonly ScenarioTypeKey[] = ['completed', 'in_progress'];
