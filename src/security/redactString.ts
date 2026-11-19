import { SECRET_PATTERNS } from './secretPatterns.js';
import { knownSecretVariants } from './scanForSecrets.js';

const REDACTED = '<redacted>';
const EMAIL = '<email>';

/** Masks known secrets, secret-looking patterns and e-mail addresses in free text. */
export function redactString(text: string, knownSecrets: readonly string[]): string {
  const withoutSecrets = redactKnownSecrets(text, knownSecrets);
  return SECRET_PATTERNS.reduce(
    (current, { kind, regex }) => current.replace(regex, kind === 'email' ? EMAIL : REDACTED),
    withoutSecrets,
  );
}

function redactKnownSecrets(text: string, knownSecrets: readonly string[]): string {
  const longestFirst = knownSecretVariants(knownSecrets).sort((a, b) => b.length - a.length);
  return longestFirst.reduce((current, variant) => current.split(variant).join(REDACTED), text);
}
