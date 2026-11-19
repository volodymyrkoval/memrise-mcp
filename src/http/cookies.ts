/** Set-Cookie wire format, kept out of the auth layer so it never parses headers itself. */

/** Value of the named cookie from raw `Set-Cookie` lines; attributes are ignored and the last occurrence wins. */
export function readCookie(setCookies: string[], name: string): string | undefined {
  let found: string | undefined;
  for (const line of setCookies) {
    const [pair] = line.split(';');
    // A line without "=" has no value; browsers ignore such cookies too.
    if (!pair.includes('=')) continue;
    const [cookieName, ...valueParts] = pair.split('=');
    if (cookieName.trim() === name) found = valueParts.join('=').trim();
  }
  return found;
}
