// Global flag so matchAll reports every occurrence. Placeholders such as
// `<redacted>` never match: the value classes exclude `<` and `>`.
export const SECRET_PATTERNS: ReadonlyArray<{ kind: string; regex: RegExp }> = [
  { kind: 'session-cookie', regex: /sessionid_2=[A-Za-z0-9._~%+/-]{4,}/g },
  { kind: 'csrf-cookie', regex: /csrftoken=[A-Za-z0-9._~%+/-]{4,}/g },
  { kind: 'access-token-json', regex: /\\?"access_token\\?"\s*:\s*\\?"[A-Za-z0-9._~%+/=-]{4,}/g },
  { kind: 'bearer-token', regex: /\bBearer\s+[A-Za-z0-9._~%+/=-]{20,}/gi },
  { kind: 'paseto-token', regex: /v4\.local\.[A-Za-z0-9_-]{10,}/g },
  { kind: 'email', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];
