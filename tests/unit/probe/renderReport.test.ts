import { describe, expect, it } from 'vitest';
import { renderReport, type ProbeFindings } from '../../../scripts/probe/renderReport.js';

const SECTIONS = [
  'Headless login',
  'Auth mode',
  'Learning states',
  'Language pairs',
  'Scenario types',
  'Id match',
  'Pagination',
  'Headers',
  'Recommendations',
];

const full: ProbeFindings = {
  failures: [],
  pairId: 7,
  login: {
    csrfSource: 'ensure_csrf',
    csrfStatuses: { ensure_csrf: 200 },
    accessTokenStatus: 200,
    bearerOnDataStatus: 401,
    webSessionStatus: 200,
    cookieNames: ['csrftoken', 'sessionid_2'],
    cookieMaxAge: { csrftoken: 31449600, sessionid_2: 31557600 },
    cookiesOnDataStatus: 200,
    expiresIn: 3600,
    bearerChecks: [
      { endpoint: 'learnables list', variant: 'no cookies', status: 401 },
      { endpoint: 'scenarios list', variant: 'no cookies', status: 401 },
      { endpoint: 'scenario details', variant: 'no cookies', status: 401 },
      { endpoint: 'learnables list', variant: 'csrf only', status: 200 },
      { endpoint: 'scenarios list', variant: 'csrf only', status: 200 },
      { endpoint: 'scenario details', variant: 'csrf only', status: 404 },
    ],
  },
  pairs: [
    { path: '/v1.25/me/language_pairs/', status: 200, listsPairs: true, pairs: [{ id: 7, name: 'Alpha to Beta' }], shape: '{ language_pairs: array[1] of {id, name} }' },
    { path: '/v1.25/me/', status: 200, listsPairs: false, pairs: [], shape: '{ user: object{id}, flag: boolean }' },
  ],
  states: {
    states: [
      { state: 'FULLY_LEARNED_OR_KNOWN', status: 200, count: 50, hasNextPage: true },
      { state: 'SEEN', status: 200, count: 12, hasNextPage: false },
      { state: null, status: 200, count: 50, hasNextPage: true },
      { state: 'INVALID_PROBE_VALUE', status: 400, errorBody: { learning_state: ['allowed: A, B'] } },
    ],
    pageSizes: [
      { pageSize: 50, status: 200, count: 50 },
      { pageSize: 100, status: 400, errorBody: { page_size: ['too big'] } },
    ],
  },
  scenarios: {
    types: [
      { type: 'completed', status: 200, count: 5, total: 40, hasMore: true },
      { type: 'invalid_probe_value', status: 400, errorBody: { detail: 'bad' } },
    ],
    immerse: [
      { value: 'true', status: 200, total: 40 },
      { value: 'false', status: 200, total: 80 },
      { value: null, status: 200, total: 90 },
    ],
    limits: [
      { limit: 20, status: 200, count: 20 },
      { limit: 50, status: 400, errorBody: { limit: ['max 20'] } },
    ],
  },
  idMatch: {
    walk: { pages: 3, total: 120, repeatedToken: true, repeatedAtPage: 3, stoppedBy: 'repeat' },
    details: [{ scenarioId: 1001, status: 200, detailIds: 15, matched: 15, unmatched: 0 }],
    sharedDetailIds: [],
    flagCounts: { learned: 100, known: 5, heard: 0, used: 0, difficult: 3, excluded: 0 },
    anyWalk: {
      walk: { pages: 4, total: 150, repeatedToken: false, stoppedBy: 'end' },
      flagCounts: { learned: 100, known: 5, heard: 30, used: 1, difficult: 3, excluded: 2 },
      chosenState: 'FULLY_LEARNED_OR_KNOWN',
      chosenTotal: 120,
      onlyInAny: 30,
      onlyInChosen: 0,
      strictSuperset: true,
    },
  },
};

