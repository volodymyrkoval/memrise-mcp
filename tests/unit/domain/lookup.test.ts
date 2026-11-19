import { describe, expect, it } from 'vitest';
import { parseLearnablesPage } from '../../../src/api/schemas.js';
import { buildLookupIndex, lookupTerm } from '../../../src/domain/lookup.js';
import { toWordRow } from '../../../src/domain/rows.js';
import type { Learnable } from '../../../src/domain/types.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { makeLearnable } from '../../helpers/domainBuilders.js';

const ROW_OPTIONS = { includeAudio: false };

function indexOf(learnables: Learnable[]) {
  return buildLookupIndex(learnables.map((learnable) => ({ learnable, row: toWordRow(learnable, [], ROW_OPTIONS) })));
}

describe('lookupTerm', () => {
  it('matches a word exactly when the article is left off the query', () => {
    const index = indexOf([makeLearnable(1, { target: 'the book' })]);

    const result = lookupTerm(index, 'book');

    expect(result.match).toBe('exact');
    expect(result.met).toBe(true);
    expect(result.items.map((row) => row.word)).toEqual(['the book']);
  });

  it('matches a multi-word target when the query is one of its words', () => {
    const index = indexOf([makeLearnable(1, { target: 'the key is on the table' })]);

    const result = lookupTerm(index, 'key');

    expect(result.match).toBe('in_sentence');
    expect(result.met).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.in_sentences.map((row) => row.word)).toEqual(['the key is on the table']);
    expect(result.in_sentences_total).toBe(1);
  });

  it('reports no match for a term that appears nowhere', () => {
    const index = indexOf([makeLearnable(1, { target: 'the book' })]);

    const result = lookupTerm(index, 'xyzzy');

    expect(result).toEqual({
      query: 'xyzzy',
      met: false,
      match: 'none',
      items: [],
      in_sentences: [],
      in_sentences_total: 0,
      in_translations: [],
      in_translations_total: 0,
    });
  });

  it('returns every learnable whose target matches, each once', () => {
    const index = indexOf([
      makeLearnable(1, { target: 'table' }),
      makeLearnable(2, { target: 'the table' }),
    ]);

    const result = lookupTerm(index, 'table');

    expect(result.items.map((row) => row.word)).toEqual(['table', 'the table']);
  });
});

describe('lookupTerm edge cases', () => {
  it('ignores case and accents on both sides', () => {
    const index = indexOf([makeLearnable(1, { target: 'Café' })]);

    expect(lookupTerm(index, 'cafe').match).toBe('exact');
    expect(lookupTerm(index, 'CAFÉ').match).toBe('exact');
  });

  it('treats cedilla as c', () => {
    const index = indexOf([makeLearnable(1, { target: 'Naïve' })]);

    expect(lookupTerm(index, 'naive').match).toBe('exact');
  });

  it('matches a target that carries punctuation', () => {
    const index = indexOf([makeLearnable(1, { target: 'Bom dia!' })]);

    expect(lookupTerm(index, 'bom dia').match).toBe('exact');
  });

  it('matches whole words only, so table does not match tablet', () => {
    const index = indexOf([
      makeLearnable(1, { target: 'tablet' }),
      makeLearnable(2, { target: 'a tablet grande' }),
    ]);

    const result = lookupTerm(index, 'table');

    expect(result.match).toBe('none');
    expect(result.in_sentences_total).toBe(0);
  });

  it('finds a word inside a longer sentence at a word boundary', () => {
    const index = indexOf([makeLearnable(1, { target: 'the plate is on the table' })]);

    const result = lookupTerm(index, 'table');

    expect(result.match).toBe('in_sentence');
    expect(result.in_sentences_total).toBe(1);
  });

  it('reports no match for an empty or punctuation-only query', () => {
    const index = indexOf([makeLearnable(1, { target: 'the book' })]);

    for (const query of ['', '   ', '!!!']) {
      expect(lookupTerm(index, query)).toMatchObject({ met: false, match: 'none', items: [] });
    }
  });

  it('lists a learnable once even when it is indexed twice', () => {
    const learnable = makeLearnable(1, { target: 'book' });
    const row = toWordRow(learnable, [], ROW_OPTIONS);

    const result = lookupTerm(buildLookupIndex([{ learnable, row }, { learnable, row }]), 'book');

    expect(result.items).toHaveLength(1);
  });

  it('does not repeat an exact match as a sentence hit', () => {
    const index = indexOf([makeLearnable(1, { target: 'big table' })]);

    const result = lookupTerm(index, 'big table');

    expect(result.match).toBe('exact');
    expect(result.items.map((row) => row.word)).toEqual(['big table']);
    expect(result.in_sentences_total).toBe(0);
  });

  it('caps sentence hits at five rows and reports the full count', () => {
    const index = indexOf(
      Array.from({ length: 7 }, (_, i) => makeLearnable(i + 1, { target: `phrase ${i + 1} table` })),
    );

    const result = lookupTerm(index, 'table');

    expect(result.in_sentences).toHaveLength(5);
    expect(result.in_sentences_total).toBe(7);
    expect(result.in_sentences[0].word).toBe('phrase 1 table');
  });
});

