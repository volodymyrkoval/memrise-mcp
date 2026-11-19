import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accountKey } from '../../../src/auth/accountKey.js';

// Usernames are built at runtime and kept free of '@' so the repo secret scanner never reads them as e-mails.
const USERNAME = ['learner', 'user'].join('-');

describe('accountKey', () => {
  it('is the first 16 hex characters of the SHA-256 of the username', () => {
    const expected = createHash('sha256').update(USERNAME).digest('hex').slice(0, 16);

    expect(accountKey(USERNAME)).toBe(expected);
  });

  it('is the same for the same username typed with different case or surrounding spaces', () => {
    const padded = `  ${USERNAME.toUpperCase()} `;

    expect(accountKey(padded)).toBe(accountKey(USERNAME));
  });
});
