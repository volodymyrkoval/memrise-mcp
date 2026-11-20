/**
 * Compact row shapes the tools and export return. Snake_case keys are the public contract; the
 * camelCase domain objects are mapped here and nowhere else.
 */
import type { DetailLearnable, Learnable, LessonRef, Scenario, ScenarioDetails } from './types.js';

export type WordOrigin = 'lesson' | 'other' | 'unknown';

export interface WordRow {
  /** Memrise's numeric id for the word; the same word has the same id in every lesson. */
  id: number;
  word: string;
  translation: string;
  growth_level: number;
  learned: boolean | null;
  known: boolean;
  difficult: boolean;
  /** Memrise's own flag that the word has been heard; its exact trigger is undocumented. True on an unlearned, unknown word means only heard. */
  heard: boolean;
  next_review: string | null;
  /**
   * `lesson`: a lesson teaches the word. `other`: none does; in practice the learner only heard the word (`heard: true`).
   * `unknown`: none is linked, but some lesson failed to load, so the link may be missing.
   */
  origin: WordOrigin;
  lessons: string[];
  topics: string[];
  audios?: string[];
}

export interface ScenarioRow {
  scenario_id: number;
  title: string;
  topic: string | null;
  number_of_learnables: number;
  items_learned: number;
  progress_percent: number;
  date_started: string | null;
  date_completed: string | null;
}

export interface RowOptions {
  includeAudio: boolean;
  /** True when some lesson failed to load, so a word with no lesson link may only be missing its link. */
  linksIncomplete?: boolean;
}

/** One learnable as a word row; `audios` is included only when requested. */
export function toWordRow(learnable: Learnable, lessons: readonly LessonRef[], options: RowOptions): WordRow {
  const row: WordRow = {
    id: learnable.id,
    word: learnable.target,
    translation: learnable.source,
    growth_level: learnable.growthLevel,
    learned: learnable.learned,
    known: learnable.known,
    difficult: learnable.difficult,
    heard: learnable.heard,
    next_review: scheduledReview(learnable),
    origin: originOf(lessons, options),
    lessons: lessonTitles(lessons),
    topics: lessonTopics(lessons),
  };
  if (options.includeAudio) row.audios = learnable.audios;
  return row;
}

/**
 * Row for one word inside a lesson's details. `enrichment` is the same word from the learnables
 * list; when it is missing, `learned` and `next_review` are null and `known` falls back to the
 * details' `already_known`.
 */
export function toScenarioWordRow(
  detail: DetailLearnable,
  enrichment: Learnable | undefined,
  lessons: readonly LessonRef[],
  options: RowOptions,
): WordRow {
  const row: WordRow = {
    id: detail.id,
    word: detail.target,
    translation: detail.source,
    growth_level: detail.growthLevel,
    learned: enrichment?.learned ?? null,
    known: enrichment?.known ?? detail.alreadyKnown,
    difficult: detail.difficult,
    heard: enrichment?.heard ?? false,
    next_review: enrichment === undefined ? null : scheduledReview(enrichment),
    origin: 'lesson',
    lessons: lessonTitles(lessons),
    topics: lessonTopics(lessons),
  };
  if (options.includeAudio) row.audios = enrichment?.audios ?? [];
  return row;
}

/** One lesson as a scenario row; dates come from its details and are null when they are absent. */
export function toScenarioRow(scenario: Scenario, details: ScenarioDetails | undefined): ScenarioRow {
  return {
    scenario_id: scenario.id,
    title: scenario.title,
    topic: scenario.topic?.name ?? null,
    number_of_learnables: scenario.numberOfLearnables,
    items_learned: scenario.itemsLearned,
    progress_percent: scenario.progressPercent,
    date_started: details?.dateStarted ?? null,
    date_completed: details?.dateCompleted ?? null,
  };
}

/** Only a learned word has a review date; never-studied and already-known words keep a stale one in the API, so it is dropped. */
function scheduledReview(learnable: Learnable): string | null {
  return learnable.learned ? learnable.nextReview : null;
}

function originOf(lessons: readonly LessonRef[], options: RowOptions): WordOrigin {
  if (lessons.length > 0) return 'lesson';
  return options.linksIncomplete === true ? 'unknown' : 'other';
}

function lessonTitles(lessons: readonly LessonRef[]): string[] {
  return lessons.map((lesson) => lesson.title);
}

function lessonTopics(lessons: readonly LessonRef[]): string[] {
  const topics = lessons.flatMap((lesson) => (lesson.topic === null ? [] : [lesson.topic]));
  return [...new Set(topics)];
}
