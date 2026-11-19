import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanForSecrets } from '../../src/security/scanForSecrets.js';
import { ProbeHttp, type TranscriptEntry } from './probeHttp.js';
import { probeIdMatch } from './probeIdMatch.js';
import { probeLogin, type Credentials } from './probeLogin.js';
import { probePairs } from './probePairs.js';
import { probeScenarios } from './probeScenarios.js';
import { probeStates } from './probeStates.js';
import { probeUnlinked, type UnlinkedFindings } from './probeUnlinked.js';
import { renderUnlinkedReport } from './renderUnlinked.js';
import { bestState, renderReport, type ProbeFailure, type ProbeFindings } from './renderReport.js';
import { createSanitizer, type Sanitizer } from './sanitize.js';

const FALLBACK_STATE = 'FULLY_LEARNED_OR_KNOWN';
const MAX_FIXTURE_ITEMS = 10;
const SCENARIO_PAGE_SIZE = 5;
const REPORT_PATH = '.probe-out/api.md';
const UNLINKED_REPORT_PATH = '.probe-out/unlinked.md';
const UNLINKED_CAPTURES_PATH = '.probe-out/unlinked-candidates.json';
/** Git-ignored: raw captured responses (learner content intact, secrets redacted) land here, never in a tracked path. */
const CAPTURE_DIR = '.probe-out';

const USAGE = [
  'Usage: MEMRISE_USERNAME=<e-mail> MEMRISE_PASSWORD=<password> npm run probe',
  'Optional: MEMRISE_LANGUAGE_PAIR_ID=<id> to skip pair discovery.',
  'Optional: --unlinked (after --) runs only the unlinked-words step, which writes .probe-out/unlinked.md.',
  'No request was made.',
].join('\n');

