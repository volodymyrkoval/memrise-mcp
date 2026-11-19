import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineScenariosListTool } from '../../../../src/mcp/tools/scenariosList.js';
import { createFixtureApp, type FixtureApp } from '../../../helpers/fixtureApp.js';

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-tool-scenarios-'));
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

describe('scenarios_list tool', () => {
  it('lists the completed lessons with their rows', async () => {
    const tool = defineScenariosListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ type: 'completed' });

    expect(result.isError).toBeUndefined();
    expect(bodyOf(result)).toMatchObject({ scenarios: expect.arrayContaining([expect.objectContaining({ scenario_id: 2005 })]) });
  });

  it('drops lessons completed before since', async () => {
    const tool = defineScenariosListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ type: 'completed', since: '2099-01-01' });

    expect(bodyOf(result)).toEqual({ scenarios: [] });
  });

  it.each(['2026-02-30', '2026-13-01', 'last week'])('answers since %s with a readable message, not a schema error', async (since) => {
    const tool = defineScenariosListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ type: 'completed', since });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining(`since "${since}" is not a date`) });
  });

  it('rejects a since date-time without a time zone and says how to fix it', async () => {
    const tool = defineScenariosListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ type: 'completed', since: '2026-01-01T09:30:00' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('has no time zone') });
  });

  it.each(['2026-01-01', '2026-01-01T09:30:00Z', '2026-01-01T09:30:00+01:00'])('accepts since %s', async (since) => {
    const tool = defineScenariosListTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ type: 'completed', since });

    expect(result.isError).toBeUndefined();
  });
});
