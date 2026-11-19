import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectMcpClient, type ConnectedClient } from '../../helpers/mcpClient.js';
import { createFixtureApp, type FixtureApp } from '../../helpers/fixtureApp.js';

const TOOL_NAMES = ['language_pairs_list', 'learnables_list', 'learnables_lookup', 'scenarios_list', 'scenario_learnables'];

let cacheDir: string;
let harness: FixtureApp;
let connected: ConnectedClient;
let client: Client;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-server-'));
  harness = createFixtureApp({ cacheDir });
  connected = await connectMcpClient(harness.app);
  client = connected.client;
});

afterEach(async () => {
  await connected.close();
  await rm(cacheDir, { recursive: true, force: true });
});

describe('MCP server', () => {
  it('lists exactly the five memrise tools', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('marks every tool read-only and non-destructive', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('tells the caller about warnings on the word and lesson tools, and names the default state', async () => {
    const { tools } = await client.listTools();
    const described = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';

    for (const name of ['learnables_list', 'learnables_lookup', 'scenarios_list', 'scenario_learnables']) {
      expect(described(name), name).toContain('`warnings`');
    }
    for (const name of ['learnables_list', 'learnables_lookup']) {
      expect(described(name), name).toContain("state: 'any' (default)");
    }
  });

  it('explains origin and the null next_review on the tools that return word rows', async () => {
    const { tools } = await client.listTools();
    const described = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';

    expect(described('scenario_learnables')).toContain('next_review is null unless the word is learned');
    for (const name of ['learnables_list', 'learnables_lookup']) {
      expect(described(name), name).toContain('next_review is null unless the word is learned');
      expect(described(name), name).toContain("origin is 'lesson'");
      expect(described(name), name).toContain("'other'");
      expect(described(name), name).toContain("'unknown'");
    }
  });

  it("says heard is Memrise's own flag with an undocumented trigger, and what heard: true on an unstudied word shows", async () => {
    const { tools } = await client.listTools();

    for (const name of ['learnables_list', 'learnables_lookup']) {
      const description = tools.find((tool) => tool.name === name)?.description ?? '';
      expect(description, name).toContain("heard is Memrise's own flag that the word has been heard (its trigger is not documented)");
      expect(description, name).toContain('heard: true on a word that is not learned or known means only heard, never studied');
      expect(description, name).not.toMatch(/audio|video/i);
    }
  });

  it('says due words come most overdue first when due_before is set', async () => {
    const { tools } = await client.listTools();

    const description = tools.find((tool) => tool.name === 'learnables_list')?.description ?? '';
    expect(description).toContain('most overdue first when due_before is set');
  });

  it('says an unknown topic or lesson gets a warning that lists the valid names', async () => {
    const { tools } = await client.listTools();

    const description = tools.find((tool) => tool.name === 'learnables_list')?.description ?? '';
    expect(description).toContain('a topic or lesson that matches nothing adds a warning listing the valid names');
  });

  it('explains that other-origin words are only heard, and claims no specific source', async () => {
    const { tools } = await client.listTools();

    for (const name of ['learnables_list', 'learnables_lookup']) {
      const description = tools.find((tool) => tool.name === name)?.description ?? '';
      expect(description, name).toContain('only heard');
      expect(description, name).toContain('heard: true');
      expect(description, name).toContain('outside your lessons');
      expect(description, name).not.toMatch(/video|immersion|other Memrise content/i);
    }
  });

  it('assumes no particular language in any tool description or schema', async () => {
    const { tools } = await client.listTools();

    const everything = JSON.stringify(tools);
    expect(everything).not.toMatch(/portugu|english|spanish|\bpt\b/i);
    const lookup = tools.find((tool) => tool.name === 'learnables_lookup')?.description ?? '';
    expect(lookup).toContain('language being learned');
    expect(lookup).toContain('word');
    expect(lookup).toContain('translation');
  });
});
