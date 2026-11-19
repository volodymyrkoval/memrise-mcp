/**
 * Text normalization for lookup matching: accent- and case-insensitive, punctuation-free,
 * single-spaced. Shared by the index (targets) and the query side so both produce the same keys.
 */

/**
 * Best-effort list of common articles in Latin-script languages: English, Spanish, Portuguese,
 * French, Italian and German. Other languages and scripts get case, accent and punctuation
 * loosening only. A short word that is also an article in one of these languages is dropped too.
 */
const LEADING_ARTICLES = new Set([
  'a', 'an', 'the',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'o', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'le', 'les', 'une', 'des',
  'il', 'lo', 'gli', 'uno',
  'der', 'die', 'das', 'ein', 'eine',
]);

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\p{P}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drops one leading article when a word follows it; a lone article is kept. */
export function stripLeadingArticle(normalized: string): string {
  const tokens = normalized.split(' ');
  if (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0])) return tokens.slice(1).join(' ');
  return normalized;
}

/** True when the normalized text is a single article and nothing else. */
export function isLoneArticle(normalized: string): boolean {
  return LEADING_ARTICLES.has(normalized);
}

/** The key lookups compare on: normalized text with a leading article loosened away. */
export function matchKey(text: string): string {
  return stripLeadingArticle(normalizeText(text));
}
