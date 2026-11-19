import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanForSecrets } from '../../../src/security/scanForSecrets.js';
import { connectMcpClient, type ConnectedClient } from '../../helpers/mcpClient.js';
import { createFixtureApp, type FixtureApp } from '../../helpers/fixtureApp.js';
import { runtimeSecret } from '../../helpers/runtimeSecret.js';

let cacheDir: string;
let connected: ConnectedClient | undefined;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'memrise-tool-edges-'));
});

afterEach(async () => {
  await connected?.close();
  connected = undefined;
  await rm(cacheDir, { recursive: true, force: true });
});

async function connectTo(harness: FixtureApp): Promise<ConnectedClient> {
  connected = await connectMcpClient(harness.app);
  return connected;
}

describe('MCP tool edge cases', () => {
  it.each([
    ['learnables_list', { limit: 0 }],
    ['learnables_lookup', { terms: [] }],
    ['scenario_learnables', { scenario_id: -1 }],
    ['learnables_list', { state: 'all' }],
    ['scenarios_list', { type: 'all' }],
  ])('rejects invalid arguments to %s before the handler runs: %j', async (name, args) => {
    const { client } = await connectTo(createFixtureApp({ cacheDir }));

    const result = await client.callTool({ name, arguments: args });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(`Invalid arguments for tool ${name}`);
  });

  it('turns a failed login into an error result that carries no secret', async () => {
    const wrongPassword = runtimeSecret('wrong');
    const harness = createFixtureApp({ cacheDir, env: { MEMRISE_PASSWORD: wrongPassword } });
    const { client } = await connectTo(harness);

    const result = await client.callTool({ name: 'language_pairs_list', arguments: {} });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('Could not sign in to Memrise. Check MEMRISE_USERNAME and MEMRISE_PASSWORD');
    expect(scanForSecrets(text, [wrongPassword, harness.credentials.password, harness.credentials.username])).toEqual([]);
  });
});
