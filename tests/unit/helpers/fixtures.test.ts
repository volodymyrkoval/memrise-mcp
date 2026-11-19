import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../helpers/fixtures.js';

interface LanguagePairsFixture {
  language_pairs: { language_pair_id: number }[];
}

describe('loadFixture', () => {
  it('reads a committed fixture and parses its JSON', () => {
    const fixture = loadFixture<LanguagePairsFixture>('language-pairs.json');

    expect(fixture.language_pairs[0]?.language_pair_id).toBe(7);
  });
});
