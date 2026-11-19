import type { ProbeHttp, Query } from './probeHttp.js';

const CANDIDATE_TYPES: ReadonlyArray<string | null> = ['completed', 'in_progress', 'all', 'learning', null, 'invalid_probe_value'];
const IMMERSE_VALUES: ReadonlyArray<string | null> = ['true', 'false', null];
const LIMITS = [5, 6, 10, 20, 25, 30, 50];
const DEFAULT_LIMIT = 5;

export interface ScenarioTypeFinding {
  type: string | null;
  status: number;
  count?: number;
  total?: number;
  hasMore?: boolean;
  errorBody?: unknown;
}

export interface ImmerseFinding {
  value: string | null;
  status: number;
  total?: number;
}

export interface ScenarioLimitFinding {
  limit: number;
  status: number;
  count?: number;
  errorBody?: unknown;
}

export interface ScenariosFindings {
  types: ScenarioTypeFinding[];
  immerse: ImmerseFinding[];
  limits: ScenarioLimitFinding[];
}

interface ScenarioParams {
  type: string | null;
  immerse: string | null;
  limit: number;
}

/** Records how the scenarios endpoint reacts to each `scenario_type`, `has_immerse_content` value and `limit`. */
export async function probeScenarios(http: ProbeHttp, pairId: number): Promise<ScenariosFindings> {
  const path = `/v1.25/me/language_pairs/${pairId}/scenarios/`;
  const types: ScenarioTypeFinding[] = [];
  for (const type of CANDIDATE_TYPES) {
    types.push(await probeType(http, path, type));
  }
  const immerse: ImmerseFinding[] = [];
  for (const value of IMMERSE_VALUES) {
    immerse.push(await probeImmerse(http, path, value));
  }
  const limits: ScenarioLimitFinding[] = [];
  for (const limit of LIMITS) {
    limits.push(await probeLimit(http, path, limit));
  }
  return { types, immerse, limits };
}

async function probeType(http: ProbeHttp, path: string, type: string | null): Promise<ScenarioTypeFinding> {
  const response = await http.get(`scenario_type ${type ?? 'omitted'}`, path, scenarioQuery({ type, immerse: 'true', limit: DEFAULT_LIMIT }));
  if (response.status >= 400 || response.status === 0) {
    return { type, status: response.status, errorBody: response.body };
  }
  return {
    type,
    status: response.status,
    count: scenarioCount(response.body),
    total: totalNumber(response.body),
    hasMore: (response.body as { has_more_pages?: unknown } | null)?.has_more_pages === true,
  };
}

async function probeImmerse(http: ProbeHttp, path: string, value: string | null): Promise<ImmerseFinding> {
  const response = await http.get(`has_immerse_content ${value ?? 'omitted'}`, path, scenarioQuery({ type: 'completed', immerse: value, limit: DEFAULT_LIMIT }));
  return { value, status: response.status, total: totalNumber(response.body) };
}

async function probeLimit(http: ProbeHttp, path: string, limit: number): Promise<ScenarioLimitFinding> {
  const response = await http.get(`limit ${limit}`, path, scenarioQuery({ type: 'completed', immerse: 'true', limit }));
  return response.status === 200
    ? { limit, status: response.status, count: scenarioCount(response.body) }
    : { limit, status: response.status, errorBody: response.body };
}

function scenarioQuery({ type, immerse, limit }: ScenarioParams): Query {
  return {
    ...(type === null ? {} : { scenario_type: type }),
    free_only: 'false',
    ...(immerse === null ? {} : { has_immerse_content: immerse }),
    limit: String(limit),
    offset: '0',
  };
}

function scenarioCount(body: unknown): number | undefined {
  const scenarios = (body as { scenarios?: unknown } | null)?.scenarios;
  return Array.isArray(scenarios) ? scenarios.length : undefined;
}

function totalNumber(body: unknown): number | undefined {
  const total = (body as { total_number?: unknown } | null)?.total_number;
  return typeof total === 'number' ? total : undefined;
}
