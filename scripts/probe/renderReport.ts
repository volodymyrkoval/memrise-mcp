import { MIMICKED_HEADER_NAMES } from './probeHttp.js';
import type { BearerCheck, LoginFindings } from './probeLogin.js';
import type { PairsFinding } from './probePairs.js';
import type { StatesFindings } from './probeStates.js';
import type { ScenariosFindings } from './probeScenarios.js';
import type { AnyWalkFinding, IdMatchFindings } from './probeIdMatch.js';

export interface ProbeFailure {
  step: string;
  message: string;
}

/** Everything the probe learned; any probe may be absent when an earlier step failed. */
export interface ProbeFindings {
  login?: LoginFindings;
  pairs?: PairsFinding[];
  states?: StatesFindings;
  scenarios?: ScenariosFindings;
  idMatch?: IdMatchFindings;
  pairId?: number;
  failures: ProbeFailure[];
}

const NOT_RUN = '_not run (an earlier step failed)_';

/** Renders the markdown report written to `.probe-out/api.md`. Contains statuses, names and counts only. */
export function renderReport(findings: ProbeFindings): string {
  return [
    '# Memrise API discovery findings',
    '',
    failuresBlock(findings.failures),
    section('Headless login', findings.login && loginLines(findings.login)),
    section('Auth mode', findings.login && authLines(findings.login)),
    section('Learning states', findings.states && stateLines(findings.states, findings.idMatch)),
    section('Language pairs', findings.pairs && pairLines(findings.pairs)),
    section('Scenario types', findings.scenarios && scenarioLines(findings.scenarios)),
    section('Id match', findings.idMatch && idMatchLines(findings.idMatch)),
    section('Pagination', paginationLines(findings)),
    section('Headers', headerLines()),
    section('Recommendations', recommendationLines(findings)),
  ].join('\n');
}

function section(title: string, lines: string[] | undefined): string {
  return [`## ${title}`, '', ...(lines ?? [NOT_RUN]), '', ''].join('\n');
}

export function failuresBlock(failures: ProbeFailure[]): string {
  if (failures.length === 0) return '';
  return ['**Partial run. Failed steps:**', '', ...failures.map(({ step, message }) => `- ${step}: ${message}`), '', ''].join('\n');
}

function loginLines(login: LoginFindings): string[] {
  const maxAges = Object.entries(login.cookieMaxAge).map(([name, age]) => `${name} (Max-Age ${age})`);
  return [
    `- CSRF cookie source: ${login.csrfSource} (statuses: ${JSON.stringify(login.csrfStatuses)})`,
    `- Access token request: ${login.accessTokenStatus ?? 'not sent'}`,
    `- Web session request: ${login.webSessionStatus ?? 'not sent'}`,
    `- Cookies set: ${login.cookieNames.join(', ') || 'none'}${maxAges.length > 0 ? `; lifetimes: ${maxAges.join(', ')}` : ''}`,
    `- Failed step: ${login.failedStep ?? 'none'}`,
  ];
}

function authLines(login: LoginFindings): string[] {
  return [
    `- Data endpoint with Bearer token alone: ${login.bearerOnDataStatus ?? 'not tested'}`,
    `- Data endpoint with session cookies: ${login.cookiesOnDataStatus ?? 'not tested'}`,
    `- Access token expires_in: ${login.expiresIn ?? 'not reported'}`,
    ...bearerTable(login.bearerChecks),
  ];
}

function bearerTable(checks: BearerCheck[] | undefined): string[] {
  if (checks === undefined) return [];
  const endpoints = [...new Set(checks.map((c) => c.endpoint))];
  const status = (endpoint: string, variant: string) => checks.find((c) => c.endpoint === endpoint && c.variant === variant)?.status ?? '';
  return [
    '',
    'Bearer-only requests (taken before /auth/web, so no session cookie exists):',
    '',
    '| endpoint | bearer with no cookies at all | bearer + csrf only |',
    '|---|---|---|',
    ...endpoints.map((endpoint) => `| ${endpoint} | ${status(endpoint, 'no cookies')} | ${status(endpoint, 'csrf only')} |`),
  ];
}

function stateLines({ states, pageSizes }: StatesFindings, idMatch: IdMatchFindings | undefined): string[] {
  const accepted = states.filter((s) => s.status === 200).map((s) => `${s.state ?? '(omitted)'} (${s.count ?? '?'})`);
  return [
    '| learning_state | status | first-page count | next page | error body |',
    '|---|---|---|---|---|',
    ...states.map(
      (s) =>
        `| ${s.state ?? '(omitted)'} | ${s.status} | ${s.count ?? ''} | ${s.hasNextPage ?? ''} | ${s.errorBody === undefined ? '' : inline(s.errorBody)} |`,
    ),
    '',
    `Accepted learning_state values: ${accepted.join(', ') || 'none'}`,
    ...(idMatch === undefined ? [] : [flagLine(idMatch)]),
    ...(idMatch?.anyWalk === undefined ? [] : anyWalkLines(idMatch.anyWalk)),
    '',
    'Page sizes (known-good state):',
    ...pageSizes.map((p) => `- ${p.pageSize}: ${outcome(p)}`),
  ];
}

