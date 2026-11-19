import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { versionMismatches } from '../../../scripts/checkVersions.js';

const server = (top: string, pkg: string) => ({ version: top, packages: [{ identifier: 'memrise-mcp', version: pkg }] });

describe('versionMismatches', () => {
  it('is empty when every file carries the same version', () => {
    expect(versionMismatches({ version: '1.2.3' }, server('1.2.3', '1.2.3'), '1.2.3')).toEqual([]);
  });

  it('names server.json when its top-level version differs', () => {
    expect(versionMismatches({ version: '1.2.3' }, server('1.2.4', '1.2.3'), '1.2.3')).toEqual([
      expect.stringContaining('server.json version 1.2.4'),
    ]);
  });

  it('names the server.json package entry when it differs', () => {
    expect(versionMismatches({ version: '1.2.3' }, server('1.2.3', '1.0.0'), '1.2.3')).toEqual([
      expect.stringContaining('server.json packages[0] version 1.0.0'),
    ]);
  });

  it('names the source constant when it differs from package.json', () => {
    expect(versionMismatches({ version: '1.2.3' }, server('1.2.3', '1.2.3'), '0.9.0')).toEqual([
      expect.stringContaining('src/version.ts VERSION 0.9.0'),
    ]);
  });

  it('holds for the files in this repository', async () => {
    const read = async (name: string) => JSON.parse(await readFile(new URL(`../../../${name}`, import.meta.url), 'utf8'));
    const { VERSION } = await import('../../../src/version.js');
    expect(versionMismatches(await read('package.json'), await read('server.json'), VERSION)).toEqual([]);
  });
});
