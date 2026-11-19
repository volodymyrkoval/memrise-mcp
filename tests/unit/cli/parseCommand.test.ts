import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../../src/cli/parseCommand.js';
import { UsageError } from '../../../src/errors.js';

describe('parseCommand', () => {
  it('serves over stdio when no arguments are given', () => {
    expect(parseCommand([])).toEqual({ kind: 'serve' });
  });

  it('exports with the default state and no audio when only --out is given', () => {
    expect(parseCommand(['export', '--out', 'words.json'])).toEqual({
      kind: 'export',
      out: 'words.json',
      state: 'any',
      includeAudio: false,
    });
  });

  it.each([['--help'], ['-h'], ['help']])('shows the usage for %s', (flag) => {
    expect(parseCommand([flag])).toEqual({ kind: 'help' });
  });

  it.each([['--version'], ['-v']])('shows the version for %s', (flag) => {
    expect(parseCommand([flag])).toEqual({ kind: 'version' });
  });

  it('rejects an unknown subcommand with a usage error', () => {
    expect(() => parseCommand(['sync', '--out', 'words.json'])).toThrow(UsageError);
  });

  it('passes a --state value through when it is a known state', () => {
    expect(parseCommand(['export', '--out', 'words.json', '--state', 'fully_learned_or_known'])).toMatchObject({
      state: 'fully_learned_or_known',
    });
  });

  it('rejects a --state value outside the known states with a usage error', () => {
    expect(() => parseCommand(['export', '--out', 'words.json', '--state', 'all'])).toThrow(UsageError);
  });

  it('includes audio when --include-audio is given', () => {
    expect(parseCommand(['export', '--out', 'words.json', '--include-audio'])).toMatchObject({ includeAudio: true });
  });

  it('requires --out for export and names the flag in the usage error', () => {
    expect(() => parseCommand(['export'])).toThrow(UsageError);
    expect(() => parseCommand(['export'])).toThrow(/--out/);
  });

  it('puts the usage line in every usage error message', () => {
    expect(() => parseCommand(['sync'])).toThrow(/memrise-mcp export --out/);
  });

  it('reports an unknown flag as a usage error, not a crash', () => {
    expect(() => parseCommand(['export', '--out', 'words.json', '--verbose'])).toThrow(UsageError);
  });
});
