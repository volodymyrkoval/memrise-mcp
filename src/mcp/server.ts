/** Registers tool definitions on an MCP server. Tools are the only surface; no resources or prompts. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDefinition } from './toolDefinition.js';

export interface ServerInfo {
  name: string;
  version: string;
}

export function createMcpServer(tools: readonly ToolDefinition[], info: ServerInfo): McpServer {
  const server = new McpServer(info);
  for (const tool of tools) registerTool(server, tool);
  return server;
}

function registerTool(server: McpServer, tool: ToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    },
    (args) => tool.handler(args),
  );
}
