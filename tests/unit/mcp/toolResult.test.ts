import { describe, expect, it } from 'vitest';
import { UsageError } from '../../../src/errors.js';
import { Redactor } from '../../../src/log/redactor.js';
import { errorResult, jsonResult, READ_ONLY_ANNOTATIONS, runTool } from '../../../src/mcp/toolResult.js';
import { runtimeSecret } from '../../helpers/runtimeSecret.js';

describe('jsonResult', () => {
  it('wraps a value as one compact JSON text block', () => {
    expect(jsonResult({ total: 2 })).toEqual({ content: [{ type: 'text', text: '{"total":2}' }] });
  });
});

describe('errorResult', () => {
  it('flags the result as an error and passes the message through the redactor', () => {
    const password = runtimeSecret('pw');
    const redactor = new Redactor();
    redactor.addSecret(password);

    const result = errorResult(new UsageError(`echoed ${password}`), redactor);

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'echoed <redacted>' },
    ]);
  });
});

describe('runTool', () => {
  it('hides the raw text of an unexpected error from the client and hands it to the debug sink', async () => {
    const logged: string[] = [];

    const result = await runTool(
      new Redactor(),
      async () => {
        throw new TypeError('internal detail');
      },
      { debug: (line) => logged.push(line) },
    );

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Something unexpected went wrong. Run with MEMRISE_DEBUG=1 to see details.' }],
    });
    expect(logged).toEqual(['unexpected error: internal detail']);
  });
});

describe('READ_ONLY_ANNOTATIONS', () => {
  it('marks a tool as read-only, non-destructive and idempotent', () => {
    expect(READ_ONLY_ANNOTATIONS).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});
