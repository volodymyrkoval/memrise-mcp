/**
 * Side effects of `export`: build the document, log its warnings to stderr, then write the file in
 * one atomic step. A failure before the write leaves nothing at `out`.
 */
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { App } from '../app/buildApp.js';
import { UserMessageError } from '../errors.js';
import { writeFileAtomic } from '../fs/atomicWriteFile.js';
import { buildExportDocument, type ExportDocument, type ExportOptions } from './exportDocument.js';

/** The file owner only: the export holds the learner's data. Windows ignores the mode without failing. */
const FILE_MODE = 0o600;

export interface RunExportOptions extends ExportOptions {
  out: string;
}

/**
 * Throws when the document cannot be built (login, network) or the file cannot be written. Either
 * way nothing partial is left at `out`.
 */
export async function runExport(
  app: Pick<App, 'queries' | 'logger'>,
  options: RunExportOptions,
  now: () => number,
): Promise<void> {
  await assertParentDirectory(options.out);
  const doc = await buildExportDocument(app.queries, options, now);
  logWarnings(app, doc);
  await writeExport(options.out, doc);
}

/** Nothing is left at `out` on failure: `writeFileAtomic` removes its temp file and never renames it in. */
async function writeExport(out: string, doc: ExportDocument): Promise<void> {
  try {
    await writeFileAtomic(out, `${JSON.stringify(doc, null, 2)}\n`, FILE_MODE);
  } catch (err) {
    throw new UserMessageError(`cannot write the export file ${out}: ${errorCode(err)}`);
  }
}

function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? 'unknown error';
}

function logWarnings(app: Pick<App, 'logger'>, doc: ExportDocument): void {
  for (const warning of doc.warnings ?? []) app.logger.warn(warning);
}

/** Checked before any fetch, so a mistyped --out fails at once instead of after a slow walk. */
async function assertParentDirectory(out: string): Promise<void> {
  const dir = dirname(out);
  const info = await stat(dir).catch(() => null);
  if (info === null || !info.isDirectory()) {
    throw new UserMessageError(`cannot write the export file: ${dir} is missing or not a directory`);
  }
}
