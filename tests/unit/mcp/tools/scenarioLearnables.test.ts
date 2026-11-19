import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineScenarioLearnablesTool } from '../../../../src/mcp/tools/scenarioLearnables.js';
import { createFixtureApp, type FixtureApp } from '../../../helpers/fixtureApp.js';

/** The fixture completed lesson in `scenario-details-1001.json`: 10 items after trimming. */
const FIXTURE_LESSON = 1001;

let cacheDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-tool-lesson-'));
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

describe('scenario_learnables tool', () => {
  it("returns one lesson's words", async () => {
    const tool = defineScenarioLearnablesTool(harness.app.queries, harness.app.redactor);

    const result = await tool.handler({ scenario_id: FIXTURE_LESSON, include_audio: false });

    expect(result.isError).toBeUndefined();
    expect(bodyOf(result)).toMatchObject({
      words: expect.arrayContaining([expect.objectContaining({ word: 'the plate is on the table' })]),
    });
  });
});
