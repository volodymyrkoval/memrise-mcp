import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectMcpClient, type ConnectedClient } from '../../helpers/mcpClient.js';
import { createFixtureApp, type FixtureApp } from '../../helpers/fixtureApp.js';

/** A lesson whose details answer 503 on every attempt, so the lesson-fetch failure is final. */
const FAILING_LESSON = 2003;

let cacheDir: string;
let harness: FixtureApp;
let connected: ConnectedClient;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-mcp-partial-'));
  harness = createFixtureApp({ cacheDir, details: { [FAILING_LESSON]: { status: 503 } } });
  connected = await connectMcpClient(harness.app);
});

afterEach(async () => {
  await connected.close();
  await rm(cacheDir, { recursive: true, force: true });
});

/** `callTool` may return the compatibility result shape; tools in this server always return `CallToolResult`. */
async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await connected.client.callTool({ name, arguments: args })) as CallToolResult;
}

function bodyOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected a text block');
  return JSON.parse(block.text) as Record<string, unknown>;
}

function textOf(result: CallToolResult): string {
  return JSON.stringify(result.content);
}

describe('MCP tools over a failed lesson', () => {
  it.each([
    ['learnables_list', { state: 'any', limit: 200, include_audio: false }],
    ['learnables_lookup', { terms: ['book'], state: 'any' }],
    ['scenarios_list', { type: 'completed' }],
  ])('%s succeeds and names the failed lesson in warnings', async (name, args) => {
    const result = await call(name, args);

    expect(result.isError).toBeFalsy();
    const warnings = bodyOf(result).warnings as string[];
    expect(warnings).toHaveLength(name === 'scenarios_list' ? 1 : 2);
    expect(warnings[0]).toContain(String(FAILING_LESSON));
  });

  it('scenario_learnables for the failed lesson is an error naming the lesson noun and the status', async () => {
    const result = await call('scenario_learnables', { scenario_id: FAILING_LESSON, include_audio: false });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('reading a lesson');
    expect(textOf(result)).toContain('HTTP 503');
  });
});

describe('MCP tools when Memrise keeps rate-limiting', () => {
  it('returns an error result with the rate-limit message instead of a warning', async () => {
    harness.details[FAILING_LESSON] = { status: 429 };

    const result = await call('learnables_list', { state: 'any', limit: 200, include_audio: false });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: expect.stringMatching(
          /^Memrise asked us to slow down\. Try again after \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\.$/,
        ),
      },
    ]);
  });
});
