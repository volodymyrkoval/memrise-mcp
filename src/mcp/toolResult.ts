/** The MCP result envelope every tool returns: JSON text on success, a redacted message on failure. */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatUserMessage, type DebugSink } from '../errorMessages.js';
import type { Redactor } from '../log/redactor.js';

/** Every tool only reads: nothing is marked, reviewed, ignored or edited. */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Shared tool-description sentences: a partial result is still a success, and the first call is slow. */
export const PARTIAL_RESULTS_NOTE =
  'If some lesson details cannot be fetched, results are still returned without those lesson links and a `warnings` field names the failed lesson ids.';
export const STATE_NOTE = "state: 'any' (default) = every word you have met; 'fully_learned_or_known' = only fully learned or already-known words.";
export const WORD_ROW_NOTE =
  "Each word row has word (in the language being learned) and translation (its meaning in the learner's own language). next_review is null unless the word is learned (words never studied, or already known, have none).";
/** For tools whose rows can lack a lesson: why, and what to say about it. */
export const ORIGIN_NOTE =
  "origin is 'lesson' when a completed or in-progress lesson teaches the word, 'other' when none does (words you have only heard, heard: true, not learned or known, from content outside your lessons; next_review is null so they never look overdue), 'unknown' when none is linked but a lesson failed to load (see warnings); words that are not 'lesson' have no lessons or topics.";
/** For tools whose rows carry `heard`: what the flag is, and the one reading the evidence supports. */
export const HEARD_NOTE =
  "heard is Memrise's own flag that the word has been heard (its trigger is not documented); heard: true on a word that is not learned or known means only heard, never studied.";
export const COLD_START_NOTE = 'The first call in a fresh process with a cold cache is noticeably slower because every completed lesson is fetched once; later calls are fast.';

/** Compact JSON as one text block; no `structuredContent`, since clients read the text. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** A failed call: the message is redacted here, so no tool can forget to scrub it. */
export function errorResult(err: unknown, redactor: Redactor, debug?: DebugSink): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: formatUserMessage(err, redactor, debug) }] };
}

/** Runs one tool's use case: a value becomes JSON text, a throw becomes a redacted error result. Handlers never throw to the SDK. */
export async function runTool(
  redactor: Redactor,
  action: () => Promise<unknown>,
  debug?: DebugSink,
): Promise<CallToolResult> {
  try {
    return jsonResult(await action());
  } catch (err) {
    return errorResult(err, redactor, debug);
  }
}
