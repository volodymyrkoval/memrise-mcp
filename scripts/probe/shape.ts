/** One-line structural summary of a JSON value: key names, value types, array lengths. Never contains values. */
export function summarizeShape(value: unknown): string {
  if (Array.isArray(value)) return describeArray(value);
  if (isObject(value)) {
    const entries = Object.entries(value).map(([key, child]) => `${keyLabel(key)}: ${describeNested(child)}`);
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return primitiveType(value);
}

function describeNested(value: unknown): string {
  if (Array.isArray(value)) return describeArray(value);
  if (isObject(value)) return `object{${keyNames(Object.keys(value))}}`;
  return primitiveType(value);
}

function describeArray(items: unknown[]): string {
  const head = `array[${items.length}]`;
  return items.length === 0 ? head : `${head} of ${describeItem(items[0])}`;
}

function describeItem(item: unknown): string {
  if (isObject(item)) return `{${keyNames(Object.keys(item))}}`;
  return Array.isArray(item) ? `array[${item.length}]` : primitiveType(item);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function primitiveType(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

const ID_KEY = '<id-key>';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_KEY_LENGTH = 24;

/** A key that is data rather than a field name: digits only, a uuid, or a long token-like string. */
export function isIdKey(key: string): boolean {
  return /^\d+$/.test(key) || UUID.test(key) || (key.length >= LONG_KEY_LENGTH && !/\s/.test(key));
}

function keyLabel(key: string): string {
  return isIdKey(key) ? ID_KEY : key;
}

/** Field names in order, with all id-like keys folded into one `<id-key> x N` entry at the first one's position. */
function keyNames(keys: string[]): string {
  const idCount = keys.filter(isIdKey).length;
  const names: string[] = [];
  let idEmitted = false;
  for (const key of keys) {
    if (!isIdKey(key)) names.push(key);
    else if (!idEmitted) {
      names.push(`${ID_KEY} x ${idCount}`);
      idEmitted = true;
    }
  }
  return names.join(', ');
}
