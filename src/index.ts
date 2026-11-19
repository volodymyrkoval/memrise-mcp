/**
 * Process entry point for the `memrise-mcp` bin. `main` dispatches on the command line and returns
 * the exit code; it runs only when this file is the process entry, never on import.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { buildApp, type App, type BuildAppOptions } from './app/buildApp.js';
import { parseCommand, USAGE } from './cli/parseCommand.js';
import { VERSION } from './version.js';
import { runExport } from './cli/runExport.js';
import { formatUserMessage, type DebugSink } from './errorMessages.js';
import { UsageError } from './errors.js';
import { Redactor } from './log/redactor.js';
import { createMcpServer } from './mcp/server.js';
import { defineMemriseTools } from './mcp/tools/index.js';

export interface MainDeps {
  /** Replaces the wire, the clock and the sleep for tests; production leaves them unset. */
  transport?: BuildAppOptions['transport'];
  now?: BuildAppOptions['now'];
  sleep?: BuildAppOptions['sleep'];
  newId?: BuildAppOptions['newId'];
  /** Protocol channel for serve mode; defaults to stdin/stdout. */
  serverTransport?: () => Transport;
  /** Diagnostics sink; defaults to stderr. stdout is the MCP protocol and is never written here. */
  stderrWrite?: (line: string) => void;
  /** Output of `--help` and `--version`; defaults to stdout. Serve mode never writes there. */
  stdoutWrite?: (text: string) => void;
}

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

const SERVER_INFO = { name: 'memrise-mcp', version: VERSION };

/** Runs one command line and resolves to its exit code; serve mode resolves only after the client disconnects. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: MainDeps = {},
): Promise<number> {
  const stderrWrite = deps.stderrWrite ?? ((line: string) => process.stderr.write(line));
  let redactor = new Redactor();
  let debug: DebugSink | undefined;
  try {
    const command = parseCommand(argv);
    if (command.kind === 'help' || command.kind === 'version') {
      const stdoutWrite = deps.stdoutWrite ?? ((text: string) => process.stdout.write(text));
      stdoutWrite(command.kind === 'help' ? `${USAGE}\n` : `${VERSION}\n`);
      return EXIT_OK;
    }
    const app = buildApp({
      env,
      transport: deps.transport,
      now: deps.now,
      sleep: deps.sleep,
      newId: deps.newId,
      stderrWrite,
      wordCache: command.kind === 'export' ? 'write-only' : 'read-write',
    });
    redactor = app.redactor;
    debug = app.logger;
    if (command.kind === 'export') {
      await runExport(app, command, deps.now ?? Date.now);
    } else {
      await serve(app, (deps.serverTransport ?? defaultServerTransport)());
    }
    return EXIT_OK;
  } catch (err) {
    stderrWrite(`memrise-mcp: ${formatUserMessage(err, redactor, debug)}\n`);
    return err instanceof UsageError ? EXIT_USAGE : EXIT_FAILURE;
  }
}

function defaultServerTransport(): Transport {
  return new StdioServerTransport();
}

/** Connects the tools and resolves once the transport closes (stdin ends or the client disconnects). */
async function serve(app: App, transport: Transport): Promise<void> {
  const server = createMcpServer(defineMemriseTools(app.queries, app.redactor, app.logger), SERVER_INFO);
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  await server.connect(transport);
  await closed;
}

/**
 * True when `entryArg` (the script the process was started with) is this module. Both sides are
 * resolved through symlinks, so the installed bin (a symlink to dist/index.js) counts.
 */
export function isEntryPoint(entryArg: string | undefined, moduleUrl: string): boolean {
  if (entryArg === undefined) return false;
  try {
    return realpathSync(entryArg) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  });
}
