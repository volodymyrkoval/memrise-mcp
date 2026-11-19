import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineLearnablesListTool } from '../../../../src/mcp/tools/learnablesList.js';
import { createFixtureApp, type FixtureApp } from '../../../helpers/fixtureApp.js';

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-tool-learnables-'));
  harness = createFixtureApp({ cacheDir });
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

/** The single text block of a tool result, parsed as JSON. */
function bodyOf(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected a text block');
  return JSON.parse(block.text);
}

describe('learnables_list tool', () => {
  it('returns the learner words cut to the requested limit, with the full count', async () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ state: 'any', limit: 2, include_audio: false });

    expect(result.isError).toBeUndefined();
    expect(bodyOf(result)).toMatchObject({
      returned: 2,
      truncated: true,
      total: expect.any(Number),
      words: [expect.any(Object), expect.any(Object)],
    });
  });

  it('pages through the words with next_after_id until truncated is false', async () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);
    const seen: unknown[] = [];
    let afterId: string | undefined;

    for (let guard = 0; guard < 1000; guard += 1) {
      const page = bodyOf(
        await tool.handler({ state: 'any', limit: 2, include_audio: false, after_id: afterId }),
      ) as { truncated: boolean; next_after_id?: string; words: unknown[]; total: number };
      seen.push(...page.words);
      if (!page.truncated) {
        expect(page).not.toHaveProperty('next_after_id');
        expect(seen).toHaveLength(page.total);
        return;
      }
      afterId = page.next_after_id;
      expect(afterId).toEqual(expect.any(String));
    }
    throw new Error('paging did not terminate');
  });

  it('answers an unknown after_id with an error naming it', async () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ state: 'any', limit: 2, include_audio: false, after_id: '999999999' });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('after_id');
  });

  it('tells agents to page with after_id instead of raising the limit', () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    expect(tool.description).toContain('after_id');
    expect(tool.description).not.toContain('there is no offset');
  });

  it('tells agents to filter instead of paging, and names every filter', () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    expect(tool.description).toContain('filter instead of paging');
    for (const name of ['difficult', 'learned', 'known', 'heard', 'due_before', 'topic', 'lesson', 'min_growth_level', 'max_growth_level']) {
      expect(tool.description, name).toContain(name);
      expect(Object.keys(tool.inputSchema), name).toContain(name);
    }
    expect(tool.description).toContain('total counts the matching words');
    expect(tool.description).toContain('default limit 200');
  });

  it('narrows the list by a filter, and total counts the matching words', async () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    const all = bodyOf(await tool.handler({ state: 'any', limit: 200, include_audio: false })) as { total: number };
    const none = bodyOf(
      await tool.handler({ state: 'any', limit: 200, include_audio: false, min_growth_level: 9999 }),
    ) as { total: number; words: unknown[] };

    expect(all.total).toBeGreaterThan(0);
    expect(none).toMatchObject({ total: 0, returned: 0, truncated: false, words: [] });
  });

  it('passes the heard filter through: fixtures hold no heard-only word', async () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    const all = bodyOf(await tool.handler({ state: 'any', limit: 200, include_audio: false })) as { total: number };
    const heard = bodyOf(await tool.handler({ state: 'any', limit: 200, include_audio: false, heard: true }));
    const notHeard = bodyOf(await tool.handler({ state: 'any', limit: 200, include_audio: false, heard: false }));

    expect(heard).toMatchObject({ total: 0, words: [] });
    expect(notHeard).toMatchObject({ total: all.total });
  });

  it('passes a due_before date through and reads it in plain words when it is wrong', async () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    const ok = await tool.handler({ state: 'any', limit: 200, include_audio: false, due_before: '2000-01-01' });
    const bad = await tool.handler({ state: 'any', limit: 200, include_audio: false, due_before: 'tomorrow' });

    expect(ok.isError).toBeUndefined();
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain('due_before \\"tomorrow\\" is not a date');
  });

  it('rejects a negative growth level in the schema', () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    expect(z.object(tool.inputSchema).safeParse({ min_growth_level: -1 }).success).toBe(false);
    expect(z.object(tool.inputSchema).safeParse({ min_growth_level: 0, topic: 'food' }).success).toBe(true);
  });
});
