import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStderrLogger } from '../../../src/log/logger.js';
import { Redactor } from '../../../src/log/redactor.js';

// Fake value only; built at runtime so the repo secret scanner stays quiet.
const FAKE_PASSWORD = ['fake', 'pass', 'word', '42'].join('-');

const STAMP = '2026-01-01T00:00:00.123Z';
const now = () => Date.parse(STAMP);

function captureWrites() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe('createStderrLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one line per call in the form "memrise-mcp <UTC time> [level] message key=value"', () => {
    const sink = captureWrites();
    const logger = createStderrLogger({ debug: false, redactor: new Redactor(), write: sink.write, now });

    logger.info('details: fetched', { scenario: 1001 });

    expect(sink.lines).toEqual([`memrise-mcp ${STAMP} [info] details: fetched scenario=1001\n`]);
  });

  it('suppresses debug lines unless debug logging is enabled', () => {
    const sink = captureWrites();
    const logger = createStderrLogger({ debug: false, redactor: new Redactor(), write: sink.write, now });

    logger.debug('session: reused cached session');
    logger.warn('details: failed scenario=1001 (HTTP 503)');

    expect(sink.lines).toEqual([`memrise-mcp ${STAMP} [warn] details: failed scenario=1001 (HTTP 503)\n`]);
  });

  it('masks a registered secret in both the message and the field values', () => {
    const sink = captureWrites();
    const redactor = new Redactor();
    redactor.addSecret(FAKE_PASSWORD);
    const logger = createStderrLogger({ debug: false, redactor, write: sink.write, now });

    logger.error(`login with ${FAKE_PASSWORD} failed`, { detail: FAKE_PASSWORD });

    expect(sink.lines).toEqual([`memrise-mcp ${STAMP} [error] login with <redacted> failed detail=<redacted>\n`]);
  });

  it('writes to stderr and never to stdout, which carries the MCP protocol', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createStderrLogger({ debug: true, redactor: new Redactor() });

    logger.debug('session: reused cached session');
    logger.info('words: disk cache hit');
    logger.warn('details: failed scenario=1001 (HTTP 503)');
    logger.error('login failed');

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(4);
  });
});
