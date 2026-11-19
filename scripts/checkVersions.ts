import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { VERSION } from '../src/version.js';

interface PackageJson {
  version: string;
}
interface ServerJson {
  version: string;
  packages?: readonly { version: string }[];
}

/** Lists every place whose version differs from package.json; empty means all agree. */
export function versionMismatches(pkg: PackageJson, server: ServerJson, sourceVersion: string): string[] {
  const expected = pkg.version;
  const found: [string, string | undefined][] = [
    ['server.json version', server.version],
    ...(server.packages ?? []).map((entry, i): [string, string] => [`server.json packages[${i}] version`, entry.version]),
    ['src/version.ts VERSION', sourceVersion],
  ];
  return found.filter(([, v]) => v !== expected).map(([name, v]) => `${name} ${v} differs from package.json ${expected}`);
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8')) as T;
}

/** Exits 1 when package.json, server.json and the source constant disagree on the version. */
export async function main(): Promise<number> {
  const problems = versionMismatches(await readJson('package.json'), await readJson('server.json'), VERSION);
  if (problems.length === 0) return 0;
  for (const line of problems) console.error(`check-versions: ${line}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
