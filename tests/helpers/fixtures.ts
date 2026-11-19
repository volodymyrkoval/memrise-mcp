/**
 * Test helper that loads sanitized API fixtures from `tests/fixtures/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

/** Reads and JSON-parses `tests/fixtures/<name>`. The caller supplies the expected shape. */
export function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}
