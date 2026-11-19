/** Command-line contract: no arguments serves over stdio; `export` writes a snapshot file; `--help` and `--version` print and exit. Every failure is a `UsageError`. */
import { parseArgs } from 'node:util';
import { UsageError } from '../errors.js';
import type { StateKey } from '../domain/types.js';

/** `out` is the file to write; `state` and `includeAudio` mirror the export options. */
export type Command = { kind: 'serve' } | { kind: 'help' } | { kind: 'version' } | { kind: 'export'; out: string; includeAudio: boolean; state: StateKey };

type ExportFlags = { out?: string; state?: string; 'include-audio'?: boolean };

const STATE_KEYS: readonly StateKey[] = ['any', 'fully_learned_or_known'];

/** The usage text, shown by `--help` and appended to every usage error. */
export const USAGE = [
  'usage: memrise-mcp                 (serve the MCP tools over stdio)',
  '       memrise-mcp export --out <file.json> [--state any|fully_learned_or_known] [--include-audio]',
  '       memrise-mcp --help | --version',
].join('\n');

/** Parses `process.argv.slice(2)`; throws `UsageError` (with the usage text) for anything it does not accept. */
export function parseCommand(argv: readonly string[]): Command {
  if (argv.length === 0) return { kind: 'serve' };
  const [subcommand, ...rest] = argv;
  if (argv.length === 1 && ['--help', '-h', 'help'].includes(subcommand!)) return { kind: 'help' };
  if (argv.length === 1 && ['--version', '-v'].includes(subcommand!)) return { kind: 'version' };
  if (subcommand !== 'export') throw usageError(`Unknown command: ${subcommand}`);
  const values = parseExportFlags(rest);
  if (!values.out) throw usageError('--out <file.json> is required for export');
  return {
    kind: 'export',
    out: values.out,
    includeAudio: values['include-audio'] ?? false,
    state: readState(values.state),
  };
}

function parseExportFlags(args: readonly string[]): ExportFlags {
  try {
    return parseArgs({
      args: [...args],
      options: {
        out: { type: 'string' },
        state: { type: 'string' },
        'include-audio': { type: 'boolean' },
      },
      strict: true,
    }).values;
  } catch (err) {
    throw usageError((err as Error).message);
  }
}

function readState(raw: string | undefined): StateKey {
  if (raw === undefined) return 'any';
  const match = STATE_KEYS.find((key) => key === raw);
  if (match === undefined) throw usageError(`Unknown --state value: ${raw}`);
  return match;
}

function usageError(detail: string): UsageError {
  return new UsageError(`${detail}\n${USAGE}`);
}
