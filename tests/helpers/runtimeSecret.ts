import { randomUUID } from 'node:crypto';

/**
 * A credential-shaped test value built at runtime, so no literal secret ever sits in the repo
 * (the secret scanner runs over tracked files).
 */
export function runtimeSecret(label: string): string {
  return `${label}-${randomUUID()}`;
}
