import type { ProbeHttp } from './probeHttp.js';
import { summarizeShape } from './shape.js';

const CANDIDATE_PATHS = [
  '/v1.25/me/language_pairs/',
  '/v1.25/me/language_pairs',
  '/v1.25/me/',
  '/v1.25/language_pairs/',
  '/v1.25/me/courses/',
  '/v1.25/me/languages/',
];
const ID_KEYS = ['id', 'language_pair_id', 'pair_id'];
const NAME_KEYS = ['name', 'title', 'label'];
const SOURCE_KEYS = ['source_language', 'source_language_name', 'source', 'from_language'];
const TARGET_KEYS = ['target_language', 'target_language_name', 'target', 'to_language'];
const MAX_DEPTH = 4;

export interface LanguagePair {
  id: number;
  name: string;
}

export interface PairsFinding {
  path: string;
  status: number;
  listsPairs: boolean;
  pairs: LanguagePair[];
  /** Key names and value types of the response; the ground truth when the parser finds nothing. */
  shape: string;
}

/** Tries each candidate endpoint and records which one lists language pairs with id and name. */
export async function probePairs(http: ProbeHttp): Promise<PairsFinding[]> {
  const findings: PairsFinding[] = [];
  for (const path of CANDIDATE_PATHS) {
    const response = await http.get(`pairs ${path}`, path);
    const pairs = response.status === 200 ? findPairs(response.body, 0) : [];
    findings.push({ path, status: response.status, listsPairs: pairs.length > 0, pairs, shape: summarizeShape(response.body) });
  }
  return findings;
}

function findPairs(node: unknown, depth: number): LanguagePair[] {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) {
    const pairs = node.flatMap((item) => toPair(item) ?? []);
    return pairs.length > 0 ? pairs : node.flatMap((item) => findPairs(item, depth + 1));
  }
  for (const child of Object.values(node)) {
    const pairs = findPairs(child, depth + 1);
    if (pairs.length > 0) return pairs;
  }
  return [];
}

function toPair(item: unknown): LanguagePair | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  const record = item as Record<string, unknown>;
  const id = ID_KEYS.map((key) => record[key]).find((value) => typeof value === 'number');
  const name = pairName(record);
  return typeof id === 'number' && name !== undefined ? { id, name } : undefined;
}

function pairName(record: Record<string, unknown>): string | undefined {
  const direct = NAME_KEYS.map((key) => record[key]).find((value) => typeof value === 'string');
  if (typeof direct === 'string') return direct;
  const source = languageName(record, SOURCE_KEYS);
  const target = languageName(record, TARGET_KEYS);
  return source !== undefined && target !== undefined ? `${source} to ${target}` : undefined;
}

function languageName(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    const nested = (value as { name?: unknown } | null | undefined)?.name;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}