function flagLine({ walk, flagCounts }: IdMatchFindings): string {
  const counts = Object.entries(flagCounts).map(([flag, count]) => `${flag} ${count}`);
  return `Flags true across the ${walk.total} walked learnables: ${counts.join(', ')}`;
}

function anyWalkLines({ walk, flagCounts, chosenState, chosenTotal, onlyInAny, onlyInChosen, strictSuperset }: AnyWalkFinding): string[] {
  const counts = Object.entries(flagCounts).map(([flag, count]) => `${flag} ${count}`);
  return [
    `Walk totals: ANY ${walk.total} items (${walk.pages} pages, stopped by ${walk.stoppedBy}); ${chosenState} ${chosenTotal} items`,
    `ANY is a strict superset of ${chosenState}: ${strictSuperset ? 'yes' : 'no'}; ids only in ANY: ${onlyInAny}; ids only in ${chosenState}: ${onlyInChosen}`,
    `Flags true across the ${walk.total} learnables of the ANY walk: ${counts.join(', ')}`,
  ];
}

function pairLines(pairs: PairsFinding[]): string[] {
  return pairs.flatMap((p) => {
    const listed = p.pairs.map((pair) => `${pair.id} ${pair.name}`).join('; ');
    return [
      `- \`${p.path}\`: status ${p.status}, ${p.listsPairs ? `lists pairs: ${listed}` : 'no pairs listed'}`,
      `  - shape: \`${p.shape}\``,
    ];
  });
}

function scenarioLines({ types, immerse, limits }: ScenariosFindings): string[] {
  return [
    '| scenario_type | status | count | total_number | more pages | error body |',
    '|---|---|---|---|---|---|',
    ...types.map(
      (t) =>
        `| ${t.type ?? '(omitted)'} | ${t.status} | ${t.count ?? ''} | ${t.total ?? ''} | ${t.hasMore ?? ''} | ${t.errorBody === undefined ? '' : inline(t.errorBody)} |`,
    ),
    '',
    '`has_immerse_content` on `completed` (total_number):',
    ...immerse.map((i) => `- ${i.value ?? '(omitted)'}: status ${i.status}, total ${i.total ?? '?'}`),
    '',
    'Limits:',
    ...limits.map((l) => `- ${l.limit}: ${outcome(l)}`),
  ];
}

function idMatchLines({ walk, details, sharedDetailIds }: IdMatchFindings): string[] {
  return [
    ...details.map(
      (d) =>
        `- scenario ${d.scenarioId}: status ${d.status}, ${d.detailIds} detail ids, ${d.matched} found in learnables, ${d.unmatched} not found`,
    ),
    `- Learnables walked: ${walk.total}`,
    detailCoverageLine(details),
    `- Learnable ids shared by at least two fetched scenarios: ${sharedDetailIds.length}`,
  ];
}

function detailCoverageLine(details: IdMatchFindings['details']): string {
  const ok = details.filter((d) => d.status === 200);
  const total = ok.reduce((sum, d) => sum + d.detailIds, 0);
  const matched = ok.reduce((sum, d) => sum + d.matched, 0);
  return `- Detail learnable_ids found in the walked learnables: ${matched} of ${total} across ${ok.length} scenarios`;
}

function paginationLines({ states, scenarios, idMatch }: ProbeFindings): string[] {
  const lines: string[] = [];
  if (idMatch !== undefined) {
    const { walk } = idMatch;
    lines.push(
      `- Learnables walk: ${walk.pages} pages, ${walk.total} items, stopped by ${walk.stoppedBy}`,
      `- Repeated next_page_token: ${walk.repeatedToken ? `yes, at page ${walk.repeatedAtPage}` : 'no'}`,
    );
  }
  if (states !== undefined) lines.push(...states.pageSizes.map((p) => `- learnables page_size ${p.pageSize}: ${outcome(p)}`));
  if (scenarios !== undefined) lines.push(...scenarios.limits.map((l) => `- scenarios limit ${l.limit}: ${outcome(l)}`));
  return lines.length > 0 ? lines : [NOT_RUN];
}

