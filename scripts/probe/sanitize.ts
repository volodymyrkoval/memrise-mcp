import { redactString } from '../../src/security/redactString.js';
import { isIdKey } from './shape.js';

const REDACTED = '<redacted>';
const REDACTED_KEYS = new Set(['access_token', 'token', 'username', 'email', 'csrftoken', 'sessionid_2', 'password']);
const TOKEN_MIN_LENGTH = 32;
const ALLOWED_HOST = 'static.memrise.com';

/** Keys whose string values are learner content (words, lesson titles, media links, timestamps). */
const LEARNER_TEXT_KEYS = new Set([
  'target_value', 'source_value', 'native_script', 'romanization', 'title', 'name', 'photo_url', 'icon_url',
  'next_review', 'date_started', 'date_completed',
]);
/** Keys whose numeric or string values identify learner content (learnable, lesson and topic ids). */
const LEARNER_ID_KEYS = new Set([
  'learnable_id', 'learnable_id_key', 'scenario_id', 'scenarioId', 'inProgressScenarioId', 'sharedDetailIds', 'topic_id',
]);

export interface SanitizerOptions {
  /** Also replaces learner content with placeholders; use for anything that is committed. */
  learnerData?: boolean;
}

export interface Sanitizer {
  sanitize(value: unknown): unknown;
}

/** Builds a sanitizer for probe output; page-token placeholders stay stable across every `sanitize` call. */
export function createSanitizer(knownSecrets: readonly string[], options: SanitizerOptions = {}): Sanitizer {
  const pageTokens = new Map<string, string>();
  const idPlaceholders = new Map<string, string>();
  const idKeys = new Map<string, string>();

  function placeholderForIdKey(key: string): string {
    if (!isIdKey(key)) return key;
    const existing = idKeys.get(key);
    if (existing !== undefined) return existing;
    const placeholder = `<id-key-${idKeys.size + 1}>`;
    idKeys.set(key, placeholder);
    return placeholder;
  }

  function placeholderForId(key: string, id: unknown): string {
    const label = `${key}:${String(id)}`;
    const existing = idPlaceholders.get(label);
    if (existing !== undefined) return existing;
    const placeholder = `<${key}-${[...idPlaceholders.keys()].filter((k) => k.startsWith(`${key}:`)).length + 1}>`;
    idPlaceholders.set(label, placeholder);
    return placeholder;
  }

  function learnerPlaceholder(node: unknown, key: string | undefined, parentKey: string | undefined): string | undefined {
    if (!options.learnerData) return undefined;
    const idKey = key !== undefined && LEARNER_ID_KEYS.has(key) ? key : parentKey !== undefined && LEARNER_ID_KEYS.has(parentKey) ? parentKey : undefined;
    if (idKey !== undefined && (typeof node === 'number' || typeof node === 'string')) return placeholderForId(idKey, node);
    if (key !== undefined && LEARNER_TEXT_KEYS.has(key) && typeof node === 'string') return `<${key}>`;
    if (parentKey === 'audios' && typeof node === 'string') return '<audio>';
    return undefined;
  }

  function placeholderForToken(token: string): string {
    const existing = pageTokens.get(token);
    if (existing !== undefined) return existing;
    const placeholder = `<page-token-${pageTokens.size + 1}>`;
    pageTokens.set(token, placeholder);
    return placeholder;
  }

  function sanitizeString(text: string): string {
    const redacted = redactString(text, knownSecrets);
    return looksLikeOpaqueToken(redacted) && !isMemriseStaticUrl(redacted) ? REDACTED : redacted;
  }

  function sanitizeNode(node: unknown, key: string | undefined, parentKey: string | undefined): unknown {
    if (key !== undefined && REDACTED_KEYS.has(key)) return REDACTED;
    const placeholder = learnerPlaceholder(node, key, parentKey);
    if (placeholder !== undefined) return placeholder;
    if (key === 'next_page_token' && typeof node === 'string') return placeholderForToken(node);
    if (key === 'id' && parentKey === 'user' && typeof node === 'number') return 0;
    if (typeof node === 'string') return sanitizeString(node);
    if (Array.isArray(node)) return node.map((item) => sanitizeNode(item, undefined, key));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([childKey, child]) => [placeholderForIdKey(childKey), sanitizeNode(child, childKey, key)]),
      );
    }
    return node;
  }

  return { sanitize: (value) => sanitizeNode(value, undefined, undefined) };
}

function looksLikeOpaqueToken(text: string): boolean {
  return text.length >= TOKEN_MIN_LENGTH && !/\s/.test(text);
}

function isMemriseStaticUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}
