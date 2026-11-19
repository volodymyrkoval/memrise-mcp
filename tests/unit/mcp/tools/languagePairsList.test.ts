import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LearnerQueries } from '../../../../src/app/learnerQueries.js';
import { AuthError } from '../../../../src/errors.js';
import { Redactor } from '../../../../src/log/redactor.js';
import { defineLanguagePairsListTool } from '../../../../src/mcp/tools/languagePairsList.js';
import { createFixtureApp, type FixtureApp } from '../../../helpers/fixtureApp.js';
import { runtimeSecret } from '../../../helpers/runtimeSecret.js';

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-tool-pairs-'));
  harness = createFixtureApp({ cacheDir });
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function bodyOf(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected a text block');
  return JSON.parse(block.text);
}

describe('language_pairs_list tool', () => {
  it('lists the learner language pairs as id, source and target names', async () => {
    const tool = defineLanguagePairsListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({});

    expect(bodyOf(result)).toEqual({
      language_pairs: [{ id: 7, source: 'Alpha', target: 'Beta' }],
    });
  });

  it('says it lists the learner courses and that an id goes into MEMRISE_LANGUAGE_PAIR_ID', () => {
    const tool = defineLanguagePairsListTool(harness.app.queries, harness.app.redactor);

    expect(tool.description).toContain('courses');
    expect(tool.description).toContain('language pairs');
    expect(tool.description).toContain('`id`');
    expect(tool.description).toContain('MEMRISE_LANGUAGE_PAIR_ID');
  });

  it('returns a redacted error result instead of throwing when the lookup fails', async () => {
    const password = runtimeSecret('pw');
    const failing = { listPairs: async () => Promise.reject(new AuthError('access_token', `echoed ${password}`)) };
    const redactor = new Redactor();
    redactor.addSecret(password);
    const tool = defineLanguagePairsListTool(failing as unknown as LearnerQueries, redactor);

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(password);
  });
});
