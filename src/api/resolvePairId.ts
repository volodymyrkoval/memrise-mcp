/**
 * Chooses the language pair a session works on: the configured one when set, otherwise the only
 * pair the account has. Several pairs without a configured choice is a configuration error.
 */
import { ConfigError } from '../errors.js';
import type { LanguagePair } from '../domain/types.js';

/**
 * Resolves the pair id. `listPairs` is only called when no id is configured, so a configured id
 * costs no request. Throws `ConfigError` when the choice cannot be made from the account alone.
 */
export async function resolvePairId(
  configuredId: number | undefined,
  listPairs: () => Promise<LanguagePair[]>,
): Promise<number> {
  if (configuredId !== undefined) return configuredId;
  const pairs = await listPairs();
  if (pairs.length === 0) throw new ConfigError('No language pairs found for this account');
  if (pairs.length === 1) return pairs[0].id;
  throw new ConfigError(
    `Several language pairs: ${pairs.map(describePair).join(', ')}; set MEMRISE_LANGUAGE_PAIR_ID`,
  );
}

function describePair(pair: LanguagePair): string {
  return `${pair.id} (${pair.sourceName} → ${pair.targetName})`;
}
