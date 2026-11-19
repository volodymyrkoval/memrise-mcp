import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExport } from '../../../src/cli/runExport.js';
import { defineLearnablesListTool } from '../../../src/mcp/tools/learnablesList.js';
import { defineLearnablesLookupTool } from '../../../src/mcp/tools/learnablesLookup.js';
import { defineScenarioLearnablesTool } from '../../../src/mcp/tools/scenarioLearnables.js';
import { syntheticDetails } from '../../helpers/fixtureApi.js';
import { createFixtureApp, FIXTURE_START_MS, type FixtureApp } from '../../helpers/fixtureApp.js';

/** "the book" in the fixture learnables; its raw item is made `heard: true` below. */
const HEARD_ID = 65500000065536;
const LESSON_ID = 2005;

let workDir: string;
let harness: FixtureApp;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memrise-heard-'));
  harness = createFixtureApp({
    cacheDir: join(workDir, 'cache'),
    heardIds: [HEARD_ID],
    details: { [LESSON_ID]: { status: 200, body: syntheticDetails([HEARD_ID]) } },
  });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function bodyOf(result: { content: { type: string; text?: string }[] }): any {
  return JSON.parse(result.content[0].text ?? '');
}

describe('a raw item with heard: true reaches every tool output as heard: true', () => {
  it('learnables_list', async () => {
    const tool = defineLearnablesListTool(harness.app.queries, harness.app.redactor);

    const body = bodyOf(await tool.handler({ state: 'any', limit: 200, include_audio: false }));

    expect(body.words.filter((w: any) => w.heard).map((w: any) => w.word)).toEqual(['the book']);
  });

  it('learnables_lookup', async () => {
    const tool = defineLearnablesLookupTool(harness.app.queries, harness.app.redactor);

    const body = bodyOf(await tool.handler({ terms: ['the book'], state: 'any' }));

    expect(body.results[0].items[0]).toMatchObject({ word: 'the book', heard: true });
  });

  it('scenario_learnables', async () => {
    const tool = defineScenarioLearnablesTool(harness.app.queries, harness.app.redactor);

    const body = bodyOf(await tool.handler({ scenario_id: LESSON_ID, include_audio: false }));

    expect(body.words).toEqual([expect.objectContaining({ word: 'the book', heard: true })]);
  });

  it('export', async () => {
    const out = join(workDir, 'memrise.json');

    await runExport(harness.app, { out, state: 'any', includeAudio: false }, () => FIXTURE_START_MS);

    const doc = JSON.parse(await readFile(out, 'utf8'));
    expect(doc.words.filter((w: any) => w.heard).map((w: any) => w.word)).toEqual(['the book']);
  });

  it('a second process reading the word cache the first one wrote still sees heard: true', async () => {
    await harness.app.queries.listWords({ limit: 200, includeAudio: false });
    const second = createFixtureApp({ cacheDir: join(workDir, 'cache'), credentials: harness.credentials });

    const result = await second.app.queries.listWords({ limit: 200, includeAudio: false, heard: true });

    expect(second.transport.countFor('/v1.25/me/language_pairs/7/learnables/')).toBe(0);
    expect(result.words.map((w) => w.word)).toEqual(['the book']);
  });
});