describe('renderReport', () => {
  it('has every required section, in order', () => {
    const report = renderReport(full);
    const positions = SECTIONS.map((name) => report.indexOf(`## ${name}`));

    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('reports cookie names with lifetimes, never values', () => {
    const report = renderReport(full);

    expect(report).toContain('sessionid_2');
    expect(report).toContain('31557600');
  });

  it('recommends cookies when the Bearer token alone is rejected, and Bearer when accepted', () => {
    expect(renderReport(full)).toMatch(/cookies/i);
    const bearerOk = { ...full, login: { ...full.login!, bearerOnDataStatus: 200 } };
    expect(renderReport(bearerOk)).toMatch(/Bearer token alone works/);
  });

  it('recommends the accepted state with the most items, preferring the omitted parameter on a tie', () => {
    expect(renderReport(full)).toContain('Default `learning_state`: omitted');
  });

  it('notes the repeated pagination token and the has_immerse_content effect', () => {
    const report = renderReport(full);

    expect(report).toMatch(/repeated.*page 3/i);
    expect(report).toMatch(/has_immerse_content.*changes/i);
  });

  it('notes that scenario ids match learnable ids when nothing is unmatched', () => {
    expect(renderReport(full)).toMatch(/learnable_id.*learnable_id_key/);
  });

  it('renders the error body of rejected page sizes and limits', () => {
    const report = renderReport(full);

    expect(report).toContain('- 100: status 400, error {"page_size":["too big"]}');
    expect(report).toContain('- 50: status 400, error {"limit":["max 20"]}');
  });

  it('recommends the largest accepted page size and limit', () => {
    const report = renderReport(full);

    expect(report).toContain('Max learnables page_size: 50');
    expect(report).toContain('Max scenarios limit: 20');
  });

  it('renders the shape summary of every language-pair response', () => {
    const report = renderReport(full);

    expect(report).toContain('shape: `{ language_pairs: array[1] of {id, name} }`');
    expect(report).toContain('shape: `{ user: object{id}, flag: boolean }`');
  });

  it('lists accepted learning_state values with counts and the flag counts of the full walk', () => {
    const report = renderReport(full);

    expect(report).toContain('Accepted learning_state values: FULLY_LEARNED_OR_KNOWN (50), SEEN (12), (omitted) (50)');
    expect(report).toContain('Flags true across the 120 walked learnables: learned 100, known 5, heard 0, used 0, difficult 3, excluded 0');
  });

  it('summarizes how many detail ids were found in the walked learnables and how many are shared between scenarios', () => {
    const report = renderReport({
      ...full,
      idMatch: {
        ...full.idMatch!,
        details: [
          { scenarioId: 1, status: 200, detailIds: 10, matched: 9, unmatched: 1 },
          { scenarioId: 2, status: 200, detailIds: 5, matched: 5, unmatched: 0 },
          { scenarioId: 3, status: 404, detailIds: 0, matched: 0, unmatched: 0 },
        ],
        sharedDetailIds: [7, 8],
      },
    });

    expect(report).toContain('Detail learnable_ids found in the walked learnables: 14 of 15 across 2 scenarios');
    expect(report).toContain('Learnable ids shared by at least two fetched scenarios: 2');
  });

  it('recommends deduplicating by learnable_id when lessons share ids, and says so when none are shared', () => {
    const shared = renderReport({ ...full, idMatch: { ...full.idMatch!, sharedDetailIds: [7, 8] } });
    const none = renderReport(full);

    expect(shared).toMatch(/Ids: 2 learnable ids are shared between lessons; deduplicate by learnable_id/);
    expect(none).toMatch(/Ids: no learnable id was shared between the fetched lessons/);
  });

  it('recommends all accepted learning_state values and points at the shapes when no endpoint listed pairs', () => {
    const report = renderReport(full);
    const noPairs = renderReport({ ...full, pairs: [full.pairs![1]] });

    expect(report).toContain('Accepted `learning_state` values: FULLY_LEARNED_OR_KNOWN, SEEN, (omitted).');
    expect(noPairs).toContain('Language pairs: no endpoint listed pairs; read the response shapes in the Language pairs section');
  });

  it('keeps all sections and marks missing data when steps failed, listing the failures', () => {
    const report = renderReport({ failures: [{ step: 'login', message: 'failed at csrf' }] });

    for (const name of SECTIONS) expect(report).toContain(`## ${name}`);
    expect(report).toContain('login: failed at csrf');
    expect(report).toContain('not run');
  });

  describe('ANY walk', () => {
    const withAny = (anyWalk: Partial<NonNullable<ProbeFindings['idMatch']>['anyWalk']>) =>
      renderReport({ ...full, idMatch: { ...full.idMatch!, anyWalk: { ...full.idMatch!.anyWalk!, ...anyWalk } } });

    it('reports both totals, superset verdict, id differences and the ANY flag counts', () => {
      const report = renderReport(full);

      expect(report).toContain('Walk totals: ANY 150 items (4 pages, stopped by end); FULLY_LEARNED_OR_KNOWN 120 items');
      expect(report).toContain('ANY is a strict superset of FULLY_LEARNED_OR_KNOWN: yes; ids only in ANY: 30; ids only in FULLY_LEARNED_OR_KNOWN: 0');
      expect(report).toContain('Flags true across the 150 learnables of the ANY walk: learned 100, known 5, heard 30, used 1, difficult 3, excluded 2');
    });

    it('recommends ANY as the default for everything met when it is a strict superset', () => {
      expect(renderReport(full)).toContain('Everything met: use `learning_state=ANY` as the default (150 items vs 120');
    });

    it('recommends the chosen state when ANY returns the same ids', () => {
      const report = withAny({ strictSuperset: false, onlyInAny: 0, chosenTotal: 150 });

      expect(report).toContain('Everything met: ANY and FULLY_LEARNED_OR_KNOWN return the same ids; either works');
    });

    it('warns when ANY lacks ids the chosen state has', () => {
      const report = withAny({ strictSuperset: false, onlyInChosen: 4 });

      expect(report).toContain('Everything met: ANY is not a superset (4 ids only in FULLY_LEARNED_OR_KNOWN); union both walks');
    });

    it('omits the ANY lines when no ANY walk was made', () => {
      const report = renderReport({ ...full, idMatch: { ...full.idMatch!, anyWalk: undefined } });

      expect(report).not.toContain('Everything met');
      expect(report).not.toContain('Walk totals');
    });
  });

  describe('Auth mode bearer coverage', () => {
    it('renders a table of Bearer-only statuses per endpoint and cookie variant, before any session exists', () => {
      const report = renderReport(full);

      expect(report).toContain('Bearer-only requests (taken before /auth/web, so no session cookie exists):');
      expect(report).toContain('| endpoint | bearer with no cookies at all | bearer + csrf only |');
      expect(report).toContain('| learnables list | 401 | 200 |');
      expect(report).toContain('| scenarios list | 401 | 200 |');
      expect(report).toContain('| scenario details | 401 | 404 |');
    });

    it('reports the access token expires_in as a number, and says so when it is absent', () => {
      expect(renderReport(full)).toContain('- Access token expires_in: 3600');
      const absent = renderReport({ ...full, login: { ...full.login!, expiresIn: undefined } });

      expect(absent).toContain('- Access token expires_in: not reported');
    });

    it('omits the table when no bearer checks ran', () => {
      const report = renderReport({ ...full, login: { ...full.login!, bearerChecks: undefined } });

      expect(report).not.toContain('Bearer-only requests');
    });
  });
});
