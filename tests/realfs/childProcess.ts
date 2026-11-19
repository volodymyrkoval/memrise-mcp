/**
 * Starts the scripts in `children/` as separate Node processes, the way two memrise-mcp processes
 * share one cache folder. They run TypeScript through the tsx loader, passed by file URL so it
 * resolves the same on every OS, with no shell in between.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface Finished {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface RunningChild {
  process: ChildProcess;
  /** Resolves once the process has exited and its output is complete. */
  finished: Promise<Finished>;
  /** Resolves with the first stdout line equal to `line`; rejects if the process exits first. */
  waitForLine(line: string): Promise<void>;
}

export function startChild(script: string, args: readonly string[]): RunningChild {
  const scriptPath = fileURLToPath(new URL(`./children/${script}`, import.meta.url));
  const child = spawn(process.execPath, ['--import', TSX_LOADER, scriptPath, ...args], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const finished = new Promise<Finished>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  const waitForLine = (line: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (stdout.split(/\r?\n/).includes(line)) resolve();
      };
      child.stdout.on('data', check);
      check();
      finished.then(({ code }) => reject(new Error(`child exited (${code}) before printing "${line}": ${stderr}`)), reject);
    });
  return { process: child, finished, waitForLine };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