describe('lookupTerm over the sanitized learnables fixtures', () => {
  const learnables = ['learnables-page-1.json', 'learnables-page-2.json', 'learnables-page-last.json'].flatMap(
    (name) => parseLearnablesPage(loadFixture<unknown>(name)).items,
  );

  it('finds book as an exact match on o book', () => {
    const result = lookupTerm(indexOf(learnables), 'book');

    expect(result.match).toBe('exact');
    expect(result.items.map((row) => row.word)).toContain('the book');
  });

  it('finds key only inside a sentence', () => {
    const result = lookupTerm(indexOf(learnables), 'key');

    expect(result.match).toBe('in_sentence');
    expect(result.items).toEqual([]);
    expect(result.in_sentences.some((row) => row.word.includes('key'))).toBe(true);
  });
});

describe('lookupTerm short terms', () => {
  const index = () =>
    indexOf([
      makeLearnable(1, { target: 'to eat' }),
      makeLearnable(2, { target: 'to' }),
      makeLearnable(3, { target: 'the red house' }),
      makeLearnable(4, { target: 'the' }),
      makeLearnable(5, { target: 'ox' }),
      makeLearnable(6, { target: 'eat the apple' }),
    ]);

  it('matches a term under three characters exactly only, never inside a phrase', () => {
    const result = lookupTerm(index(), 'to');

    expect(result.match).toBe('exact');
    expect(result.items.map((row) => row.word)).toEqual(['to']);
    expect(result.in_sentences).toEqual([]);
    expect(result.in_sentences_total).toBe(0);
  });

  it('reports no match for a short term that only occurs inside phrases', () => {
    const result = lookupTerm(indexOf([makeLearnable(1, { target: 'to eat' })]), 'to');

    expect(result).toMatchObject({ met: false, match: 'none', in_sentences: [] });
  });

  it('still finds a two-character word exactly', () => {
    expect(lookupTerm(index(), 'ox').items.map((row) => row.word)).toEqual(['ox']);
  });

  it('counts characters, not UTF-16 units, so one astral character is still short', () => {
    const result = lookupTerm(indexOf([makeLearnable(1, { target: '\u{20BB7}\u{20BB7} \u{20BB7}' })]), '\u{20BB7}\u{20BB7}');

    expect(result.in_sentences).toEqual([]);
  });

  it('matches a lone article exactly only, so it does not match every phrase that starts with it', () => {
    const result = lookupTerm(index(), 'the');

    expect(result.items.map((row) => row.word)).toEqual(['the']);
    expect(result.in_sentences).toEqual([]);
  });

  it('matches a lone article in a phrase search when written with a noun', () => {
    const result = lookupTerm(index(), 'the red');

    expect(result.in_sentences.map((row) => row.word)).toEqual(['the red house']);
  });
});

