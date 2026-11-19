import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { scanForSecrets } from '../src/security/scanForSecrets.js';

export interface MainOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 1024 * 1024;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RESERVED_EXAMPLE_DOMAIN = /@example\.(?:com|org|net)$/i;

/** Scans git-tracked files and returns 0 when clean, 1 when any secret-looking text is found. */
export async function main(options: MainOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const out = options.out ?? ((line: string) => console.log(line));
  const err = options.err ?? ((line: string) => console.error(line));

  const knownSecrets = [env.MEMRISE_USERNAME, env.MEMRISE_PASSWORD].filter((v): v is string => Boolean(v));
  const { fileCount, findings } = await scanTrackedFiles(cwd, knownSecrets);

  if (findings.length === 0) {
    out(`check-secrets: no secrets found in ${fileCount} tracked files`);
    return 0;
  }
  for (const finding of findings) err(finding);
  return 1;
}

async function scanTrackedFiles(
  cwd: string,
  knownSecrets: readonly string[],
): Promise<{ fileCount: number; findings: string[] }> {
  const files = await listTrackedFiles(cwd);
  const findings: string[] = [];

  for (const file of files) {
    const text = await readTextFile(join(cwd, file));
    if (text === null) continue;
    const lines = text.split('\n');
    for (const finding of scanForSecrets(text, knownSecrets)) {
      const line = lines[finding.line - 1];
      if (isPublishedAuthorEmail(file, finding.kind, line)) continue;
      if (finding.kind === 'email' && isOnlyReservedExampleEmails(line)) continue;
      findings.push(`${file}:${finding.line}:${finding.kind}`);
    }
  }
  return { fileCount: files.length, findings };
}

/** The package.json `author` line is public by design; every other e-mail stays a finding. */
function isPublishedAuthorEmail(file: string, kind: string, line: string | undefined): boolean {
  return file === 'package.json' && kind === 'email' && /^\s*"author"\s*:/.test(line ?? '');
}

/** Addresses on the reserved example domains (RFC 2606) are documentation placeholders, never real people. */
function isOnlyReservedExampleEmails(line: string | undefined): boolean {
  const emails = (line ?? '').match(EMAIL_PATTERN) ?? [];
  return emails.length > 0 && emails.every((email) => RESERVED_EXAMPLE_DOMAIN.test(email));
}

async function listTrackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.split('\0').filter(Boolean);
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (info.size > MAX_FILE_BYTES) return null;
    const bytes = await readFile(path);
    if (bytes.includes(0)) return null;
    return bytes.toString('utf8');
  } catch (error) {
    // A file deleted from the working tree is still listed by `git ls-files` until it is removed from the index.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  process.exitCode = await main();
}
