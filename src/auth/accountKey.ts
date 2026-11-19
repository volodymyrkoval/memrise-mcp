import { createHash } from 'node:crypto';

/** Binds a stored session to the account it was created for; the username itself is never stored. */
export function accountKey(username: string): string {
  return createHash('sha256').update(username.trim().toLowerCase()).digest('hex').slice(0, 16);
}
