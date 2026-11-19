import { describe, expect, it } from 'vitest';
import { isLoneArticle, matchKey, normalizeText, stripLeadingArticle } from '../../../src/domain/textNormalize.js';

describe('normalizeText', () => {
  it('removes accents and cedillas and lowercases', () => {
    expect(normalizeText('Café')).toBe('cafe');
    expect(normalizeText('Bóok')).toBe('book');
    expect(normalizeText('NAÏVE')).toBe('naive');
  });

  it('turns punctuation into spaces, collapses whitespace and trims', () => {
    expect(normalizeText('  The key is on the table!  ')).toBe(
      'the key is on the table',
    );
  });
});

describe('stripLeadingArticle', () => {
  it('removes one leading article token', () => {
    expect(stripLeadingArticle('the book')).toBe('book');
    expect(stripLeadingArticle('an apple green')).toBe('apple green');
  });

  it('knows common articles of English, Spanish, Portuguese, French, Italian and German', () => {
    const phrases = ['the book', 'an apple', 'el libro', 'la casa', 'une table', 'il cane', 'der tisch', 'ein hund'];
    expect(phrases.map(stripLeadingArticle)).toEqual(['book', 'apple', 'libro', 'casa', 'table', 'cane', 'tisch', 'hund']);
  });

  it('removes only one article when two are in a row', () => {
    expect(stripLeadingArticle('the the book')).toBe('the book');
  });

  it('keeps a lone article, since stripping it would leave nothing', () => {
    expect(stripLeadingArticle('the')).toBe('the');
  });

  it('leaves text without a leading article unchanged', () => {
    expect(stripLeadingArticle('book of port')).toBe('book of port');
    expect(stripLeadingArticle('hello')).toBe('hello');
  });
});

describe('matchKey', () => {
  it('gives the same key for article, case and accent variants of a word', () => {
    expect(matchKey('the book')).toBe('book');
    expect(matchKey('Book')).toBe('book');
    expect(matchKey('bóok')).toBe('book');
  });
});

describe('isLoneArticle', () => {
  it('is true for a single article and false for anything else', () => {
    expect(isLoneArticle('the')).toBe(true);
    expect(isLoneArticle('the book')).toBe(false);
    expect(isLoneArticle('book')).toBe(false);
    expect(isLoneArticle('')).toBe(false);
  });
});
