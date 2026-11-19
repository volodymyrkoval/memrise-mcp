/**
 * Live smoke test: logs in, reads one page of words and one completed lesson, and prints counts
 * only. Skipped when both credentials are unset, so `npm run smoke` is safe in CI and offline.
 */
import { pathToFileURL } from 'node:url';
import { buildApp, type App } from '../src/app/buildApp.js';
import { formatUserMessage } from '../src/errorMessages.js';
import { UserMessageError } from '../src/errors.js';
import { Redactor } from '../src/log/redactor.js';

/** Seams for tests; production leaves them unset and gets `process.env`, `buildApp` and the console. */
export interface SmokeDeps {
  env: Readonly<Record<string, string | undefined>>;
  createApp: (env: Readonly<Record<string, string | undefined>>) => App;
  out: (line: string) => void;
  err: (line: string) => void;
}

const SKIP_LINE = 'smoke skipped: MEMRISE_USERNAME/MEMRISE_PASSWORD not set';
/** One words page: the largest page the learnables endpoint returns. */
const WORDS_SAMPLE = 50;

/** Resolves to the exit code. Errors are printed as one redacted line on stderr, never as a stack. */
export async function main(deps: Partial<SmokeDeps> = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));
  if (!isSet(env.MEMRISE_USERNAME) && !isSet(env.MEMRISE_PASSWORD)) {
    out(SKIP_LINE);
    return 0;
  }
  const createApp = deps.createApp ?? ((appEnv) => buildApp({ env: appEnv }));
  let redactor = redactorWithCredentials(env);
  try {
    const app = createApp(env);
    redactor = app.redactor;
    out(await sampleCounts(app));
    return 0;
  } catch (error) {
    err(`smoke failed: ${formatUserMessage(error, redactor)}`);
    return 1;
  }
}

/** Counts only: the words sample and the first completed lesson's item count. */
async function sampleCounts(app: App): Promise<string> {
  const pairId = await app.queries.pairId();
  const words = await app.api.listLearnables(pairId, 'any', { maxItems: WORDS_SAMPLE });
  const lesson = await firstCompletedLesson(app, pairId);
  const details = await app.api.fetchScenarioDetails(lesson.id);
  return `words page: ${words.length}, lesson items: ${details.learnables.length}`;
}

async function firstCompletedLesson(app: App, pairId: number) {
  const [first] = await app.api.listScenarios(pairId, 'completed');
  if (first === undefined) throw new UserMessageError('no completed lesson to sample');
  return first;
}

/** Until the app exists, failures are redacted with the credentials from the environment alone. */
function redactorWithCredentials(env: Readonly<Record<string, string | undefined>>): Redactor {
  const redactor = new Redactor();
  for (const value of [env.MEMRISE_USERNAME, env.MEMRISE_PASSWORD]) {
    if (isSet(value)) redactor.addSecret(value);
  }
  return redactor;
}

/** Blank counts as unset, matching how the config reads the same variables. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  process.exitCode = await main();
}
