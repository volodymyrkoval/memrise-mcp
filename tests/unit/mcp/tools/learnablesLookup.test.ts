import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineLearnablesLookupTool } from '../../../../src/mcp/tools/learnablesLookup.js';
import { createFixtureApp, type FixtureApp } from '../../../helpers/fixtureApp.js';

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-tool-lookup-'));
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

describe('learnables_lookup tool', () => {
  it('reports for each term whether the learner has met it and how it matched', async () => {
    const tool = defineLearnablesLookupTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ terms: ['book', 'key', 'xyzzy'], state: 'any' });

    expect(result.isError).toBeUndefined();
    expect(bodyOf(result)).toMatchObject({
      results: [
        { query: 'book', met: true, match: 'exact' },
        { query: 'key', met: true, match: 'in_sentence' },
        { query: 'xyzzy', met: false, match: 'none' },
      ],
    });
  });

  it('describes every match kind, the translation list, the no-stemming advice and the short-term rule', () => {
    const tool = defineLearnablesLookupTool(harness.app.queries, harness.app.redactor);

    for (const text of [
      "match ('exact', 'in_sentence', 'translation' or 'none')",
      'in_translations',
      "'translation' means only translations matched",
      'No stemming',
      'dictionary form',
      'shorter than 3 characters',
      'lone article',
    ]) {
      expect(tool.description, text).toContain(text);
    }
  });
});
