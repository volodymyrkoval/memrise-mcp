/** Paging protocols for the Memrise list endpoints: token-based (learnables) and offset-based (scenarios). */

export interface TokenPage<T> {
  items: T[];
  nextPageToken: string | null;
}

export type TokenStopReason = 'repeated_token' | 'page_cap';

export interface TokenPageOptions {
  /** Stop after this many items; the page that crosses it is truncated and no further page is requested. */
  maxItems?: number;
  /** Ceiling on pages requested, so a server that never runs out cannot keep us paging. */
  maxPages?: number;
  /** Called when collection stops early because of a repeated token or the page cap; not called on normal completion. */
  onStop?: (reason: TokenStopReason) => void;
}

const DEFAULT_MAX_PAGES = 1000;

/**
 * Collects the items of a token-paginated list, following `nextPageToken` until it is empty.
 * A token the server has already issued ends the walk: a server that loops must not loop us.
 */
export async function collectTokenPages<T>(
  fetchPage: (token: string | null) => Promise<TokenPage<T>>,
  options: TokenPageOptions = {},
): Promise<T[]> {
  const { maxItems = Infinity, maxPages = DEFAULT_MAX_PAGES, onStop } = options;
  const items: T[] = [];
  const issued = new Set<string>();
  let token: string | null = null;
  for (let pages = 1; ; pages += 1) {
    const page = await fetchPage(token);
    items.push(...page.items.slice(0, maxItems - items.length));
    const next = page.nextPageToken;
    if (!next || items.length >= maxItems) return items;
    if (issued.has(next)) {
      onStop?.('repeated_token');
      return items;
    }
    if (pages >= maxPages) {
      onStop?.('page_cap');
      return items;
    }
    issued.add(next);
    token = next;
  }
}

/** One offset page: `hasMore` is the server's own flag, not a count comparison. */
export interface OffsetPage<T> {
  items: T[];
  hasMore: boolean;
}

/**
 * Collects the items of an offset-paginated list, advancing by the count each page actually returned.
 * An empty page ends the walk even if the server says more follow: advancing by zero would loop forever.
 */
export async function collectOffsetPages<T>(fetchPage: (offset: number) => Promise<OffsetPage<T>>): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset);
    items.push(...page.items);
    if (!page.hasMore || page.items.length === 0) return items;
    offset += page.items.length;
  }
}