describe('lookupTerm translations', () => {
  it('finds a word by its translation and says only the translation matched', () => {
    const index = indexOf([makeLearnable(1, { target: 'tren', source: 'train' })]);

    const result = lookupTerm(index, 'train');

    expect(result).toMatchObject({ met: true, match: 'translation', items: [], in_sentences: [], in_translations_total: 1 });
    expect(result.in_translations.map((row) => row.word)).toEqual(['tren']);
  });

  it('finds a word whose translation contains the term as a run of words', () => {
    const index = indexOf([makeLearnable(1, { target: 'estacion', source: 'the train station' })]);

    const result = lookupTerm(index, 'train');

    expect(result.match).toBe('translation');
    expect(result.in_translations.map((row) => row.word)).toEqual(['estacion']);
  });

  it('does not match part of a translation word', () => {
    const index = indexOf([makeLearnable(1, { target: 'cuidador', source: 'trainer' })]);

    expect(lookupTerm(index, 'train').match).toBe('none');
  });

  it('lists exact translation matches before in-text ones, each in list order', () => {
    const index = indexOf([
      makeLearnable(1, { target: 'a', source: 'train station' }),
      makeLearnable(2, { target: 'b', source: 'train' }),
      makeLearnable(3, { target: 'c', source: 'night train' }),
      makeLearnable(4, { target: 'd', source: 'the train' }),
    ]);

    const result = lookupTerm(index, 'train');

    expect(result.in_translations.map((row) => row.word)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('lists a word once when both its target and translation match, under items', () => {
    const index = indexOf([makeLearnable(1, { target: 'train', source: 'train' })]);

    const result = lookupTerm(index, 'train');

    expect(result.match).toBe('exact');
    expect(result.items).toHaveLength(1);
    expect(result.in_translations).toEqual([]);
    expect(result.in_translations_total).toBe(0);
  });

  it('keeps the target-side match when a translation matches too, and still lists the translation hit', () => {
    const index = indexOf([
      makeLearnable(1, { target: 'train', source: 'x' }),
      makeLearnable(2, { target: 'tren', source: 'train' }),
    ]);

    const result = lookupTerm(index, 'train');

    expect(result.match).toBe('exact');
    expect(result.items.map((row) => row.word)).toEqual(['train']);
    expect(result.in_translations.map((row) => row.word)).toEqual(['tren']);
  });

  it('does not repeat a word already listed under in_sentences', () => {
    const index = indexOf([makeLearnable(1, { target: 'big train now', source: 'a big train' })]);

    const result = lookupTerm(index, 'train');

    expect(result.match).toBe('in_sentence');
    expect(result.in_sentences).toHaveLength(1);
    expect(result.in_translations).toEqual([]);
  });

  it('caps in_translations at five and reports the full count', () => {
    const index = indexOf(
      Array.from({ length: 7 }, (_, i) => makeLearnable(i + 1, { target: `t${i}`, source: `train ${i}` })),
    );

    const result = lookupTerm(index, 'train');

    expect(result.in_translations).toHaveLength(5);
    expect(result.in_translations_total).toBe(7);
  });

  it('matches a short term or a lone article against whole translations only', () => {
    const index = indexOf([
      makeLearnable(1, { target: 'a1', source: 'go to the sea' }),
      makeLearnable(2, { target: 'a2', source: 'to' }),
      makeLearnable(3, { target: 'a3', source: 'the' }),
      makeLearnable(4, { target: 'a4', source: 'eat the apple' }),
    ]);

    expect(lookupTerm(index, 'to').in_translations.map((row) => row.word)).toEqual(['a2']);
    expect(lookupTerm(index, 'the').in_translations.map((row) => row.word)).toEqual(['a3']);
  });

  it('ignores accents and case in the translation, like on the target side', () => {
    const index = indexOf([makeLearnable(1, { target: 'x', source: 'Café au lait' })]);

    expect(lookupTerm(index, 'cafe').match).toBe('translation');
  });

  it('skips learnables with an empty translation', () => {
    const index = indexOf([makeLearnable(1, { target: 'x', source: '' })]);

    expect(lookupTerm(index, 'x').in_translations).toEqual([]);
  });
});