function headerLines(): string[] {
  return [
    `Sent on every request: ${MIMICKED_HEADER_NAMES.map((name) => `\`${name}\``).join(', ')}.`,
    'Cookies are sent as a `cookie` header once set; `x-csrftoken` mirrors the `csrftoken` cookie.',
  ];
}

function recommendationLines(findings: ProbeFindings): string[] {
  const lines = [
    authRecommendation(findings.login),
    stateRecommendation(findings.states),
    pairRecommendation(findings.pairs),
    ...scenarioRecommendations(findings.scenarios),
    maxRecommendation('learnables page_size', 'Max', findings.states?.pageSizes.map((p) => ({ value: p.pageSize, status: p.status }))),
    maxRecommendation('scenarios limit', 'Max', findings.scenarios?.limits.map((l) => ({ value: l.limit, status: l.status }))),
    anyRecommendation(findings.idMatch?.anyWalk),
    ...idRecommendations(findings.idMatch),
    ...paginationRecommendations(findings.idMatch),
  ];
  return lines.filter((line): line is string => line !== undefined).map((line) => `- ${line}`);
}

function authRecommendation(login: LoginFindings | undefined): string | undefined {
  if (login === undefined) return undefined;
  if (login.bearerOnDataStatus === 200) return 'Auth: the Bearer token alone works on data endpoints; simpler than cookies, prefer it.';
  if (login.cookiesOnDataStatus === 200) return 'Auth: use the sessionid_2 and csrftoken cookies; the Bearer token alone is not accepted.';
  return 'Auth: neither Bearer nor cookies were confirmed on a data endpoint; investigate.';
}

/** The accepted state with the most first-page items (omitted wins ties); `undefined` when none was accepted. */
export function bestState(states: StatesFindings | undefined): { state: string | null; count: number } | undefined {
  const accepted = states?.states.filter((s) => s.status === 200 && s.count !== undefined) ?? [];
  if (accepted.length === 0) return undefined;
  const most = Math.max(...accepted.map((s) => s.count ?? 0));
  const best = accepted.filter((s) => s.count === most);
  return { state: (best.find((s) => s.state === null) ?? best[0]).state, count: most };
}

function stateRecommendation(states: StatesFindings | undefined): string | undefined {
  const best = bestState(states);
  if (best === undefined) return undefined;
  const accepted = states?.states.filter((s) => s.status === 200).map((s) => s.state ?? '(omitted)');
  return `Default \`learning_state\`: ${best.state ?? 'omitted'} (${best.count} items on the first page). Accepted \`learning_state\` values: ${accepted?.join(', ')}.`;
}

function pairRecommendation(pairs: PairsFinding[] | undefined): string | undefined {
  if (pairs === undefined) return undefined;
  const working = pairs.find((p) => p.listsPairs);
  return working === undefined
    ? 'Language pairs: no endpoint listed pairs; read the response shapes in the Language pairs section to find the id, or set MEMRISE_LANGUAGE_PAIR_ID.'
    : `Language pairs: list them with \`${working.path}\`.`;
}

function scenarioRecommendations(scenarios: ScenariosFindings | undefined): Array<string | undefined> {
  if (scenarios === undefined) return [];
  const accepted = scenarios.types.filter((t) => t.status === 200).map((t) => t.type ?? 'omitted');
  const totals = new Set(scenarios.immerse.map((i) => i.total));
  return [
    `Scenario types accepted: ${accepted.join(', ') || 'none'}.`,
    totals.size > 1
      ? 'has_immerse_content changes total_number; choose the value deliberately.'
      : 'has_immerse_content does not change total_number.',
  ];
}

function anyRecommendation(any: AnyWalkFinding | undefined): string | undefined {
  if (any === undefined) return undefined;
  const { chosenState, chosenTotal, onlyInAny, onlyInChosen, strictSuperset, walk } = any;
  if (strictSuperset) {
    return `Everything met: use \`learning_state=ANY\` as the default (${walk.total} items vs ${chosenTotal} for ${chosenState}; ${onlyInAny} extra ids, none missing).`;
  }
  return onlyInChosen === 0
    ? `Everything met: ANY and ${chosenState} return the same ids; either works, prefer ${chosenState}.`
    : `Everything met: ANY is not a superset (${onlyInChosen} ids only in ${chosenState}); union both walks.`;
}

function idRecommendations(idMatch: IdMatchFindings | undefined): Array<string | undefined> {
  const ok = idMatch?.details.filter((d) => d.status === 200) ?? [];
  if (idMatch === undefined || ok.length === 0) return [];
  const shared = idMatch.sharedDetailIds.length;
  return [
    ok.every((d) => d.unmatched === 0)
      ? 'Ids: scenario details learnable_id equals learnables learnable_id_key; join on it.'
      : 'Ids: some scenario detail learnable_ids were not found in the learnables list; the join is partial.',
    shared > 0
      ? `Ids: ${shared} learnable ids are shared between lessons; deduplicate by learnable_id.`
      : `Ids: no learnable id was shared between the fetched lessons (${ok.length} scenarios).`,
  ];
}

function paginationRecommendations(idMatch: IdMatchFindings | undefined): string[] {
  if (idMatch === undefined) return [];
  return idMatch.walk.repeatedToken
    ? [`Pagination: next_page_token repeated at page ${idMatch.walk.repeatedAtPage}; stop when a token repeats.`]
    : ['Pagination: follow next_page_token until it is absent.'];
}

function outcome({ status, count, errorBody }: { status: number; count?: number; errorBody?: unknown }): string {
  return status === 200 ? `status 200, ${count ?? '?'} items` : `status ${status}, error ${errorBody === undefined ? '(no body)' : inline(errorBody)}`;
}

function maxRecommendation(label: string, prefix: string, probes: Array<{ value: number; status: number }> | undefined): string | undefined {
  const accepted = probes?.filter((p) => p.status === 200).map((p) => p.value) ?? [];
  return accepted.length === 0 ? undefined : `${prefix} ${label}: ${Math.max(...accepted)} (largest accepted of the values tried).`;
}

function inline(value: unknown): string {
  return JSON.stringify(value).replaceAll('|', '\\|');
}
