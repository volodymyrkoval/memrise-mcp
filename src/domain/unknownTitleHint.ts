import { titleMatcher } from './wordFilter.js';

const MAX_NAMES = 30;

/**
 * A hint for a topic or lesson filter that matches none of `titles`, listing what exists; `null`
 * when something matches. `partial` says some lessons could not be read, so the list may be short.
 */
export function unknownTitleHint(
  kind: 'topic' | 'lesson',
  query: string,
  titles: readonly string[],
  partial: boolean,
): string | null {
  if (titles.some(titleMatcher(kind, query))) return null;
  const head = `No ${kind} matches "${query}".`;
  const tail = partial ? ' Some lessons could not be read, so this list may be incomplete.' : '';
  return `${head} ${describeTitles(kind, titles)}${tail}`;
}

function describeTitles(kind: 'topic' | 'lesson', titles: readonly string[]): string {
  const names = [...new Set(titles)].sort((a, b) => a.localeCompare(b, 'en'));
  if (names.length === 0) return `There are no ${kind}s.`;
  const shown = names.slice(0, MAX_NAMES).join(', ');
  const more = names.length > MAX_NAMES ? ` (+${names.length - MAX_NAMES} more)` : '';
  return `${kind === 'topic' ? 'Topics' : 'Lessons'}: ${shown}${more}.`;
}
