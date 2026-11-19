/** Parses JSON text, returning `undefined` instead of throwing. Callers validate the result with zod. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