export interface RunProbeOptions {
  env: Record<string, string | undefined>;
  /** Command-line flags; `--unlinked` runs only login, pair discovery and the unlinked-words step. */
  argv?: readonly string[];
  /** Directory the report and the raw captures (both under `.probe-out/`) are written under. */
  outputRoot: string;
  http?: ProbeHttp;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

/** Runs the discovery probe; resolves to the process exit code. */
export async function main(options: RunProbeOptions): Promise<number> {
  const { env, argv = [], outputRoot, http = new ProbeHttp(), log = console.log, error = console.error } = options;
  const creds = readCredentials(env);
  if (creds === undefined) {
    error(USAGE);
    return 1;
  }

  const unlinkedOnly = argv.includes('--unlinked');
  const findings = unlinkedOnly ? await runUnlinkedProbe(http, creds, env) : await runProbes(http, creds, env);
  const secrets = collectKnownSecrets(http, creds);
  const capture = createSanitizer(secrets);
  const report = createSanitizer(secrets, { learnerData: true });
  const files = unlinkedOnly
    ? buildUnlinkedFiles(http.transcript, findings, capture, report)
    : buildFiles(http.transcript, findings, capture, report);

  const paths = await writeFiles(outputRoot, files);
  const leaks = [...(await selfCheck(paths, secrets)), ...(await idRunCheck(paths))];
  if (leaks.length > 0) {
    await Promise.all(paths.map((path) => unlink(path)));
    leaks.forEach((leak) => error(`self-check failed, output deleted: ${leak}`));
    return 1;
  }
  log(`Wrote ${paths.length} files under ${outputRoot}${findings.failures.length > 0 ? ` (${findings.failures.length} failed step(s), see ${unlinkedOnly ? UNLINKED_REPORT_PATH : REPORT_PATH})` : ''}`);
  return 0;
}

function readCredentials(env: RunProbeOptions['env']): Credentials | undefined {
  const username = env.MEMRISE_USERNAME;
  const password = env.MEMRISE_PASSWORD;
  return username && password ? { username, password } : undefined;
}

async function runProbes(http: ProbeHttp, creds: Credentials, env: RunProbeOptions['env']): Promise<ProbeFindings> {
  const findings = await loginAndChoosePair(http, creds, env);
  const { failures, pairId } = findings;
  if (pairId === undefined) return findings;

  findings.states = await step(failures, 'states', () => probeStates(http, pairId));
  findings.scenarios = await step(failures, 'scenarios', async () => {
    const scenarios = await probeScenarios(http, pairId);
    await fetchLastCompletedPage(http, pairId, scenarios.types.find((t) => t.type === 'completed')?.total);
    return scenarios;
  });
  const chosen = bestState(findings.states)?.state;
  findings.idMatch = await step(failures, 'id match', () => probeIdMatch(http, pairId, chosen ?? FALLBACK_STATE));
  return findings;
}

/** Login and language-pair discovery, shared by the full probe and `--unlinked`; `pairId` is set only when both worked. */
async function loginAndChoosePair(http: ProbeHttp, creds: Credentials, env: RunProbeOptions['env']): Promise<ProbeFindings> {
  const findings: ProbeFindings = { failures: [] };
  const { failures } = findings;

  findings.login = await step(failures, 'login', () => probeLogin(http, creds, { pairId: configuredPairId(env) }));
  if (findings.login?.failedStep !== undefined) {
    failures.push({ step: 'login', message: `failed at ${findings.login.failedStep}; later probes skipped` });
    return findings;
  }
  if (findings.login === undefined) return findings;

  findings.pairs = await step(failures, 'pairs', () => probePairs(http));
  const pairId = choosePairId(findings, env, failures);
  if (pairId !== undefined) findings.pairId = pairId;
  return findings;
}

/** Findings of `--unlinked`: the shared login/pair findings plus the unlinked-words step. */
interface UnlinkedRun extends ProbeFindings {
  unlinked?: UnlinkedFindings;
}

async function runUnlinkedProbe(http: ProbeHttp, creds: Credentials, env: RunProbeOptions['env']): Promise<UnlinkedRun> {
  const findings: UnlinkedRun = await loginAndChoosePair(http, creds, env);
  const { pairId } = findings;
  if (pairId !== undefined) findings.unlinked = await step(findings.failures, 'unlinked', () => probeUnlinked(http, pairId));
  return findings;
}

async function step<T>(failures: ProbeFailure[], name: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (cause) {
    failures.push({ step: name, message: cause instanceof Error ? cause.message : 'unknown error' });
    return undefined;
  }
}

function configuredPairId(env: RunProbeOptions['env']): number | undefined {
  const configured = Number(env.MEMRISE_LANGUAGE_PAIR_ID);
  return Number.isInteger(configured) && configured > 0 ? configured : undefined;
}

function choosePairId(findings: ProbeFindings, env: RunProbeOptions['env'], failures: ProbeFailure[]): number | undefined {
  const configured = configuredPairId(env);
  if (configured !== undefined) return configured;
  const listed = findings.pairs?.find((p) => p.listsPairs)?.pairs ?? [];
  if (listed.length === 1) return listed[0].id;
  const reason = listed.length === 0 ? 'no endpoint listed language pairs' : 'several language pairs are listed';
  failures.push({ step: 'pairs', message: `${reason}; set MEMRISE_LANGUAGE_PAIR_ID; later probes skipped` });
  return undefined;
}

async function fetchLastCompletedPage(http: ProbeHttp, pairId: number, total: number | undefined): Promise<void> {
  if (total === undefined || total <= SCENARIO_PAGE_SIZE) return;
  const offset = Math.floor((total - 1) / SCENARIO_PAGE_SIZE) * SCENARIO_PAGE_SIZE;
  await http.get('scenarios completed last page', `/v1.25/me/language_pairs/${pairId}/scenarios/`, {
    scenario_type: 'completed',
    free_only: 'false',
    has_immerse_content: 'true',
    limit: String(SCENARIO_PAGE_SIZE),
    offset: String(offset),
  });
}

function collectKnownSecrets(http: ProbeHttp, creds: Credentials): string[] {
  const grant = http.transcript.find((entry) => entry.label === 'access token')?.body as
    | { access_token?: { access_token?: unknown }; user?: { id?: unknown } }
    | undefined;
  const token = grant?.access_token?.access_token;
  const userId = grant?.user?.id;
  return [
    creds.password,
    creds.username,
    ...http.cookieValues(),
    ...(typeof token === 'string' ? [token] : []),
    ...(userId === undefined || userId === null ? [] : [String(userId)]),
  ];
}

interface OutputFile {
  path: string;
  content: string;
}

/** Captures keep learner content (secrets redacted); the committed report gets placeholders for it. */
function buildFiles(transcript: TranscriptEntry[], findings: ProbeFindings, capture: Sanitizer, report: Sanitizer): OutputFile[] {
  const body = (label: string) => transcript.find((entry) => entry.label === label)?.body;
  const walkPages = transcript.filter((entry) => entry.label.startsWith('walk page '));
  const sharedId = findings.idMatch?.sharedDetailIds[0];
  const pairsPath = findings.pairs?.find((p) => p.listsPairs)?.path;
  const inProgressId = findings.idMatch?.inProgressScenarioId;

  const fixtures: Array<[string, unknown]> = [
    ['language-pairs.json', pairsPath === undefined ? undefined : body(`pairs ${pairsPath}`)],
    ['learnables-page-1.json', walkPages[0]?.body],
    ['learnables-page-2.json', walkPages[1]?.body],
    ['learnables-page-last.json', walkPages.length > 0 ? walkPages.at(-1)?.body : undefined],
    ['learnables-invalid-state.json', body('state INVALID_PROBE_VALUE')],
    ['scenarios-completed-page-1.json', body('scenario_type completed')],
    ['scenarios-completed-page-last.json', body('scenarios completed last page')],
    ['scenarios-in-progress.json', body('scenario_type in_progress')],
    ['scenario-details-1001.json', body('scenario details 1001')],
    ['scenario-details-in-progress.json', inProgressId === undefined ? undefined : body(`scenario details ${inProgressId}`)],
    ['auth-access-token.json', body('access token')],
    ['auth-web.json', body('web session')],
  ];
  const keepShared = new Set(['scenario-details-1001.json', 'scenario-details-in-progress.json']);

  const files: OutputFile[] = fixtures
    .filter(([, content]) => content !== undefined)
    .map(([name, content]) => ({
      path: join(CAPTURE_DIR, name),
      content: `${JSON.stringify(capture.sanitize(trimLists(content, keepShared.has(name) ? sharedId : undefined)), null, 2)}\n`,
    }));
  const publicFindings = report.sanitize(findings) as ProbeFindings;
  files.push({ path: REPORT_PATH, content: `${report.sanitize(renderReport(publicFindings))}\n` });
  return files;
}

/** Only the unlinked report, and the candidate answers as captured (secrets redacted, learner content kept, git-ignored). */
function buildUnlinkedFiles(transcript: TranscriptEntry[], findings: UnlinkedRun, capture: Sanitizer, report: Sanitizer): OutputFile[] {
  const candidates = Object.fromEntries(
    transcript.filter((entry) => entry.label.startsWith('unlinked candidate ')).map((entry) => [entry.label, { status: entry.status, body: entry.body }]),
  );
  return [
    { path: UNLINKED_REPORT_PATH, content: `${report.sanitize(renderUnlinkedReport(findings.unlinked, findings.failures))}\n` },
    { path: UNLINKED_CAPTURES_PATH, content: `${JSON.stringify(capture.sanitize(candidates), null, 2)}\n` },
  ];
}

function trimLists(body: unknown, keepId: number | undefined): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      (key === 'learnables' || key === 'scenarios') && Array.isArray(value) ? trimList(value, keepId) : value,
    ]),
  );
}

