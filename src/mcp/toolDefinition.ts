/** What one MCP tool is: its registration metadata, its input shape, and the handler the server calls. */
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

export type ToolShape = Record<string, z.ZodType>;

/**
 * `handler` is a method, not a property, so tools with different input shapes can share one array.
 * The SDK validates arguments against `inputSchema` before the handler runs.
 */
export interface ToolDefinition<Shape extends ToolShape = ToolShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Shape;
  readonly annotations: ToolAnnotations;
  handler(args: z.output<z.ZodObject<Shape>>): Promise<CallToolResult>;
}
