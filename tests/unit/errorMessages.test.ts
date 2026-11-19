import { describe, expect, it } from 'vitest';
import { formatUserMessage } from '../../src/errorMessages.js';
import {
  AuthError,
  ConfigError,
  HttpStatusError,
  MalformedResponseError,
  NetworkError,
  NotFoundError,
  PacerLockTimeoutError,
  RateLimitedError,
  UsageError,
  UserMessageError,
} from '../../src/errors.js';
import { Redactor } from '../../src/log/redactor.js';
import { runtimeSecret } from '../helpers/runtimeSecret.js';

const redactor = new Redactor();
const format = (err: unknown) => formatUserMessage(err, redactor);

describe('formatUserMessage', () => {
  it('names the lesson id and where lesson ids come from when a lesson is not found', () => {
    expect(format(new NotFoundError('scenario_details', 999999999))).toBe(
      'No lesson with id 999999999. Lesson ids come from scenarios_list.',
    );
  });

  it('falls back to a plain not-found sentence when the id is unknown', () => {
    expect(format(new NotFoundError('scenario_details'))).toBe('Memrise could not find a lesson.');
  });

  it.each([
    ['learnables_page', 'your words'],
    ['scenarios_page', 'your lessons'],
    ['scenario_details', 'a lesson'],
    ['language_pairs', 'your language pairs'],
    ['something_else', 'your data'],
  ])('says a server problem while reading %s in terms of %s, with the status and attempts', (label, noun) => {
    expect(format(new HttpStatusError(503, label, 3))).toBe(
      `Memrise had a problem while reading ${noun} (HTTP 503, tried 3 times). Try again in a few minutes.`,
    );
  });

  it('leaves out the attempts when the request was not retried', () => {
    expect(format(new HttpStatusError(500, 'learnables_page'))).toBe(
      'Memrise had a problem while reading your words (HTTP 500). Try again in a few minutes.',
    );
  });

  it.each([
    ['learnables_page', 'your words'],
    ['scenarios_page', 'your lessons'],
    ['language_pairs', 'your language pairs'],
  ])('points at MEMRISE_LANGUAGE_PAIR_ID on a 404 while reading %s', (label, noun) => {
    expect(format(new HttpStatusError(404, label))).toBe(
      `Memrise could not find ${noun} (HTTP 404). If MEMRISE_LANGUAGE_PAIR_ID is set, check it with language_pairs_list.`,
    );
  });

  it('says a 404 for a lesson without the language pair hint', () => {
    expect(format(new HttpStatusError(404, 'scenario_details'))).toBe('Memrise could not find a lesson (HTTP 404).');
  });

  it('asks for a connection check when Memrise cannot be reached', () => {
    expect(format(new NetworkError('learnables_page', 3))).toBe(
      'Could not reach Memrise while reading your words (tried 3 times). Check the internet connection and try again.',
    );
  });

  it('says Memrise may have changed when an answer has an unexpected format', () => {
    expect(format(new MalformedResponseError('scenarios_page'))).toBe(
      'Memrise answered in an unexpected format while reading your lessons. Memrise may have changed its website; please report this.',
    );
  });

  it('gives a UTC time to retry after rate limiting', () => {
    expect(format(new RateLimitedError(Date.parse('2026-01-01T00:01:00.000Z')))).toBe(
      'Memrise asked us to slow down. Try again after 2026-01-01T00:01:00Z.',
    );
  });

  it('asks the user to wait when another process holds the request lock', () => {
    expect(format(new PacerLockTimeoutError())).toBe(
      'Another memrise-mcp process is still talking to Memrise. Try again in a minute.',
    );
  });

  describe('login failures', () => {
    const CREDENTIALS =
      'Could not sign in to Memrise. Check MEMRISE_USERNAME and MEMRISE_PASSWORD in your client settings.';

    it.each([
      ['a rejected login', new AuthError('access_token', 'HTTP 400', { cause: new HttpStatusError(400, 'access_token') })],
      ['a missing csrf cookie', new AuthError('csrf', 'csrftoken cookie missing')],
      ['a csrf step answered 403', new AuthError('csrf', 'HTTP 403', { cause: new HttpStatusError(403, 'csrf') })],
    ])('sends the user to the credentials for %s', (_name, err) => {
      expect(format(err)).toBe(CREDENTIALS);
    });

    it('says to try later when Memrise had a server problem during login', () => {
      const cause = new HttpStatusError(503, 'access_token', 3);

      expect(format(new AuthError('access_token', 'HTTP 503', { cause }))).toBe(
        'Could not sign in to Memrise right now (HTTP 503). Try again later.',
      );
    });

    it('says to try later when Memrise could not be reached during login', () => {
      const cause = new NetworkError('csrf', 3);

      expect(format(new AuthError('csrf', 'network error', { cause }))).toBe(
        'Could not sign in to Memrise right now (network error). Try again later.',
      );
    });

    it('says Memrise may have changed when the login answer has an unexpected format', () => {
      expect(format(new AuthError('access_token', 'malformed response'))).toBe(
        'Memrise answered in an unexpected format while signing in. Memrise may have changed its website; please report this.',
      );
    });

    it('says the session keeps ending at the re-login cap', () => {
      expect(format(new AuthError('relogin_cap', 're-login limit of 3 reached'))).toBe(
        'Memrise keeps ending the session. Try again later.',
      );
    });

    it('says access was refused even after signing in again, with the status', () => {
      const cause = new HttpStatusError(403, 'learnables_page');

      expect(format(new AuthError('data_request_after_relogin', 'HTTP 403', { cause }))).toBe(
        'Memrise refused access to your data even after signing in again (HTTP 403).',
      );
    });
  });

  describe('configuration and usage', () => {
    it('shows a message that is already written for the user as it is', () => {
      expect(format(new UserMessageError('cannot write the export file: some-folder is missing or not a directory'))).toBe(
        'cannot write the export file: some-folder is missing or not a directory',
      );
    });

    it('explains missing credentials as not set up yet', () => {
      expect(format(new ConfigError('MEMRISE_USERNAME and MEMRISE_PASSWORD must be set'))).toBe(
        'Not set up yet: MEMRISE_USERNAME and MEMRISE_PASSWORD must be set in your client settings.',
      );
    });

    it('leaves other configuration errors as they are', () => {
      expect(format(new ConfigError('MEMRISE_CACHE_DIR must be an absolute path'))).toBe(
        'MEMRISE_CACHE_DIR must be an absolute path',
      );
    });

    it('passes a usage error through, since its text is already for the learner', () => {
      expect(format(new UsageError('min_growth_level (5) is greater than max_growth_level (2).'))).toBe(
        'min_growth_level (5) is greater than max_growth_level (2).',
      );
    });
  });

  describe('unexpected errors', () => {
    it('gives a generic sentence for an unknown error and keeps its message out of the output', () => {
      expect(format(new TypeError('cannot read properties of undefined'))).toBe(
        'Something unexpected went wrong. Run with MEMRISE_DEBUG=1 to see details.',
      );
    });

    it('gives the same sentence for a thrown value that is not an Error', () => {
      expect(format('boom')).toBe('Something unexpected went wrong. Run with MEMRISE_DEBUG=1 to see details.');
    });

    it('sends the raw, redacted message to the debug log only', () => {
      const password = runtimeSecret('pw');
      const withSecret = new Redactor();
      withSecret.addSecret(password);
      const logged: string[] = [];

      const message = formatUserMessage(new TypeError(`failed for ${password}`), withSecret, { debug: (line) => logged.push(line) });

      expect(message).not.toContain('failed');
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('failed for <redacted>');
      expect(logged[0]).not.toContain(password);
    });
  });

  describe('secrets', () => {
    it('still masks a secret that a usage error echoes from the caller input', () => {
      const password = runtimeSecret('pw');
      const withSecret = new Redactor();
      withSecret.addSecret(password);

      const message = formatUserMessage(new UsageError(`due_before "${password}" is not a date.`), withSecret);

      expect(message).toBe('due_before "<redacted>" is not a date.');
    });

    it('never shows a URL query, a token or a login detail from the error chain', () => {
      const token = runtimeSecret('token');
      const cause = new HttpStatusError(401, `access_token?token=${token}`);
      const err = new AuthError('access_token', `HTTP 401 ${token}`, { cause });

      expect(format(err)).not.toContain(token);
      expect(format(err)).not.toContain('?');
    });
  });
});
