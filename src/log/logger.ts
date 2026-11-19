import type { Redactor } from './redactor.js';

/** Diagnostics for operators. Lines go to stderr only: stdout carries the MCP protocol. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface StderrLoggerOptions {
  debug: boolean;
  redactor: Redactor;
  write?: (line: string) => void;
  /** Stamps each line; defaults to the system clock. */
  now?: () => number;
}

/** Builds a logger whose every line, timestamp included, passes through the redactor before it is written. */
export function createStderrLogger({ debug, redactor, write = defaultWrite, now = Date.now }: StderrLoggerOptions): Logger {
  const emit = (level: string, msg: string, fields: Record<string, unknown> = {}): void => {
    write(`${redactor.redact(formatLine(now(), level, msg, fields))}\n`);
  };
  return {
    debug: (msg, fields) => {
      if (debug) emit('debug', msg, fields);
    },
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

/** `at` is printed as ISO 8601 UTC with milliseconds, so lines from several processes can be ordered. */
function formatLine(at: number, level: string, msg: string, fields: Record<string, unknown>): string {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`);
  return [`memrise-mcp ${new Date(at).toISOString()} [${level}] ${msg}`, ...pairs].join(' ');
}

function defaultWrite(line: string): void {
  process.stderr.write(line);
}