function trimList(items: unknown[], keepId: number | undefined): unknown[] {
  const kept = items.slice(0, MAX_FIXTURE_ITEMS);
  if (keepId === undefined || kept.length === items.length) return kept;
  const shared = items.find((item) => (item as { learnable_id?: unknown }).learnable_id === keepId);
  if (shared !== undefined && !kept.includes(shared)) kept[kept.length - 1] = shared;
  return kept;
}

async function writeFiles(root: string, files: OutputFile[]): Promise<string[]> {
  const paths: string[] = [];
  for (const { path, content } of files) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    paths.push(absolute);
  }
  return paths;
}

/** Scans every written file; returns `file:line:kind` strings, never the matched value. */
async function selfCheck(paths: string[], secrets: string[]): Promise<string[]> {
  const leaks: string[] = [];
  for (const path of paths) {
    for (const { kind, line } of scanForSecrets(await readFile(path, 'utf8'), secrets)) {
      leaks.push(`${path}:${line}:${kind}`);
    }
  }
  return leaks;
}

const ID_RUN = /\d{8,}/;

/** The unlinked report holds counts only, so a run of 8+ digits in it is an id that slipped through; returns `file:line:kind`. */
async function idRunCheck(paths: string[]): Promise<string[]> {
  const leaks: string[] = [];
  for (const path of paths.filter((candidate) => candidate.endsWith(basename(UNLINKED_REPORT_PATH)))) {
    (await readFile(path, 'utf8')).split('\n').forEach((text, index) => {
      if (ID_RUN.test(text)) leaks.push(`${path}:${index + 1}:digit run of 8+ characters (possible id in a counts-only report)`);
    });
  }
  return leaks;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main({ env: process.env, argv: process.argv.slice(2), outputRoot: process.cwd() }));
}
