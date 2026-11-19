import { describe, expect, it } from 'vitest';
import { resolvePairId } from '../../../src/api/resolvePairId.js';
import { parseLanguagePairs } from '../../../src/api/schemas.js';
import { ConfigError } from '../../../src/errors.js';
import type { LanguagePair } from '../../../src/domain/types.js';
import { loadFixture } from '../../helpers/fixtures.js';

const FIXTURE_PAIR = parseLanguagePairs(loadFixture('language-pairs.json'))[0];
const SPANISH_PAIR: LanguagePair = { ...FIXTURE_PAIR, id: 61, targetName: 'Gamma', targetLocale: 'es' };

/** A listing that counts its calls, so a test can assert the account was never asked. */
function countingListing(pairs: LanguagePair[]) {
  let calls = 0;
  const listPairs = async () => {
    calls += 1;
    return pairs;
  };
  return { listPairs, calls: () => calls };
}

describe('resolvePairId', () => {
  it('returns the configured pair id without listing the account pairs', async () => {
    const listing = countingListing([FIXTURE_PAIR, SPANISH_PAIR]);

    expect(await resolvePairId(61, listing.listPairs)).toBe(61);
    expect(listing.calls()).toBe(0);
  });

  it('uses the only pair on the account when none is configured', async () => {
    const listing = countingListing([FIXTURE_PAIR]);

    expect(await resolvePairId(undefined, listing.listPairs)).toBe(7);
    expect(listing.calls()).toBe(1);
  });

  it('fails with a ConfigError when the account has no language pairs', async () => {
    await expect(resolvePairId(undefined, countingListing([]).listPairs)).rejects.toThrow(
      new ConfigError('No language pairs found for this account'),
    );
  });

  it('lists every pair and names the setting when several exist and none is configured', async () => {
    const listing = countingListing([FIXTURE_PAIR, SPANISH_PAIR]);

    await expect(resolvePairId(undefined, listing.listPairs)).rejects.toThrow(
      new ConfigError(
        'Several language pairs: 7 (Alpha → Beta), 61 (Alpha → Gamma); set MEMRISE_LANGUAGE_PAIR_ID',
      ),
    );
  });
});
