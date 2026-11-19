/**
 * Connects an SDK `Client` to `createMcpServer` over an in-memory transport, so tests exercise the
 * real protocol path (schema validation, annotations, error mapping) without stdio.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { App } from '../../src/app/buildApp.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { defineMemriseTools } from '../../src/mcp/tools/index.js';

export interface ConnectedClient {
  client: Client;
  close(): Promise<void>;
}

export async function connectMcpClient(app: App): Promise<ConnectedClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(defineMemriseTools(app.queries, app.redactor), {
    name: 'memrise-mcp',
    version: '0.0.0-test',
  });
  await server.connect(serverTransport);
  const client = new Client({ name: 'memrise-mcp-test', version: '0.0.0-test' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
