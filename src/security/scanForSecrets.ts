import { SECRET_PATTERNS } from './secretPatterns.js';

export interface Finding {
  kind: string;
  line: number;
}

const MIN_LITERAL_LENGTH = 3;

export function scanForSecrets(text: string, knownSecrets: readonly string[]): Finding[] {
  return [...findLiterals(text, knownSecrets), ...findPatterns(text)];
}

/** Every distinct raw, URL-encoded, form-encoded (`+` for space), base64 and JSON-escaped form of each usable secret (>= 3 chars). */
export function knownSecretVariants(secrets: readonly string[]): string[] {
  const usable = secrets.filter((secret) => secret.length >= MIN_LITERAL_LENGTH);
  return [...new Set(usable.flatMap(literalVariants))];
}

function findLiterals(text: string, secrets: readonly string[]): Finding[] {
  return knownSecretVariants(secrets).flatMap((variant) => findOccurrences(text, variant));
}

function literalVariants(secret: string): string[] {
  const jsonEscaped = JSON.stringify(secret).slice(1, -1);
  const urlEncoded = encodeURIComponent(secret);
  const formEncoded = urlEncoded.replaceAll('%20', '+');
  const base64 = Buffer.from(secret).toString('base64');
  return [...new Set([secret, urlEncoded, formEncoded, base64, jsonEscaped])];
}

function findOccurrences(text: string, literal: string): Finding[] {
  const findings: Finding[] = [];
  let index = text.indexOf(literal);
  while (index !== -1) {
    findings.push({ kind: 'known-secret', line: lineOf(text, index) });
    index = text.indexOf(literal, index + literal.length);
  }
  return findings;
}

function findPatterns(text: string): Finding[] {
  return SECRET_PATTERNS.flatMap(({ kind, regex }) =>
    [...text.matchAll(regex)].map((match) => ({ kind, line: lineOf(text, match.index ?? 0) })),
  );
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}
