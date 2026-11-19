/**
 * Lookup matching for `learnables_lookup`: exact key match first, then a contiguous word-sequence
 * match inside multi-word targets ("sentences"), then the same on the translation side. Matching is
 * accent-, case- and article-loose.
 */
import { uniqueById } from './uniqueById.js';
import { isLoneArticle, matchKey } from './textNormalize.js';
import type { WordRow } from './rows.js';
import type { Learnable } from './types.js';

export interface LookupEntry {
  learnable: Learnable;
  row: WordRow;
}

export interface LookupResult {
  query: string;
  met: boolean;
  /** `translation` only when nothing matched in the language being learned. */
  match: 'exact' | 'in_sentence' | 'translation' | 'none';
  items: WordRow[];
  in_sentences: WordRow[];
  in_sentences_total: number;
  in_translations: WordRow[];
  in_translations_total: number;
}

export interface LookupIndex {
  exact: Map<string, IndexedRow[]>;
  sentences: PhraseEntry[];
  translations: PhraseEntry[];
}

interface IndexedRow {
  learnableId: number;
  row: WordRow;
}

/** A row under a normalized key, split into words for run-of-words matching. */
interface PhraseEntry extends IndexedRow {
  key: string;
  tokens: string[];
}

const HIT_LIMIT = 5;
const MIN_PHRASE_SEARCH_LENGTH = 3;

/** Indexes each learnable once (by id) under its target's match key, and its translation's. */
export function buildLookupIndex(entries: readonly LookupEntry[]): LookupIndex {
  const index: LookupIndex = { exact: new Map(), sentences: [], translations: [] };
  const unique = uniqueById(entries.map((entry) => ({ ...entry, id: entry.learnable.id })));
  for (const { learnable, row } of unique) {
    const indexed: IndexedRow = { learnableId: learnable.id, row };
    const key = matchKey(learnable.target);
    if (key !== '') {
      const bucket = index.exact.get(key) ?? [];
      bucket.push(indexed);
      index.exact.set(key, bucket);
      const tokens = key.split(' ');
      if (tokens.length > 1) index.sentences.push({ ...indexed, key, tokens });
    }
    const translationKey = matchKey(learnable.source);
    if (translationKey !== '') index.translations.push({ ...indexed, key: translationKey, tokens: translationKey.split(' ') });
  }
  return index;
}

/**
 * A word already matched on the target side is not repeated as a sentence or translation hit.
 * `in_sentences` and `in_translations` are capped at five rows; the `_total` fields are the full counts.
 */
export function lookupTerm(index: LookupIndex, query: string): LookupResult {
  const key = matchKey(query);
  if (key === '') return toResult(query, [], [], []);
  const queryTokens = key.split(' ');
  const shortTerm = isExactOnly(key);
  const exactHits = index.exact.get(key) ?? [];
  const sentenceHits = shortTerm ? [] : phraseHits(index.sentences, queryTokens, exactHits);
  const taken = [...exactHits, ...sentenceHits];
  return toResult(query, exactHits, sentenceHits, translationHits(index.translations, key, queryTokens, taken, shortTerm));
}

/** Terms too short to search inside phrases (under three characters, or a lone article) match whole words only. */
function isExactOnly(key: string): boolean {
  return [...key].length < MIN_PHRASE_SEARCH_LENGTH || isLoneArticle(key);
}

function phraseHits(entries: readonly PhraseEntry[], queryTokens: readonly string[], taken: readonly IndexedRow[]): PhraseEntry[] {
  const takenIds = new Set(taken.map((hit) => hit.learnableId));
  return entries.filter((entry) => !takenIds.has(entry.learnableId) && containsSequence(entry.tokens, queryTokens));
}

/** Whole-translation matches first, then translations that contain the term; each group in list order. */
function translationHits(
  entries: readonly PhraseEntry[],
  key: string,
  queryTokens: readonly string[],
  taken: readonly IndexedRow[],
  exactOnly: boolean,
): PhraseEntry[] {
  const takenIds = new Set(taken.map((hit) => hit.learnableId));
  const free = entries.filter((entry) => !takenIds.has(entry.learnableId));
  const whole = free.filter((entry) => entry.key === key);
  if (exactOnly) return whole;
  const inText = free.filter((entry) => entry.key !== key && containsSequence(entry.tokens, queryTokens));
  return [...whole, ...inText];
}

function toResult(
  query: string,
  exactHits: readonly IndexedRow[],
  sentenceHits: readonly IndexedRow[],
  translationHits: readonly IndexedRow[],
): LookupResult {
  const match = classify(exactHits.length, sentenceHits.length, translationHits.length);
  return {
    query,
    met: match !== 'none',
    match,
    items: exactHits.map((hit) => hit.row),
    in_sentences: sentenceHits.slice(0, HIT_LIMIT).map((hit) => hit.row),
    in_sentences_total: sentenceHits.length,
    in_translations: translationHits.slice(0, HIT_LIMIT).map((hit) => hit.row),
    in_translations_total: translationHits.length,
  };
}

function classify(exactCount: number, sentenceCount: number, translationCount: number): LookupResult['match'] {
  if (exactCount > 0) return 'exact';
  if (sentenceCount > 0) return 'in_sentence';
  if (translationCount > 0) return 'translation';
  return 'none';
}

export function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}
