/**
 * Keeps one item per id, the first occurrence, in the original order. Every list the app returns
 * has one row per learnable, so this runs on each paginated or merged list.
 */
export function uniqueById<T extends { id: number }>(items: readonly T[]): T[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
