/**
 * The one place that turns an error into the sentence a learner (or Claude) reads, for tool results
 * and the CLI. Messages say what happened and what to do, and never carry a credential, token or
 * URL query: they are built from the error's kind and numbers, not from its raw text. The redactor
 * still runs last, because usage errors echo the caller's own input.
 */
import {
  AuthError,
  ConfigError,
  HttpStatusError,
  MalformedResponseError,
  MISSING_CREDENTIALS_MESSAGE,
  NetworkError,
  NotFoundError,
  PacerLockTimeoutError,
  RateLimitedError,
  UsageError,
  UserMessageError,
  utcSeconds,
} from './errors.js';

/** Structural ports so this module does not depend on the logging layer; `Redactor` and `Logger` satisfy them. */
interface TextRedactor {
  redact(text: string): string;
  redactError?(err: unknown): string;
}

export interface DebugSink {
  debug(line: string): void;
}

const UNEXPECTED = 'Something unexpected went wrong. Run with MEMRISE_DEBUG=1 to see details.';
const LIST_LABELS = new Set(['language_pairs', 'learnables_page', 'scenarios_page']);
const NOUNS: Readonly<Record<string, string>> = {
  language_pairs: 'your language pairs',
  learnables_page: 'your words',
  scenarios_page: 'your lessons',
  scenario_details: 'a lesson',
};

interface Rule {
  matches(err: unknown): boolean;
  format(err: unknown): string;
}

/** Pairs an error class with its formatter; the cast is safe because `format` only runs after `matches`. */
function rule<E extends Error>(errorClass: abstract new (...args: never[]) => E, format: (err: E) => string): Rule {
  return { matches: (err) => err instanceof errorClass, format: (err) => format(err as E) };
}

const RULES: readonly Rule[] = [
  rule(NotFoundError, notFound),
  rule(HttpStatusError, httpStatus),
  rule(NetworkError, network),
  rule(MalformedResponseError, malformed),
  rule(RateLimitedError, (err) => `Memrise asked us to slow down. Try again after ${utcSeconds(err.until)}.`),
  rule(PacerLockTimeoutError, () => 'Another memrise-mcp process is still talking to Memrise. Try again in a minute.'),
  rule(AuthError, auth),
  rule(ConfigError, config),
  rule(UsageError, (err) => err.message),
  rule(UserMessageError, (err) => err.message),
];

/**
 * One learner-readable message, with secrets masked. An error this module does not know gets a
 * generic sentence; its own text goes only to `debug` (a no-op unless debugging is on).
 */
export function formatUserMessage(err: unknown, redactor: TextRedactor, debug?: DebugSink): string {
  const matching = RULES.find((candidate) => candidate.matches(err));
  if (matching === undefined) {
    debug?.debug(`unexpected error: ${describeUnexpected(err, redactor)}`);
    return UNEXPECTED;
  }
  return redactor.redact(matching.format(err));
}

function describeUnexpected(err: unknown, redactor: TextRedactor): string {
  if (redactor.redactError !== undefined) return redactor.redactError(err);
  return redactor.redact(err instanceof Error ? err.message : String(err));
}

function learnerNoun(label: string): string {
  return NOUNS[label] ?? 'your data';
}

function notFound(err: NotFoundError): string {
  if (err.label === 'scenario_details' && err.id !== undefined) {
    return `No lesson with id ${err.id}. Lesson ids come from scenarios_list.`;
  }
  return `Memrise could not find ${learnerNoun(err.label)}.`;
}

function httpStatus(err: HttpStatusError): string {
  const noun = learnerNoun(err.label);
  if (err.status === 404) {
    const hint = LIST_LABELS.has(err.label)
      ? ' If MEMRISE_LANGUAGE_PAIR_ID is set, check it with language_pairs_list.'
      : '';
    return `Memrise could not find ${noun} (HTTP 404).${hint}`;
  }
  const tried = err.attempts === undefined ? '' : `, tried ${err.attempts} times`;
  return `Memrise had a problem while reading ${noun} (HTTP ${err.status}${tried}). Try again in a few minutes.`;
}

function network(err: NetworkError): string {
  return `Could not reach Memrise while reading ${learnerNoun(err.label)} (tried ${err.attempts} times). Check the internet connection and try again.`;
}

function malformed(err: MalformedResponseError): string {
  return `Memrise answered in an unexpected format while reading ${learnerNoun(err.label)}. ${REPORT_CHANGE}`;
}

const REPORT_CHANGE = 'Memrise may have changed its website; please report this.';

function auth(err: AuthError): string {
  if (err.step === 'relogin_cap') return 'Memrise keeps ending the session. Try again later.';
  if (err.step === 'data_request_after_relogin') {
    const status = err.cause instanceof HttpStatusError ? ` (HTTP ${err.cause.status})` : '';
    return `Memrise refused access to your data even after signing in again${status}.`;
  }
  const cause = err.cause;
  if (cause instanceof HttpStatusError && cause.status >= 500) {
    return `Could not sign in to Memrise right now (HTTP ${cause.status}). Try again later.`;
  }
  if (cause instanceof NetworkError) return 'Could not sign in to Memrise right now (network error). Try again later.';
  if (cause instanceof MalformedResponseError || err.detail === 'malformed response') {
    return `Memrise answered in an unexpected format while signing in. ${REPORT_CHANGE}`;
  }
  return 'Could not sign in to Memrise. Check MEMRISE_USERNAME and MEMRISE_PASSWORD in your client settings.';
}

function config(err: ConfigError): string {
  if (err.message === MISSING_CREDENTIALS_MESSAGE) {
    return 'Not set up yet: MEMRISE_USERNAME and MEMRISE_PASSWORD must be set in your client settings.';
  }
  return err.message;
}
