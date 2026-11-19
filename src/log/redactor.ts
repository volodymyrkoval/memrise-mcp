import { redactString } from '../security/redactString.js';

/** Masks registered secrets and secret-looking text; the only place log and error output is scrubbed. */
export class Redactor {
  readonly #secrets = new Set<string>();

  addSecret(value: string): void {
    this.#secrets.add(value);
  }

  redact(text: string): string {
    return redactString(text, [...this.#secrets]);
  }

  /** Redacted messages of an error and its `cause` chain, outermost first; never throws. */
  redactError(err: unknown): string {
    try {
      return messageChain(err)
        .map((message) => this.redact(message))
        .join(': ');
    } catch {
      return UNDESCRIBABLE;
    }
  }
}

const UNDESCRIBABLE = '<unprintable error>';
const MAX_CHAIN_MESSAGES = 10;

function messageChain(err: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<Error>();
  let current: unknown = err;
  while (current !== undefined && messages.length < MAX_CHAIN_MESSAGES) {
    if (current instanceof Error) {
      if (seen.has(current)) break;
      seen.add(current);
      messages.push(current.message);
      current = current.cause;
    } else {
      messages.push(typeof current === 'string' ? current : typeof current);
      current = undefined;
    }
  }
  return messages;
}
