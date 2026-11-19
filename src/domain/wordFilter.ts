/**
 * Filters for `learnables_list`, built once into a single predicate over word rows. Every given
 * filter must hold (AND); no filter at all accepts every row.
 */
import { UsageError } from '../errors.js';
import { containsSequence } from './lookup.js';
import type { WordRow } from './rows.js';
import { normalizeText } from './textNormalize.js';

export interface WordFilters {
  /** Keeps words whose next review is at or before this instant; words with no review date never match. */
  dueBefore?: Date;
  difficult?: boolean;
  learned?: boolean;
  known?: boolean;
  heard?: boolean;
  /** Whole words, any case or accents; several words must appear next to each other, in order. */
  topic?: string;
  lesson?: string;
  minGrowthLevel?: number;
  maxGrowthLevel?: number;
}

export type WordPredicate = (row: WordRow) => boolean;

export function buildWordFilter(filters: WordFilters): WordPredicate {
  const predicates = [...flagPredicates(filters), ...duePredicates(filters), ...titlePredicates(filters), ...growthPredicates(filters)];
  return (row) => predicates.every((accepts) => accepts(row));
}

function flagPredicates(filters: WordFilters): WordPredicate[] {
  const predicates: WordPredicate[] = [];
  if (filters.difficult !== undefined) predicates.push((row) => row.difficult === filters.difficult);
  if (filters.learned !== undefined) predicates.push((row) => row.learned === filters.learned);
  if (filters.known !== undefined) predicates.push((row) => row.known === filters.known);
  if (filters.heard !== undefined) predicates.push((row) => row.heard === filters.heard);
  return predicates;
}

function duePredicates({ dueBefore }: WordFilters): WordPredicate[] {
  if (dueBefore === undefined) return [];
  const threshold = dueBefore.getTime();
  return [(row) => row.next_review !== null && Date.parse(row.next_review) <= threshold];
}

function titlePredicates(filters: WordFilters): WordPredicate[] {
  const predicates: WordPredicate[] = [];
  if (filters.topic !== undefined) predicates.push(titlePredicate('topic', filters.topic, (row) => row.topics));
  if (filters.lesson !== undefined) predicates.push(titlePredicate('lesson', filters.lesson, (row) => row.lessons));
  return predicates;
}

function titlePredicate(field: string, query: string, titlesOf: (row: WordRow) => readonly string[]): WordPredicate {
  const matches = titleMatcher(field, query);
  return (row) => titlesOf(row).some(matches);
}

/** Whether a topic or lesson title matches the learner's filter text; throws when the text has nothing to match. */
export function titleMatcher(field: string, query: string): (title: string) => boolean {
  const normalized = normalizeText(query);
  if (normalized === '') throw new UsageError(`${field} "${query}" has no letters or digits to match.`);
  const needle = normalized.split(' ');
  return (title) => containsSequence(normalizeText(title).split(' '), needle);
}

function growthPredicates({ minGrowthLevel, maxGrowthLevel }: WordFilters): WordPredicate[] {
  const predicates: WordPredicate[] = [];
  if (minGrowthLevel !== undefined) predicates.push((row) => row.growth_level >= minGrowthLevel);
  if (maxGrowthLevel !== undefined) predicates.push((row) => row.growth_level <= maxGrowthLevel);
  return predicates;
}
